import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { detectLanguage } from '@/lib/language';
import type { RichMarkup } from '@/lib/richTranslation/model';
import { getTranslatorFeatures } from '@/requests/backend/getTranslatorFeatures';
import { getUserLanguagePreferences } from '@/requests/backend/getUserLanguagePreferences';
import { addTranslationHistoryEntry } from '@/requests/backend/history/addTranslationHistoryEntry';
import { trackClientEvent } from '@/requests/backend/telemetry';

import { TextTranslator, type TextTranslatorComponentProps } from './TextTranslator';

vi.mock('@/components/controls/LanguagePanel/LanguagePanel', () => ({
  LanguagePanel: () => null,
}));
vi.mock('@/components/controls/DictionaryButton/DictionaryButton', () => ({
  DictionaryButton: () => null,
}));
vi.mock('@/lib/language', () => ({
  detectLanguage: vi.fn(),
  getMessage: (messageName: string) => messageName,
  getLanguageNameByCode: (code: string) => code,
}));
vi.mock('@astryxdesign/core/Spinner', () => ({
  Spinner: () => null,
}));
vi.mock('@/requests/backend/getTranslatorFeatures', () => ({
  getTranslatorFeatures: vi.fn(),
}));
vi.mock('@/requests/backend/getUserLanguagePreferences', () => ({
  getUserLanguagePreferences: vi.fn(),
}));
vi.mock('@/requests/backend/history/addTranslationHistoryEntry', () => ({
  addTranslationHistoryEntry: vi.fn(),
}));
vi.mock('@/requests/backend/telemetry', () => ({
  trackClientEvent: vi.fn(),
}));
vi.mock('@/lib/hooks/useTTS', () => ({
  useTTS: () => ({ toggle: vi.fn() }),
}));
vi.mock('@/lib/hooks/useTTSLanguages', () => ({
  useTTSLanguages: () => ({
    isSupportedLanguage: () => false,
  }),
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type RenderOptions = {
  richSource?: RichMarkup;
  translateResult: string | string[];
};

type TestTranslatorProps = Omit<TextTranslatorComponentProps, 'translate'> & {
  translate: ReturnType<
    typeof vi.fn<(text: string, from: string, to: string) => Promise<string>>
  >;
};

const createProps = ({
  richSource,
  translateResult,
}: RenderOptions): TestTranslatorProps => {
  const queue = Array.isArray(translateResult) ? [...translateResult] : [translateResult];

  return {
    detectedLangFirst: true,
    isUseAutoForDetectLang: false,
    rememberDirection: false,
    text: 'Click Save',
    translate: vi.fn((_text: string, _from: string, _to: string) => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve(next ?? '');
    }),
    closeHandler: vi.fn(),
    updatePopup: vi.fn(),
    pageLanguage: 'en',
    showOriginalText: false,
    richSource,
  };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('TextTranslator rich translation integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.clearAllMocks();
    vi.mocked(detectLanguage).mockResolvedValue('en');
    vi.mocked(getTranslatorFeatures).mockResolvedValue({
      supportedLanguages: ['en', 'de'],
      isSupportAutodetect: false,
    });
    vi.mocked(getUserLanguagePreferences).mockResolvedValue('de');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderTranslator(options: RenderOptions) {
    const props = createProps(options);
    await act(async () => {
      root.render(<TextTranslator {...props} />);
      await flushPromises();
    });
    await act(async () => {
      await vi.waitFor(() => expect(props.translate).toHaveBeenCalled());
      await flushPromises();
    });
    return props;
  }

  test('renders valid translated markup through its mapped semantic element', async () => {
    const richSource: RichMarkup = {
      markup: '<g id="r1">Click Save</g>',
      nodes: { r1: { tag: 'strong' } },
    };

    const props = await renderTranslator({
      richSource,
      translateResult: 'Klicken Sie auf <g id="r1">Speichern</g>',
    });

    expect(props.translate).toHaveBeenCalledWith(richSource.markup, 'en', 'de');
    expect(container.querySelector('strong')?.textContent).toBe('Speichern');
    expect(container.textContent).toContain('Klicken Sie auf Speichern');
  });

  test('retries with placeholder-free text when translated markup cannot be repaired', async () => {
    const richSource: RichMarkup = {
      markup: '<g id="r1">Click <g id="r2">Save</g></g>',
      nodes: {
        r1: { tag: 'strong' },
        r2: { tag: 'strong' },
      },
    };

    const props = await renderTranslator({
      richSource,
      translateResult: [
        '<Klicken Sie Speichern> <corrupted',
        'Klicken Sie auf Speichern',
      ],
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(props.translate.mock.calls.some(([input]) => input === 'Click Save')).toBe(
          true,
        ),
      );
      await flushPromises();
    });

    expect(props.translate).toHaveBeenNthCalledWith(1, richSource.markup, 'en', 'de');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('Klicken Sie auf Speichern');
    expect(container.textContent).not.toContain('<');
  });

  test('keeps the plain-text rendering path when richSource is undefined', async () => {
    const props = await renderTranslator({ translateResult: 'Plain translation' });

    expect(props.translate).toHaveBeenCalledWith('Click Save', 'en', 'de');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('Plain translation');
    expect(addTranslationHistoryEntry).toHaveBeenCalled();
    expect(trackClientEvent).toHaveBeenCalled();
  });
});
