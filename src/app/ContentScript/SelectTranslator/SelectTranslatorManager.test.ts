import { createObservableStore } from '@/lib/store';
import type { AppConfigType } from '@/types/runtime';

import { SelectTranslator } from './SelectTranslator';
import { SelectTranslatorManager } from './SelectTranslatorManager';

vi.mock('./SelectTranslator', () => ({
  SelectTranslator: vi.fn(),
}));

type SelectTranslatorState = {
  enabled: boolean;
  config: AppConfigType['selectTranslator'];
  pageData: { language: string | null };
};

type TranslatorDouble = {
  isRun: () => boolean;
  start: () => void;
  stop: () => void;
  translateSelectedText: () => void;
};

const createConfig = (enabled: boolean): AppConfigType['selectTranslator'] => ({
  enabled,
  disableWhileTranslatePage: false,
  zIndex: undefined,
  focusOnTranslateButton: undefined,
  rememberDirection: false,
  modifiers: ['ctrlKey'],
  strictSelection: false,
  detectedLangFirst: false,
  showOnceForSelection: true,
  showOriginalText: true,
  isUseAutoForDetectLang: true,
  timeoutForHideButton: 0,
  mode: 'popupButton',
});

const createTranslator = (isRunning: boolean): TranslatorDouble => ({
  isRun: vi.fn(() => isRunning),
  start: vi.fn(),
  stop: vi.fn(),
  translateSelectedText: vi.fn(),
});

const createManager = (
  configEnabled: boolean,
  stateEnabled: boolean,
  translator?: TranslatorDouble,
) => {
  if (translator !== undefined) {
    vi.mocked(SelectTranslator).mockImplementationOnce(
      () => translator as unknown as SelectTranslator,
    );
  }

  const $state = createObservableStore<SelectTranslatorState>({
    enabled: stateEnabled,
    config: createConfig(configEnabled),
    pageData: { language: null },
  });
  const manager = new SelectTranslatorManager($state);
  manager.start();
  return manager;
};

describe('SelectTranslatorManager translateSelectedText command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('does nothing when no select translator instance exists', () => {
    const manager = createManager(false, false);

    manager.translateSelectedText();

    expect(SelectTranslator).not.toHaveBeenCalled();
  });

  test('does nothing when the select translator instance is stopped', () => {
    const translator = createTranslator(false);
    const manager = createManager(true, false, translator);

    manager.translateSelectedText();

    expect(translator.isRun).toHaveBeenCalled();
    expect(translator.translateSelectedText).not.toHaveBeenCalled();
  });

  test('delegates when the select translator instance is running', () => {
    const translator = createTranslator(true);
    const manager = createManager(true, true, translator);

    manager.translateSelectedText();

    expect(translator.translateSelectedText).toHaveBeenCalledOnce();
  });
});
