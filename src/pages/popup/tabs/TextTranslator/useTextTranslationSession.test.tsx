import { act, type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { addTranslationHistoryEntry } from '@/requests/backend/history/addTranslationHistoryEntry';
import { suggestLanguage } from '@/requests/backend/suggestLanguage';
import { trackClientEvent } from '@/requests/backend/telemetry';

import {
  type TextTranslationSession,
  type UseTextTranslationSessionProps,
  useTextTranslationSession,
} from './useTextTranslationSession';

vi.mock('@/lib/language', () => ({
  getMessage: (messageName: string) => messageName,
}));
vi.mock('@/requests/backend/history/addTranslationHistoryEntry', () => ({
  addTranslationHistoryEntry: vi.fn(),
}));
vi.mock('@/requests/backend/suggestLanguage', () => ({
  suggestLanguage: vi.fn(),
}));
vi.mock('@/requests/backend/telemetry', () => ({
  trackClientEvent: vi.fn(),
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const createProps = (
  translateHook: UseTextTranslationSessionProps['translateHook'],
): UseTextTranslationSessionProps => ({
  from: 'auto',
  to: 'en',
  setFrom: vi.fn(),
  setTo: vi.fn(),
  lastTranslation: null,
  setLastTranslation: vi.fn(),
  translateHook,
  inputDelay: 600,
  enableLanguageSuggestions: true,
  enableLanguageSuggestionsAlways: true,
});

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useTextTranslationSession', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let session: TextTranslationSession | undefined;

  const renderSession = async (props: UseTextTranslationSessionProps) => {
    const Harness: FC = () => {
      session = useTextTranslationSession(props);
      return null;
    };

    await act(async () => root?.render(<Harness />));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(suggestLanguage).mockResolvedValue('auto');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    root = null;
    container.remove();
    session = undefined;
    vi.useRealTimers();
  });

  it('ignores a stale translation completion', async () => {
    const resolvers: ((value: string) => void)[] = [];
    const translateHook = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    await renderSession(createProps(translateHook));
    expect(session).toBeDefined();
    await act(async () => {
      session?.onTextChange('first');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(translateHook).toHaveBeenNthCalledWith(1, 'first', 'auto', 'en');
    await act(async () => {
      session?.onTextChange('second');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(session?.userInput).toBe('second');
    expect(translateHook).toHaveBeenNthCalledWith(2, 'second', 'auto', 'en');

    await act(async () => {
      resolvers[0]?.('stale result');
      await flushPromises();
    });
    expect(session?.translation).toBeNull();

    await act(async () => {
      resolvers[1]?.('current result');
      await flushPromises();
    });
    expect(session?.translation).toEqual({
      original: 'second',
      text: 'current result',
    });
  });

  it('exposes a translated request error and stops loading', async () => {
    const translateHook = vi.fn().mockRejectedValue(new Error('offline'));
    await renderSession(createProps(translateHook));

    await act(async () => {
      session?.onTextChange('hello');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
      await flushPromises();
    });

    expect(session?.errorMessage).toBe('common_error: offline');
    expect(session?.inTranslateProcess).toBe(false);
  });

  it('records history and telemetry after a successful request', async () => {
    const translateHook = vi.fn().mockResolvedValue('hola');
    await renderSession(createProps(translateHook));

    await act(async () => {
      session?.onTextChange('hello');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
      await flushPromises();
    });

    expect(addTranslationHistoryEntry).toHaveBeenCalledWith({
      origin: 'textInput',
      translation: {
        from: 'auto',
        to: 'en',
        originalText: 'hello',
        translatedText: 'hola',
      },
    });
    expect(trackClientEvent).toHaveBeenCalledWith(
      TELEMETRY_EVENT_NAME.TEXT_TRANSLATION_COMPLETED,
      {
        scope: 'user input',
        from: 'auto',
        to: 'en',
        sourceTextLength: 5,
        translationLength: 4,
      },
    );
  });

  it('applies a language suggestion and clears it on reset', async () => {
    vi.mocked(suggestLanguage).mockResolvedValue('fr');
    const props = createProps(vi.fn().mockResolvedValue('bonjour'));
    await renderSession(props);

    await act(async () => {
      session?.onTextChange('bonjour');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
      await flushPromises();
    });
    expect(session?.languageSuggestion).toBe('fr');

    await act(async () => {
      session?.applySuggestedLanguage();
    });
    expect(props.setFrom).toHaveBeenCalledWith('fr');
    expect(session?.languageSuggestion).toBeNull();

    await act(async () => {
      session?.onTextChange('');
    });
    expect(session?.userInput).toBe('');
    expect(session?.languageSuggestion).toBeNull();
  });
});
