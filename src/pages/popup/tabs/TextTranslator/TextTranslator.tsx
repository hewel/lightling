import { FC, PropsWithChildren, Ref, useMemo, useState } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import * as stylex from '@stylexjs/stylex';
import { IconVolume2, IconWand } from '@tabler/icons-react';

import { CopyButton } from '@/components/controls/CopyButton/CopyButton';
import { DictionaryButton } from '@/components/controls/DictionaryButton/DictionaryButton';
import { LanguagePanel } from '@/components/controls/LanguagePanel/LanguagePanel';
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { Textarea } from '@/components/primitives/Textarea/Textarea.bundle/desktop';
import { useTTS } from '@/lib/hooks/useTTS';
import { useTTSLanguages } from '@/lib/hooks/useTTSLanguages';
import { getLanguageNameByCode, getLocalizedNode, getMessage } from '@/lib/language';
import { ITranslation } from '@/types/translation/Translation';
import { MutableValue } from '@/types/utils';

import { TabData } from '../../layout/PopupWindow';

import {
  useTextTranslationSession,
  type TranslationState,
} from './useTextTranslationSession';

export type { TranslationState } from './useTextTranslationSession';

const styles = stylex.create({
  input: {
    width: '100%',
  },
  controlPlane: {
    display: 'flex',
    height: 'calc(var(--spacing-12) * 3 + var(--spacing-1-5))',
    flexDirection: 'column',
    gap: 'var(--spacing-1)',
  },
  inputSlot: {
    display: 'grid',
    flex: '1 1 auto',
    gridTemplateRows: 'minmax(0, 1fr)',
    minHeight: 0,
  },
  field: {
    height: '100%',
    '--textarea-adapter-height': '100%',
    '--textarea-adapter-min-height': '0',
    '--textarea-adapter-max-height': 'none',
    '--textarea-adapter-resize': 'none',
  },
  textActions: {
    display: 'flex',
    gap: 'var(--spacing-1)',
  },
  inputTextActions: {
    zIndex: 2,
  },
  resultContainer: {
    maxHeight: '12.5rem',
    backgroundColor: 'var(--color-background-muted)',
    borderRadius: 'var(--radius-element)',
  },
  resultText: {
    boxSizing: 'border-box',
    minHeight: '8.125rem',
    padding: 'var(--spacing-2)',
    overflow: 'auto',
    color: 'var(--color-text-primary)',
    whiteSpace: 'pre-line',
    wordBreak: 'break-word',
  },
  placeholderText: {
    color: 'var(--color-text-secondary)',
  },
  resultActions: {
    padding: '0 var(--spacing-2) var(--spacing-1)',
  },
  languageSuggestion: {
    display: 'flex',
    gap: 'var(--spacing-1)',
  },
});

export interface TextTranslatorProps
  extends
    MutableValue<'userInput', string>,
    MutableValue<'from', string>,
    MutableValue<'to', string>,
    // It must be null only when translate result never be set or after reset input
    MutableValue<'lastTranslation', TranslationState | null> {
  /**
   * Features of translator module
   */
  translatorFeatures: TabData['translatorFeatures'];

  /**
   * Callback which translate text
   */
  translateHook: (text: string, from: string, to: string) => Promise<string>;

  /**
   * Ref to input
   */
  inputControl?: Ref<HTMLTextAreaElement>;

  /**
   * Delay for handle input
   */
  inputDelay?: number;

  /**
   * Init phase say to component - await full loading
   *
   * Useful to prevent translate
   */
  initPhase?: boolean;

  /**
   * Enable spellcheck
   */
  spellCheck?: boolean;

  enableLanguageSuggestions?: boolean;
  enableLanguageSuggestionsAlways?: boolean;

  isMobile?: boolean;
}

/**
 * Component for translate any text
 */
