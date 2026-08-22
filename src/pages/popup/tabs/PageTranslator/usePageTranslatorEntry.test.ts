import type { PageTranslatorStats } from '@/app/ContentScript/PageTranslator/PageTranslator';

import { sitePreferenceOptions } from './PageTranslator';
import {
  applyLanguagePreference,
  applySitePreference,
  mapLanguagePreferences,
  subscribeToPageTranslatorStats,
} from './usePageTranslatorEntry';

describe('Page translator entry preferences', () => {
  test.each([
    [null, 'disable'],
    [true, 'enable'],
    [false, 'disableForAll'],
  ])('maps language preference %s to %s', (stored, expected) => {
    expect(mapLanguagePreferences(stored as boolean | null)).toBe(expected);
  });

  test('persists language commands using the selected source language', () => {
    const setState = vi.fn();
    const add = vi.fn();
    const remove = vi.fn();

    applyLanguagePreference('enable', 'en', setState, { add, remove });
    applyLanguagePreference('disableForAll', 'de', setState, { add, remove });
    applyLanguagePreference('disable', 'fr', setState, { add, remove });

    expect(setState.mock.calls).toEqual([['enable'], ['disableForAll'], ['disable']]);
    expect(add.mock.calls).toEqual([
      ['en', true],
      ['de', false],
    ]);
    expect(remove).toHaveBeenCalledWith('fr');
  });

  test('maps site commands to persisted host preferences', () => {
    const setState = vi.fn();
    const remove = vi.fn();
    const set = vi.fn();

    applySitePreference(
      sitePreferenceOptions.ALWAYS_FOR_THIS_LANGUAGE,
      'en',
      'example.com',
      {
        enableAutoTranslate: false,
        autoTranslateLanguages: [],
        autoTranslateIgnoreLanguages: ['en'],
      },
      setState,
      { remove, set },
    );

    expect(set).toHaveBeenCalledWith('example.com', {
      enableAutoTranslate: true,
      autoTranslateLanguages: ['en'],
      autoTranslateIgnoreLanguages: [],
    });
    expect(setState).toHaveBeenCalledWith(sitePreferenceOptions.ALWAYS_FOR_THIS_LANGUAGE);

    applySitePreference(
      sitePreferenceOptions.DEFAULT,
      'en',
      'example.com',
      null,
      setState,
      { remove, set },
    );
    expect(remove).toHaveBeenCalledWith('example.com');
  });
});

describe('Page translator entry stats subscription', () => {
  test('filters by tab id and returns the registration cleanup', () => {
    let handler: ((stats: PageTranslatorStats, tabId?: number) => void) | undefined;
    const cleanup = vi.fn();
    const setCounters = vi.fn();
    const subscribe = vi.fn((nextHandler: typeof handler) => {
      handler = nextHandler;
      return cleanup;
    });

    const teardown = subscribeToPageTranslatorStats(42, setCounters, subscribe);
    handler?.({ resolved: 1, rejected: 0, pending: 0 }, 7);
    handler?.({ resolved: 2, rejected: 1, pending: 3 }, 42);

    expect(setCounters).toHaveBeenCalledOnce();
    expect(setCounters).toHaveBeenCalledWith({ resolved: 2, rejected: 1, pending: 3 });
    teardown();
    expect(teardown).toBe(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
