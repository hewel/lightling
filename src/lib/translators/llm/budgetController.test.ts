import {
  BUDGET_TUNING,
  TranslationBudgetController,
  type TranslationBudgetObservation,
} from './budgetController';
import { resolveTranslationModelProfile } from './modelProfile';
import { llmProviderPresets } from './presets';

const configured = {
  ...structuredClone(llmProviderPresets.custom),
  name: 'Primary',
  model: 'test-model',
};
const profile = resolveTranslationModelProfile(configured, null).profile;
const observation = (
  overrides: Partial<TranslationBudgetObservation> = {},
): TranslationBudgetObservation => ({
  valid: true,
  truncated: false,
  timedOut: false,
  latencyMs: 100,
  validationFailures: 0,
  targetCount: 1,
  rateLimited: false,
  retryAfterMs: null,
  sourceTokens: 600,
  ...overrides,
});
const controller = (persisted = null, tier: 'small' | 'medium' | 'large' = 'small') =>
  new TranslationBudgetController({
    tier,
    profile,
    userConcurrencyCeiling: null,
    persisted,
    getOutputRatio: () => 1,
  });

describe('TranslationBudgetController', () => {
  test('halves budget on 429 and suppresses growth during Retry-After cooldown', () => {
    vi.useFakeTimers();
    const target = controller();
    const before = target.snapshot().budgetTokens;
    target.observe(observation({ rateLimited: true, retryAfterMs: 60_000 }));
    const afterRateLimit = target.snapshot().budgetTokens;
    expect(afterRateLimit).toBeCloseTo(before * BUDGET_TUNING.rateLimitShrinkFactor);

    for (let index = 0; index < BUDGET_TUNING.cleanObservationWindow; index++) {
      target.observe(observation());
    }
    expect(target.snapshot().budgetTokens).toBe(afterRateLimit);
    vi.advanceTimersByTime(60_001);
    for (let index = 0; index < BUDGET_TUNING.cleanObservationWindow; index++) {
      target.observe(observation());
    }
    expect(target.snapshot().budgetTokens).toBeGreaterThan(afterRateLimit);
    vi.useRealTimers();
  });
  test('excludes rate-limited latencies from the baseline', () => {
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: null,
      persisted: null,
      getOutputRatio: () => 1,
      tuning: { rateLimitShrinkFactor: 1 },
    });
    const initial = target.snapshot().budgetTokens;

    for (let index = 0; index < BUDGET_TUNING.baselineObservationCount; index++) {
      target.observe(observation({ latencyMs: 1_000, rateLimited: true }));
    }
    for (let index = 0; index < BUDGET_TUNING.baselineObservationCount; index++) {
      target.observe(observation({ latencyMs: 100 }));
    }
    for (let index = 0; index < BUDGET_TUNING.rollingObservationWindow; index++) {
      target.observe(observation({ latencyMs: 200 }));
    }

    expect(target.snapshot().budgetTokens).toBeCloseTo(
      initial * BUDGET_TUNING.latencyShrinkFactor,
    );
  });

  test('applies only the 429 shrink for a rate-limited latency spike', () => {
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: null,
      persisted: null,
      getOutputRatio: () => 1,
      tuning: { baselineObservationCount: 1, rollingObservationWindow: 1 },
    });
    target.observe(observation({ latencyMs: 100 }));
    const beforeRateLimit = target.snapshot().budgetTokens;

    target.observe(observation({ latencyMs: 1_000, rateLimited: true }));

    expect(target.snapshot().budgetTokens).toBeCloseTo(
      beforeRateLimit * BUDGET_TUNING.rateLimitShrinkFactor,
    );
  });

  test('shrinks budget after a rolling latency regression', () => {
    const target = controller();
    const initial = target.snapshot().budgetTokens;
    for (let index = 0; index < BUDGET_TUNING.baselineObservationCount; index++) {
      target.observe(observation({ latencyMs: 100 }));
    }
    for (let index = 0; index < BUDGET_TUNING.rollingObservationWindow; index++) {
      target.observe(observation({ latencyMs: 200 }));
    }
    expect(target.snapshot().budgetTokens).toBeCloseTo(
      initial * BUDGET_TUNING.latencyShrinkFactor,
    );
  });

  test('shrinks batches for failures and grows them again for clean batches', () => {
    const target = controller();
    const initial = target.snapshot();
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      target.observe(observation({ valid: false, validationFailures: 1 }));
    }
    const afterFailures = target.snapshot();
    expect(afterFailures.batchSourceTokens).toBeLessThan(initial.batchSourceTokens);
    expect(afterFailures.budgetTokens).toBeCloseTo(initial.budgetTokens);
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      target.observe(observation());
    }
    expect(target.snapshot().batchSourceTokens).toBeGreaterThan(
      afterFailures.batchSourceTokens,
    );
  });

  test('keeps explicit high-failure batch reductions for medium and large tiers', () => {
    for (const tier of ['medium', 'large'] as const) {
      const target = controller(null, tier);
      const initial = target.snapshot();
      for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
        target.observe(observation({ valid: false, validationFailures: 1 }));
      }
      const afterFailures = target.snapshot();
      expect(afterFailures.batchSourceTokens).toBe(
        Math.floor(initial.batchSourceTokens * BUDGET_TUNING.highFailureBatchFactor),
      );
      expect(afterFailures.concurrency).toBeGreaterThanOrEqual(initial.concurrency);
    }
  });

  test('keeps explicit high-failure reductions with a user-capped concurrency', () => {
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: 1,
      persisted: null,
      getOutputRatio: () => 1,
    });
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      target.observe(observation({ valid: false, validationFailures: 1 }));
    }
    expect(target.snapshot()).toMatchObject({
      concurrency: 1,
      batchSourceTokens: 480,
    });
  });

  test('backfills concurrency only when the discrete budget permits it', () => {
    const insufficient = new TranslationBudgetController({
      tier: 'medium',
      profile,
      userConcurrencyCeiling: null,
      persisted: { concurrency: 2, batchSourceTokens: 1_200, budgetTokens: 3_800 },
      getOutputRatio: () => 1,
      tuning: { persistedColdStartFactor: 1 },
    });
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      insufficient.observe(observation({ valid: false, validationFailures: 1 }));
    }
    expect(insufficient.snapshot()).toMatchObject({
      concurrency: 1,
      batchSourceTokens: 960,
    });

    const sufficient = new TranslationBudgetController({
      tier: 'medium',
      profile,
      userConcurrencyCeiling: null,
      persisted: { concurrency: 2, batchSourceTokens: 1_200, budgetTokens: 3_840 },
      getOutputRatio: () => 1,
      tuning: { persistedColdStartFactor: 1 },
    });
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      sufficient.observe(observation({ valid: false, validationFailures: 1 }));
    }
    expect(sufficient.snapshot()).toMatchObject({
      concurrency: 2,
      batchSourceTokens: 960,
    });
  });

  test('continues shrinking high-failure batches toward the medium minimum', () => {
    const target = controller(null, 'medium');
    const observedBatches: number[] = [];
    for (let window = 0; window < 5; window++) {
      for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
        target.observe(observation({ valid: false, validationFailures: 1 }));
      }
      observedBatches.push(target.snapshot().batchSourceTokens);
    }
    expect(observedBatches).toEqual([960, 768, 614, 512, 512]);
  });

  test('honors persisted cold start and all hard clamps', () => {
    const target = new TranslationBudgetController({
      tier: 'large',
      profile: { ...profile, batching: { ...profile.batching, maxSourceTokens: 900 } },
      userConcurrencyCeiling: 2,
      persisted: { concurrency: 12, batchSourceTokens: 5000, budgetTokens: 4000 },
      getOutputRatio: () => 1,
    });
    expect(target.snapshot()).toMatchObject({
      concurrency: 1,
      batchSourceTokens: 900,
      budgetTokens: 3200,
    });
    expect(target.getConcurrency()).toBeLessThanOrEqual(2);
  });

  test('uses target counts instead of batch count for failure rates', () => {
    const target = controller();
    const initial = target.snapshot();
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      target.observe(observation({ targetCount: 10, validationFailures: 1 }));
    }
    expect(target.snapshot().batchSourceTokens).toBeGreaterThan(
      initial.batchSourceTokens,
    );
  });

  test('excludes 429 observations from allocation while shrinking budget', () => {
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: null,
      persisted: { concurrency: 8, batchSourceTokens: 600, budgetTokens: 10_000 },
      getOutputRatio: () => 1,
      tuning: { allocationObservationWindow: 2 },
    });
    const initial = target.snapshot();

    target.observe(observation());
    target.observe(
      observation({
        rateLimited: true,
        retryAfterMs: 1_000,
        targetCount: 10,
        validationFailures: 10,
      }),
    );
    const afterRateLimit = target.snapshot();
    expect(afterRateLimit.budgetTokens).toBeLessThan(initial.budgetTokens);
    expect(afterRateLimit.batchSourceTokens).toBe(initial.batchSourceTokens);

    target.observe(observation());
    expect(target.snapshot().batchSourceTokens).toBeGreaterThan(
      afterRateLimit.batchSourceTokens,
    );
  });

  test('recovers batch size from low explicit validation failure rates', () => {
    const target = controller();
    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      target.observe(observation({ targetCount: 10, validationFailures: 5 }));
    }
    const afterHighFailures = target.snapshot();

    for (let index = 0; index < BUDGET_TUNING.allocationObservationWindow; index++) {
      target.observe(observation({ targetCount: 10, validationFailures: 1 }));
    }
    expect(target.snapshot().batchSourceTokens).toBeGreaterThan(
      afterHighFailures.batchSourceTokens,
    );
  });

  test('floors budget-derived dimensions without overspending a 1300-token budget', () => {
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: null,
      persisted: { concurrency: 2, batchSourceTokens: 600, budgetTokens: 1_300 },
      getOutputRatio: () => 0.1,
      tuning: { persistedColdStartFactor: 1 },
    });
    const snapshot = target.snapshot();

    expect(snapshot).toMatchObject({
      concurrency: 2,
      batchSourceTokens: 590,
      budgetTokens: 1_300,
    });
    expect(snapshot.concurrency * snapshot.batchSourceTokens * 1.1).toBeLessThanOrEqual(
      snapshot.budgetTokens,
    );
  });

  test('clamps maximum budget to realizable user and profile caps', () => {
    const target = new TranslationBudgetController({
      tier: 'large',
      profile: { ...profile, batching: { ...profile.batching, maxSourceTokens: 900 } },
      userConcurrencyCeiling: 2,
      persisted: { concurrency: 2, batchSourceTokens: 900, budgetTokens: 10_000 },
      getOutputRatio: () => 1,
      tuning: { persistedColdStartFactor: 1 },
    });

    expect(target.snapshot()).toEqual({
      concurrency: 2,
      batchSourceTokens: 900,
      budgetTokens: 3_600,
    });
  });

  test('reports Retry-After dispatch delay using the injected clock', () => {
    let now = 1_000;
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: null,
      persisted: null,
      getOutputRatio: () => 1,
      now: () => now,
    });

    expect(target.getDispatchDelayMs()).toBe(0);
    target.observe(observation({ rateLimited: true, retryAfterMs: 5_000 }));
    expect(target.getDispatchDelayMs()).toBe(5_000);
    now = 5_999;
    expect(target.getDispatchDelayMs()).toBe(1);
    now = 6_000;
    expect(target.getDispatchDelayMs()).toBe(0);
  });

  test('honors user and profile hard ceilings below tier minimums', () => {
    const target = new TranslationBudgetController({
      tier: 'small',
      profile: { ...profile, batching: { ...profile.batching, maxSourceTokens: 100 } },
      userConcurrencyCeiling: 1,
      persisted: null,
      getOutputRatio: () => 1,
    });
    expect(target.snapshot()).toMatchObject({
      concurrency: 1,
      batchSourceTokens: 100,
    });
  });

  test('accepts injected tuning and clock for deterministic simulation', () => {
    let now = 0;
    const target = new TranslationBudgetController({
      tier: 'small',
      profile,
      userConcurrencyCeiling: null,
      persisted: null,
      getOutputRatio: () => 1,
      now: () => now,
      tuning: {
        baselineObservationCount: 1,
        cleanObservationWindow: 2,
      },
    });
    const initial = target.snapshot().budgetTokens;
    target.observe(observation());
    target.observe(observation());
    expect(target.snapshot().budgetTokens).toBe(initial);
    now = 1;
    target.observe(observation());
    target.observe(observation());
    expect(target.snapshot().budgetTokens).toBeGreaterThan(initial);
  });
});
