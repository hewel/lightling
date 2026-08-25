import { resolveLLMExecutionSettings } from '@/lib/translators/llm/modelInfo';
import { llmProviderPresets } from '@/lib/translators/llm/presets';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';

import { preparePageTranslationSession } from './pageTranslationSession';
const getBudget = vi.hoisted(() => vi.fn());
const setBudget = vi.hoisted(() => vi.fn());

const loadSettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/translators/llm/modelListCache', () => ({
  loadLLMExecutionSettingsCached: loadSettings,
}));

vi.mock('@/requests/backend/getTranslationBudgetSnapshot', () => ({
  getTranslationBudgetSnapshot: getBudget,
}));
vi.mock('@/requests/backend/setTranslationBudgetSnapshot', () => ({
  setTranslationBudgetSnapshot: setBudget,
}));
const baseInput = {
  from: 'en',
  to: 'de',
  documentIdentity: 'document-1',
  pageUrl: 'https://example.test/article',
  sessionId: 'session-1',
};

describe('preparePageTranslationSession', () => {
  beforeEach(() => {
    getBudget.mockResolvedValue(null);
    setBudget.mockResolvedValue(undefined);
    loadSettings.mockImplementation((profile) =>
      Promise.resolve({ ...resolveLLMExecutionSettings(profile, null), modelInfo: null }),
    );
  });
  test('uses conservative defaults for non-LLM translators', async () => {
    const session = await preparePageTranslationSession({
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

  test('raises the reserve for an estimated LLM tokenizer', async () => {
    const profile = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Primary',
      model: 'local-model',
    };
    const session = await preparePageTranslationSession({
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

  test('builds a local session signature without adding it to transport', async () => {
    const session = await preparePageTranslationSession({
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

  test('exposes debug, logging, provider, and model identity fields', async () => {
    const profile = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Debug profile',
      model: 'debug-model',
      translationProfile: {
        ...structuredClone(llmProviderPresets.custom.translationProfile),
        debug: true,
      },
    };
    const session = await preparePageTranslationSession({
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
  test('loads and saves independent identity keys through backend requests', async () => {
    const profileA = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'A',
      apiKey: 'key-a',
      model: 'model-a',
    };
    const profileB = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'B',
      apiKey: 'key-b',
      model: 'model-b',
    };
    const [sessionA, sessionB] = await Promise.all([
      preparePageTranslationSession({
        ...baseInput,
        config: {
          translatorModule: 'LLMTranslator',
          llmTranslator: { activeProfile: 'A', profiles: [profileA] },
        },
      }),
      preparePageTranslationSession({
        ...baseInput,
        config: {
          translatorModule: 'LLMTranslator',
          llmTranslator: { activeProfile: 'B', profiles: [profileB] },
        },
      }),
    ]);
    const snapshot = { concurrency: 2, batchSourceTokens: 600, budgetTokens: 3000 };
    sessionA.onBudgetSnapshot(snapshot);
    sessionB.onBudgetSnapshot({ ...snapshot, concurrency: 3 });

    await vi.waitFor(() => expect(setBudget).toHaveBeenCalledTimes(2));
    const identities = setBudget.mock.calls.map(([request]) => request.identity);
    expect(new Set(identities).size).toBe(2);
    expect(identities.every((identity: string) => !identity.includes('en>de'))).toBe(
      true,
    );
    expect(getBudget).toHaveBeenCalledWith({ identity: identities[0] });
  });

  test('uses the loaded backend snapshot', async () => {
    const snapshot = { concurrency: 2, batchSourceTokens: 600, budgetTokens: 3000 };
    getBudget.mockResolvedValue(snapshot);
    const profile = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Loaded',
      apiKey: 'loaded-key',
      model: 'loaded-model',
    };

    const session = await preparePageTranslationSession({
      ...baseInput,
      config: {
        translatorModule: 'LLMTranslator',
        llmTranslator: { activeProfile: 'Loaded', profiles: [profile] },
      },
    });

    expect(session.persistedBudget).toEqual(snapshot);
    expect(getBudget).toHaveBeenCalledWith({
      identity: expect.any(String),
    });
  });

  test('logs fire-and-forget backend save failures', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setBudget.mockRejectedValue(new Error('write failed'));
    const profile = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Rejected',
      apiKey: 'rejected-key',
      model: 'rejected-model',
    };

    try {
      const session = await preparePageTranslationSession({
        ...baseInput,
        config: {
          translatorModule: 'LLMTranslator',
          llmTranslator: { activeProfile: 'Rejected', profiles: [profile] },
        },
      });
      session.onBudgetSnapshot({
        concurrency: 2,
        batchSourceTokens: 600,
        budgetTokens: 3000,
      });

      await vi.waitFor(() =>
        expect(warning).toHaveBeenCalledWith(
          'Failed to persist page translation budget snapshot',
          expect.any(Error),
        ),
      );
    } finally {
      warning.mockRestore();
    }
  });
});
