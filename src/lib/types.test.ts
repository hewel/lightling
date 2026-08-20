import { Effect, Schema } from 'effect';

import { AppConfig } from '@/types/runtime';

import {
  checkTypeByPath,
  decodeStruct,
  NonNaNNumber,
  NonNegativeInteger,
  PositiveInteger,
  tryDecode,
} from './types';

describe('runtime type helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('decodes valid data without removing excess properties', () => {
    const schema = Schema.Struct({ name: Schema.String });
    const input = { name: 'Linguist', custom: true };

    expect(decodeStruct(schema, input)).toEqual({
      data: input,
      errors: null,
    });
  });

  test('reports every invalid field with its path and value', () => {
    const schema = Schema.Struct({
      name: Schema.String,
      settings: Schema.Struct({ enabled: Schema.Boolean }),
    });

    const result = decodeStruct(schema, {
      name: 1,
      settings: { enabled: 'yes' },
    });

    expect(result.data).toBeNull();
    expect(
      result.errors?.map(({ key, type, value }) => ({
        key,
        typeTag: type.ast._tag,
        value,
      })),
    ).toEqual([
      {
        key: 'name',
        value: 1,
        typeTag: 'String',
      },
      {
        key: 'settings.enabled',
        value: 'yes',
        typeTag: 'Boolean',
      },
    ]);
    expect(result.errors?.every(({ message }) => message !== undefined)).toBe(true);
  });

  test('returns an explicit fallback without logging invalid data', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(tryDecode(Schema.String, 1, 'fallback')).toBe('fallback');
    expect(error).not.toHaveBeenCalled();
  });

  test('logs invalid data and throws when no fallback is provided', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => tryDecode(Schema.String, 1)).toThrow(new TypeError('Invalid type'));
    expect(error).toHaveBeenCalledWith('Data for the error below', 1);
  });

  test('validates fields by nested path and rejects unknown paths', () => {
    const schema = Schema.Struct({
      settings: Schema.Struct({ enabled: Schema.Boolean }),
    });

    expect(checkTypeByPath(schema, ['settings', 'enabled'], true)).toBe(true);
    expect(checkTypeByPath(schema, ['settings', 'enabled'], 'yes')).toBe(false);
    expect(checkTypeByPath(schema, ['settings', 'missing'], true)).toBe(false);
  });

  test('validates paths through structs with decoding defaults', () => {
    const schema = Schema.Struct({
      llmTranslator: Schema.Struct({ apiKey: Schema.String }).pipe(
        Schema.withDecodingDefault(Effect.succeed({ apiKey: '' })),
      ),
    });

    expect(checkTypeByPath(schema, ['llmTranslator', 'apiKey'], 'key')).toBe(true);
    expect(checkTypeByPath(schema, ['llmTranslator', 'apiKey'], 42)).toBe(false);
    expect(checkTypeByPath(schema, ['llmTranslator', 'missing'], 'x')).toBe(false);
  });

  test('validates whole section values and leaf paths of the app config', () => {
    // `updateConfig` saves the `llmTranslator` section as a unit from the profiles manager
    expect(
      checkTypeByPath(AppConfig, ['llmTranslator'], {
        activeProfile: 'OpenAI',
        profiles: [
          {
            name: 'OpenAI',
            provider: 'openai',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4o-mini',
            contextWindowTokens: null,
            preferredInputTokens: null,
            maxOutputTokens: null,
            maxConcurrentRequests: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      checkTypeByPath(AppConfig, ['llmTranslator'], {
        activeProfile: 'OpenAI',
        profiles: [
          { name: 'OpenAI', provider: 'unknown', apiUrl: '', apiKey: '', model: '' },
        ],
      }),
    ).toBe(false);
    expect(checkTypeByPath(AppConfig, ['llmTranslator', 'activeProfile'], 'OpenAI')).toBe(
      true,
    );
    expect(checkTypeByPath(AppConfig, ['llmTranslator', 'activeProfile'], 42)).toBe(
      false,
    );
  });

  test('preserves legacy number semantics by rejecting only NaN', () => {
    expect(Schema.is(NonNaNNumber)(0)).toBe(true);
    expect(Schema.is(NonNaNNumber)(Infinity)).toBe(true);
    expect(Schema.is(NonNaNNumber)(NaN)).toBe(false);
  });

  test('validates positive and non-negative integers', () => {
    expect(Schema.is(PositiveInteger)(1)).toBe(true);
    expect(Schema.is(PositiveInteger)(0)).toBe(false);
    expect(Schema.is(PositiveInteger)(1.5)).toBe(false);
    expect(Schema.is(PositiveInteger)(NaN)).toBe(false);
    expect(Schema.is(PositiveInteger)(Infinity)).toBe(false);

    expect(Schema.is(NonNegativeInteger)(0)).toBe(true);
    expect(Schema.is(NonNegativeInteger)(3)).toBe(true);
    expect(Schema.is(NonNegativeInteger)(-1)).toBe(false);
    expect(Schema.is(NonNegativeInteger)(0.5)).toBe(false);
  });
});
