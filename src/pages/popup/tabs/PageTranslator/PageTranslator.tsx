import { FC, useCallback, useMemo } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import * as stylex from '@stylexjs/stylex';

import { PageTranslatorStats } from '@/app/ContentScript/PageTranslator/PageTranslator';
import { LanguagePanel } from '@/components/controls/LanguagePanel/LanguagePanel';
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { getLanguageNameByCode, getMessage } from '@/lib/language';
import { MutableValue } from '@/types/utils';

import { TabData } from '../../layout/PopupWindow';

const styles = stylex.create({
  translateButtonFill: {
    width: '100%',
  },
});

export const languagePreferenceOptions = {
  ENABLE: 'enable',
  DISABLE: 'disable',
  DISABLE_FOR_ALL: 'disableForAll',
} as const;

export const sitePreferenceOptions = {
  DEFAULT: 'default',
  ALWAYS: 'always',
  NEVER: 'never',
  DEFAULT_FOR_THIS_LANGUAGE: 'defaultForThisLang',
  ALWAYS_FOR_THIS_LANGUAGE: 'alwaysForThisLang',
  NEVER_FOR_THIS_LANGUAGE: 'neverForThisLang',
} as const;

export interface PageTranslatorProps
  extends
    MutableValue<'from', string | undefined>,
    MutableValue<'to', string | undefined>,
    MutableValue<'isShowOptions', boolean>,
    // TODO: use literals
    MutableValue<'sitePreferences', string>,
    MutableValue<'languagePreferences', string> {
  /**
   * Features of translator module
   */
  translatorFeatures: TabData['translatorFeatures'];

  hostname: string;

  showCounters?: boolean;

  isTranslated: boolean;

  toggleTranslate: () => void;
  exportLog?: () => void;

  counters: PageTranslatorStats;

  isMobile?: boolean;
}

/**
 * Component represent UI for translate current page
 */
export const PageTranslator: FC<PageTranslatorProps> = ({
  translatorFeatures,
  from,
  setFrom,
  to,
  setTo,
  hostname,
  sitePreferences,
  setSitePreferences,
  languagePreferences,
  setLanguagePreferences,
  showCounters,
  toggleTranslate,
  exportLog,
  isTranslated,
  counters,

  isShowOptions,
  setIsShowOptions,

  isMobile,
}) => {
  const actionBtnText = getMessage(
    isTranslated ? 'pageTranslator_showOriginal' : 'pageTranslator_translatePage',
  );

  const escapedHostname = useMemo(
    () => (hostname.length <= 50 ? hostname : hostname.slice(0, 80) + '...'),
    [hostname],
  );
  const localizedLang = useMemo(
    () => (from ? getLanguageNameByCode(from) : null),
    [from],
  );

  // TODO: #important fix types in library to allow set types strict
  const setTranslateLangAdaptor = useCallback(
    (value: string[] | string | undefined) => {
      // TODO: check that it is const value
      if (typeof value === 'string') {
        setLanguagePreferences(value);
      }
    },
    [setLanguagePreferences],
  );

  const setTranslateStateAdaptor = useCallback(
    (value: string[] | string | undefined) => {
      if (typeof value === 'string') {
        setSitePreferences(value);
      }
    },
    [setSitePreferences],
  );

  const translateLanguageOptions = useMemo(
    () =>
      [
        languagePreferenceOptions.ENABLE,
        languagePreferenceOptions.DISABLE,
        languagePreferenceOptions.DISABLE_FOR_ALL,
      ].map((key) => ({
        value: key,
        label: getMessage('pageTranslator_commonPreferences_autoTranslate_' + key),
      })),
    [],
  );

  const translateSiteOptions = useMemo(
    () =>
      [
        sitePreferenceOptions.DEFAULT,
        sitePreferenceOptions.NEVER,
        sitePreferenceOptions.ALWAYS,
        sitePreferenceOptions.DEFAULT_FOR_THIS_LANGUAGE,
        sitePreferenceOptions.ALWAYS_FOR_THIS_LANGUAGE,
        sitePreferenceOptions.NEVER_FOR_THIS_LANGUAGE,
      ].map((key) => ({
        value: key,
        label: getMessage('pageTranslator_sitePreferences_autoTranslate_' + key),
      })),
    [],
  );

  const ActionStack = isMobile ? VStack : HStack;

  return (
    <VStack gap={3}>
      <ActionStack gap={2} align={isMobile ? 'stretch' : 'center'} width="100%">
        <Button
          view="action"
          onPress={toggleTranslate}
          size={isMobile ? 'l' : 'm'}
          xstyle={isMobile && styles.translateButtonFill}
        >
          {actionBtnText}
        </Button>
        <LanguagePanel
          auto={translatorFeatures.isSupportAutodetect}
          languages={translatorFeatures.supportedLanguages}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          mobile={isMobile}
        />
      </ActionStack>

      {/* Options */}
      <Collapsible
        trigger={getMessage('pageTranslator_showTranslationPreferences')}
        isOpen={isShowOptions}
        onOpenChange={setIsShowOptions}
      >
        <VStack gap={3}>
          <VStack gap={2}>
            <Heading level={4}>
              {getMessage('pageTranslator_commonPreferences_title') +
                (localizedLang !== null ? ` (${localizedLang})` : '')}
            </Heading>
            <HStack gap={2} align="center" justify="between" width="100%">
              <Text>{getMessage('pageTranslator_option_autoTranslate')}</Text>
              <Selector
                label={getMessage('pageTranslator_commonPreferences_title')}
                isLabelHidden
                options={translateLanguageOptions}
                value={languagePreferences}
                onChange={setTranslateLangAdaptor}
              />
            </HStack>
          </VStack>

          <VStack gap={2}>
            <Heading level={4}>
              {getMessage('pageTranslator_sitePreferences_title')} {escapedHostname}
            </Heading>
            <HStack gap={2} align="center" justify="between" width="100%">
              <Text>{getMessage('pageTranslator_option_autoTranslate')}</Text>
              <Selector
                label={getMessage('pageTranslator_sitePreferences_title')}
                isLabelHidden
                options={translateSiteOptions}
                value={sitePreferences}
                onChange={setTranslateStateAdaptor}
              />
            </HStack>
          </VStack>
          {exportLog !== undefined && (
            <Button view="default" onPress={exportLog}>
              {getMessage('pageTranslator_exportLog')}
            </Button>
          )}
        </VStack>
      </Collapsible>

      {showCounters && (
        <VStack gap={2}>
          <Heading level={4}>{getMessage('pageTranslator_translationReport')}</Heading>
          <HStack gap={2}>
            <Badge
              variant="success"
              label={`${getMessage('pageTranslator_translationReport_resolve')}: ${
                counters !== undefined ? counters.resolved : 0
              }`}
            />
            <Badge
              variant="error"
              label={`${getMessage('pageTranslator_translationReport_reject')}: ${
                counters !== undefined ? counters.rejected : 0
              }`}
            />
            <Badge
              variant="neutral"
              label={`${getMessage('pageTranslator_translationReport_queue')}: ${
                counters !== undefined ? counters.pending : 0
              }`}
            />
          </HStack>
        </VStack>
      )}
    </VStack>
  );
};
