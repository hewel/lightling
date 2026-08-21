import { normalizeDetectedLanguage } from '@/lib/browser';

import { withDetectedPageLanguage } from './PageTranslationContext';

describe('page translation language resolution', () => {
  test('normalizes regional detector results to the supported primary language', () => {
    expect(normalizeDetectedLanguage('EN-US')).toBe('en');
    expect(normalizeDetectedLanguage('zh_Hant')).toBe('zh');
    expect(normalizeDetectedLanguage('unknown-language')).toBeNull();
  });

  test('replaces auto with the approximate primary page language', () => {
    expect(withDetectedPageLanguage({ from: 'auto', to: 'zh' }, 'en')).toEqual({
      from: 'en',
      to: 'zh',
    });
  });

  test('keeps the detected language even when it equals the target', () => {
    expect(withDetectedPageLanguage({ from: 'auto', to: 'zh' }, 'zh')).toEqual({
      from: 'zh',
      to: 'zh',
    });
  });

  test('keeps auto when approximate detection is unavailable', () => {
    expect(withDetectedPageLanguage({ from: 'auto', to: 'zh' }, null)).toEqual({
      from: 'auto',
      to: 'zh',
    });
  });

  test('does not replace an explicit source language', () => {
    expect(withDetectedPageLanguage({ from: 'de', to: 'zh' }, 'en')).toEqual({
      from: 'de',
      to: 'zh',
    });
  });
});
