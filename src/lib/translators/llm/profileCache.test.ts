import { getLLMCacheId } from './LLMTranslationEngine';
import { llmProviderPresets } from './presets';

describe('translation profile cache identity', () => {
  test('invalidates when quality mode or an advanced profile override changes', () => {
    const baseline = structuredClone(llmProviderPresets.openai);
    const fast = structuredClone(baseline);
    fast.qualityMode = 'fast';
    const customSampling = structuredClone(baseline);
    customSampling.translationProfile.generation.temperature = 0;

    expect(getLLMCacheId(fast)).not.toBe(getLLMCacheId(baseline));
    expect(getLLMCacheId(customSampling)).not.toBe(getLLMCacheId(baseline));
    expect(getLLMCacheId(structuredClone(baseline))).toBe(getLLMCacheId(baseline));
  });
});
