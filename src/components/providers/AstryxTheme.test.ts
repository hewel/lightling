import { shadowRootTokens } from './AstryxTheme';

describe('shadowRootTokens', () => {
  test('contains no rem values, since shadow trees resolve rem against the host page', () => {
    const remTokens = Object.entries(shadowRootTokens).filter(
      ([, value]) => typeof value === 'string' && /\drem\b/.test(value),
    );

    expect(remTokens).toEqual([]);
  });

  test('converts the font scale to a 16px root', () => {
    expect(shadowRootTokens['--font-size-base']).toBe('14px');
    expect(shadowRootTokens['--font-size-sm']).toBe('12px');
  });
});
