import { clearAllMocks } from '@/lib/tests';
import { LLMScheduler } from '@/lib/translators/llm/LLMScheduler';
import { LLMTranslator } from '@/lib/translators/llm/LLMTranslator';
import { llmProviderPresets } from '@/lib/translators/llm/presets';

import { TranslatorManager } from '.';

const createTranslatorMockClass = (translatorName: string) => {
  return class MockTranslator {
    translate = vi.fn((text: string, from: string, to: string) => {
      return Promise.resolve(`${translatorName}["${text}"-${from}-${to}]`);
    });

    translateBatch = vi.fn((texts: string[], from: string, to: string) => {
      return Promise.all(texts.map((text) => this.translate(text, from, to)));
    });

    abort = vi.fn((_context: string) => {});

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

test('TranslatorManager thrown error when translator module not found', async () => {
  const translatorManagerConfig = {
    ...defaultConfig,
    translatorModule: 'unknown translator id',
  };
  const translatorManager = new TranslatorManager(
    translatorManagerConfig,
    createTranslatorsList(),
  );

  await expect(translatorManager.translate('Hello world', 'en', 'de')).rejects.toThrow(
    Error,
  );
});

test('TranslatorManager translate text with selected translator', async () => {
  const translators = createTranslatorsList();
  const translatorManager = new TranslatorManager(defaultConfig, translators);

  const translatedText = await translatorManager.translate('Hello world', 'en', 'de');

  const targetTranslator = new translators.translator2();
  const expectedText = await targetTranslator.translate('Hello world', 'en', 'de');

  expect(translatedText).toBe(expectedText);
});
test('TranslatorManager validates languages and records successful translation once', async () => {
  const onTranslation = vi.fn();
  const translatorManager = new TranslatorManager(
    {
      ...defaultConfig,
      scheduler: { ...defaultConfig.scheduler, useCache: false },
    },
    createTranslatorsList(),
    {
      onTranslation,
    },
  );

  await translatorManager.translate('Hello world', 'en', 'de', {
    context: 'test-context',
    priority: 1,
  });
  expect(onTranslation).toHaveBeenCalledTimes(1);

  await expect(translatorManager.translate('Hello world', 'ru', 'de')).resolves.toBe(
    'translator2["Hello world"-ru-de]',
  );
  expect(onTranslation).toHaveBeenCalledTimes(2);

  await expect(translatorManager.translate('Hello world', 'xx', 'de')).rejects.toThrow(
    'Source language is not supported by selected translator',
  );
  await expect(translatorManager.translate('Hello world', 'en', 'xx')).rejects.toThrow(
    'Target language is not supported by selected translator',
  );
  expect(onTranslation).toHaveBeenCalledTimes(2);
});

test('TranslatorManager aborts translation with selected translator', async () => {
  const translatorManager = new TranslatorManager(
    {
      ...defaultConfig,
      scheduler: { ...defaultConfig.scheduler, useCache: false },
    },
    createTranslatorsList(),
  );

  const translation = translatorManager.translate('Hello world', 'en', 'de', {
    context: 'test-context',
  });
  await translatorManager.abort('test-context');

  await expect(translation).rejects.toThrow('Translation is aborted in scheduler');
});

test('setConfig rebuilds the scheduler with the newly selected translator', async () => {
  const translatorManager = new TranslatorManager(defaultConfig, createTranslatorsList());

  await translatorManager.translate('Hello world', 'en', 'de');
  translatorManager.setConfig({
    ...defaultConfig,
    translatorModule: 'translator3',
  });

  await expect(translatorManager.translate('Hello world', 'en', 'de')).resolves.toBe(
    'translator3["Hello world"-en-de]',
  );
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

    // Should call translate method first time for each new translation request
    await translatorManager.translate('Hello world', 'en', 'de');
    const translateFn = translatorManager.getTranslator().translate;
    expect(translateFn).toBeCalledTimes(1);

    await translatorManager.translate('Another text', 'en', 'de');
    expect(translateFn).toBeCalledTimes(2);

    // Should return translation from cache
    translateFn.mockClear();

    await translatorManager.translate('Hello world', 'en', 'de');
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

    // Should call translate method first time for each new translation request
    await translatorManager.translate('Hello world', 'en', 'de');
    const translateFn = translatorManager.getTranslator().translate;
    expect(translateFn).toBeCalledTimes(1);

    await translatorManager.translate('Another text', 'en', 'de');
    expect(translateFn).toBeCalledTimes(2);

    // Should call translate method
    translateFn.mockClear();

    await translatorManager.translate('Hello world', 'en', 'de');
    expect(translateFn).toBeCalled();

    // Consider config updates
    translatorManager.setConfig(defaultConfig);

    // TODO: implement behavior to reuse scheduler
    await translatorManager.translate('Hello world', 'en', 'de');
    const translateFn2 = translatorManager.getTranslator().translate;
    expect(translateFn2).toBeCalledTimes(1);

    await translatorManager.translate('Another text', 'en', 'de');
    expect(translateFn2).toBeCalledTimes(2);

    // Should return translation from cache
    translateFn2.mockClear();

    await translatorManager.translate('Hello world', 'en', 'de');
    expect(translateFn2).not.toBeCalled();
  });
});

describe('TranslatorManager LLM integration', () => {
  beforeEach(clearAllMocks);

  const llmProfile1 = {
    ...structuredClone(llmProviderPresets.custom),
    name: 'Profile1',
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'model-1',
  };

  const llmProfile2 = {
    ...structuredClone(llmProviderPresets.custom),
    name: 'Profile2',
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'model-2',
  };

  test('setConfig disposes previous LLMScheduler instance', async () => {
    const disposeSpy = vi.spyOn(LLMScheduler.prototype, 'dispose');
    const translateSpy = vi
      .spyOn(LLMScheduler.prototype, 'translate')
      .mockResolvedValue('translated');
    const llmManager = new TranslatorManager(
      {
        ...defaultConfig,
        translatorModule: 'LLMTranslator',
        llmTranslator: { activeProfile: 'Profile1', profiles: [llmProfile1] },
      },
      { LLMTranslator },
    );

    await llmManager.translate('apple', 'en', 'de');
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

    // TranslatorManager owns one scheduler, and LLMTranslator owns its internal
    // page-batch scheduler. Replacing the manager scheduler disposes both.
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    translateSpy.mockRestore();
    disposeSpy.mockRestore();
  });

  test('getCacheInstance uses getLLMCacheId isolating cache between different models', async () => {
    const mockTranslate = vi
      .spyOn(LLMTranslator.prototype, 'executeBatchWithOptions')
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

    const res1 = await llmManager.translate('apple', 'en', 'de');
    expect(res1).toBe('llm:apple');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockClear();

    // Same model -> hits cache
    const resCached = await llmManager.translate('apple', 'en', 'de');
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

    const res2 = await llmManager.translate('apple', 'en', 'de');
    expect(res2).toBe('llm:apple');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockRestore();
  });
});
