import { Schema } from 'effect';

import { defaultConfig } from '../config';
import { tryDecode } from '../lib/types';
import { AppConfig, type AppConfigType, LangCode, LangCodeWithAuto } from './runtime';

describe('runtime schemas', () => {
  test('validates language codes and the auto-detect sentinel', () => {
    expect(Schema.is(LangCode)('en')).toBe(true);
    expect(Schema.is(LangCode)('auto')).toBe(false);
    expect(Schema.is(LangCode)('not-a-language')).toBe(false);
    expect(Schema.is(LangCodeWithAuto)('auto')).toBe(true);
  });

  test('materializes omitted optional config fields as undefined', () => {
    const selectTranslator = { ...defaultConfig.selectTranslator };
    Reflect.deleteProperty(selectTranslator, 'zIndex');
    Reflect.deleteProperty(selectTranslator, 'focusOnTranslateButton');

    const config = tryDecode(AppConfig, {
      ...defaultConfig,
      selectTranslator,
    });

    expect(Object.prototype.hasOwnProperty.call(config.selectTranslator, 'zIndex')).toBe(
      true,
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        config.selectTranslator,
        'focusOnTranslateButton',
      ),
    ).toBe(true);
    expect(config.selectTranslator.zIndex).toBeUndefined();
    expect(config.selectTranslator.focusOnTranslateButton).toBeUndefined();
  });

  test('defaults missing LLM execution overrides of legacy profiles to null', () => {
    const legacyProfile = {
      name: 'Legacy',
      provider: 'openai-compatible',
      apiUrl: 'https://llm.example/v1',
      apiKey: '',
      model: 'test-model',
    };

    const config = tryDecode(AppConfig, {
      ...defaultConfig,
      llmTranslator: { activeProfile: 'Legacy', profiles: [legacyProfile] },
    });

    expect(config.llmTranslator.profiles[0]).toMatchObject({
      ...legacyProfile,
      contextWindowTokens: null,
      preferredInputTokens: null,
      maxOutputTokens: null,
      maxConcurrentRequests: null,
      qualityMode: 'balanced',
      fallbackProfile: null,
      adaptiveBatching: true,
    });
    expect(config.llmTranslator.profiles[0].translationProfile).toMatchObject({
      tokenizerId: null,
      promptVariant: null,
      structuredOutputMode: null,
      reasoningMode: null,
    });
  });

  test('enforces execution override ranges', () => {
    const profile = { ...defaultConfig.llmTranslator.profiles[0] };
    const configWith = (overrides: Record<string, unknown>) => ({
      ...defaultConfig,
      llmTranslator: {
        activeProfile: profile.name,
        profiles: [{ ...profile, ...overrides }],
      },
    });

    expect(() =>
      tryDecode(AppConfig, configWith({ contextWindowTokens: 511 })),
    ).toThrow();
    expect(() =>
      tryDecode(AppConfig, configWith({ contextWindowTokens: 512 })),
    ).not.toThrow();
    expect(() =>
      tryDecode(AppConfig, configWith({ maxConcurrentRequests: 9 })),
    ).toThrow();
    expect(() =>
      tryDecode(AppConfig, configWith({ maxConcurrentRequests: 8 })),
    ).not.toThrow();
    expect(() => tryDecode(AppConfig, configWith({ preferredInputTokens: 0 }))).toThrow();
  });

  test('rejects fractional and negative retry attempt limits', () => {
    const configWith = (limit: unknown) => ({
      ...defaultConfig,
      scheduler: { ...defaultConfig.scheduler, translateRetryAttemptLimit: limit },
    });

    expect(() => tryDecode(AppConfig, configWith(2))).not.toThrow();
    expect(() => tryDecode(AppConfig, configWith(0))).not.toThrow();
    expect(() => tryDecode(AppConfig, configWith(1.5))).toThrow();
    expect(() => tryDecode(AppConfig, configWith(-1))).toThrow();
  });

  test('keeps the schema-derived config type mutable', () => {
    const config: AppConfigType = {
      ...defaultConfig,
      pageTranslator: {
        ...defaultConfig.pageTranslator,
        excludeSelectors: [...defaultConfig.pageTranslator.excludeSelectors],
        translatableAttributes: [...defaultConfig.pageTranslator.translatableAttributes],
      },
      selectTranslator: {
        ...defaultConfig.selectTranslator,
        modifiers: [...defaultConfig.selectTranslator.modifiers],
      },
    };

    config.language = 'fr';
    config.selectTranslator.modifiers.push('ctrlKey');

    expect(config.language).toBe('fr');
    expect(config.selectTranslator.modifiers).toContain('ctrlKey');
  });
});
