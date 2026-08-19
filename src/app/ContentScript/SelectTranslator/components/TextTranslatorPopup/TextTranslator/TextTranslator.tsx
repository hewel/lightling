import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import browser from 'webextension-polyfill';
import { Button as GhostButton } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import * as stylex from '@stylexjs/stylex';
import { IconChevronDown, IconVolume2, IconX } from '@tabler/icons-react';

import { CopyButton } from '@/components/controls/CopyButton/CopyButton';
import { DictionaryButton } from '@/components/controls/DictionaryButton/DictionaryButton';
import { LanguagePanel } from '@/components/controls/LanguagePanel/LanguagePanel';
// Components
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { isMobileBrowser } from '@/lib/browser';
import { useTTS } from '@/lib/hooks/useTTS';
import { useTTSLanguages } from '@/lib/hooks/useTTSLanguages';
import { detectLanguage, getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { TranslatorFeatures } from '@/pages/popup/layout/PopupWindow';
import { getTranslatorFeatures } from '@/requests/backend/getTranslatorFeatures';
import { getUserLanguagePreferences } from '@/requests/backend/getUserLanguagePreferences';
import { addTranslationHistoryEntry } from '@/requests/backend/history/addTranslationHistoryEntry';
import { TRANSLATION_ORIGIN } from '@/requests/backend/history/constants';
import { trackClientEvent } from '@/requests/backend/telemetry';
import { ITranslation } from '@/types/translation/Translation';

const styles = stylex.create({
  root: {
    boxSizing: 'border-box',
    padding: 'var(--spacing-3)',
    fontFamily: 'var(--font-family-body)',
    fontSize: 'var(--text-supporting-size)',
    fontWeight: 'var(--text-supporting-weight)',
    lineHeight: 'var(--text-supporting-leading)',
    color: 'var(--color-text-primary)',
    textAlign: 'initial',
  },
  body: {
    maxWidth: 'calc(var(--spacing-10) * 10)',
    maxHeight: 'calc(var(--spacing-10) * 10)',
    paddingBlock: 'var(--spacing-1)',
    overflowY: 'auto',
    fontSize: 'var(--text-body-size)',
    lineHeight: 'var(--text-body-leading)',
    whiteSpace: 'pre-line',
    scrollbarWidth: 'thin',
  },
  originalText: {
    maxHeight: 'calc(var(--spacing-10) * 10)',
    margin: 'var(--spacing-2) 0 0',
    overflow: 'auto',
    color: 'var(--color-text-secondary)',
    whiteSpace: 'pre-wrap',
    scrollbarWidth: 'thin',
  },
  error: {
    color: 'var(--color-error)',
  },
  chevronOpen: {
    transform: 'rotate(180deg)',
  },
});

export interface TextTranslatorComponentProps {
  detectedLangFirst: boolean;
  isUseAutoForDetectLang: boolean;
  rememberDirection: boolean;
  text: string;
  translate: (text: string, from: string, to: string) => Promise<string>;
  closeHandler: () => void;
  /**
   * Recalculate popup position
   */
  updatePopup: () => void;
  pageLanguage?: string;
  showOriginalText?: boolean;
}

// TODO: rename component and move to element dir
export const TextTranslator: FC<TextTranslatorComponentProps> = ({
  pageLanguage,
  detectedLangFirst,
  isUseAutoForDetectLang,
  rememberDirection,
  text,
  closeHandler,
  translate,
  updatePopup,
  showOriginalText,
}) => {
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [translatorFeatures, setTranslatorFeatures] = useState<TranslatorFeatures>();

  const [originalText, setOriginalText] = useState<string>(text);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const translateContext = useRef(Symbol('TranslateContext'));
  const translateText = useCallback(() => {
    // NOTE: maybe worth handle this error
    if (from === undefined || to === undefined) {
      throw Error(`Call to translate method with invalid direction: ${from}-${to}`);
    }

    translateContext.current = Symbol('TranslateContext');
    const context = translateContext.current;

    setTranslatedText(null);
    setError(null);

    translate(originalText, from, to)
      .then((translatedText) => {
        if (context !== translateContext.current) return;

        setTranslatedText(translatedText);
        setError(null);

        addTranslationHistoryEntry({
          origin: TRANSLATION_ORIGIN.USER_INPUT,
          translation: {
            from,
            to,
            originalText,
            translatedText,
          },
        });

        trackClientEvent(TELEMETRY_EVENT_NAME.TEXT_TRANSLATION_COMPLETED, {
          scope: 'selected text',
          from,
          to,
          sourceTextLength: originalText.length,
          translationLength: translatedText.length,
        });
      })
      .catch((reason) => {
        if (context !== translateContext.current) return;

        let error = 'Unknown error';
        if (typeof reason === 'string') {
          error = reason;
        } else if (reason instanceof Error) {
          error = reason.message;
        }

        setTranslatedText(null);
        setError(error);
        console.error(error);

        trackClientEvent(TELEMETRY_EVENT_NAME.ERROR_CAPTURED, {
          scope: 'selected text',
          error,
        });
      })
      .finally(() => {
        if (context !== translateContext.current) return;

        translateContext.current = Symbol('TranslateContext');
      });
  }, [from, originalText, to, translate]);

  const swapHandler = useCallback(
    ({ from, to }: { from: string; to: string }) => {
      if (translatedText === null) return;

      setFrom(from);
      setTo(to);
      setOriginalText(translatedText);
      setTranslatedText(null);
    },
    [translatedText],
  );

  const dictionaryData: ITranslation | null = useMemo(() => {
    if (translatedText === null || from === undefined || to === undefined) return null;

    return {
      from,
      to,
      originalText,
      translatedText,
    };
  }, [from, originalText, to, translatedText]);

  // Init
  const isUnmount = useRef(false);
  useEffect(() => {
    getTranslatorFeatures().then(async ({ supportedLanguages, isSupportAutodetect }) => {
      const userLanguage = await getUserLanguagePreferences();

      let from: string | undefined;

      // Try recover last direction
      if (rememberDirection) {
        try {
          // TODO: migrate data to another storage property
          // TODO: move storage operations to a hook
          const lastFrom = await browser.storage.local
            .get('SelectTranslator')
            .then((store) => {
              const data = store?.SelectTranslator?.lastFrom;
              return typeof data === 'string' ? data : null;
            });

          if (
            lastFrom !== null &&
            ((isSupportAutodetect && lastFrom == 'auto') ||
              supportedLanguages.indexOf(lastFrom)) !== -1
          ) {
            from = lastFrom;
          }
        } catch (error) {
          console.error(error);
        }
      }

      // Set `from` language
      if (from === undefined) {
        const detectedLanguage = await detectLanguage(originalText);

        const isValidLang = (lang: any): lang is string => {
          if (typeof lang !== 'string') return false;

          if (supportedLanguages.includes(lang)) return true;
          // TODO: rename `isSupportAutodetect` to `isSupportAutoDetect`
          if (lang === 'auto' && isSupportAutodetect) return true;

          return false;
        };

        // List of lang detectors which define language depends on config
        const langDetectors: {
          getLang: () => string | void;
          priority: number;
        }[] = [
          {
            // Detect language from text or use `auto` if support
            getLang() {
              // Set detected lang if found
              if (detectedLanguage !== null) return detectedLanguage;

              // Set `auto` if support and enable
              if (isUseAutoForDetectLang && isSupportAutodetect) return 'auto';

              return;
            },
            priority: 0,
          },

          {
            // Set page lang if found
            getLang() {
              if (pageLanguage !== undefined) return pageLanguage;

              return;
            },
            priority: 0,
          },

          {
            // Default value. Auto detect if supported, first lang otherwise
            getLang() {
              return isSupportAutodetect ? 'auto' : supportedLanguages[0];
            },
            priority: -1,
          },
        ];

        // Set priority
        if (detectedLangFirst) {
          langDetectors[0].priority++;
        } else {
          langDetectors[1].priority++;
        }

        // Reverse sort by priority
        const sortedLangDetectors = langDetectors.sort((x, y) => y.priority - x.priority);

        // Select language
        for (const detector of sortedLangDetectors) {
          const selectedFromLang = detector.getLang();
          if (isValidLang(selectedFromLang)) {
            from = selectedFromLang;
            break;
          }
        }
      }

      // Check for cases when component did close very fast
      if (!isUnmount.current) {
        setTranslatorFeatures({
          supportedLanguages,
          isSupportAutodetect,
        });
        setFrom(from);
        setTo(userLanguage);
      }
    });

    return () => {
      isUnmount.current = true;
      translateContext.current = Symbol('TranslateContext');
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  // Set init state
  const [isInited, setIsInited] = useState(false);
  useEffect(() => {
    // Skip if already inited
    if (isInited) return;

    // Set inited
    if (from !== undefined && to !== undefined && translatorFeatures !== undefined) {
      setIsInited(true);
    }
  }, [isInited, from, to, translatorFeatures]);

  useEffect(() => {
    // Save direction
    if (rememberDirection && from !== undefined) {
      browser.storage.local
        .set({ SelectTranslator: { lastFrom: from } })
        .catch(console.error);
    }
  }, [from, rememberDirection]);

  useEffect(() => {
    // Wait init
    if (!isInited) return;
    translateText();
  }, [isInited, translateText, translatorFeatures]);

  useEffect(() => {
    if (updatePopup) updatePopup();
  });

  // Translate by update original text
  useEffect(() => {
    // Wait init
    if (!isInited) return;
    translateText();

    // oxlint-disable-next-line react/exhaustive-deps
  }, [isInited, originalText]);

  const [activeTTS, setActiveTTS] = useState<symbol | null>(null);
  const TTSSignal = {
    active: activeTTS,
    setActive: setActiveTTS,
  };
  const ttsOriginal = useTTS(from ?? null, originalText, TTSSignal);
  const ttsTranslate = useTTS(to ?? null, translatedText, TTSSignal);
  const ttsModule = useTTSLanguages();

  const isMobile = useMemo(() => isMobileBrowser(), []);

  const [isOriginalOpen, setIsOriginalOpen] = useState(false);

  const listenLabel = getMessage('common_listen');
  const closeLabel = getMessage('common_close');

  const closeButton = (
    <IconButton
      label={closeLabel}
      tooltip={closeLabel}
      icon={<IconX />}
      variant="ghost"
      size="sm"
      onClick={closeHandler}
    />
  );

  if (translatorFeatures !== undefined && (translatedText !== null || error !== null)) {
    return (
      <VStack
        gap={2}
        width="max-content"
        maxWidth="min(100vw, calc(var(--spacing-10) * 10 + var(--spacing-3) * 2))"
        xstyle={styles.root}
      >
        {isMobile && (
          <HStack justify="end" width="100%">
            {closeButton}
          </HStack>
        )}
        <HStack gap={2} width="100%" align="center">
          <StackItem size="fill">
            <LanguagePanel
              languages={translatorFeatures.supportedLanguages}
              auto={translatorFeatures.isSupportAutodetect}
              setFrom={setFrom}
              setTo={setTo}
              from={from}
              to={to}
              swapHandler={swapHandler}
              disableSwap={translatedText === null}
              mobile={isMobile}
            />
          </StackItem>

          {!isMobile && closeButton}
        </HStack>
        {error === null ? (
          <>
            <StackItem size="fill" xstyle={styles.body}>
              {translatedText}
            </StackItem>
            <HStack width="100%" align="center" justify="between">
              <HStack gap={0.5} align="center">
                <IconButton
                  label={listenLabel}
                  tooltip={listenLabel}
                  icon={<IconVolume2 />}
                  variant="ghost"
                  size="sm"
                  onClick={ttsTranslate.toggle}
                  isDisabled={to === undefined || !ttsModule.isSupportedLanguage(to)}
                />
                <CopyButton text={translatedText} />
                <DictionaryButton translation={dictionaryData} />
              </HStack>
              {showOriginalText && (
                <GhostButton
                  label={getMessage('inlineTranslator_showOriginalText')}
                  icon={
                    <IconChevronDown
                      {...stylex.props(isOriginalOpen && styles.chevronOpen)}
                    />
                  }
                  variant="ghost"
                  size="sm"
                  aria-expanded={isOriginalOpen}
                  onClick={() => setIsOriginalOpen((isOpen) => !isOpen)}
                />
              )}
            </HStack>
            {showOriginalText && isOriginalOpen && (
              <HStack gap={1} width="100%" align="start">
                <StackItem size="fill">
                  <p {...stylex.props(styles.originalText)}>{originalText}</p>
                </StackItem>
                <IconButton
                  label={listenLabel}
                  tooltip={listenLabel}
                  icon={<IconVolume2 />}
                  variant="ghost"
                  size="sm"
                  onClick={ttsOriginal.toggle}
                  isDisabled={from === undefined || !ttsModule.isSupportedLanguage(from)}
                />
              </HStack>
            )}
          </>
        ) : (
          <>
            <div {...stylex.props(styles.body, styles.error)}>{error}</div>
            <div>
              <Button view="action" onPress={translateText}>
                {getMessage('common_retry')}
              </Button>
            </div>
          </>
        )}
      </VStack>
    );
  } else {
    return <Spinner />;
  }
};
