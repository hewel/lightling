import { AppConfigType } from '@/types/runtime';

import {
  buildTranslatorModelOptions,
  decodeLLMProfileOptionValue,
  encodeLLMProfileOptionValue,
  getCurrentTranslatorModelValue,
} from './TranslatorModelSelector';

type LLMTranslatorConfig = AppConfigType['llmTranslator'];

const makeLLMConfig = (
  activeProfile: string,
  profileNames: string[],
): LLMTranslatorConfig =>
  ({
    activeProfile,
    profiles: profileNames.map((name) => ({ name })),
  }) as unknown as LLMTranslatorConfig;

const translators: Record<string, string> = {
  GoogleTranslator: 'Google',
  LLMTranslator: 'LLM',
  BergamotTranslator: 'Bergamot',
};

describe('buildTranslatorModelOptions', () => {
  test('lists every LLM profile as a separate translation model', () => {
    const options = buildTranslatorModelOptions(
      translators,
      makeLLMConfig('OpenAI', ['OpenAI', 'Local']),
    );

    expect(options).toEqual([
      { value: 'GoogleTranslator', label: 'Google' },
      { value: 'BergamotTranslator', label: 'Bergamot' },
      { value: 'llm:OpenAI', label: 'LLM: OpenAI' },
      { value: 'llm:Local', label: 'LLM: Local' },
    ]);
  });

  test('keeps the plain LLM module entry when no profiles are configured', () => {
    const options = buildTranslatorModelOptions(translators, makeLLMConfig('', []));

    expect(options).toContainEqual({ value: 'LLMTranslator', label: 'LLM' });
  });
});

describe('getCurrentTranslatorModelValue', () => {
  test('returns the module id for a non-LLM translator', () => {
    const config = {
      translatorModule: 'GoogleTranslator',
      llmTranslator: makeLLMConfig('OpenAI', ['OpenAI']),
    } as unknown as AppConfigType;

    expect(getCurrentTranslatorModelValue(config)).toBe('GoogleTranslator');
  });

  test('returns the active LLM profile', () => {
    const config = {
      translatorModule: 'LLMTranslator',
      llmTranslator: makeLLMConfig('Local', ['OpenAI', 'Local']),
    } as unknown as AppConfigType;

    expect(getCurrentTranslatorModelValue(config)).toBe('llm:Local');
  });

  test('falls back to the first profile when activeProfile is unknown', () => {
    const config = {
      translatorModule: 'LLMTranslator',
      llmTranslator: makeLLMConfig('Deleted', ['OpenAI']),
    } as unknown as AppConfigType;

    expect(getCurrentTranslatorModelValue(config)).toBe('llm:OpenAI');
  });

  test('falls back to the module id when no profiles exist', () => {
    const config = {
      translatorModule: 'LLMTranslator',
      llmTranslator: makeLLMConfig('', []),
    } as unknown as AppConfigType;

    expect(getCurrentTranslatorModelValue(config)).toBe('LLMTranslator');
  });
});

describe('LLM profile option value codec', () => {
  test('round-trips profile names', () => {
    expect(decodeLLMProfileOptionValue(encodeLLMProfileOptionValue('My Profile'))).toBe(
      'My Profile',
    );
  });

  test('returns null for plain module ids', () => {
    expect(decodeLLMProfileOptionValue('GoogleTranslator')).toBeNull();
  });
});
