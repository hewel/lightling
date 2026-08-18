import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { IconArrowsExchange } from '@tabler/icons-react';

import { getLanguageNameByCode, getMessage } from '@/lib/language';
import { addRecentUsedLanguage } from '@/requests/backend/recentUsedLanguages/addRecentUsedLanguage';
import { getRecentUsedLanguages } from '@/requests/backend/recentUsedLanguages/getRecentUsedLanguages';

export interface LanguagePanelProps {
  languages: string[];
  from?: string;
  to?: string;
  auto?: boolean;
  setFrom?: (value?: string) => void;
  setTo?: (value?: string) => void;
  swapHandler?: (languages: { from: string; to: string }) => void;
  disableSwap?: boolean;
  preventFocusOnPress?: boolean;
  mobile?: boolean;
}

export const LanguagePanel: FC<LanguagePanelProps> = ({
  auto,
  languages,
  from,
  to,
  setFrom,
  setTo,
  swapHandler,
  disableSwap,
  preventFocusOnPress,
  mobile,
}) => {
  const fromValue = from !== undefined ? from : auto ? 'auto' : languages[0];
  const toValue = to !== undefined ? to : languages[0];

  const swapLanguages = () => {
    if (fromValue === 'auto') return;

    if (swapHandler !== undefined) {
      swapHandler({ from: toValue, to: fromValue });
      return;
    }

    if (setFrom !== undefined && setTo !== undefined) {
      setFrom(toValue);
      setTo(fromValue);
    }
  };

  const [recentLanguages, setRecentLanguages] = useState<string[]>([]);
  useEffect(() => {
    getRecentUsedLanguages().then(setRecentLanguages);
  }, []);

  const upLanguage = useCallback(
    (lang: string) =>
      addRecentUsedLanguage(lang).then(() => {
        getRecentUsedLanguages().then(setRecentLanguages);
      }),
    [],
  );

  const options = useMemo(
    () =>
      languages
        .map((value) => ({
          value,
          label: getLanguageNameByCode(value),
        }))
        .sort((language1, language2) => {
          // The lowest the most used
          const lang1UsageRate = recentLanguages.indexOf(language1.value);
          const lang2UsageRate = recentLanguages.indexOf(language2.value);

          // Move left the language with lowest index, but not -1
          if (lang1UsageRate !== -1 || lang2UsageRate !== -1) {
            if (lang1UsageRate === -1) return 1;
            if (lang2UsageRate === -1) return -1;

            return lang1UsageRate > lang2UsageRate ? -1 : 1;
          }

          // Sort lexicographically
          return language1.label > language2.label
            ? 1
            : language1.label < language2.label
              ? -1
              : 0;
        }),
    [languages, recentLanguages],
  );

  const optionsFrom = useMemo(
    () =>
      auto
        ? [{ value: 'auto', label: getLanguageNameByCode('auto') }, ...options]
        : options,
    [auto, options],
  );

  const onFromChange = useCallback(
    (value: string) => {
      if (setFrom === undefined) return;

      setFrom(value);
      upLanguage(value);
    },
    [setFrom, upLanguage],
  );

  const onToChange = useCallback(
    (value: string) => {
      if (setTo === undefined) return;

      setTo(value);
      upLanguage(value);
    },
    [setTo, upLanguage],
  );

  const Stack = mobile ? VStack : HStack;

  return (
    <Stack gap={2} width="100%">
      <Selector
        label="Source language"
        isLabelHidden
        options={optionsFrom}
        value={fromValue}
        onChange={onFromChange}
        width="100%"
      />
      <IconButton
        label={getMessage('lang_swap')}
        tooltip={getMessage('lang_swap')}
        icon={<IconArrowsExchange />}
        variant="ghost"
        size="sm"
        onClick={swapLanguages}
        onMouseDown={preventFocusOnPress ? (event) => event.preventDefault() : undefined}
        isDisabled={fromValue === 'auto' || fromValue === toValue || disableSwap}
      />
      <Selector
        label="Target language"
        isLabelHidden
        options={options}
        value={toValue}
        onChange={onToChange}
        width="100%"
      />
    </Stack>
  );
};
