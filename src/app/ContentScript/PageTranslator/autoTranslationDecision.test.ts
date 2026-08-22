import {
  shouldAutoTranslate,
  type AutoTranslationDecisionAdapters,
} from './autoTranslationDecision';

const supportedLanguages = ['en', 'de'];

const createAdapters = (
  overrides: Partial<AutoTranslationDecisionAdapters> = {},
): AutoTranslationDecisionAdapters => ({
  getPageHost: () => 'example.com',
  getSitePreferences: async () => null,
  getLanguagePreferences: async () => null,
  getTranslatorFeatures: async () => ({
    supportedLanguages,
    isSupportAutodetect: true,
  }),
  ...overrides,
});

describe('automatic page translation decision', () => {
  test('skips a page that is already translating', async () => {
    let readCount = 0;
    const adapters = createAdapters({
      getPageHost: () => {
        readCount++;
        return 'example.com';
      },
      getSitePreferences: async () => {
        readCount++;
        return null;
      },
      getLanguagePreferences: async () => {
        readCount++;
        return true;
      },
      getTranslatorFeatures: async () => {
        readCount++;
        return { supportedLanguages, isSupportAutodetect: true };
      },
    });

    await expect(
      shouldAutoTranslate(
        { isTranslating: true, pageLanguage: 'en', userLanguage: 'de' },
        adapters,
      ),
    ).resolves.toBe(false);
    expect(readCount).toBe(0);
  });

  test('skips when the page language is unknown', async () => {
    await expect(
      shouldAutoTranslate(
        { isTranslating: false, pageLanguage: null, userLanguage: 'de' },
        createAdapters(),
      ),
    ).resolves.toBe(false);
  });

  test('allows same-language translation when preferences request it', async () => {
    await expect(
      shouldAutoTranslate(
        { isTranslating: false, pageLanguage: 'en', userLanguage: 'en' },
        createAdapters({ getLanguagePreferences: async () => true }),
      ),
    ).resolves.toBe(true);
  });

  test('site never wins over a language preference that enables translation', async () => {
    let languagePreferenceRead = false;
    const sitePreferences = {
      enableAutoTranslate: false,
      autoTranslateLanguages: [],
      autoTranslateIgnoreLanguages: [],
    };

    await expect(
      shouldAutoTranslate(
        { isTranslating: false, pageLanguage: 'en', userLanguage: 'de' },
        createAdapters({
          getSitePreferences: async () => sitePreferences,
          getLanguagePreferences: async () => {
            languagePreferenceRead = true;
            return true;
          },
        }),
      ),
    ).resolves.toBe(false);
    expect(languagePreferenceRead).toBe(false);
  });

  test('language never prevents translation', async () => {
    await expect(
      shouldAutoTranslate(
        { isTranslating: false, pageLanguage: 'en', userLanguage: 'de' },
        createAdapters({ getLanguagePreferences: async () => false }),
      ),
    ).resolves.toBe(false);
  });

  test.each([
    [
      'site',
      createAdapters({
        getSitePreferences: async () => ({
          enableAutoTranslate: true,
          autoTranslateLanguages: [],
          autoTranslateIgnoreLanguages: [],
        }),
      }),
    ],
    ['language', createAdapters({ getLanguagePreferences: async () => true })],
  ])('%s preference enables translation', async (_, adapters) => {
    await expect(
      shouldAutoTranslate(
        { isTranslating: false, pageLanguage: 'en', userLanguage: 'de' },
        adapters,
      ),
    ).resolves.toBe(true);
  });

  test.each([
    ['page', 'fr', 'de'],
    ['user', 'en', 'fr'],
  ])(
    'skips when the %s language is unsupported',
    async (_, pageLanguage, userLanguage) => {
      await expect(
        shouldAutoTranslate(
          { isTranslating: false, pageLanguage, userLanguage },
          createAdapters({ getLanguagePreferences: async () => true }),
        ),
      ).resolves.toBe(false);
    },
  );
});
