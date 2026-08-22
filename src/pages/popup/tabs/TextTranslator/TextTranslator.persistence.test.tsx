import { act, type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { TranslationState } from './TextTranslator';
import {
  recoverTextTranslatorInitData,
  serializeTextTranslatorData,
  type TextTranslatorPersistenceStorage,
  useTextTranslatorPersistence,
} from './TextTranslator.persistence';
import type { TextTranslatorData } from './TextTranslator.utils/TextTranslatorStorage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const createStorage = (data: TextTranslatorData): TextTranslatorPersistenceStorage => ({
  getData: vi.fn(async () => data),
  setData: vi.fn(async () => undefined),
});

const translation: TranslationState = {
  originalText: 'original',
  translatedText: 'translated',
};

describe('TextTranslator persistence policy', () => {
  it('does not remember text when rememberText is disabled', () => {
    expect(
      serializeTextTranslatorData({
        from: 'en',
        to: 'de',
        lastTranslation: translation,
        rememberText: false,
      }),
    ).toEqual({
      from: 'en',
      to: 'de',
      translate: null,
    });
  });

  it.each([
    ['originalText', { originalText: 'x'.repeat(100001), translatedText: 'translated' }],
    ['translatedText', { originalText: 'original', translatedText: 'x'.repeat(100001) }],
  ])('does not serialize oversized %s', (_, lastTranslation) => {
    expect(
      serializeTextTranslatorData({
        from: 'en',
        to: 'de',
        lastTranslation,
        rememberText: true,
      }),
    ).toEqual({
      from: 'en',
      to: 'de',
      translate: null,
    });
  });

  describe('delayed serialization', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      vi.useFakeTimers();
      container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
    });

    it('waits 300ms before writing state', async () => {
      const storage = createStorage(null);
      const PersistenceHarness: FC = () => {
        useTextTranslatorPersistence({
          from: 'en',
          to: 'de',
          lastTranslation: translation,
          rememberText: true,
          storage,
        });
        return null;
      };

      await act(async () => root.render(<PersistenceHarness />));
      vi.advanceTimersByTime(299);
      expect(storage.setData).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTime(1));
      expect(storage.setData).toHaveBeenCalledOnce();
      expect(storage.setData).toHaveBeenCalledWith({
        from: 'en',
        to: 'de',
        translate: translation,
      });
    });
  });

  it('ignores stored languages unsupported by the current translator', async () => {
    const storage = createStorage({
      from: 'fr',
      to: 'it',
      translate: null,
    });

    await expect(
      recoverTextTranslatorInitData({
        translatorFeatures: {
          isSupportAutodetect: false,
          supportedLanguages: ['en', 'de'],
        },
        language: 'en',
        rememberText: true,
        storage,
      }),
    ).resolves.toEqual({
      from: 'en',
      to: 'en',
      lastTranslate: null,
    });
  });

  it('recovers the last translation when text remembering is enabled', async () => {
    const storage = createStorage({
      from: 'auto',
      to: 'de',
      translate: translation,
    });

    await expect(
      recoverTextTranslatorInitData({
        translatorFeatures: {
          isSupportAutodetect: true,
          supportedLanguages: ['en', 'de'],
        },
        language: 'en',
        rememberText: true,
        storage,
      }),
    ).resolves.toEqual({
      from: 'auto',
      to: 'de',
      lastTranslate: translation,
    });
  });
});
