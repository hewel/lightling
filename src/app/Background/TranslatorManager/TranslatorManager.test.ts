import { clearAllMocks } from '@/lib/tests';
import { LLMScheduler } from '@/lib/translators/llm/LLMScheduler';
import { LLMTranslator } from '@/lib/translators/llm/LLMTranslator';

import { TranslatorManager } from '.';

const createTranslatorMockClass = (translatorName: string) => {
  return class MockTranslator {
    translate = vi.fn((text: string, from: string, to: string) => {
      return Promise.resolve(`${translatorName}["${text}"-${from}-${to}]`);
    });

    translateBatch = vi.fn((texts: string[], from: string, to: string) => {
      return Promise.all(texts.map((text) => this.translate(text, from, to)));
    });

    getLengthLimit = () => 4000;
    getRequestsTimeout = () => 300;
    checkLimitExceeding = () => -10000;

    static isSupportedAutoFrom = () => true;
    static getSupportedLanguages = () => ['en', 'ru', 'ja', 'de'];
    static translatorName = 'FakeTranslator';
    static isRequiredKey = () => false;
  };
};

const createTranslatorsList = () => ({
  translator1: createTranslatorMockClass('translator1'),
  translator2: createTranslatorMockClass('translator2'),
  translator3: createTranslatorMockClass('translator3'),
});

const defaultConfig = {
  translatorModule: 'translator2',
  scheduler: {
    useCache: true,
    translateRetryAttemptLimit: 2,
    isAllowDirectTranslateBadChunks: true,
    directTranslateLength: null,
    translatePoolDelay: 300,
    chunkSizeForInstantTranslate: null,
  },
  cache: {
    ignoreCase: true,
  },
  llmTranslator: {
    activeProfile: '',
    profiles: [],
  },
};

test('TranslatorManager thrown error when translator module not found', () => {
  const translatorManagerConfig = {
    ...defaultConfig,
    translatorModule: 'unknown translator id',
  };
  const translatorManager = new TranslatorManager(
    translatorManagerConfig,
    createTranslatorsList(),
  );

  expect(translatorManager.getScheduler).toThrow(Error);
});

test('TranslatorManager translate text with selected translator', async () => {
  const translators = createTranslatorsList();
  const translatorManager = new TranslatorManager(defaultConfig, translators);

  const scheduler = translatorManager.getScheduler();
  const translatedText = await scheduler.translate('Hello world', 'en', 'de');

  const targetTranslator = new translators.translator2();
  const expectedText = await targetTranslator.translate('Hello world', 'en', 'de');

  expect(translatedText).toBe(expectedText);
});

test('TranslatorManager passes llmTranslator config to LLMTranslator', async () => {
  const translatorManager = new TranslatorManager(
    { ...defaultConfig, translatorModule: 'LLMTranslator' },
    { LLMTranslator },
  );

  const translator = translatorManager.getTranslator();
  await expect(translator.translate('Hello world', 'en', 'de')).rejects.toThrow(
    'LLM translator model is not configured',
  );
});

describe('TranslatorManager consider cache preferences', () => {
  beforeEach(clearAllMocks);

  test('TranslatorManager with enabled cache', async () => {
    const translators = createTranslatorsList();
    const translatorManager = new TranslatorManager(defaultConfig, translators);

    const scheduler = translatorManager.getScheduler();
    const translateFn = translatorManager.getTranslator().translate;

    // Should call translate method first time for each new translation request
    await scheduler.translate('Hello world', 'en', 'de');
    expect(translateFn).toBeCalledTimes(1);

    await scheduler.translate('Another text', 'en', 'de');
    expect(translateFn).toBeCalledTimes(2);

    // Should return translation from cache
    translateFn.mockClear();

    await scheduler.translate('Hello world', 'en', 'de');
    expect(translateFn).not.toBeCalled();
  });

  test('TranslatorManager with disabled cache', async () => {
    const translators = createTranslatorsList();
    const translatorManager = new TranslatorManager(
      {
        ...defaultConfig,
        scheduler: {
          ...defaultConfig.scheduler,
          useCache: false,
        },
      },
      translators,
    );

    const scheduler = translatorManager.getScheduler();
    const translateFn = translatorManager.getTranslator().translate;

    // Should call translate method first time for each new translation request
    await scheduler.translate('Hello world', 'en', 'de');
    expect(translateFn).toBeCalledTimes(1);

    await scheduler.translate('Another text', 'en', 'de');
    expect(translateFn).toBeCalledTimes(2);

    // Should call translate method
    translateFn.mockClear();

    await scheduler.translate('Hello world', 'en', 'de');
    expect(translateFn).toBeCalled();

    // Consider config updates
    translatorManager.setConfig(defaultConfig);

    // TODO: implement behavior to reuse scheduler
    const scheduler2 = translatorManager.getScheduler();
    const translateFn2 = translatorManager.getTranslator().translate;

    translateFn2.mockClear();

    // Should call translate method first time for each new translation request
    await scheduler2.translate('Hello world', 'en', 'de');
    expect(translateFn2).toBeCalledTimes(1);

    await scheduler2.translate('Another text', 'en', 'de');
    expect(translateFn2).toBeCalledTimes(2);

    // Should return translation from cache
    translateFn2.mockClear();

    await scheduler2.translate('Hello world', 'en', 'de');
    expect(translateFn2).not.toBeCalled();
  });
});