export const TextTranslator: FC<TextTranslatorProps> = ({
  from,
  to,
  setFrom,
  setTo,
  lastTranslation,
  setLastTranslation,
  translatorFeatures,
  translateHook,
  spellCheck,
  inputControl: inputControlExternal,
  inputDelay = 600,
  enableLanguageSuggestions = true,
  enableLanguageSuggestionsAlways = true,
  isMobile,
}) => {
  const {
    userInput,
    translation,
    inTranslateProcess,
    errorMessage,
    languageSuggestion,
    isTranslatedTextRelative,
    onTextChange,
    clearState,
    swapLanguages,
    applySuggestedLanguage,
  } = useTextTranslationSession({
    from,
    to,
    setFrom,
    setTo,
    lastTranslation,
    setLastTranslation,
    translateHook,
    inputDelay,
    enableLanguageSuggestions,
    enableLanguageSuggestionsAlways,
  });

  const ApplySuggestComponent = useMemo(
    () =>
      ({ children }: PropsWithChildren<{}>) => {
        return (
          <a
            href="src/components/layouts/TextTranslator#"
            onClick={(event) => {
              event.preventDefault();
              applySuggestedLanguage();
            }}
          >
            {children}
          </a>
        );
      },
    [applySuggestedLanguage],
  );

  const [activeTTS, setActiveTTS] = useState<symbol | null>(null);
  const TTSSignal = {
    active: activeTTS,
    setActive: setActiveTTS,
  };
  const ttsOriginal = useTTS(from, userInput, TTSSignal);
  const ttsTranslate = useTTS(to, translation ? translation.text : null, TTSSignal);
  const ttsModule = useTTSLanguages();

  const dictionaryData: ITranslation | null = useMemo(() => {
    if (errorMessage !== null || translation === null || !isTranslatedTextRelative)
      return null;

    return {
      from,
      to,
      originalText: userInput,
      translatedText: translation.text,
    };
  }, [errorMessage, from, isTranslatedTextRelative, to, translation, userInput]);

  const [isFocusOnInput, setIsFocusOnInput] = useState(false);

  // TODO: hide suggestions only for languages which is not supported by translator
  const langSuggestion =
    languageSuggestion && languageSuggestion !== from
      ? getLanguageNameByCode(languageSuggestion, false)
      : null;

  const resultText = inTranslateProcess
    ? '...'
    : errorMessage !== null
      ? `[${errorMessage}]`
      : translation !== null
        ? translation.text
        : null;

  return (
    <VStack gap={3}>
      <LanguagePanel
        auto={translatorFeatures.isSupportAutodetect}
        languages={translatorFeatures.supportedLanguages}
        from={from}
        to={to}
        setFrom={(from) => from !== undefined && setFrom(from)}
        setTo={(to) => to !== undefined && setTo(to)}
        swapHandler={swapLanguages}
        preventFocusOnPress={isFocusOnInput}
        mobile={isMobile}
      />
      <VStack gap={2}>
        {langSuggestion && (
          <div {...stylex.props(styles.languageSuggestion)}>
            <IconWand size="1em" />
            <span>
              {getLocalizedNode({
                messageName: 'textTranslator_suggestLanguage',
                substitutions: [langSuggestion.toLowerCase()],
                slots: {
                  languageSuggest: ApplySuggestComponent,
                },
              })}
            </span>
          </div>
        )}

        <div>
          <Textarea
            placeholder={getMessage('textTranslator_translateInputPlaceholder')}
            xstyle={styles.input}
            controlProps={{
              innerRef: inputControlExternal,
              controlPlaneXstyle: styles.controlPlane,
              inputXstyle: styles.inputSlot,
              fieldXstyle: styles.field,
            }}
            value={userInput}
            onInputText={onTextChange}
            hasClear
            onClearClick={clearState}
            spellCheck={spellCheck}
            onFocus={() => {
              setIsFocusOnInput(true);
            }}
            onBlur={() => {
              setIsFocusOnInput(false);
            }}
            addonAfterControl={
              <div {...stylex.props(styles.textActions, styles.inputTextActions)}>
                <Button
                  disabled={
                    userInput.length === 0 || !ttsModule.isSupportedLanguage(from)
                  }
                  onPress={ttsOriginal.toggle}
                  view="clear"
                  size="s"
                >
                  <IconVolume2 />
                </Button>
                <DictionaryButton translation={dictionaryData} />
              </div>
            }
          />
        </div>
        <VStack xstyle={styles.resultContainer}>
          <div
            {...stylex.props(
              styles.resultText,
              resultText === null && styles.placeholderText,
            )}
          >
            {resultText !== null
              ? resultText
              : getMessage('textTranslator_translatePlaceholder')}
          </div>
          <HStack gap={1} xstyle={styles.resultActions}>
            <Button
              disabled={
                inTranslateProcess ||
                translation === null ||
                !ttsModule.isSupportedLanguage(to)
              }
              onPress={ttsTranslate.toggle}
              view="clear"
              size="s"
            >
              <IconVolume2 />
            </Button>
            <CopyButton text={translation ? translation.text : null} />
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
};
