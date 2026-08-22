import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';

import { useDelayCallback } from '@/lib/hooks/useDelayCallback';
import { useImmutableCallback } from '@/lib/hooks/useImmutableCallback';
import { useIsFirstRenderRef } from '@/lib/hooks/useIsFirstRenderRef';
import { getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { addTranslationHistoryEntry } from '@/requests/backend/history/addTranslationHistoryEntry';
import { TRANSLATION_ORIGIN } from '@/requests/backend/history/constants';
import { suggestLanguage } from '@/requests/backend/suggestLanguage';
import { trackClientEvent } from '@/requests/backend/telemetry';

export type TranslationState = {
  originalText: string;
  translatedText: string | null;
};

type TranslationResult = {
  text: string;
  original: string;
};

export interface UseTextTranslationSessionProps {
  from: string;
  to: string;
  setFrom: Dispatch<SetStateAction<string>>;
  setTo: Dispatch<SetStateAction<string>>;
  lastTranslation: TranslationState | null;
  setLastTranslation: Dispatch<SetStateAction<TranslationState | null>>;
  translateHook: (text: string, from: string, to: string) => Promise<string>;
  inputDelay: number;
  enableLanguageSuggestions: boolean;
  enableLanguageSuggestionsAlways: boolean;
}

export interface TextTranslationSession {
  userInput: string;
  translation: TranslationResult | null;
  inTranslateProcess: boolean;
  errorMessage: string | null;
  languageSuggestion: string | null;
  isTranslatedTextRelative: boolean;
  onTextChange: (text: string) => void;
  clearState: () => void;
  swapLanguages: (languages: { from: string; to: string }) => void;
  applySuggestedLanguage: () => void;
}

export const useTextTranslationSession = ({
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
}: UseTextTranslationSessionProps): TextTranslationSession => {
  const [userInput, setUserInput] = useState(lastTranslation?.originalText ?? '');
  const [translation, setTranslation] = useState<TranslationResult | null>(
    lastTranslation !== null && lastTranslation.translatedText !== null
      ? {
          original: lastTranslation.originalText,
          text: lastTranslation.translatedText,
        }
      : null,
  );
  const [inTranslateProcess, setInTranslateProcess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [languageSuggestion, setLanguageSuggestion] = useState<string | null>(null);

  const isFirstRenderRef = useIsFirstRenderRef();
  const textStateContext = useRef(Symbol('TextContext'));
  const isPreventClearTranslation = useRef(false);

  const isTranslatedTextRelative =
    translation !== null && translation.original === userInput;
  const isSuggestLanguage =
    enableLanguageSuggestions && (enableLanguageSuggestionsAlways || from === 'auto');

  useEffect(() => {
    setLanguageSuggestion(null);
  }, [from]);

  useEffect(() => {
    if (!isSuggestLanguage) {
      setLanguageSuggestion(null);
    }
  }, [isSuggestLanguage]);

  const applySuggestedLanguage = useCallback(() => {
    if (languageSuggestion !== null) {
      setFrom(languageSuggestion);
      setLanguageSuggestion(null);
    }
  }, [languageSuggestion, setFrom]);

  const translate = useCallback(() => {
    const localContext = textStateContext.current;

    translateHook(userInput, from, to)
      .then((translatedText) => {
        if (localContext !== textStateContext.current) {
          return;
        }

        if (typeof translatedText !== 'string') {
          throw new Error(`[${getMessage('common_error')}: unexpected response]`);
        }

        setTranslation({
          text: translatedText,
          original: userInput,
        });

        addTranslationHistoryEntry({
          origin: TRANSLATION_ORIGIN.USER_INPUT,
          translation: {
            from,
            to,
            originalText: userInput,
            translatedText,
          },
        });

        trackClientEvent(TELEMETRY_EVENT_NAME.TEXT_TRANSLATION_COMPLETED, {
          scope: 'user input',
          from,
          to,
          sourceTextLength: userInput.length,
          translationLength: translatedText.length,
        });
      })
      .catch((reason) => {
        if (localContext !== textStateContext.current) return;

        if (reason instanceof Error) {
          setErrorMessage(`${getMessage('common_error')}: ${reason.message}`);
          return;
        }

        setErrorMessage(getMessage('message_unknownError'));
      })
      .finally(() => {
        if (localContext !== textStateContext.current) return;

        setInTranslateProcess(false);
      });
  }, [from, to, translateHook, userInput]);

  const resetTemporaryTextState = useCallback(() => {
    textStateContext.current = Symbol('TextContext');
    setInTranslateProcess(false);
    setErrorMessage(null);
    setLanguageSuggestion(null);
  }, []);

  const clearState = useCallback(() => {
    resetTemporaryTextState();
    setUserInput('');
    setTranslation(null);
  }, [resetTemporaryTextState]);

  const swapLanguages = useCallback(
    (languages: { from: string; to: string }) => {
      isPreventClearTranslation.current = true;

      ReactDOM.unstable_batchedUpdates(() => {
        clearState();

        if (translation !== null) {
          setUserInput(translation.text);
          setTranslation({
            text: userInput,
            original: translation.text,
          });
        }

        setFrom(languages.from);
        setTo(languages.to);
      });
    },
    [clearState, setFrom, setTo, translation, userInput],
  );

  const showLanguageSuggestion = useCallback(() => {
    if (!isSuggestLanguage) return;

    const localContext = textStateContext.current;
    suggestLanguage(userInput).then((lang) => {
      if (localContext !== textStateContext.current || !isSuggestLanguage) return;
      setLanguageSuggestion(lang);
    });
  }, [isSuggestLanguage, userInput]);

  const rememberTranslationState = useImmutableCallback(() => {
    setLastTranslation(
      userInput.length === 0
        ? null
        : {
            originalText: userInput,
            translatedText: isTranslatedTextRelative ? translation.text : null,
          },
    );
  }, [isTranslatedTextRelative, setLastTranslation, translation, userInput]);

  const handleText = useImmutableCallback(() => {
    if (from !== to && userInput.length > 0) {
      setInTranslateProcess(true);
      setErrorMessage(null);
      translate();
    }

    showLanguageSuggestion();
  }, [from, to, translate, userInput, showLanguageSuggestion]);

  const [setTranslateTask] = useDelayCallback();
  const onTextChange = useCallback(
    (text: string) => {
      if (text.length === 0) {
        clearState();
        return;
      }

      resetTemporaryTextState();
      setUserInput(text);
      setTranslateTask(handleText, inputDelay);
    },
    [clearState, handleText, inputDelay, resetTemporaryTextState, setTranslateTask],
  );

  const isRequiredInitTranslate = useRef(userInput.length > 0 && translation === null);
  useEffect(() => {
    if (!isRequiredInitTranslate.current) return;

    handleText();
  }, [handleText]);

  useEffect(() => {
    if (isFirstRenderRef.current) return;

    resetTemporaryTextState();

    if (isPreventClearTranslation.current) {
      isPreventClearTranslation.current = false;
    } else {
      setTranslation(null);
    }

    handleText();
  }, [from, to, handleText, resetTemporaryTextState, isFirstRenderRef]);

  useEffect(() => {
    rememberTranslationState();
  }, [rememberTranslationState, userInput, translation]);

  return {
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
  };
};
