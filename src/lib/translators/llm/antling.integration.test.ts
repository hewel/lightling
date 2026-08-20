import { readFileSync } from 'node:fs';

import { LLMTranslator } from './LLMTranslator';

/**
 * Real-network smoke test against Ant Ling.
 *
 * Runs only under `TEST_TARGETS=integration` and when ANT_LING_API_KEY is set
 * (e.g. via the gitignored `.env`). Location is stubbed only to keep effect's
 * baseUrl() happy in the test env; fetch is NOT mocked — this hits the real API.
 */
vi.stubGlobal('location', new URL('https://localhost/_generated_background_page.html'));

const readEnvKey = (key: string): string => {
  if (process.env[key] !== undefined) return process.env[key];
  try {
    const envFile = readFileSync(`${process.cwd()}/.env`, 'utf8');
    const line = envFile.split('\n').find((entry) => entry.startsWith(`${key}=`));
    return line === undefined ? '' : line.slice(key.length + 1).trim();
  } catch {
    return '';
  }
};

const apiKey = readEnvKey('ANT_LING_API_KEY');
const runIfKey = apiKey === '' ? test.skip : test;

const antlingProfile = (model: string) => ({
  activeProfile: 'Ant Ling',
  profiles: [
    {
      name: 'Ant Ling',
      provider: 'openai-compatible' as const,
      apiUrl: 'https://api.ant-ling.com/v1',
      apiKey,
      model,
      contextWindowTokens: null,
      preferredInputTokens: null,
      maxOutputTokens: null,
      maxConcurrentRequests: null,
    },
  ],
});

describe('Ant Ling real API', () => {
  runIfKey(
    'Ling-3.0-tiny translates a plain batch with thinking disabled',
    async () => {
      const translator = new LLMTranslator(antlingProfile('Ling-3.0-tiny'));
      const result = await translator.translateBatch(
        ['Hello world', 'Good morning'],
        'en',
        'es',
      );
      expect(result).toHaveLength(2);
      expect(result[0].toLowerCase()).toContain('hola');
    },
    90000,
  );

  runIfKey(
    'Ling-3.0-tiny translates a multi-line text without count mismatch',
    async () => {
      const translator = new LLMTranslator(antlingProfile('Ling-3.0-tiny'));
      const result = await translator.translateBatch(
        [
          'Omitting most of the sections of the config file will leave you with the default values for that section.\nA notable exception is',
        ],
        'auto',
        'zh',
      );
      expect(result).toHaveLength(1);
      // Multi-line structure is preserved and the text is actually translated
      expect(result[0]).toContain('\n');
      expect(result[0]).not.toContain('Omitting');
    },
    90000,
  );

  runIfKey(
    'Ling-3.0-flash translates with thinking disabled',
    async () => {
      const translator = new LLMTranslator(antlingProfile('Ling-3.0-flash'));
      const result = await translator.translate('Hello world', 'en', 'es');
      expect(result.toLowerCase()).toContain('hola');
    },
    90000,
  );
});
