import { getLanguageCodesISO639 } from 'anylang/languages';

import {
  buildLink,
  getLanguageNameByCode,
  getLocalizedNode,
  getMessage,
  getUserLanguage,
} from '@/lib/language';
import { capitalizeString } from '@/lib/utils';

import { OptionsGroup } from '../OptionsTree/OptionsTree';

const langCodes = getLanguageCodesISO639('v1');

const docsUrl = (path: string) => {
  const documentPath = path.replace(/^\/docs\//, '');
  return `https://github.com/hewel/lightling/blob/master/docs/${documentPath}.md`;
};

type Options = {
  clearCacheProcess: boolean;
  translatorModules: Record<string, string>;
  ttsModules: Record<string, string>;
  clearCache: () => void;
  toggleCustomTranslatorsWindow: () => void;
  toggleTTSModulesWindow: () => void;
};

/**
 * Generate config tree for render with `OptionsTree`
 */
export const generateTree = ({
  clearCacheProcess,
  translatorModules,
  ttsModules,
  clearCache,
  toggleCustomTranslatorsWindow,
  toggleTTSModulesWindow,
}: Options): OptionsGroup[] => {
  return [
    {
      id: 'general',
      title: getMessage('settings_option_commonSettings'),
      groupContent: [
        {
          title: getMessage('settings_option_userLanguage'),
          description: getMessage('settings_option_userLanguage_desc'),
          path: 'language',
          optionContent: {
            type: 'SelectList',
            options: langCodes
              // Remove repeated langs
              .filter((lang, idx, arr) => arr.indexOf(lang) === idx)
              .map((code) => ({
                id: code,
                content: getLanguageNameByCode(code),
              }))
              .sort(({ content: a }, { content: b }) => (a > b ? 1 : a < b ? -1 : 0)),
          },
        },
      ],
    },
    {
      id: 'translator',
      title: getMessage('settings_option_translatePreferences'),
      groupContent: [
        Object.keys(translatorModules).length === 0
          ? undefined
          : {
              title: getMessage('settings_option_translatorModule'),
              description: getMessage('settings_option_translatorModule_desc'),
              path: 'translatorModule',
              optionContent: {
                type: 'SelectList',
                options: Object.keys(translatorModules).map((value) => ({
                  id: value,
                  content: translatorModules[value],
                })),
              },
            },
        {
          title: getMessage('settings_option_customTranslatorModule'),
          description: getLocalizedNode({
            messageName: 'settings_option_customTranslatorModule_desc',
            slots: {
              docs: buildLink(docsUrl('/docs/CustomTranslator')),
            },
          }),
          optionContent: {
            type: 'Button',
            text: getMessage('settings_option_customTranslatorModule_manageButton'),
            action: toggleCustomTranslatorsWindow,
          },
        },
        {
          title: getMessage('settings_option_llmTranslator_header'),
          groupContent: [
            {
              title: getMessage('llmProfiles_managerTitle'),
              description: getMessage('settings_option_llmTranslator_manage_desc'),
              path: 'llmTranslator',
              optionContent: {
                type: 'LLMProfiles',
              },
            },
          ],
        },
      ],
    },
    {
      id: 'scheduler',
      title: getMessage('settings_option_translateScheduler'),
      groupContent: [
        {
          title: getMessage('settings_option_translateScheduler_delay'),
          description: getMessage('settings_option_translateScheduler_delay_desc'),
          path: 'scheduler.translatePoolDelay',
          optionContent: {
            type: 'InputNumber',
          },
        },
        {
          title: getMessage('settings_option_translateScheduler_retryLimit'),
          description: getMessage('settings_option_translateScheduler_retryLimit_desc'),
          path: 'scheduler.translateRetryAttemptLimit',
          optionContent: {
            type: 'InputNumber',
            min: 0,
            isIntegerOnly: true,
          },
        },
      ],
    },
    {
      id: 'cache',
      title: getMessage('settings_option_cache'),
      groupContent: [
        {
          description: getMessage('settings_option_cache_enable_desc'),
          path: 'scheduler.useCache',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_cache_enable'),
          },
        },
        {
          description: getMessage('settings_option_cache_ignoreCase_desc'),
          path: 'cache.ignoreCase',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_cache_ignoreCase'),
          },
        },
        {
          description: getMessage('settings_option_cache_clear_desc'),
          optionContent: {
            type: 'Button',
            text: getMessage('settings_option_cache_clear'),
            disabled: clearCacheProcess,
            action: clearCache,
          },
        },
      ],
    },
    {
      id: 'tts',
      title: getMessage('settings_option_tts'),
      groupContent: [
        Object.keys(ttsModules).length === 0
          ? undefined
          : {
              title: getMessage('settings_option_ttsModule'),
              description: getMessage('settings_option_ttsModule_desc'),
              path: 'ttsModule',
              optionContent: {
                type: 'SelectList',
                options: Object.entries(ttsModules).map(([id, name]) => ({
                  id,
                  content: name,
                })),
              },
            },
        {
          title: getMessage('settings_option_ttsCustomModules'),
          description: getLocalizedNode({
            messageName: 'settings_option_ttsCustomModules_desc',
            slots: {
              docs: buildLink(docsUrl('/docs/CustomTTS')),
            },
          }),
          optionContent: {
            type: 'Button',
            text: getMessage('settings_option_ttsCustomModules_button'),
            action: toggleTTSModulesWindow,
          },
        },
      ],
    },
    {
      id: 'page-translation',
      title: getMessage('settings_option_pageTranslation'),
      groupContent: [
        {
          description: getMessage('settings_option_pageTranslation_lazyTranslate_desc'),
          path: 'pageTranslator.lazyTranslate',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_pageTranslation_lazyTranslate'),
          },
        },
        {
          description: getLocalizedNode({
            messageName: 'settings_option_pageTranslation_detectLanguageByContent_desc',
            slots: {
              docs: buildLink(
                'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/lang',
              ),
            },
          }),
          path: 'pageTranslator.detectLanguageByContent',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_pageTranslation_detectLanguageByContent'),
          },
        },
        {
          path: 'pageTranslator.enableContextMenu',
          description: getMessage(
            'settings_option_pageTranslation_enableContextMenu_desc',
          ),
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_pageTranslation_enableContextMenu'),
          },
        },
        {
          path: 'pageTranslator.toggleTranslationHotkey',
          title: getMessage('settings_option_pageTranslation_shortcut_toggleTranslation'),
          description: getMessage(
            'settings_option_pageTranslation_shortcut_toggleTranslation_desc',
          ),
          optionContent: {
            type: 'Hotkey',
          },
        },
        {
          path: 'pageTranslator.originalTextPopup',
          description: getMessage(
            'settings_option_pageTranslation_originalTextPopup_desc',
          ),
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_pageTranslation_originalTextPopup'),
          },
        },
        {
          path: 'pageTranslator.enableLogExport',
          description: getMessage('settings_option_pageTranslation_enableLogExport_desc'),
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_pageTranslation_enableLogExport'),
          },
        },
        {
          title: getMessage('settings_option_pageTranslation_translatableAttributes'),
          description: getLocalizedNode({
            messageName: 'settings_option_pageTranslation_translatableAttributes_desc',
            slots: {
              htmlAttributes: buildLink(
                `https://developer.mozilla.org/${getUserLanguage()}/docs/Web/HTML/Attributes`,
              ),
            },
          }),
          path: 'pageTranslator.translatableAttributes',
          optionContent: {
            type: 'InputMultilineFromArray',
          },
        },
        {
          title: getMessage('settings_option_pageTranslation_excludeSelectors'),
          description: getMessage(
            'settings_option_pageTranslation_excludeSelectors_desc',
          ),
          path: 'pageTranslator.excludeSelectors',
          optionContent: {
            type: 'InputMultilineFromArray',
          },
        },
      ],
    },
    {
      id: 'select-translation',
      title: getMessage('settings_option_selectTranslation'),
      groupContent: [
        {
          path: 'selectTranslator.enabled',
          description: getMessage('settings_option_selectTranslation_enable_desc'),
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_selectTranslation_enable'),
          },
        },
        {
          title: getMessage('settings_option_selectTranslation_mode'),
          path: 'selectTranslator.mode',
          optionContent: {
            type: 'SelectList',
            options: ['popupButton', 'quickTranslate', 'contextMenu'].map((id) => ({
              id,
              content: getMessage(`settings_option_selectTranslation_mode_item_${id}`),
            })),
          },
        },
        {
          title: getMessage('settings_option_selectTranslation_modifiers'),
          description: getMessage('settings_option_selectTranslation_modifiers_desc'),
          path: 'selectTranslator.modifiers',
          optionContent: {
            type: 'CheckboxGroup',
            valueMap: ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'],
            options: (
              [
                {
                  type: 'Checkbox',
                  text: getMessage(
                    'settings_option_selectTranslation_modifiers_key_ctrl',
                  ),
                },
                {
                  type: 'Checkbox',
                  text: getMessage('settings_option_selectTranslation_modifiers_key_alt'),
                },
                {
                  type: 'Checkbox',
                  text: getMessage(
                    'settings_option_selectTranslation_modifiers_key_shift',
                  ),
                },
                {
                  type: 'Checkbox',
                  text: getMessage(
                    'settings_option_selectTranslation_modifiers_key_meta',
                  ),
                },
              ] as const
            ).map(({ text, ...rest }) => ({
              text: capitalizeString(text),
              ...rest,
            })),
          },
        },
        {
          description: getMessage(
            'settings_option_selectTranslation_strictSelection_desc',
          ),
          path: 'selectTranslator.strictSelection',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_selectTranslation_strictSelection'),
          },
        },
        {
          path: 'selectTranslator.disableWhileTranslatePage',
          optionContent: {
            type: 'Checkbox',
            text: getMessage(
              'settings_option_selectTranslation_disableWhileTranslatePage',
            ),
          },
        },
        {
          path: 'selectTranslator.showOriginalText',
          description: getMessage(
            'settings_option_selectTranslation_showOriginalText_desc',
          ),
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_selectTranslation_showOriginalText'),
          },
        },
        {
          title: getMessage('settings_option_selectTranslation_header_languageChoice'),
          fieldSpacing: 'relaxed',
          groupContent: [
            {
              path: 'selectTranslator.rememberDirection',
              optionContent: {
                type: 'Checkbox',
                text: getMessage('settings_option_selectTranslation_rememberDirection'),
              },
            },
            {
              description: getMessage(
                'settings_option_selectTranslation_detectTextLanguage_desc',
              ),

              path: 'selectTranslator.detectedLangFirst',
              optionContent: {
                type: 'Checkbox',
                text: getMessage('settings_option_selectTranslation_detectTextLanguage'),
              },
            },
            {
              description: getMessage(
                'settings_option_selectTranslation_isUseAutoForDetectLang_desc',
              ),
              path: 'selectTranslator.isUseAutoForDetectLang',
              optionContent: {
                type: 'Checkbox',
                text: getMessage(
                  'settings_option_selectTranslation_isUseAutoForDetectLang',
                ),
              },
            },
          ],
        },
      ],
    },
    {
      id: 'text-translation',
      title: getMessage('settings_option_textTranslator'),
      groupContent: [
        {
          description: getMessage('settings_option_textTranslator_rememberText_desc'),
          path: 'textTranslator.rememberText',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_textTranslator_rememberText'),
          },
        },
        {
          path: 'textTranslator.spellCheck',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_textTranslator_spellCheck'),
          },
        },
        {
          path: 'textTranslator.suggestLanguage',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_textTranslator_suggestLanguage'),
          },
        },
        {
          description: getMessage(
            'settings_option_textTranslator_suggestLanguageAlways_desc',
          ),
          path: 'textTranslator.suggestLanguageAlways',
          optionContent: {
            type: 'Checkbox',
            text: getMessage('settings_option_textTranslator_suggestLanguageAlways'),
          },
        },
      ],
    },

    {
      id: 'popup-history',
      title: getMessage('settings_section_popupAndHistory'),
      groupContent: [
        {
          title: 'Popup button',
          fieldSpacing: 'relaxed',
          groupContent: [
            {
              description: getMessage(
                'settings_option_selectTranslation_showOnceForSelection_desc',
              ),
              path: 'selectTranslator.showOnceForSelection',
              optionContent: {
                type: 'Checkbox',
                text: getMessage(
                  'settings_option_selectTranslation_showOnceForSelection',
                ),
              },
            },
            {
              description: getMessage(
                'settings_option_selectTranslation_focusOnTranslateButton_desc',
              ),
              path: 'selectTranslator.focusOnTranslateButton',
              optionContent: {
                type: 'Checkbox',
                text: getMessage(
                  'settings_option_selectTranslation_focusOnTranslateButton',
                ),
              },
            },
            {
              title: getMessage('settings_option_selectTranslation_timeoutForHideButton'),
              description: getMessage(
                'settings_option_selectTranslation_timeoutForHideButton_desc',
              ),
              path: 'selectTranslator.timeoutForHideButton',
              optionContent: {
                type: 'InputNumber',
              },
            },
            {
              title: getMessage('settings_option_selectTranslation_zIndex'),
              description: getMessage('settings_option_selectTranslation_zIndex_desc'),
              path: 'selectTranslator.zIndex',
              optionContent: {
                type: 'InputNumber',
              },
            },
          ],
        },
        {
          title: getMessage('settings_option_pageTranslation'),
          groupContent: [
            {
              description: getMessage(
                'settings_option_popupTab_pageTranslator_showCounters_desc',
              ),
              path: 'popupTab.pageTranslator.showCounters',
              optionContent: {
                type: 'Checkbox',
                text: getMessage('settings_option_popupTab_pageTranslator_showCounters'),
              },
            },
          ],
        },
        {
          title: getMessage('settings_section_history'),
          groupContent: [
            {
              description: getLocalizedNode({
                messageName: 'settings_option_history_enable_desc',
                slots: {
                  historyPage: buildLink(`/pages/history/history.html`),
                },
              }),
              path: 'history.enabled',
              optionContent: {
                type: 'Checkbox',
                text: getMessage('settings_option_history_enable'),
              },
            },
          ],
        },
      ],
    },
    {
      id: 'statistics',
      title: getMessage('settings_section_statistics'),
      groupContent: [
        {
          title: getMessage('settings_option_statistics_title'),
          description: getMessage('settings_option_statistics_desc'),
          optionContent: { type: 'Statistics' },
        },
      ],
    },
  ];
};
