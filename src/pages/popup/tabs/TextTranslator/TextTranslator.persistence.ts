import { useEffect, useMemo } from 'react';

import { useDelayCallback } from '@/lib/hooks/useDelayCallback';

import type { TranslationState } from './TextTranslator';
import {
  TextTranslatorStorage,
  type TextTranslatorData,
} from './TextTranslator.utils/TextTranslatorStorage';

const serializeLenLimit = 100000;
const serializeDelay = 300;

export interface TextTranslatorPersistenceStorage {
  getData: () => Promise<TextTranslatorData>;
  setData: (data: TextTranslatorData) => Promise<void>;
}

export interface TextTranslatorPersistenceOptions {
  from: string;
  to: string;
  lastTranslation: TranslationState | null;
  rememberText: boolean;
  storage?: TextTranslatorPersistenceStorage;
}

export interface TextTranslatorInitOptions {
  translatorFeatures: {
    isSupportAutodetect: boolean;
    supportedLanguages: string[];
  };
  language: string;
  rememberText: boolean;
  storage?: TextTranslatorPersistenceStorage;
}

export interface TextTranslatorInitData {
  from: string;
  to: string;
  lastTranslate: TranslationState | null;
}

export const serializeTextTranslatorData = ({
  from,
  to,
  lastTranslation,
  rememberText,
}: Omit<TextTranslatorPersistenceOptions, 'storage'>): TextTranslatorData => {
  const translationState: TextTranslatorData = {
    // Cast string to `langCode`
    from,
    to,
    translate: null,
  };

  if (lastTranslation !== null && rememberText) {
    const { originalText, translatedText } = lastTranslation;

    if (
      originalText.length <= serializeLenLimit &&
      (translatedText === null || translatedText.length <= serializeLenLimit)
    ) {
      translationState.translate = lastTranslation;
    }
  }

  return translationState;
};

export const useTextTranslatorPersistence = ({
  from,
  to,
  lastTranslation,
  rememberText,
  storage: storageOption,
}: TextTranslatorPersistenceOptions) => {
  const storage = useMemo(
    () => storageOption ?? new TextTranslatorStorage(),
    [storageOption],
  );
  const [setDelayCb] = useDelayCallback();

  useEffect(() => {
    const serialize = () => {
      try {
        const translationState = serializeTextTranslatorData({
          from,
          to,
          lastTranslation,
          rememberText,
        });

        storage.setData(translationState);
      } catch (err) {
        console.error(err);
      }
    };

    setDelayCb(serialize, serializeDelay);
  }, [from, lastTranslation, rememberText, setDelayCb, storage, to]);
};

export const recoverTextTranslatorInitData = async ({
  translatorFeatures,
  language,
  rememberText,
  storage: storageOption,
}: TextTranslatorInitOptions): Promise<TextTranslatorInitData> => {
  let from = translatorFeatures.isSupportAutodetect
    ? 'auto'
    : translatorFeatures.supportedLanguages[0];
  let to = language;
  let lastTranslate: TranslationState | null = null;

  const storage = storageOption ?? new TextTranslatorStorage();
  const lastState = await storage.getData();
  if (lastState !== null) {
    const { isSupportAutodetect, supportedLanguages } = translatorFeatures;
    const { from: lastFrom, to: lastTo, translate } = lastState;

    if (
      (lastFrom === 'auto' && isSupportAutodetect) ||
      supportedLanguages.includes(lastFrom)
    ) {
      from = lastFrom;
    }

    if (supportedLanguages.includes(lastTo)) {
      to = lastTo;
    }

    if (rememberText && translate !== null) {
      lastTranslate = translate;
    }
  }

  return { from, to, lastTranslate };
};
