import { FC, useCallback, useMemo } from 'react';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Selector } from '@astryxdesign/core/Selector';
import * as stylex from '@stylexjs/stylex';

import { PageTranslatorStats } from '@/app/ContentScript/PageTranslator/PageTranslator';
import { LanguagePanel } from '@/components/controls/LanguagePanel/LanguagePanel';
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { getLanguageNameByCode, getMessage } from '@/lib/language';
import { MutableValue } from '@/types/utils';

import { TabData } from '../../layout/PopupWindow';

const styles = stylex.create({
  root: {
    fontFamily: 'var(--typography-font-family)',
  },
  verticalContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--typography-controls-indent-l)',
  },
  horizontalContainer: {
    display: 'flex',
    gap: 'var(--typography-controls-indent-l)',
  },
  header: {
    margin:
      'var(--typography-layout-indent-l-all) 0 var(--typography-layout-indent-m-all)',
  },
  translateButtonFill: {
    width: '100%',
  },
  langPanel: {
    display: 'inline',
  },
  langPanelMobile: {
    display: 'block',
  },
  counterContainer: {
    display: 'flex',
    gap: 'var(--button-size-s-indent-outer)',
  },
  counter: {
    display: 'inline-block',
    backgroundColor: 'var(--button-view-default-fill-color-disabled)',
    color: 'var(--button-view-default-typo-color-disabled)',
    fontSize: 'var(--button-size-s-font-size)',
    lineHeight: 'var(--button-size-s-line-height)',
    padding: '0 var(--button-size-m-indent-inner)',
    borderRadius: 'var(--button-border-radius)',
  },
  counterContent: {
    marginInlineStart: 'var(--typography-layout-indent-s-all)',
    borderInlineStart: 'var(--border-width) solid currentcolor',
    paddingInlineStart: 'var(--typography-layout-indent-s-all)',
  },
  placeholder: {
    marginBlockEnd: '0.5rem',
  },
  optionTitle: {
    marginInlineEnd: 'var(--typography-controls-indent-l)',
  },
  optionTitleMobile: {
    display: 'block',
  },
  optionValue: {
    marginInlineEnd: 'var(--typography-controls-indent-l)',
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

  return (
    <div {...stylex.props(styles.root, styles.verticalContainer)}>
      <div
        {...stylex.props(
          isMobile ? styles.verticalContainer : styles.horizontalContainer,
        )}
      >
        <Button
          view="action"
          onPress={toggleTranslate}
          size={isMobile ? 'l' : 'm'}
          xstyle={isMobile && styles.translateButtonFill}
        >
          {actionBtnText}
        </Button>
        <div {...stylex.props(styles.langPanel, isMobile && styles.langPanelMobile)}>
          <LanguagePanel
            auto={translatorFeatures.isSupportAutodetect}
            languages={translatorFeatures.supportedLanguages}
            from={from}
            to={to}
            setFrom={setFrom}
            setTo={setTo}
            mobile={isMobile}
          />
        </div>
      </div>

      {/* Options */}
      <Collapsible
        trigger={getMessage('pageTranslator_showTranslationPreferences')}
        isOpen={isShowOptions}
        onOpenChange={setIsShowOptions}
      >
        <div {...stylex.props(styles.verticalContainer)}>
          <div>
            <h4 {...stylex.props(styles.header)}>
              {getMessage('pageTranslator_commonPreferences_title') +
                (localizedLang && ` (${localizedLang})`)}
            </h4>
            <div>
              <span
                {...stylex.props(
                  styles.optionTitle,
                  isMobile && styles.optionTitleMobile,
                )}
              >
                {getMessage('pageTranslator_option_autoTranslate')}
              </span>
              <span {...stylex.props(styles.optionValue)}>
                <Selector
                  label={getMessage('pageTranslator_commonPreferences_title')}
                  isLabelHidden
                  options={translateLanguageOptions}
                  value={languagePreferences}
                  onChange={setTranslateLangAdaptor}
                />
              </span>
            </div>
          </div>

          <div>
            <h4 {...stylex.props(styles.header)}>
              {getMessage('pageTranslator_sitePreferences_title')} {escapedHostname}
            </h4>
            <div>
              <span
                {...stylex.props(
                  styles.optionTitle,
                  isMobile && styles.optionTitleMobile,
                )}
              >
                {getMessage('pageTranslator_option_autoTranslate')}
              </span>
              <span {...stylex.props(styles.optionValue)}>
                <Selector
                  label={getMessage('pageTranslator_sitePreferences_title')}
                  isLabelHidden
                  options={translateSiteOptions}
                  value={sitePreferences}
                  onChange={setTranslateStateAdaptor}
                />
              </span>
            </div>
          </div>
        </div>
      </Collapsible>

      {showCounters ? (
        <>
          <h4 {...stylex.props(styles.header)}>
            {getMessage('pageTranslator_translationReport')}
          </h4>
          <div {...stylex.props(styles.counterContainer)}>
            <span {...stylex.props(styles.counter)}>
              {getMessage('pageTranslator_translationReport_resolve')}
              <span {...stylex.props(styles.counterContent)}>
                {counters !== undefined ? counters.resolved : 0}
              </span>
            </span>
            <span {...stylex.props(styles.counter)}>
              {getMessage('pageTranslator_translationReport_reject')}
              <span {...stylex.props(styles.counterContent)}>
                {counters !== undefined ? counters.rejected : 0}
              </span>
            </span>
            <span {...stylex.props(styles.counter)}>
              {getMessage('pageTranslator_translationReport_queue')}
              <span {...stylex.props(styles.counterContent)}>
                {counters !== undefined ? counters.pending : 0}
              </span>
            </span>
          </div>
        </>
      ) : (
        // Placeholder
        <div {...stylex.props(styles.placeholder)} />
      )}
    </div>
  );
};
