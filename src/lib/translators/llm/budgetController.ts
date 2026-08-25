// cspell:ignore AIMD cooldown
import type { TranslationModelProfile } from './modelProfile';
import { SIZE_TIER_BUDGETS, type TranslationModelSizeTier } from './sizeTier';

/**
 * Conservative defaults anchored by the supplied Ling trace. Dimensions that
 * trace cannot identify (429 behavior and missing size tiers) retain the ADR's
 * safety values; the benchmark reports those synthetic caveats explicitly.
 */
export interface TranslationBudgetTuning {
  growthStep: number;
  rateLimitShrinkFactor: number;
  latencyShrinkFactor: number;
  latencyRegressionMultiplier: number;
  baselineObservationCount: number;
  rollingObservationWindow: number;
  cleanObservationWindow: number;
  allocationObservationWindow: number;
  highValidationFailureRate: number;
  lowValidationFailureRate: number;
  highFailureBatchFactor: number;
  lowFailureBatchFactor: number;
  persistedColdStartFactor: number;
}

export const BUDGET_TUNING: TranslationBudgetTuning = {
  growthStep: 0.1,
  rateLimitShrinkFactor: 0.5,
  latencyShrinkFactor: 0.8,
  latencyRegressionMultiplier: 1.5,
  baselineObservationCount: 10,
  rollingObservationWindow: 6,
  cleanObservationWindow: 6,
  allocationObservationWindow: 6,
  highValidationFailureRate: 0.05,
  lowValidationFailureRate: 0.03,
  highFailureBatchFactor: 0.8,
  lowFailureBatchFactor: 1.25,
  persistedColdStartFactor: 0.8,
};

export interface TranslationBudgetObservation {
  valid: boolean;
  truncated: boolean;
  timedOut: boolean;
  latencyMs: number;
  validationFailures: number;
  targetCount: number;
  rateLimited: boolean;
  retryAfterMs: number | null;
  sourceTokens: number;
}

export interface BudgetSnapshot {
  concurrency: number;
  batchSourceTokens: number;
  budgetTokens: number;
}

const finitePositive = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 1;

const percentile = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.5))] ?? 0;
};

export class TranslationBudgetController {
  private readonly tierSpec: (typeof SIZE_TIER_BUDGETS)[TranslationModelSizeTier];
  private readonly getOutputRatio: () => number;
  private readonly tuning: TranslationBudgetTuning;
  private readonly now: () => number;
  private readonly minConcurrency: number;
  private readonly maxConcurrency: number;
  private readonly minBatchSourceTokens: number;
  private readonly maxBatchSourceTokens: number;
  private concurrency: number;
  private batchSourceTokens: number;
  private budgetTokens: number;
  private readonly baselineLatencies: number[] = [];
  private readonly rollingLatencies: number[] = [];
  private readonly allocationObservations: TranslationBudgetObservation[] = [];
  private readonly cleanObservations: TranslationBudgetObservation[] = [];
  private cooldownUntil = 0;

  public constructor(options: {
    tier: TranslationModelSizeTier;
    profile: TranslationModelProfile;
    userConcurrencyCeiling: number | null;
    persisted: BudgetSnapshot | null;
    getOutputRatio: () => number;
    tuning?: Partial<TranslationBudgetTuning>;
    now?: () => number;
  }) {
    this.tierSpec = SIZE_TIER_BUDGETS[options.tier];
    this.getOutputRatio = options.getOutputRatio;
    this.tuning = { ...BUDGET_TUNING, ...options.tuning };
    this.now = options.now ?? Date.now;
    this.maxConcurrency = Math.max(
      1,
      Math.min(this.tierSpec.maxConcurrency, options.userConcurrencyCeiling ?? 12),
    );
    this.minConcurrency = Math.min(this.tierSpec.minConcurrency, this.maxConcurrency);
    this.maxBatchSourceTokens = Math.max(
      1,
      Math.min(
        this.tierSpec.maxBatchSourceTokens,
        options.profile.batching.maxSourceTokens,
      ),
    );
    this.minBatchSourceTokens = Math.min(
      this.tierSpec.minBatchSourceTokens,
      this.maxBatchSourceTokens,
    );

    const persisted = options.persisted;
    this.concurrency = this.clampConcurrency(
      persisted?.concurrency ?? this.tierSpec.initialConcurrency,
    );
    this.batchSourceTokens = this.clampBatchSourceTokens(
      persisted?.batchSourceTokens ?? this.tierSpec.initialBatchSourceTokens,
    );
    const initialBudget =
      persisted?.budgetTokens ??
      this.concurrency * this.batchSourceTokens * this.outputMultiplier();
    this.budgetTokens = this.clampBudget(
      finitePositive(initialBudget) *
        (persisted === null ? 1 : this.tuning.persistedColdStartFactor),
    );
    this.reallocateForBudget();
  }

  public getConcurrency(): number {
    this.reallocateForBudget();
    return this.concurrency;
  }

  public getBatchSourceTokens(): number {
    return this.batchSourceTokens;
  }

