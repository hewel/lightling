import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';

import { getMessage } from '@/lib/language';
import { getAvailableTranslators } from '@/requests/backend/translators/getAvailableTranslators';
import { updateConfig } from '@/requests/backend/updateConfig';
import { AppConfigType } from '@/types/runtime';

const LLM_TRANSLATOR_MODULE = 'LLMTranslator';
const LLM_OPTION_PREFIX = 'llm:';

export const encodeLLMProfileOptionValue = (profileName: string): string =>
  `${LLM_OPTION_PREFIX}${profileName}`;

export const decodeLLMProfileOptionValue = (value: string): string | null =>
  value.startsWith(LLM_OPTION_PREFIX) ? value.slice(LLM_OPTION_PREFIX.length) : null;

type TranslatorModelOption = { value: string; label: string };

/**
 * Build a unified options list where every translator module and every
 * configured LLM profile is a separate translation model
 */
export const buildTranslatorModelOptions = (
  translators: Record<string, string>,
  llmConfig: AppConfigType['llmTranslator'],
): TranslatorModelOption[] => {
  const options: TranslatorModelOption[] = [];

  const llmModuleName =
    translators[LLM_TRANSLATOR_MODULE] ?? getMessage('common_llmTranslator');

  for (const [code, name] of Object.entries(translators)) {
    if (code === LLM_TRANSLATOR_MODULE) continue;
    options.push({ value: code, label: name });
  }

  if (llmConfig.profiles.length === 0) {
    options.push({ value: LLM_TRANSLATOR_MODULE, label: llmModuleName });
  } else {
    for (const profile of llmConfig.profiles) {
      options.push({
        value: encodeLLMProfileOptionValue(profile.name),
        label: `${llmModuleName}: ${profile.name}`,
      });
    }
  }

  return options;
};

/**
 * Current option value: the translator module, or the active LLM profile
 */
export const getCurrentTranslatorModelValue = (config: AppConfigType): string => {
  if (config.translatorModule !== LLM_TRANSLATOR_MODULE) return config.translatorModule;

  const activeProfile =
    config.llmTranslator.profiles.find(
      ({ name }) => name === config.llmTranslator.activeProfile,
    ) ?? config.llmTranslator.profiles[0];

  return activeProfile !== undefined
    ? encodeLLMProfileOptionValue(activeProfile.name)
    : LLM_TRANSLATOR_MODULE;
};

export interface TranslatorModelSelectorProps {
  config: AppConfigType;
  onConfigUpdated: () => void;
}

/**
 * Header control which treats every LLM profile as a translation model
 * and switches `translatorModule` / `llmTranslator.activeProfile`
 */
export const TranslatorModelSelector: FC<TranslatorModelSelectorProps> = ({
  config,
  onConfigUpdated,
}) => {
  const [translators, setTranslators] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let isActual = true;
    getAvailableTranslators().then((translatorsMap) => {
      if (isActual) setTranslators(translatorsMap);
    });

    return () => {
      isActual = false;
    };
  }, []);

  const options = useMemo(
    () =>
      translators === null
        ? []
        : buildTranslatorModelOptions(translators, config.llmTranslator),
    [translators, config.llmTranslator],
  );

  const handleChange = useCallback(
    (value: string) => {
      const profileName = decodeLLMProfileOptionValue(value);
      const configUpdate =
        profileName !== null
          ? {
              translatorModule: LLM_TRANSLATOR_MODULE,
              'llmTranslator.activeProfile': profileName,
            }
          : { translatorModule: value };

      updateConfig(configUpdate)
        .then(({ success }) => {
          if (success) onConfigUpdated();
        })
        .catch(console.error);
    },
    [onConfigUpdated],
  );

  if (translators === null) return null;

  return (
    <Selector
      label={getMessage('settings_option_translatorModule')}
      isLabelHidden
      variant="ghost"
      size="sm"
      hasSearch
      searchPlaceholder={getMessage('common_search')}
      options={options}
      value={getCurrentTranslatorModelValue(config)}
      width="100%"
      onChange={handleChange}
    />
  );
};
