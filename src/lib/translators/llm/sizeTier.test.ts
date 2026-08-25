import { llmProviderPresets } from './presets';
import { resolveSizeTier, SIZE_TIER_BUDGETS } from './sizeTier';

const configured = (overrides: Partial<(typeof llmProviderPresets)['custom']> = {}) => ({
  ...structuredClone(llmProviderPresets.custom),
  name: 'Primary',
  model: 'unknown-model',
  ...overrides,
});

const modelInfo = (
  overrides: Partial<NonNullable<Parameters<typeof resolveSizeTier>[1]>> = {},
) => ({
  id: 'unknown-model',
  displayName: 'Unknown model',
  contextWindowTokens: null,
  maxInputTokens: null,
  maxOutputTokens: null,
  inputPricePerMillionTokens: null,
  outputPricePerMillionTokens: null,
  supportedParameters: null,
  tokenizerId: null,
  supportsPrefixCaching: null,
  contextWindowSource: null,
  maxInputSource: null,
  maxOutputSource: null,
  ...overrides,
});

describe('resolveSizeTier', () => {
  test('uses the registered model tier before metadata', () => {
    expect(
      resolveSizeTier(
        configured({ model: 'gpt-4o-mini' }),
        modelInfo({ contextWindowTokens: 4096 }),
      ),
    ).toBe('small');
  });

  test.each([
    ['tiny-model', 'small'],
    ['my-mini-model', 'small'],
    ['model-pro', 'large'],
    ['reasoning-model', 'large'],
  ])('classifies model name %s as %s', (model, tier) => {
    expect(resolveSizeTier(configured({ model }), modelInfo())).toBe(tier);
  });
  test('uses price classification before model names', () => {
    expect(
      resolveSizeTier(
        configured({ model: 'turbo-model' }),
        modelInfo({ inputPricePerMillionTokens: 6, outputPricePerMillionTokens: 1 }),
      ),
    ).toBe('large');
    expect(
      resolveSizeTier(
        configured({ model: 'pro-model' }),
        modelInfo({ inputPricePerMillionTokens: 0.5, outputPricePerMillionTokens: 2 }),
      ),
    ).toBe('small');
    expect(
      resolveSizeTier(
        configured({ model: 'turbo-model' }),
        modelInfo({ inputPricePerMillionTokens: 2, outputPricePerMillionTokens: 5 }),
      ),
    ).toBe('medium');
  });

  test('uses known registered context after names and metadata', () => {
    expect(resolveSizeTier(configured({ model: 'tencent/hy-mt2-30b-a3b' }), null)).toBe(
      'small',
    );
  });

  test('uses configured context window when discovery metadata is absent', () => {
    expect(resolveSizeTier(configured({ contextWindowTokens: 16_384 }), null)).toBe(
      'small',
    );
  });

  test('uses context window fallback and defaults unknown models to medium', () => {
    expect(
      resolveSizeTier(configured(), modelInfo({ contextWindowTokens: 31_999 })),
    ).toBe('small');
    expect(
      resolveSizeTier(configured(), modelInfo({ contextWindowTokens: 32_000 })),
    ).toBe('medium');
    expect(resolveSizeTier(configured(), null)).toBe('medium');
  });
});

test('exports the ADR tier budgets', () => {
  expect(SIZE_TIER_BUDGETS.small).toMatchObject({
    initialConcurrency: 4,
    initialBatchSourceTokens: 600,
    minConcurrency: 2,
    maxConcurrency: 12,
    minBatchSourceTokens: 256,
    maxBatchSourceTokens: 1200,
    budgetCeilingTokens: 9600,
  });
});