  public observe(observation: TranslationBudgetObservation): void {
    const now = this.now();
    const baselineReady =
      this.baselineLatencies.length >= this.tuning.baselineObservationCount;
    const contributesToAllocation =
      !observation.rateLimited &&
      (observation.valid || observation.validationFailures > 0);
    if (contributesToAllocation) {
      this.allocationObservations.push(observation);
      if (this.allocationObservations.length > this.tuning.allocationObservationWindow) {
        this.allocationObservations.shift();
      }
    }

    if (observation.rateLimited) {
      this.budgetTokens = this.clampBudget(
        this.budgetTokens * this.tuning.rateLimitShrinkFactor,
      );
      const retryAfterMs = observation.retryAfterMs ?? 0;
      this.cooldownUntil = Math.max(this.cooldownUntil, now + Math.max(0, retryAfterMs));
      this.cleanObservations.length = 0;
      this.reallocateForBudget();
    }

    if (
      !observation.rateLimited &&
      Number.isFinite(observation.latencyMs) &&
      observation.latencyMs > 0
    ) {
      if (this.baselineLatencies.length < this.tuning.baselineObservationCount) {
        this.baselineLatencies.push(observation.latencyMs);
      } else {
        this.rollingLatencies.push(observation.latencyMs);
        if (this.rollingLatencies.length > this.tuning.rollingObservationWindow) {
          this.rollingLatencies.shift();
        }
        if (
          this.rollingLatencies.length >= this.tuning.rollingObservationWindow &&
          percentile(this.rollingLatencies) >
            percentile(this.baselineLatencies) * this.tuning.latencyRegressionMultiplier
        ) {
          this.budgetTokens = this.clampBudget(
            this.budgetTokens * this.tuning.latencyShrinkFactor,
          );
          this.rollingLatencies.length = 0;
          this.cleanObservations.length = 0;
          this.reallocateForBudget();
        }
      }
    }

    const failureRate = this.validationFailureRate();
    if (
      contributesToAllocation &&
      this.allocationObservations.length >= this.tuning.allocationObservationWindow
    ) {
      if (failureRate >= this.tuning.highValidationFailureRate) {
        this.batchSourceTokens = this.clampBatchSourceTokens(
          this.batchSourceTokens * this.tuning.highFailureBatchFactor,
        );
        this.reallocateForBudget();
      } else if (failureRate <= this.tuning.lowValidationFailureRate) {
        this.batchSourceTokens = this.clampBatchSourceTokens(
          this.batchSourceTokens * this.tuning.lowFailureBatchFactor,
        );
        this.reallocateForBudget();
      }
      this.allocationObservations.length = 0;
    }

    const isClean =
      !observation.rateLimited &&
      observation.valid &&
      !observation.truncated &&
      !observation.timedOut &&
      observation.validationFailures === 0;
    if (isClean && baselineReady) this.cleanObservations.push(observation);
    else this.cleanObservations.length = 0;
    if (
      this.cleanObservations.length >= this.tuning.cleanObservationWindow &&
      now >= this.cooldownUntil
    ) {
      this.budgetTokens = this.clampBudget(
        this.budgetTokens * (1 + this.tuning.growthStep),
      );
      this.cleanObservations.length = 0;
      this.reallocateForBudget();
    }
  }

  public getDispatchDelayMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  public snapshot(): BudgetSnapshot {
    this.reallocateForBudget();
    return {
      concurrency: this.concurrency,
      batchSourceTokens: this.batchSourceTokens,
      budgetTokens: this.budgetTokens,
    };
  }

  private outputMultiplier(): number {
    const ratio = this.getOutputRatio();
    return 1 + (Number.isFinite(ratio) && ratio >= 0 ? ratio : 1.35);
  }

  private clampConcurrency(value: number): number {
    return Math.max(
      this.minConcurrency,
      Math.min(this.maxConcurrency, Math.max(1, Math.floor(finitePositive(value)))),
    );
  }

  private clampBatchSourceTokens(value: number): number {
    return Math.max(
      this.minBatchSourceTokens,
      Math.min(this.maxBatchSourceTokens, Math.max(1, Math.floor(finitePositive(value)))),
    );
  }

  private clampBudget(value: number): number {
    const ratio = this.outputMultiplier();
    const minimum = this.minConcurrency * this.minBatchSourceTokens * ratio;
    const maximum = Math.min(
      this.tierSpec.budgetCeilingTokens * ratio,
      this.maxConcurrency * this.maxBatchSourceTokens * ratio,
    );
    return Math.max(minimum, Math.min(maximum, finitePositive(value)));
  }

  private reallocateForBudget(): void {
    this.budgetTokens = this.clampBudget(this.budgetTokens);
    const ratio = this.outputMultiplier();
    const desiredConcurrency = Math.floor(
      this.budgetTokens / (this.batchSourceTokens * ratio),
    );
    this.concurrency = this.clampConcurrency(desiredConcurrency);
    const maxBatchByBudget = Math.floor(this.budgetTokens / (this.concurrency * ratio));
    this.batchSourceTokens = this.clampBatchSourceTokens(
      Math.min(this.batchSourceTokens, maxBatchByBudget),
    );
  }

  private validationFailureRate(): number {
    if (this.allocationObservations.length === 0) return 0;
    let failedTargets = 0;
    let targetCount = 0;
    for (const observation of this.allocationObservations) {
      const count = Number.isFinite(observation.targetCount)
        ? Math.max(0, Math.floor(observation.targetCount))
        : 0;
      if (count === 0) continue;
      const failures = Number.isFinite(observation.validationFailures)
        ? Math.max(0, Math.floor(observation.validationFailures))
        : 0;
      failedTargets += Math.min(count, failures);
      targetCount += count;
    }
    return targetCount === 0 ? 0 : failedTargets / targetCount;
  }
}