describe('TranslatorManager LLM integration', () => {
  beforeEach(clearAllMocks);

  const llmProfile1 = {
    name: 'Profile1',
    provider: 'openai-compatible' as const,
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'model-1',
    contextWindowTokens: null,
    preferredInputTokens: null,
    maxOutputTokens: null,
    maxConcurrentRequests: null,
  };

  const llmProfile2 = {
    name: 'Profile2',
    provider: 'openai-compatible' as const,
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'model-2',
    contextWindowTokens: null,
    preferredInputTokens: null,
    maxOutputTokens: null,
    maxConcurrentRequests: null,
  };

  test('LLM path instantiates LLMTranslator directly while non-LLM wraps with telemetry subclass', () => {
    const translators = {
      ...createTranslatorsList(),
      LLMTranslator,
    };

    // LLM path
    const llmManager = new TranslatorManager(
      {
        ...defaultConfig,
        translatorModule: 'LLMTranslator',
        llmTranslator: { activeProfile: 'Profile1', profiles: [llmProfile1] },
      },
      translators,
    );
    const llmTranslatorInstance = llmManager.getTranslator();
    expect(llmTranslatorInstance.constructor).toBe(LLMTranslator);

    // Non-LLM path
    const regularManager = new TranslatorManager(
      { ...defaultConfig, translatorModule: 'translator1' },
      translators,
    );
    const regularTranslatorInstance = regularManager.getTranslator();
    expect(regularTranslatorInstance.constructor).not.toBe(translators.translator1);
    expect(regularTranslatorInstance).toBeInstanceOf(translators.translator1);
  });

  test('setConfig disposes previous LLMScheduler instance', () => {
    const disposeSpy = vi.spyOn(LLMScheduler.prototype, 'dispose');
    const llmManager = new TranslatorManager(
      {
        ...defaultConfig,
        translatorModule: 'LLMTranslator',
        llmTranslator: { activeProfile: 'Profile1', profiles: [llmProfile1] },
      },
      { LLMTranslator },
    );

    llmManager.getScheduler();
    expect(disposeSpy).not.toHaveBeenCalled();

    llmManager.setConfig({
      ...defaultConfig,
      translatorModule: 'LLMTranslator',
      scheduler: {
        ...defaultConfig.scheduler,
        translatePoolDelay: 500,
      },
      llmTranslator: { activeProfile: 'Profile1', profiles: [llmProfile1] },
    });

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });

  test('getCacheInstance uses getLLMCacheId isolating cache between different models', async () => {
    const mockTranslate = vi
      .spyOn(LLMTranslator.prototype, 'translateBatchWithOptions')
      .mockImplementation(async (texts) => texts.map((t) => `llm:${t}`));

    const llmManager = new TranslatorManager(
      {
        ...defaultConfig,
        translatorModule: 'LLMTranslator',
        scheduler: {
          ...defaultConfig.scheduler,
          useCache: true,
        },
        llmTranslator: {
          activeProfile: 'Profile1',
          profiles: [llmProfile1, llmProfile2],
        },
      },
      { LLMTranslator },
    );

    const scheduler1 = llmManager.getScheduler();
    const res1 = await scheduler1.translate('apple', 'en', 'de');
    expect(res1).toBe('llm:apple');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockClear();

    // Same model -> hits cache
    const resCached = await scheduler1.translate('apple', 'en', 'de');
    expect(resCached).toBe('llm:apple');
    expect(mockTranslate).not.toHaveBeenCalled();

    // Switch to Profile2 (different model) -> cache misses
    llmManager.setConfig({
      ...defaultConfig,
      translatorModule: 'LLMTranslator',
      scheduler: {
        ...defaultConfig.scheduler,
        useCache: true,
      },
      llmTranslator: {
        activeProfile: 'Profile2',
        profiles: [llmProfile1, llmProfile2],
      },
    });

    const scheduler2 = llmManager.getScheduler();
    const res2 = await scheduler2.translate('apple', 'en', 'de');
    expect(res2).toBe('llm:apple');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockRestore();
  });
});
