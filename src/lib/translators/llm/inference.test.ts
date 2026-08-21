import {
  mapTranslationInferenceRequest,
  type TranslationInferenceRequest,
} from './inference';
import {
  resolveTranslationModelProfile,
  type ConfiguredLLMProfile,
} from './modelProfile';
import { llmProviderPresets } from './presets';

const request = (
  overrides: Partial<TranslationInferenceRequest> = {},
): TranslationInferenceRequest => ({
  modelProfileId: 'test',
  messages: [{ role: 'user', content: 'Translate' }],
  structuredOutputMode: 'prompt-only',
  maxOutputTokens: 512,
  sampling: { temperature: 0.1, topP: 0.95, topK: 40 },
  penalties: { repetition: 1, presence: 0, frequency: 0 },
  seed: 7,
  stop: ['END'],
  reasoningMode: 'disabled',
  signal: new AbortController().signal,
  ...overrides,
});

const profileFor = (
  preset: keyof typeof llmProviderPresets,
  supportedParameters: readonly string[] | null = null,
) => {
  const configured = {
    ...structuredClone(llmProviderPresets[preset]),
    model: 'test-model',
  };
  return resolveTranslationModelProfile(configured, {
    contextWindowTokens: 8192,
    maxOutputTokens: 2048,
    tokenizerId: null,
    supportedParameters,
    supportsPrefixCaching: null,
  }).profile;
};

describe('provider inference mapping', () => {
  test('maps translation-safe defaults and reasoning controls for Anthropic', () => {
    const profile = profileFor('anthropic');
    const mapping = mapTranslationInferenceRequest('anthropic', profile, request(), null);
    expect(mapping.generationConfig).toEqual({
      max_tokens: 512,
      temperature: 0.1,
      top_p: 0.95,
      top_k: 40,
      stop_sequences: ['END'],
      thinking: { type: 'disabled' },
    });
    expect(mapping.generationConfig).not.toHaveProperty('seed');
    expect(mapping.generationConfig).not.toHaveProperty('repetition_penalty');
  });

  test('filters every OpenRouter field not declared by model metadata', () => {
    const supported = ['temperature', 'top_p', 'frequency_penalty'];
    const profile = profileFor('openrouter', supported);
    const mapping = mapTranslationInferenceRequest(
      'openrouter',
      profile,
      request(),
      supported,
    );
    expect(mapping.generationConfig).toEqual({
      max_tokens: 512,
      temperature: 0.1,
      top_p: 0.95,
      frequency_penalty: 0,
    });
    expect(mapping.generationConfig).not.toHaveProperty('top_k');
    expect(mapping.generationConfig).not.toHaveProperty('seed');
    expect(mapping.generationConfig).not.toHaveProperty('stop');
    expect(mapping.generationConfig).not.toHaveProperty('reasoning_effort');
  });

  test('maps only explicitly reported custom endpoint extensions', () => {
    const supported = ['top_k', 'repeat_penalty', 'seed', 'enable_thinking'];
    const configured: ConfiguredLLMProfile = {
      ...structuredClone(llmProviderPresets.custom),
      model: 'local-model',
      translationProfile: {
        ...structuredClone(llmProviderPresets.custom.translationProfile),
        reasoningControl: 'enable-thinking',
        capabilities: {
          ...structuredClone(llmProviderPresets.custom.translationProfile.capabilities),
          supportsSeed: true,
          supportsReasoningControl: true,
        },
      },
    };
    const profile = resolveTranslationModelProfile(configured, {
      contextWindowTokens: 8192,
      maxOutputTokens: null,
      tokenizerId: null,
      supportedParameters: supported,
      supportsPrefixCaching: null,
    }).profile;
    const mapping = mapTranslationInferenceRequest(
      'openai-compatible',
      profile,
      request(),
      supported,
    );
    expect(mapping.generationConfig).toEqual({
      max_output_tokens: 512,
      temperature: 0.1,
      top_p: 0.95,
      top_k: 40,
      repeat_penalty: 1,
      seed: 7,
      enable_thinking: false,
    });
    expect(mapping.generationConfig).not.toHaveProperty('presence_penalty');
    expect(mapping.generationConfig).not.toHaveProperty('frequency_penalty');
  });

  test('preserves exactly zero temperature without combining aggressive sampling', () => {
    const profile = profileFor('openai');
    const mapping = mapTranslationInferenceRequest(
      'openai',
      profile,
      request({ sampling: { temperature: 0, topP: 1 } }),
      null,
    );
    expect(mapping.generationConfig).toMatchObject({
      temperature: 0,
      top_p: 1,
      max_output_tokens: 512,
    });
    expect(mapping.generationConfig).not.toHaveProperty('top_k');
    expect(mapping.generationConfig).not.toHaveProperty('repetition_penalty');
  });
});
