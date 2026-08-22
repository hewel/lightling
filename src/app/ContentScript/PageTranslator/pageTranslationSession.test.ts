import { llmProviderPresets } from '@/lib/translators/llm/presets';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';

import { preparePageTranslationSession } from './pageTranslationSession';

const baseInput = {
  from: 'en',
  to: 'de',
  documentIdentity: 'document-1',
  pageUrl: 'https://example.test/article',
  sessionId: 'session-1',
};

describe('preparePageTranslationSession', () => {
  test('uses conservative defaults for non-LLM translators', () => {
    const session = preparePageTranslationSession({
      ...baseInput,
      config: { translatorModule: 'GoogleTranslator' },
    });

    expect(session.provider).toBe('GoogleTranslator');
    expect(session.model).toBe('GoogleTranslator');
    expect(session.modelProfile.tokenizerSource).toBe('fallback');
    expect(session.modelProfile.safetyReserveTokens).toBe(640);
    expect(session.tokenCounter).toBe(conservativeTokenCounter);
    expect(session.debug).toBe(false);
    expect(session.logEnabled).toBe(false);
  });

  test('raises the reserve for an estimated LLM tokenizer', () => {
    const profile = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Primary',
      model: 'local-model',
    };
    const session = preparePageTranslationSession({
      ...baseInput,
      config: {
        translatorModule: 'LLMTranslator',
        llmTranslator: { activeProfile: profile.name, profiles: [profile] },
      },
    });

    expect(session.tokenCounter.accuracy).toBe('estimate');
    expect(session.modelProfile.tokenizerSource).toBe('fallback');
    expect(session.modelProfile.safetyReserveTokens).toBe(640);
  });

  test('builds a local session signature without adding it to transport', () => {
    const session = preparePageTranslationSession({
      ...baseInput,
      config: { translatorModule: 'GoogleTranslator', lazyTranslate: true },
    });

    expect(session.sessionId).toBe(baseInput.sessionId);
    expect(session.sessionSignature.split('\u0000')).toEqual([
      baseInput.pageUrl,
      baseInput.documentIdentity,
      baseInput.from,
      baseInput.to,
      session.provider,
      session.model,
      session.modelProfile.profileVersion,
      session.modelProfile.promptVersion,
      'lazy',
    ]);
  });

  test('exposes debug, logging, provider, and model identity fields', () => {
    const profile = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Debug profile',
      model: 'debug-model',
      translationProfile: {
        ...structuredClone(llmProviderPresets.custom.translationProfile),
        debug: true,
      },
    };
    const session = preparePageTranslationSession({
      ...baseInput,
      config: {
        translatorModule: 'LLMTranslator',
        llmTranslator: { activeProfile: profile.name, profiles: [profile] },
        enableLogExport: true,
      },
    });

    expect(session.provider).toBe(profile.provider);
    expect(session.model).toBe(profile.model);
    expect(session.logEnabled).toBe(true);
    expect(session.debug).toBe(true);
  });
});
