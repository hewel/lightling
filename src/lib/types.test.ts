import { Schema } from 'effect';

import { checkTypeByPath, decodeStruct, NonNaNNumber, tryDecode } from './types';

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

  test('preserves legacy number semantics by rejecting only NaN', () => {
    expect(Schema.is(NonNaNNumber)(0)).toBe(true);
    expect(Schema.is(NonNaNNumber)(Infinity)).toBe(true);
    expect(Schema.is(NonNaNNumber)(NaN)).toBe(false);
  });
});
