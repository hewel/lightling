import { llmProviderPresets } from './presets';
import { resolveTranslationTokenizer } from './tokenizer';

describe('translation tokenizer resolution', () => {
  test('changes tokenizer selection when the configured model changes', () => {
    const openAi = {
      ...structuredClone(llmProviderPresets.openai),
      model: 'gpt-4o-mini',
    };
    const local = {
      ...structuredClone(llmProviderPresets.custom),
      model: 'unknown-local-model',
    };

    expect(resolveTranslationTokenizer(openAi, null)).toMatchObject({
      source: 'registered-model',
      counter: { id: 'o200k_base', accuracy: 'exact' },
    });
    const openRouter = {
      ...structuredClone(llmProviderPresets.openrouter),
      model: 'openai/gpt-4o-mini',
    };
    expect(resolveTranslationTokenizer(openRouter, null)).toMatchObject({
      source: 'registered-model',
      counter: { id: 'o200k_base', accuracy: 'exact' },
    });
    expect(resolveTranslationTokenizer(local, null)).toMatchObject({
      source: 'fallback',
      counter: { id: 'conservative-utf8-estimator-v1', accuracy: 'estimate' },
    });
  });

  test('uses explicit override before provider metadata', () => {
    const profile = structuredClone(llmProviderPresets.custom);
    profile.model = 'local-model';
    profile.translationProfile.tokenizerId = 'o200k_base';
    expect(
      resolveTranslationTokenizer(profile, {
        contextWindowTokens: null,
        maxOutputTokens: null,
        tokenizerId: 'cl100k_base',
        supportedParameters: null,
        supportsPrefixCaching: null,
      }),
    ).toMatchObject({
      source: 'override',
      counter: { id: 'o200k_base', accuracy: 'exact' },
    });
  });

  test('exposes unavailable exact tokenization and uses a conservative estimator', () => {
    const profile = structuredClone(llmProviderPresets.custom);
    profile.translationProfile.tokenizerId = 'not-installed';
    const resolution = resolveTranslationTokenizer(profile, null);
    expect(resolution.counter.accuracy).toBe('estimate');
    expect(resolution.warning).toContain('not-installed');
    expect(resolution.counter.count('Save')).toBeGreaterThan(0);
  });
});
