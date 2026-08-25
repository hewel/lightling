#!/usr/bin/env bun
// cspell:ignore batchx cooldown latx makespan
/*
 * Translation budget benchmark harness.
 * Run with: bun scripts/translationBudgetBenchmark.ts --help
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUDGET_TUNING,
  TranslationBudgetController,
  type TranslationBudgetTuning,
} from '../src/lib/translators/llm/budgetController';
import type { TranslationModelProfile } from '../src/lib/translators/llm/modelProfile';
import {
  SIZE_TIER_BUDGETS,
  type TranslationModelSizeTier,
} from '../src/lib/translators/llm/sizeTier';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const defaultSeed = 0x4c494e47;
const defaultTop = 5;
const defaultSimulations = 32;
const defaultTpmWall = 0;
const calibrationSchema = 'lightling.page-translation-log.v2';
const tierOrder: readonly TranslationModelSizeTier[] = ['small', 'medium', 'large'];

type ColdStart = 'fresh' | 'persisted-0.8';

interface CliOptions {
  calibrationPath: string | null;
  jsonOnly: boolean;
  lambda: number | null;
  pageTokens: number | null;
  seed: number;
  simulations: number;
  top: number;
  tpmWall: number;
}

interface CalibrationBatch {
  sourceTokens: number;
  providerTokens: number;
  tokenEvidence: 'measured-estimate' | 'synthetic';
  targetCount: number;
  latencyMs: number | null;
  retryCount: number;
  validationFailures: number;
  allocationEligible: boolean;
  tier: TranslationModelSizeTier | null;
  model: string | null;
}

interface CalibrationGroupFit {
  batches: number;
  providerTargets: number;
  providerSourceTokens: number;
  providerTokens: number;
  averageBatchTokens: number | null;
  averageLatencyMs: number | null;
  validationRate: number | null;
  validationAnchorRate: number | null;
  validationAnchorTokens: number | null;
  retryRate: number | null;
  latencyBaseMs: number | null;
  latencyPerTokenMs: number | null;
  validationBatchSlope: number | null;
  measuredParameters: string[];
  syntheticParameters: string[];
  caveats: string[];
}

interface CalibrationFit extends CalibrationGroupFit {
  retries: number;
  validationFailures: number;
  sourceTokens: number;
  concurrency: number | null;
  providerBatches: number;
  files: string[];
  groups: Partial<Record<TranslationModelSizeTier, CalibrationGroupFit>>;
  modelGroups: Record<string, CalibrationGroupFit>;
  uncertainty: {
    latencyMs: number | null;
    validationRate: number | null;
    stable: boolean;
  };
}

interface TuningCandidate {
  budgetGrowthStep: number;
  budgetShrink429: number;
  budgetShrinkLatency: number;
  failureHighThreshold: number;
  failureLowThreshold: number;
  failureShrinkBatch: number;
  latencyRegressionMultiplier: number;
  observationWindow: number;
  id: string;
}

interface SimulationResult {
  coldStart: ColdStart;
  batches: number;
  makespanMs: number;
  retryTokenCost: number;
  retries: number;
  validationFailures: number;
  rateLimits: number;
  objective: number;
  finalBudgetTokens: number;
  finalConcurrency: number;
  finalBatchSourceTokens: number;
}

interface RankedResult {
  candidate: TuningCandidate;
  mean: SimulationResult;
  samples: SimulationResult[];
}

interface BenchmarkReport {
  command: string;
  seed: number;
  simulations: number;
  lambdaMsPerToken: number;
  calibration: CalibrationFit;
  provisionalTuning: TranslationBudgetTuning;
  tiers: Record<TranslationModelSizeTier, RankedResult[]>;
  global: {
    candidateId: string;
    normalizedObjective: number;
    tierObjectives: Record<TranslationModelSizeTier, number>;
    stable: boolean;
  };
  recommendation: TranslationBudgetTuning;
  caveats: string[];
}

type RawRecord = Record<string, unknown>;

interface Request {
  sourceTokens: number;
  targetCount: number;
  attempt: number;
  retry: boolean;
  transportRetries: number;
  readyAtMs?: number;
}

interface Event {
  request: Request;
  endMs: number;
  latencyMs: number;
  validationFailures: number;
}

interface TokenLedgerEntry {
  atMs: number;
  tokens: number;
}

interface SimulationModel {
  baseLatencyMs: number;
  perTokenLatencyMs: number;
  validationAnchorRate: number;
  validationAnchorTokens: number;
  validationBatchSlope: number;
  tpmWall: number;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/translationBudgetBenchmark.ts [options]

Options:
  --calibration <path>  JSON log file or directory of page-translation logs
  --simulations <n>     Deterministic repetitions per candidate (default: ${defaultSimulations})
  --top <n>             Number of ranked configurations per tier (default: ${defaultTop})
  --seed <n>            Seed for deterministic PRNG (default: ${defaultSeed})
  --lambda <n>          Retry-token objective weight; default is calibrated ms/token or 0.8
  --page-tokens <n>     Synthetic page source-token count
  --tpm-wall <n>       Provider TPM wall; 0 selects tier-specific synthetic walls
  --json                Print machine-readable JSON only
  --help                Show this help

The benchmark uses common random numbers, a rolling 60-second provider token ledger,
real controller cooldown dispatch gating, fresh and persisted 0.8 cold starts, and a
single normalized recommendation across small, medium, and large tiers.`);
}

function parsePositiveNumber(
  value: string,
  flag: string,
  integer = false,
  zeroAllowed = false,
): number {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (zeroAllowed ? parsed < 0 : parsed <= 0) ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error(
      `${flag} must be a ${zeroAllowed ? 'non-negative' : 'positive'} ${integer ? 'integer' : 'number'}; received ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions | 'help' {
  const options: CliOptions = {
    calibrationPath: null,
    jsonOnly: false,
    lambda: null,
    pageTokens: null,
    seed: defaultSeed,
    simulations: defaultSimulations,
    top: defaultTop,
    tpmWall: defaultTpmWall,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return 'help';
    if (argument === '--json') {
      options.jsonOnly = true;
      continue;
    }
    const [flag, inlineValue] = argument.split('=', 2);
    const needsValue = [
      '--calibration',
      '--page-tokens',
      '--simulations',
      '--top',
      '--seed',
      '--lambda',
      '--tpm-wall',
    ].includes(flag);
    if (!needsValue)
      throw new Error(`Unknown argument ${JSON.stringify(argument)}; use --help`);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`${flag} requires a value`);
    if (flag === '--calibration') options.calibrationPath = value;
    else if (flag === '--page-tokens')
      options.pageTokens = parsePositiveNumber(value, flag, true);
    else if (flag === '--simulations')
      options.simulations = parsePositiveNumber(value, flag, true);
    else if (flag === '--top') options.top = parsePositiveNumber(value, flag, true);
    else if (flag === '--seed') options.seed = parsePositiveNumber(value, flag, true);
    else if (flag === '--lambda')
      options.lambda = parsePositiveNumber(value, flag, false, true);
    else if (flag === '--tpm-wall')
      options.tpmWall = parsePositiveNumber(value, flag, false, true);
  }
  return options;
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ??
    null
  );
}

async function calibrationPaths(input: string): Promise<string[]> {
  const path = resolve(projectDirectory, input);
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter(
        (entry) => entry.isFile() && ['.json', '.jsonl'].includes(extname(entry.name)),
      )
      .map((entry) => resolve(path, entry.name))
      .sort();
  } catch {
    return [path];
  }
}

function classifyTier(model: string | null): TranslationModelSizeTier | null {
  if (model === null) return null;
  const name = model.toLowerCase();
  if (/(tiny|mini|flash|nano|lite|haiku|turbo)/u.test(name)) return 'small';
  if (/(pro|opus|ultra|reasoning|o1|o3|r1)/u.test(name)) return 'large';
  return 'medium';
}

function parseBatch(
  record: RawRecord,
  sessionModel: string | null = null,
): CalibrationBatch | null {
  const sourceTokens = numberValue(record.sourceTokens);
  if (sourceTokens === null || sourceTokens < 0 || !Array.isArray(record.targets))
    return null;
  const targets = record.targets.filter(isRecord);
  const providerTargets = targets.filter((target) => target.cacheHit !== true);
  if (providerTargets.length === 0) return null;
  const queuedAt = numberValue(record.queuedAt);
  const completedAt = numberValue(record.completedAt);
  const recordedLatency = numberValue(record.latencyMs);
  const latencyMs =
    recordedLatency ??
    (queuedAt !== null && completedAt !== null && completedAt >= queuedAt
      ? completedAt - queuedAt
      : null);
  const parallelism = isRecord(record.parallelism) ? record.parallelism : null;
  const model =
    sessionModel ??
    stringValue(record.model) ??
    stringValue(record.modelName) ??
    stringValue(parallelism?.model);
  const attempts = Array.isArray(record.attempts) ? record.attempts.filter(isRecord) : [];
  const hasTransportAttempt = attempts.some(
    (attempt) =>
      attempt.kind === 'transport-retry' ||
      numberValue(attempt.httpStatus) !== null ||
      numberValue(attempt.retryAfterMs) !== null,
  );
  const allocationEligible = !hasTransportAttempt && !isRecord(record.error);
  const retryCount = attempts.reduce(
    (count, attempt) =>
      count +
      (attempt.kind === 'transport-retry' || stringValue(attempt.stage) !== 'initial'
        ? 1
        : 0),
    0,
  );
  const validationFailures = Math.min(
    providerTargets.length,
    attempts.reduce(
      (count, attempt) =>
        count + (Array.isArray(attempt.issues) ? attempt.issues.length : 0),
      0,
    ),
  );
  const tokenBudget = isRecord(record.tokenBudget) ? record.tokenBudget : null;
  const estimatedTotal = numberValue(tokenBudget?.totalEstimatedTokens);
  const tokenEvidence =
    estimatedTotal !== null && estimatedTotal > 0 ? 'measured-estimate' : 'synthetic';
  const providerTokens =
    estimatedTotal !== null && estimatedTotal > 0
      ? estimatedTotal
      : Math.max(1, Math.ceil(sourceTokens * 1.2));
  const sizeTierValue =
    stringValue(record.sizeTier) ?? stringValue(parallelism?.sizeTier);
  const tier =
    sizeTierValue === 'small' || sizeTierValue === 'medium' || sizeTierValue === 'large'
      ? sizeTierValue
      : classifyTier(model);
  return {
    sourceTokens,
    providerTokens,
    tokenEvidence,
    targetCount: providerTargets.length,
    latencyMs,
    retryCount,
    validationFailures,
    allocationEligible,
    tier,
    model,
  };
}

function linearFit(
  pairs: readonly { x: number; y: number }[],
): { intercept: number; slope: number } | null {
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
  const denominator = pairs.reduce((sum, pair) => sum + (pair.x - meanX) ** 2, 0);
  if (denominator <= 0) return null;
  const slope =
    pairs.reduce((sum, pair) => sum + (pair.x - meanX) * (pair.y - meanY), 0) /
    denominator;
  return { intercept: meanY - slope * meanX, slope: Math.max(0, slope) };
}

function fitGroup(batches: readonly CalibrationBatch[]): CalibrationGroupFit {
  const providerTargets = batches.reduce((sum, batch) => sum + batch.targetCount, 0);
  const providerSourceTokens = batches.reduce(
    (sum, batch) => sum + batch.sourceTokens,
    0,
  );
  const providerTokens = batches.reduce((sum, batch) => sum + batch.providerTokens, 0);
  const latencies = batches.flatMap((batch) =>
    batch.latencyMs === null ? [] : [batch.latencyMs],
  );
  const averageBatchTokens =
    batches.length === 0 ? null : providerSourceTokens / batches.length;
  const averageLatencyMs =
    latencies.length === 0
      ? null
      : latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const allocationBatches = batches.filter((batch) => batch.allocationEligible);
  const allocationTargets = allocationBatches.reduce(
    (sum, batch) => sum + batch.targetCount,
    0,
  );
  const validationFailures = allocationBatches.reduce(
    (sum, batch) => sum + batch.validationFailures,
    0,
  );
  const retries = batches.reduce((sum, batch) => sum + batch.retryCount, 0);
  const validationRate =
    allocationTargets === 0 ? null : validationFailures / allocationTargets;
  const retryRate = batches.length === 0 ? null : retries / batches.length;
  const measuredParameters: string[] = [];
  const syntheticParameters: string[] = [];
  const caveats: string[] = [];
  if (allocationBatches.length < batches.length)
    caveats.push(
      'Transport and terminal-error outcomes were retained for provider aggregates but excluded from allocation calibration.',
    );
  const measuredTokenBatches = batches.filter(
    (batch) => batch.tokenEvidence === 'measured-estimate',
  ).length;
  const syntheticTokenBatches = batches.length - measuredTokenBatches;
  if (measuredTokenBatches > 0) {
    measuredParameters.push('planner-estimated total token evidence');
    caveats.push(
      'tokenBudget.totalEstimatedTokens is a planner-estimated total, not actual provider usage.',
    );
  }
  if (syntheticTokenBatches > 0) {
    syntheticParameters.push('synthetic total token evidence');
    caveats.push(
      'Missing tokenBudget.totalEstimatedTokens uses a synthetic 1.2× source-token estimate; it is not actual provider usage.',
    );
  }
  const cleanPairs = batches
    .filter(
      (batch) =>
        batch.allocationEligible && batch.retryCount === 0 && batch.latencyMs !== null,
    )
    .map((batch) => ({ x: batch.sourceTokens, y: batch.latencyMs! }));
  const latencyFit = linearFit(cleanPairs);
  let latencyBaseMs: number | null = null;
  let latencyPerTokenMs: number | null = null;
  if (latencyFit !== null) {
    latencyBaseMs = latencyFit.intercept;
    latencyPerTokenMs = latencyFit.slope;
    measuredParameters.push(
      'clean no-retry latency intercept',
      'clean no-retry latency slope',
    );
  } else {
    syntheticParameters.push('latency intercept', 'latency slope');
    caveats.push(
      'Clean no-retry latency pairs lacked at least two distinct source-token values; latency fit is synthetic.',
    );
  }
  const validationAnchorTokens =
    averageBatchTokens === null ? null : Math.max(1, averageBatchTokens);
  const failureFit =
    validationAnchorTokens === null
      ? null
      : linearFit(
          allocationBatches.map((batch) => ({
            x: batch.sourceTokens / validationAnchorTokens - 1,
            y: batch.targetCount === 0 ? 0 : batch.validationFailures / batch.targetCount,
          })),
        );
  const validationAnchorRate =
    failureFit === null ? validationRate : clamp(failureFit.intercept, 0, 1);
  const validationBatchSlope = failureFit === null ? null : failureFit.slope;
  if (failureFit !== null && allocationBatches.length >= 2) {
    measuredParameters.push('normalized-batch-ratio validation failure slope');
  } else {
    syntheticParameters.push('validation failure slope');
    caveats.push(
      'Allocation batches lacked enough variation to identify a normalized validation failure slope; slope is synthetic.',
    );
  }
  if (validationRate !== null)
    measuredParameters.push('per-target validation failure rate');
  else syntheticParameters.push('per-target validation failure rate');
  if (batches.length > 0) measuredParameters.push('provider token ledger samples');
  else syntheticParameters.push('provider token ledger');
  return {
    batches: batches.length,
    providerTargets,
    providerSourceTokens,
    providerTokens,
    averageBatchTokens,
    averageLatencyMs,
    validationRate,
    validationAnchorRate,
    validationAnchorTokens,
    retryRate,
    latencyBaseMs,
    latencyPerTokenMs,
    validationBatchSlope,
    measuredParameters,
    syntheticParameters,
    caveats,
  };
}

async function fitCalibration(input: string | null): Promise<CalibrationFit> {
  const files: string[] = [];
  const batches: CalibrationBatch[] = [];
  const caveats = new Set<string>();
  let aggregateBatches = 0;
  let aggregateRetries = 0;
  let aggregateFailures = 0;
  let aggregateSourceTokens = 0;
  let concurrency: number | null = null;
  if (input !== null) {
    for (const path of await calibrationPaths(input)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        caveats.add(
          `Skipped unreadable calibration file ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!isRecord(parsed) || stringValue(parsed.schemaVersion) !== calibrationSchema) {
        caveats.add(`Skipped ${path}: schemaVersion is not ${calibrationSchema}.`);
        continue;
      }
      files.push(path);
      const metrics = isRecord(parsed.metrics) ? parsed.metrics : {};
      aggregateBatches += numberValue(metrics.batches) ?? 0;
      aggregateRetries += numberValue(metrics.retries) ?? 0;
      aggregateFailures += numberValue(metrics.validationFailures) ?? 0;
      aggregateSourceTokens += numberValue(metrics.sourceTokens) ?? 0;
      const metricConcurrency =
        numberValue(metrics.concurrency) ?? numberValue(metrics.dispatchConcurrency);
      if (metricConcurrency !== null)
        concurrency =
          concurrency === null
            ? metricConcurrency
            : Math.min(concurrency, metricConcurrency);
      if (Array.isArray(parsed.batches)) {
        const session = isRecord(parsed.session) ? parsed.session : null;
        const sessionModel = stringValue(session?.model);
        for (const item of parsed.batches)
          if (isRecord(item)) {
            const batch = parseBatch(item, sessionModel);
            if (batch !== null) batches.push(batch);
          }
      } else
        caveats.add(
          'Calibration logs contain aggregates only; per-tier latency and failure fits remain synthetic.',
        );
    }
  }
  const groups: Partial<Record<TranslationModelSizeTier, CalibrationGroupFit>> = {};
  for (const tier of tierOrder) {
    const tierBatches = batches.filter((batch) => batch.tier === tier);
    if (tierBatches.length > 0) groups[tier] = fitGroup(tierBatches);
  }
  const modelBatches = new Map<string, CalibrationBatch[]>();
  for (const batch of batches) {
    const key = batch.model ?? batch.tier ?? 'unknown';
    const existing = modelBatches.get(key) ?? [];
    existing.push(batch);
    modelBatches.set(key, existing);
  }
  const modelGroups: Record<string, CalibrationGroupFit> = {};
  for (const [model, modelBatchList] of modelBatches)
    modelGroups[model] = fitGroup(modelBatchList);
  const aggregate = fitGroup(batches);
  if (aggregateBatches === 0 && batches.length > 0) aggregateBatches = batches.length;
  if (aggregateSourceTokens === 0 && batches.length > 0)
    aggregateSourceTokens = aggregate.providerSourceTokens;
  if (aggregateRetries === 0 && batches.length > 0)
    aggregateRetries = batches.reduce((sum, batch) => sum + batch.retryCount, 0);
  if (aggregateFailures === 0 && batches.length > 0)
    aggregateFailures = batches.reduce((sum, batch) => sum + batch.validationFailures, 0);
  if (concurrency === null && aggregateBatches > 0) {
    concurrency = 2;
  }
  if (batches.length < aggregateBatches)
    caveats.add(
      'Cache-hit and dropped outcomes were excluded from provider calibration batches; retained provider batches supply both numerator and denominator aggregates.',
    );
  if (files.length === 0) {
    caveats.add(
      'No valid calibration logs were loaded; all tier model parameters are synthetic-only.',
    );
    caveats.add(
      'No tokenBudget.totalEstimatedTokens evidence was available; synthetic 1.2× source-token estimates are not actual provider usage.',
    );
  }
  if (Object.keys(groups).length < tierOrder.length)
    caveats.add(
      "Missing tier/model groups use only that tier's synthetic defaults; no fit is shared across tiers.",
    );
  const uncertaintyValues = batches
    .map((batch) => batch.latencyMs)
    .filter((value): value is number => value !== null);
  const uncertaintyLatency = percentile(uncertaintyValues, 0.75);
  const rate = aggregate.validationRate;
  const retainedRetries = batches.reduce((sum, batch) => sum + batch.retryCount, 0);
  const retainedFailures = batches.reduce(
    (sum, batch) => sum + batch.validationFailures,
    0,
  );
  const retainedSourceTokens = batches.reduce(
    (sum, batch) => sum + batch.sourceTokens,
    0,
  );
  return {
    ...aggregate,
    batches: aggregateBatches,
    retries: batches.length > 0 ? retainedRetries : aggregateRetries,
    validationFailures: batches.length > 0 ? retainedFailures : aggregateFailures,
    sourceTokens: batches.length > 0 ? retainedSourceTokens : aggregateSourceTokens,
    concurrency,
    providerBatches: batches.length,
    files,
    groups,
    modelGroups,
    uncertainty: {
      latencyMs:
        uncertaintyLatency === null || aggregate.averageLatencyMs === null
          ? null
          : uncertaintyLatency - aggregate.averageLatencyMs,
      validationRate:
        rate === null
          ? null
          : Math.sqrt(
              Math.max(0, rate * (1 - rate)) / Math.max(1, aggregate.providerTargets),
            ),
      stable: batches.length >= 2 && aggregate.caveats.length === 0,
    },
    caveats: [...new Set([...aggregate.caveats, ...caveats])].sort(),
  };
}

class Prng {
  private static readonly modulus = 2_147_483_647;
  private static readonly multiplier = 48_271;
  private state: number;
  public constructor(seed: number) {
    const normalized = Math.trunc(Math.abs(seed)) % (Prng.modulus - 1);
    this.state = normalized === 0 ? 1 : normalized;
  }
  public next(): number {
    this.state = (this.state * Prng.multiplier) % Prng.modulus;
    return this.state / Prng.modulus;
  }
  public normal(): number {
    const first = Math.max(this.next(), Number.MIN_VALUE);
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * this.next());
  }
}

function numericTuning<K extends keyof TranslationBudgetTuning>(
  name: K,
  fallback: number,
): number {
  const value = BUDGET_TUNING[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeProfile(tier: TranslationModelSizeTier): TranslationModelProfile {
  const budget = SIZE_TIER_BUDGETS[tier];
  return {
    id: `benchmark:${tier}`,
    providerId: 'openai-compatible',
    modelId: `benchmark-${tier}`,
    tokenizerSource: 'fallback',
    contextWindow: tier === 'small' ? 128000 : 64000,
    promptVariant: 'standard',
    responseShape: 'pairs',
    structuredOutputMode: 'prompt-only',
    reasoningMode: 'disabled',
    messageFormat: 'structured-chat',
    chatTemplateOwner: 'provider',
    capabilities: {
      supportsJsonSchema: false,
      supportsGrammar: false,
      supportsToolCalling: false,
      supportsJsonObjectMode: false,
      supportsSeed: false,
      supportsStopSequences: false,
      supportsReasoningControl: false,
      reportsPromptTokens: false,
      reportsCompletionTokens: false,
      reportsContextWindow: true,
      supportsPrefixCaching: false,
      supportsCancellation: true,
    },
    generation: { temperature: 0.1, topP: 1 },
    batching: {
      maxItems: Math.max(1, Math.floor(budget.maxBatchSourceTokens / 30)),
      maxSourceTokens: budget.maxBatchSourceTokens,
      maxContextTokens: 8000,
      maxMemoryTokens: 1000,
      preferredSourceTokens: budget.initialBatchSourceTokens,
      preferredItems: Math.max(1, Math.floor(budget.initialBatchSourceTokens / 30)),
      concurrency: budget.initialConcurrency,
    },
    retry: {
      maxRetries: 2,
      retryWithSmallerBatch: true,
      retryWithoutRetrievedContext: false,
      retryWithRicherLocalContext: false,
    },
    adaptive: { enabled: true },
    safetyReserveTokens: 640,
    schemaReserveTokens: 128,
    initialOutputRatios: { default: 0.2 },
    promptVersion: 'benchmark',
    profileVersion: 'benchmark',
  };
}

function buildCandidates(count: number, calibration: CalibrationFit): TuningCandidate[] {
  const growth = [
    numericTuning('growthStep', 0.1) * 0.5,
    numericTuning('growthStep', 0.1),
    numericTuning('growthStep', 0.1) * 2,
  ];
  const shrink429Base = numericTuning('rateLimitShrinkFactor', 0.5);
  const shrink429 = [
    shrink429Base * 0.8,
    shrink429Base,
    Math.min(0.9, shrink429Base * 1.2),
  ];
  const shrinkLatencyBase = numericTuning('latencyShrinkFactor', 0.8);
  const shrinkLatency = [
    shrinkLatencyBase * 0.875,
    shrinkLatencyBase,
    Math.min(0.95, shrinkLatencyBase * 1.125),
  ];
  const measuredRate = calibration.validationRate ?? 0.05;
  const failureHigh = [
    clamp(measuredRate * 0.8 + 0.01, 0.01, 0.8),
    clamp(measuredRate + 0.01, 0.01, 0.8),
    clamp(measuredRate * 1.2 + 0.01, 0.01, 0.8),
  ];
  const failureLow = [
    clamp(measuredRate * 0.6, 0, 0.7),
    clamp(measuredRate, 0, 0.7),
    clamp(measuredRate * 1.2, 0, 0.7),
  ];
  const shrinkBatchBase = numericTuning('highFailureBatchFactor', 0.8);
  const shrinkBatch = [
    Math.max(0.5, shrinkBatchBase * 0.875),
    shrinkBatchBase,
    Math.min(0.95, shrinkBatchBase * 1.125),
  ];
  const latencyMultiplierBase = numericTuning('latencyRegressionMultiplier', 1.5);
  const latencyMultipliers = [
    Math.max(1.1, latencyMultiplierBase * 0.9),
    latencyMultiplierBase,
    latencyMultiplierBase * 1.1,
  ];
  const windowBase = numericTuning('cleanObservationWindow', 10);
  const windows = [
    Math.max(4, Math.round(windowBase * 0.6)),
    Math.round(windowBase),
    Math.round(windowBase * 1.4),
  ];
  const dimensions = [
    growth,
    shrink429,
    shrinkLatency,
    failureHigh,
    failureLow,
    shrinkBatch,
    latencyMultipliers,
    windows,
  ];
  const total = dimensions.reduce((product, values) => product * values.length, 1);
  const candidates: TuningCandidate[] = [];
  const stride = 7919;
  for (let index = 0; index < count; index += 1) {
    let rank = (index * stride) % total;
    const values: number[] = [];
    for (const dimension of dimensions) {
      const radix = dimension.length;
      values.push(dimension[rank % radix]);
      rank = Math.floor(rank / radix);
    }
    const high = values[3];
    let low = values[4];
    if (low >= high) low = Math.max(0, high - 0.01);
    candidates.push({
      budgetGrowthStep: values[0],
      budgetShrink429: values[1],
      budgetShrinkLatency: values[2],
      failureHighThreshold: high,
      failureLowThreshold: low,
      failureShrinkBatch: values[5],
      latencyRegressionMultiplier: values[6],
      observationWindow: Math.max(1, Math.round(values[7])),
      id: `c-${String(index + 1).padStart(3, '0')}`,
    });
  }
  return candidates;
}

function modelForTier(
  tier: TranslationModelSizeTier,
  calibration: CalibrationFit,
  tpmWall: number,
): SimulationModel {
  const defaults: Record<
    TranslationModelSizeTier,
    { base: number; perToken: number; failure: number; slope: number; tpm: number }
  > = {
    small: { base: 380, perToken: 0.75, failure: 0.045, slope: 0.12, tpm: 7200 },
    medium: { base: 650, perToken: 1.15, failure: 0.022, slope: 0.08, tpm: 4000 },
    large: { base: 1050, perToken: 1.7, failure: 0.012, slope: 0.045, tpm: 2800 },
  };
  const fallback = defaults[tier];
  const group = calibration.groups[tier];
  const anchorTokens =
    group?.validationAnchorTokens ??
    group?.averageBatchTokens ??
    SIZE_TIER_BUDGETS[tier].initialBatchSourceTokens;
  return {
    baseLatencyMs: group?.latencyBaseMs ?? fallback.base,
    perTokenLatencyMs: group?.latencyPerTokenMs ?? fallback.perToken,
    validationAnchorRate:
      group?.validationAnchorRate ?? group?.validationRate ?? fallback.failure,
    validationAnchorTokens: Math.max(1, anchorTokens),
    validationBatchSlope: group?.validationBatchSlope ?? fallback.slope,
    tpmWall: tpmWall > 0 ? tpmWall : fallback.tpm,
  };
}

function splitRequest(request: Request, count: number): Request[] {
  const each = request.sourceTokens / count;
  return Array.from({ length: count }, (_, index) => ({
    sourceTokens: index === count - 1 ? request.sourceTokens - each * (count - 1) : each,
    targetCount: 1,
    attempt: request.attempt + 1,
    retry: true,
    transportRetries: 0,
  }));
}
interface SimulationProbe {
  accepted: Request[];
  rateLimited: Request[];
}

function simulate(
  tier: TranslationModelSizeTier,
  candidate: TuningCandidate,
  model: SimulationModel,
  profile: TranslationModelProfile,
  pageTokens: number,
  seed: number,
  lambda: number,
  coldStart: ColdStart,
  probe?: SimulationProbe,
): SimulationResult {
  const budgetSpec = SIZE_TIER_BUDGETS[tier];
  let nowMs = 0;
  const tuning: Partial<TranslationBudgetTuning> = {
    growthStep: candidate.budgetGrowthStep,
    rateLimitShrinkFactor: candidate.budgetShrink429,
    latencyShrinkFactor: candidate.budgetShrinkLatency,
    latencyRegressionMultiplier: candidate.latencyRegressionMultiplier,
    highValidationFailureRate: candidate.failureHighThreshold,
    lowValidationFailureRate: candidate.failureLowThreshold,
    highFailureBatchFactor: candidate.failureShrinkBatch,
    lowFailureBatchFactor: clamp(1 / candidate.failureShrinkBatch, 1, 2),
    rollingObservationWindow: candidate.observationWindow,
    cleanObservationWindow: candidate.observationWindow,
    allocationObservationWindow: candidate.observationWindow,
  };
  const initialBudget =
    budgetSpec.initialConcurrency * budgetSpec.initialBatchSourceTokens * 1.2;
  const controller = new TranslationBudgetController({
    tier,
    profile,
    userConcurrencyCeiling: null,
    persisted:
      coldStart === 'fresh'
        ? null
        : {
            concurrency: budgetSpec.initialConcurrency,
            batchSourceTokens: budgetSpec.initialBatchSourceTokens,
            budgetTokens: initialBudget,
          },
    getOutputRatio: () => 0.2,
    tuning,
    now: () => nowMs,
  });
  const random = new Prng(seed);
  const events: Event[] = [];
  const pending: Request[] = [];
  const ledger: TokenLedgerEntry[] = [];
  let remainingTokens = pageTokens;
  let retryTokenCost = 0;
  let retries = 0;
  let validationFailures = 0;
  let rateLimits = 0;
  let batches = 0;
  const estimatedTokens = (sourceTokens: number): number =>
    Math.max(1, Math.ceil(sourceTokens * 1.2));
  const expireLedger = () => {
    while (ledger.length > 0 && ledger[0].atMs + 60_000 <= nowMs) ledger.shift();
  };
  const ledgerTokens = () => ledger.reduce((sum, entry) => sum + entry.tokens, 0);
  const observe = (
    latencyMs: number,
    valid: boolean,
    rateLimited: boolean,
    failures: number,
    sourceTokens: number,
    targetCount: number,
    retryAfterMs: number | null,
  ) => {
    controller.observe({
      valid,
      truncated: false,
      timedOut: false,
      latencyMs,
      validationFailures: failures,
      rateLimited,
      retryAfterMs,
      sourceTokens,
      targetCount,
    });
  };
  while (remainingTokens > 0 || pending.length > 0 || events.length > 0) {
    if (batches >= 10000)
      throw new Error(
        'Simulation exceeded 10,000 accepted provider batches before draining the page.',
      );
    expireLedger();
    while (
      remainingTokens > 0 &&
      pending.length + events.length < controller.getConcurrency()
    ) {
      const sourceTokens = Math.min(
        controller.getBatchSourceTokens(),
        Math.floor(model.tpmWall / 1.2),
        remainingTokens,
      );
      if (sourceTokens <= 0)
        throw new Error(
          `TPM wall ${model.tpmWall} cannot admit a positive source-token batch.`,
        );
      remainingTokens -= sourceTokens;
      pending.push({
        sourceTokens,
        targetCount: Math.max(1, Math.ceil(sourceTokens / 35)),
        attempt: 0,
        retry: false,
        transportRetries: 0,
      });
    }
    let dispatched = false;
    while (
      pending.length > 0 &&
      events.length < controller.getConcurrency() &&
      controller.getDispatchDelayMs() <= 0
    ) {
      const request = pending[0];
      if (request.readyAtMs !== undefined && request.readyAtMs > nowMs) break;
      pending.shift();
      const tokens = estimatedTokens(request.sourceTokens);
      const projectedTokens = ledgerTokens() + tokens;
      const retryAfterMs =
        projectedTokens > model.tpmWall
          ? Math.max(1, (ledger[0]?.atMs ?? nowMs) + 60_000 - nowMs)
          : null;
      if (retryAfterMs !== null) {
        if (ledger.length === 0)
          throw new Error(
            `TPM wall ${model.tpmWall} is below the minimum estimated request of ${tokens} tokens.`,
          );
        rateLimits += 1;
        retries += 1;
        probe?.rateLimited.push({ ...request });
        observe(
          retryAfterMs,
          false,
          true,
          0,
          request.sourceTokens,
          request.targetCount,
          retryAfterMs,
        );
        pending.unshift({
          ...request,
          transportRetries: request.transportRetries + 1,
          readyAtMs: nowMs + retryAfterMs,
        });
        dispatched = true;
        continue;
      }
      if (request.retry) retryTokenCost += tokens;
      ledger.push({ atMs: nowMs, tokens });
      batches += 1;
      probe?.accepted.push({ ...request });
      const probability = clamp(
        model.validationAnchorRate +
          model.validationBatchSlope *
            (request.sourceTokens / model.validationAnchorTokens - 1),
        0,
        0.8,
      );
      let failures = 0;
      for (let item = 0; item < request.targetCount; item += 1)
        if (random.next() < probability) failures += 1;
      const latencyMs =
        Math.max(
          1,
          model.baseLatencyMs + request.sourceTokens * model.perTokenLatencyMs,
        ) * Math.exp(random.normal() * 0.15);
      events.push({
        request,
        endMs: nowMs + latencyMs,
        latencyMs,
        validationFailures: failures,
      });
      dispatched = true;
    }
    events.sort((left, right) => left.endMs - right.endMs);
    if (events.length > 0) {
      const nextEvent = events[0];
      const nextReadyAt = pending[0]?.readyAtMs;
      const nextDispatch = controller.getDispatchDelayMs();
      if (
        nextReadyAt !== undefined &&
        nextReadyAt > nowMs &&
        nextReadyAt < nextEvent.endMs
      )
        nowMs = nextReadyAt;
      else if (
        pending.length > 0 &&
        nextDispatch > 0 &&
        nowMs + nextDispatch < nextEvent.endMs
      )
        nowMs += nextDispatch;
      else nowMs = Math.max(nowMs, nextEvent.endMs);
      const completed = events.splice(
        0,
        events.findIndex((event) => event.endMs > nowMs) < 0
          ? events.length
          : events.findIndex((event) => event.endMs > nowMs),
      );
      for (const event of completed) {
        observe(
          event.latencyMs,
          event.validationFailures === 0,
          false,
          event.validationFailures,
          event.request.sourceTokens,
          event.request.targetCount,
          null,
        );
        validationFailures += event.validationFailures;
        if (event.validationFailures > 0) {
          pending.unshift(
            ...splitRequest(
              {
                ...event.request,
                targetCount: event.validationFailures,
                sourceTokens:
                  event.request.sourceTokens *
                  (event.validationFailures / event.request.targetCount),
              },
              event.validationFailures,
            ),
          );
        }
      }
      continue;
    }
    const nextReadyAt = pending[0]?.readyAtMs;
    if (nextReadyAt !== undefined && nextReadyAt > nowMs) nowMs = nextReadyAt;
    else {
      const delay = controller.getDispatchDelayMs();
      if (delay > 0) nowMs += delay;
      else if (!dispatched && pending.length === 0 && remainingTokens === 0) break;
      else nowMs += 1;
    }
  }
  const snapshot = controller.snapshot();
  return {
    coldStart,
    batches,
    makespanMs: nowMs,
    retryTokenCost,
    retries,
    validationFailures,
    rateLimits,
    objective: nowMs + lambda * retryTokenCost,
    finalBudgetTokens: snapshot.budgetTokens,
    finalConcurrency: snapshot.concurrency,
    finalBatchSourceTokens: snapshot.batchSourceTokens,
  };
}

function averageResults(results: readonly SimulationResult[]): SimulationResult {
  const average = (field: keyof Omit<SimulationResult, 'coldStart'>): number =>
    results.reduce((sum, result) => sum + result[field], 0) / Math.max(1, results.length);
  return {
    coldStart: 'fresh',
    batches: average('batches'),
    makespanMs: average('makespanMs'),
    retryTokenCost: average('retryTokenCost'),
    retries: average('retries'),
    validationFailures: average('validationFailures'),
    rateLimits: average('rateLimits'),
    objective: average('objective'),
    finalBudgetTokens: average('finalBudgetTokens'),
    finalConcurrency: average('finalConcurrency'),
    finalBatchSourceTokens: average('finalBatchSourceTokens'),
  };
}

function rankTier(
  tier: TranslationModelSizeTier,
  options: CliOptions,
  calibration: CalibrationFit,
  lambda: number,
): RankedResult[] {
  const profile = makeProfile(tier);
  const model = modelForTier(tier, calibration, options.tpmWall);
  const pageTokens = options.pageTokens ?? Math.max(12000, calibration.sourceTokens || 0);
  return buildCandidates(48, calibration)
    .map((candidate) => {
      const samples: SimulationResult[] = [];
      for (let run = 0; run < options.simulations; run += 1) {
        const runSeed = options.seed + run * 104729;
        samples.push(
          simulate(tier, candidate, model, profile, pageTokens, runSeed, lambda, 'fresh'),
        );
        samples.push(
          simulate(
            tier,
            candidate,
            model,
            profile,
            pageTokens,
            runSeed,
            lambda,
            'persisted-0.8',
          ),
        );
      }
      return { candidate, samples, mean: averageResults(samples) };
    })
    .sort(
      (left, right) =>
        left.mean.objective - right.mean.objective ||
        left.candidate.id.localeCompare(right.candidate.id),
    );
}

function tuningFromCandidate(candidate: TuningCandidate): TranslationBudgetTuning {
  return {
    growthStep: candidate.budgetGrowthStep,
    rateLimitShrinkFactor: candidate.budgetShrink429,
    latencyShrinkFactor: candidate.budgetShrinkLatency,
    latencyRegressionMultiplier: candidate.latencyRegressionMultiplier,
    baselineObservationCount: numericTuning('baselineObservationCount', 10),
    rollingObservationWindow: candidate.observationWindow,
    cleanObservationWindow: candidate.observationWindow,
    allocationObservationWindow: candidate.observationWindow,
    highValidationFailureRate: candidate.failureHighThreshold,
    lowValidationFailureRate: candidate.failureLowThreshold,
    highFailureBatchFactor: candidate.failureShrinkBatch,
    lowFailureBatchFactor: clamp(1 / candidate.failureShrinkBatch, 1, 2),
    persistedColdStartFactor: 0.8,
  };
}

function chooseGlobal(ranks: Record<TranslationModelSizeTier, RankedResult[]>): {
  candidate: TuningCandidate;
  score: number;
  tierObjectives: Record<TranslationModelSizeTier, number>;
  stable: boolean;
} {
  const medians = Object.fromEntries(
    tierOrder.map((tier) => [
      tier,
      percentile(
        ranks[tier].map((row) => row.mean.objective),
        0.5,
      ) ?? 1,
    ]),
  ) as Record<TranslationModelSizeTier, number>;
  const byTier = Object.fromEntries(
    tierOrder.map((tier) => [
      tier,
      new Map(ranks[tier].map((row) => [row.candidate.id, row])),
    ]),
  ) as Record<TranslationModelSizeTier, Map<string, RankedResult>>;
  const candidateIds = [...byTier.small.keys()].filter((id) =>
    tierOrder.every((tier) => byTier[tier].has(id)),
  );
  const scored = candidateIds
    .map((candidateId) => {
      const small = byTier.small.get(candidateId)!;
      const tierObjectives = Object.fromEntries(
        tierOrder.map((tier) => [tier, byTier[tier].get(candidateId)!.mean.objective]),
      ) as Record<TranslationModelSizeTier, number>;
      const score =
        tierOrder.reduce(
          (sum, tier) => sum + tierObjectives[tier] / Math.max(1, medians[tier]),
          0,
        ) / tierOrder.length;
      return { candidate: small.candidate, score, tierObjectives };
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.candidate.id.localeCompare(right.candidate.id),
    );
  if (scored.length === 0)
    throw new Error('No candidate ID was evaluated in every size tier.');
  const winner = scored[0];
  const stable = scored.length < 2 || winner.score <= scored[1].score * 0.99;
  return { ...winner, stable };
}
function assertBenchmarkContracts(): void {
  const makeCandidate = (id: string): TuningCandidate => ({
    budgetGrowthStep: 0.1,
    budgetShrink429: 0.5,
    budgetShrinkLatency: 0.8,
    failureHighThreshold: 0.2,
    failureLowThreshold: 0.1,
    failureShrinkBatch: 0.8,
    latencyRegressionMultiplier: 1.5,
    observationWindow: 10,
    id,
  });
  const result = (id: string, objective: number): RankedResult => ({
    candidate: makeCandidate(id),
    mean: {
      coldStart: 'fresh',
      batches: 1,
      makespanMs: objective,
      retryTokenCost: 0,
      retries: 0,
      validationFailures: 0,
      rateLimits: 0,
      objective,
      finalBudgetTokens: 1,
      finalConcurrency: 1,
      finalBatchSourceTokens: 1,
    },
    samples: [],
  });
  const joined = chooseGlobal({
    small: [result('c-001', 10), result('c-002', 20), result('c-003', 0)],
    medium: [result('c-002', 1), result('c-001', 100)],
    large: [result('c-002', 1), result('c-001', 100), result('c-003', 0)],
  });
  if (
    joined.candidate.id !== 'c-002' ||
    joined.tierObjectives.medium !== 1 ||
    joined.tierObjectives.large !== 1
  ) {
    throw new Error(
      'Benchmark self-check failed: global ranking did not join only candidate IDs present in every tier.',
    );
  }
  const parsed = parseBatch(
    {
      sourceTokens: 100,
      targets: [{ cacheHit: false }],
      tokenBudget: { totalEstimatedTokens: 240 },
      attempts: [
        {
          kind: 'transport-retry',
          httpStatus: 429,
          retryAfterMs: 1000,
          stage: 'initial',
        },
      ],
      rateLimited: false,
    },
    'Ling-3.0-flash',
  );
  if (
    parsed === null ||
    parsed.model !== 'Ling-3.0-flash' ||
    parsed.tier !== 'small' ||
    parsed.providerTokens !== 240 ||
    parsed.tokenEvidence !== 'measured-estimate' ||
    parsed.allocationEligible
  ) {
    throw new Error(
      'Benchmark self-check failed: session model, token evidence, or transport eligibility.',
    );
  }
  const slopeFit = fitGroup([
    {
      sourceTokens: 100,
      providerTokens: 120,
      tokenEvidence: 'measured-estimate',
      targetCount: 10,
      latencyMs: 100,
      retryCount: 0,
      validationFailures: 0,
      allocationEligible: true,
      tier: 'small',
      model: 'Ling-3.0-flash',
    },
    {
      sourceTokens: 300,
      providerTokens: 360,
      tokenEvidence: 'synthetic',
      targetCount: 10,
      latencyMs: 300,
      retryCount: 0,
      validationFailures: 1,
      allocationEligible: true,
      tier: 'small',
      model: 'Ling-3.0-flash',
    },
  ]);
  if (
    slopeFit.validationAnchorTokens !== 200 ||
    slopeFit.validationBatchSlope === null ||
    Math.abs(slopeFit.validationBatchSlope - 0.1) > 1e-9
  ) {
    throw new Error(
      'Benchmark self-check failed: validation slope is not normalized to its anchor ratio.',
    );
  }
  const probe: SimulationProbe = { accepted: [], rateLimited: [] };
  simulate(
    'small',
    makeCandidate('self-check'),
    {
      baseLatencyMs: 1,
      perTokenLatencyMs: 0,
      validationAnchorRate: 0,
      validationAnchorTokens: 600,
      validationBatchSlope: 0,
      tpmWall: 1000,
    },
    makeProfile('small'),
    2400,
    17,
    0,
    'fresh',
    probe,
  );
  const rejected = probe.rateLimited[0];
  if (
    rejected === undefined ||
    !probe.accepted.some(
      (request) =>
        request.sourceTokens === rejected.sourceTokens &&
        request.targetCount === rejected.targetCount &&
        request.attempt === rejected.attempt &&
        !request.retry,
    )
  ) {
    throw new Error(
      'Benchmark self-check failed: rejected TPM request was not retried as the same batch.',
    );
  }
}

function provisionalTuning(): TranslationBudgetTuning {
  return { ...BUDGET_TUNING };
}

function printReport(report: BenchmarkReport, jsonOnly: boolean): void {
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Run command: ${report.command}`);
  console.log(
    `Seed: ${report.seed}; repetitions: ${report.simulations}; lambda: ${report.lambdaMsPerToken} ms/token`,
  );
  console.log(
    `Calibration: ${report.calibration.providerBatches} provider batches; measured ${report.calibration.providerTargets} targets; stable=${report.calibration.uncertainty.stable}`,
  );
  for (const caveat of [...report.calibration.caveats, ...report.caveats])
    console.log(`  - ${caveat}`);
  for (const tier of tierOrder) {
    console.log(
      `\n${tier.toUpperCase()} top configurations (normalized global recommendation is ${report.global.candidateId})`,
    );
    console.log(
      'id objective makespan retryTokens retries 429s valFailures growth 429x latx high low batchx window',
    );
    for (const row of report.tiers[tier]) {
      const candidate = row.candidate;
      const mean = row.mean;
      console.log(
        `${candidate.id} ${mean.objective.toFixed(1)} ${mean.makespanMs.toFixed(1)} ${mean.retryTokenCost.toFixed(1)} ${mean.retries.toFixed(1)} ${mean.rateLimits.toFixed(1)} ${mean.validationFailures.toFixed(1)} ${candidate.budgetGrowthStep.toFixed(2)} ${candidate.budgetShrink429.toFixed(2)} ${candidate.budgetShrinkLatency.toFixed(2)} ${candidate.failureHighThreshold.toFixed(3)} ${candidate.failureLowThreshold.toFixed(3)} ${candidate.failureShrinkBatch.toFixed(2)} ${candidate.observationWindow}`,
      );
    }
  }
  console.log('\nRecommended TranslationBudgetTuning:');
  console.log(JSON.stringify(report.recommendation, null, 2));
  console.log('\nJSON report:');
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    printHelp();
    return;
  }
  assertBenchmarkContracts();
  const calibration = await fitCalibration(parsed.calibrationPath);
  const lambda = parsed.lambda ?? calibration.latencyPerTokenMs ?? 0.8;
  const allRanks = {
    small: rankTier('small', parsed, calibration, lambda),
    medium: rankTier('medium', parsed, calibration, lambda),
    large: rankTier('large', parsed, calibration, lambda),
  } satisfies Record<TranslationModelSizeTier, RankedResult[]>;
  const global = chooseGlobal(allRanks);
  const report: BenchmarkReport = {
    command: `bun ${process.argv.slice(1).join(' ')}`,
    seed: parsed.seed,
    simulations: parsed.simulations,
    lambdaMsPerToken: lambda,
    calibration,
    provisionalTuning: provisionalTuning(),
    tiers: {
      small: allRanks.small.slice(0, parsed.top),
      medium: allRanks.medium.slice(0, parsed.top),
      large: allRanks.large.slice(0, parsed.top),
    },
    global: {
      candidateId: global.candidate.id,
      normalizedObjective: global.score,
      tierObjectives: global.tierObjectives,
      stable: global.stable,
    },
    recommendation: tuningFromCandidate(global.candidate),
    caveats: [
      'Each candidate is evaluated with identical seed sequences per repetition (common random numbers).',
      'Recommendation is one global TranslationBudgetTuning object; tier tables are diagnostic only.',
      'TPM rejections do not consume the rolling token ledger and retry the same batch after Retry-After; validation failures alone create isolated child requests.',
    ],
  };
  printReport(report, parsed.jsonOnly);
}
const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
