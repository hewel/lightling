import {
  mergeTranslationModelProfile,
  resolveTranslationModelProfile,
  selectStructuredOutputMode,
  validateFallbackProfiles,
  validateTranslationModelProfile,
} from './modelProfile';
import { llmProviderPresets } from './presets';

const configured = (overrides: Partial<(typeof llmProviderPresets)['custom']> = {}) => ({
  ...structuredClone(llmProviderPresets.custom),
  name: 'Primary',
  model: 'local-model',
  ...overrides,
});

describe('translation model profile resolution', () => {
  test('deep-merges provider, quality, exact-model, and user layers deterministically', () => {
    const base = resolveTranslationModelProfile(
      configured({ qualityMode: 'fast' }),
      null,
    ).profile;
    const merged = mergeTranslationModelProfile(base, {
      generation: { temperature: 0 },
      batching: { concurrency: 1 },
    });

    expect(merged.promptVariant).toBe('compact');
    expect(merged.responseShape).toBe('array');
    expect(merged.generation).toMatchObject({
      temperature: 0,
      topP: 0.95,
      repetitionPenalty: 1,
      presencePenalty: 0,
      frequencyPenalty: 0,
    });
    expect(merged.batching.concurrency).toBe(1);
    expect(merged.batching.maxItems).toBe(24);
  });

  test('gives explicit overrides precedence over provider metadata', () => {
    const profile = configured({
      contextWindowTokens: 8192,
      translationProfile: {
        ...structuredClone(llmProviderPresets.custom.translationProfile),
        promptVariant: 'compact',
        capabilities: {
          ...structuredClone(llmProviderPresets.custom.translationProfile.capabilities),
          supportsJsonSchema: false,
          supportsToolCalling: true,
        },
        batching: {
          ...structuredClone(llmProviderPresets.custom.translationProfile.batching),
          maxItems: 7,
        },
      },
    });
    const resolved = resolveTranslationModelProfile(profile, {
      contextWindowTokens: 32768,
      maxOutputTokens: 4096,
      tokenizerId: 'cl100k_base',
      supportedParameters: ['structured_outputs', 'tools'],
      supportsPrefixCaching: true,
    }).profile;

    expect(resolved.contextWindow).toBe(8192);
    expect(resolved.promptVariant).toBe('compact');
    expect(resolved.batching.maxItems).toBe(7);
    expect(resolved.capabilities.supportsJsonSchema).toBe(false);
    expect(resolved.structuredOutputMode).toBe('tool-call');
  });

  test('uses actual metadata before registered model defaults', () => {
    const profile = configured({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiUrl: '',
    });
    const resolved = resolveTranslationModelProfile(profile, {
      contextWindowTokens: 64000,
      maxOutputTokens: 8000,
      tokenizerId: 'cl100k_base',
      supportedParameters: null,
      supportsPrefixCaching: false,
    }).profile;

    expect(resolved.contextWindow).toBe(64000);
    expect(resolved.maximumOutputTokens).toBe(8000);
    expect(resolved.tokenizerId).toBe('cl100k_base');
    expect(resolved.tokenizerSource).toBe('provider');
  });

  test.each(['inclusionai/ling-3.0-flash', 'inclusionai/ling-3.0-tiny'])(
    'shares the 262K model parameters across providers for %s',
    (model) => {
      const openRouter = resolveTranslationModelProfile(
        configured({ provider: 'openrouter', apiUrl: '', model }),
        null,
      ).profile;
      const compatible = resolveTranslationModelProfile(
        configured({ provider: 'openai-compatible', model }),
        null,
      ).profile;

      expect(openRouter.contextWindow).toBe(262_144);
      expect(compatible.contextWindow).toBe(openRouter.contextWindow);
      expect(compatible.generation).toEqual(openRouter.generation);
      expect(compatible.batching).toEqual(openRouter.batching);
    },
  );

  test('shares HY-MT2 parameters across providers', () => {
    const model = 'tencent/hy-mt2-30b-a3b';
    const openRouter = resolveTranslationModelProfile(
      configured({ provider: 'openrouter', apiUrl: '', model }),
      null,
    ).profile;
    const compatible = resolveTranslationModelProfile(
      configured({ provider: 'openai-compatible', model }),
      null,
    ).profile;

    expect(openRouter.contextWindow).toBe(8192);
    expect(compatible.contextWindow).toBe(8192);
    expect(compatible.generation).toEqual(openRouter.generation);
    expect(compatible.batching).toEqual(openRouter.batching);
  });

  test('selects the strongest supported structured output mode', () => {
    const capabilities = resolveTranslationModelProfile(configured(), null).profile
      .capabilities;
    expect(selectStructuredOutputMode(capabilities)).toBe('prompt-only');
    expect(
      selectStructuredOutputMode({ ...capabilities, supportsJsonObjectMode: true }),
    ).toBe('json-object');
    expect(
      selectStructuredOutputMode({
        ...capabilities,
        supportsToolCalling: true,
        supportsJsonObjectMode: true,
      }),
    ).toBe('tool-call');
    expect(
      selectStructuredOutputMode({
        ...capabilities,
        supportsJsonSchema: true,
        supportsGrammar: true,
      }),
    ).toBe('json-schema');
  });

  test('prevents fallback cycles and double chat-template application', () => {
    const first = configured({ name: 'First', fallbackProfile: 'Second' });
    const second = configured({ name: 'Second', fallbackProfile: 'First' });
    expect(validateFallbackProfiles([first, second])).toEqual([
      'Fallback cycle includes profile First',
      'Fallback cycle includes profile Second',
    ]);

    const profile = resolveTranslationModelProfile(configured(), null).profile;
    expect(
      validateTranslationModelProfile({
        ...profile,
        chatTemplateOwner: 'tokenizer',
        messageFormat: 'structured-chat',
      }),
    ).toContain('Structured chat cannot also apply a tokenizer or application template');
  });
});
