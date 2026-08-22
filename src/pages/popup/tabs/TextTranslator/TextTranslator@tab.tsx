import { useContext, useEffect, useRef, useState } from 'react';
import { useFocusVisible } from '@react-aria/interactions';

import { translate as sendTranslateRequest } from '@/requests/backend/translate';

import {
  PopupWindowContext,
  type InitFn,
  type TabComponent,
} from '../../layout/PopupWindow';

import { TextTranslator, type TextTranslatorProps } from './TextTranslator';
import {
  recoverTextTranslatorInitData,
  type TextTranslatorInitData,
  useTextTranslatorPersistence,
} from './TextTranslator.persistence';

type InitData = TextTranslatorInitData;

/**
 * Wrapper on `TextTranslator` to use as tab in `PopupWindow`
 */
export const TextTranslatorTab: TabComponent<InitFn<InitData>> = ({
  config,
  translatorFeatures,
  id: tabId,
  initData,
  isMobile,
}) => {
  const [from, setFrom] = useState(initData.from);
  const [to, setTo] = useState(initData.to);

  const [userInput, setUserInput] = useState(initData.lastTranslate?.originalText ?? '');
  const [lastTranslation, setLastTranslation] = useState<
    TextTranslatorProps['lastTranslation']
  >(initData.lastTranslate ?? null);

  useTextTranslatorPersistence({
    from,
    to,
    lastTranslation,
    rememberText: config.textTranslator.rememberText,
  });

  // Focus on input when focus is free
  const { activeTab } = useContext(PopupWindowContext);
  const { isFocusVisible } = useFocusVisible();
  const inputControl = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // TODO: prevent focus for mobile device
    if (
      activeTab === tabId &&
      inputControl.current !== null &&
      (!isFocusVisible || document.activeElement === document.body)
    ) {
      inputControl.current.focus();
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [activeTab, tabId]);

  // It need to prevent translating while init state,
  // `isInitPhase` need to prevent update right after change `isInitPhase`
  // const [isInitPhase, setIsInitPhase] = useState(true);
  // useEffect(() => {
  // 	setIsInitPhase(false);
  // }, []);

  return (
    <TextTranslator
      translatorFeatures={translatorFeatures}
      translateHook={sendTranslateRequest}
      spellCheck={config.textTranslator.spellCheck}
      enableLanguageSuggestions={config.textTranslator.suggestLanguage}
      enableLanguageSuggestionsAlways={config.textTranslator.suggestLanguageAlways}
      {...{
        from,
        setFrom,
        to,
        setTo,
        lastTranslation,
        setLastTranslation,
        userInput,
        setUserInput,
        inputControl,
        isMobile,
      }}
    />
  );
};

TextTranslatorTab.init = async ({ translatorFeatures, config }) => {
  return recoverTextTranslatorInitData({
    translatorFeatures,
    language: config.language,
    rememberText: config.textTranslator.rememberText,
  });
};
