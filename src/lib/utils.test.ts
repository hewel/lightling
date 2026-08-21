import {
  createUUID,
  getValueAtPath,
  isDeepEqual,
  isEqualIntersection,
  setValueAtPath,
} from './utils';

describe('object utilities', () => {
  test('compares nested JSON-like values independent of object key order', () => {
    expect(
      isDeepEqual(
        { enabled: true, languages: ['en', 'de'], nested: { limit: 2 } },
        { nested: { limit: 2 }, languages: ['en', 'de'], enabled: true },
      ),
    ).toBe(true);
    expect(isDeepEqual({ languages: ['en', 'de'] }, { languages: ['de', 'en'] })).toBe(
      false,
    );
    expect(isDeepEqual({ value: undefined }, {})).toBe(false);
    expect(isDeepEqual(NaN, NaN)).toBe(true);
  });

  test('reads dotted paths and returns undefined when traversal stops', () => {
    const value = { scheduler: { useCache: true } };
    const directValue = {
      ...value,
      'scheduler.useCache': 'pending override',
    };

    expect(getValueAtPath(directValue, 'scheduler.useCache')).toBe('pending override');
    expect(getValueAtPath(value, 'scheduler.useCache')).toBe(true);
    expect(getValueAtPath(value, 'scheduler.missing')).toBeUndefined();
    expect(getValueAtPath(value, 'scheduler.useCache.missing')).toBeUndefined();
  });

  test('sets an existing nested path and rejects invalid traversal', () => {
    const value = { scheduler: { useCache: true } };

    setValueAtPath(value, ['scheduler', 'useCache'], false);

    expect(value.scheduler.useCache).toBe(false);
    expect(() => setValueAtPath(value, [], false)).toThrow('Cannot set an empty path');
    expect(() => setValueAtPath(value, ['missing', 'value'], false)).toThrow(
      'Cannot set path through "missing"',
    );
  });

  test('matches object intersections while requiring exact arrays', () => {
    expect(
      isEqualIntersection(
        { direction: { from: 'en' } },
        {
          direction: { from: 'en', to: 'de' },
          type: 'model',
        },
      ),
    ).toBe(true);
    expect(
      isEqualIntersection({ modifiers: ['ctrlKey'] }, { modifiers: ['ctrlKey'] }),
    ).toBe(true);
    expect(
      isEqualIntersection(
        { modifiers: ['ctrlKey'] },
        { modifiers: ['ctrlKey', 'altKey'] },
      ),
    ).toBe(false);
  });

  test('falls back to getRandomValues for RFC 4122 v4 UUIDs', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index++) bytes[index] = index;
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      expect(createUUID()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
