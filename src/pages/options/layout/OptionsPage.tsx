import {
  createContext,
  type FC,
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';

import { Page } from '@/components/layouts/Page/Page';
import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { isMobileBrowser } from '@/lib/browser';
import { openFileDialog, readAsText, saveFile } from '@/lib/files';
import { getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { type LLMTranslatorConfig } from '@/lib/translators/llm/LLMTranslator';
import { getValueAtPath, isDeepEqual } from '@/lib/utils';
// Requests
import { clearCache as clearCacheReq } from '@/requests/backend/clearCache';
import { getConfig } from '@/requests/backend/getConfig';
import { ping } from '@/requests/backend/ping';
import { resetConfig as resetConfigReq } from '@/requests/backend/resetConfig';
import { setConfig as setConfigReq } from '@/requests/backend/setConfig';
import { getAvailableTranslators } from '@/requests/backend/translators/getAvailableTranslators';
import { getSpeakers } from '@/requests/backend/tts/getSpeakers';
import { updateConfig as updateConfigReq } from '@/requests/backend/updateConfig';
import type { AppConfigType } from '@/types/runtime';

import { OptionsNav } from './OptionsNav/OptionsNav';
import {
  getLLMProfilesError,
  normalizeLLMTranslatorConfig,
} from './OptionsPage.components/LLMProfilesFieldList/LLMProfilesFieldList';
import { optionsPageStyles } from './OptionsPage.stylex';
import { generateTree } from './OptionsPage.utils/generateTree';
import { filterOptionsTree } from './OptionsPage.utils/searchOptions';
import { type OptionValue, OptionsTree } from './OptionsTree/OptionsTree';
import { PageSection } from './PageSection/PageSection';

export const OptionsModalsContext = createContext<
  RefObject<HTMLDivElement | null> | undefined
>(undefined);

// Performance seam: manager dialogs load only after their controls are activated.
const TranslatorsManager = lazy(() =>
  import('./OptionsPage.components/TranslatorsManager/TranslatorsManager').then(
    ({ TranslatorsManager }) => ({ default: TranslatorsManager }),
  ),
);
const TTSList = lazy(() =>
  import('./OptionsPage.components/TTSList/TTSList').then(({ TTSList }) => ({
    default: TTSList,
  })),
);

type Errors = null | Record<string, string>;

type ModifiedConfig = Record<string, OptionValue>;

const emptyLLMTranslator: LLMTranslatorConfig = {
  activeProfile: '',
  profiles: [],
};

const getEffectiveLLMTranslator = (
  config: AppConfigType | undefined,
  modifiedConfig: ModifiedConfig | null,
): LLMTranslatorConfig => {
  const modifiedValue = modifiedConfig?.llmTranslator;
  if (
    typeof modifiedValue === 'object' &&
    modifiedValue !== null &&
    !Array.isArray(modifiedValue)
  ) {
    return modifiedValue;
  }

  return config?.llmTranslator ?? emptyLLMTranslator;
};

interface OptionsPageProps {
  messageHideDelay?: number;
}

export const OptionsPage: FC<OptionsPageProps> = () => {
  useLayoutEffect(() => {
    telemetry.track(TELEMETRY_EVENT_NAME.SCREEN_SHOWN, { screen: 'Preferences' });
  }, []);

  const [loaded, setLoaded] = useState<boolean>(false);

  const [config, setConfig] = useState<AppConfigType | undefined>();
  const [errors, setErrors] = useState<Errors>(null);
  const [modifiedConfig, setModifiedConfig] = useState<ModifiedConfig | null>(null);

  const windowsStackRef = useRef<HTMLDivElement>(null);

  const [clearCacheProcess, setClearCacheProcess] = useState<boolean>(false);

  const [translatorModules, setTranslatorModules] = useState<Record<string, string>>({});
  const [isOpenCustomTranslatorsWindow, setIsOpenCustomTranslatorsWindow] =
    useState(false);

  const [ttsModules, setTTSModules] = useState<Record<string, string>>({});
  const [isTTSModulesWindowOpen, setIsTTSModulesWindowOpen] = useState(false);

  const updateConfig = useCallback(() => {
    (async () => {
      await Promise.all([
        getConfig().then(setConfig),
        getAvailableTranslators().then(setTranslatorModules),
        getSpeakers().then(setTTSModules),
      ]);

      setLoaded(true);
    })();
  }, []);

  //
  // Messages broker
  //

  const showToast = useToast();

  const handleError = useCallback(
    (error: any) => {
      if (typeof error === 'string') {
        showToast({ body: error, type: 'error' });
      } else if (error instanceof Error) {
        showToast({ body: error.message, type: 'error' });
      } else {
        const unknownMessage = getMessage('message_unknownError');
        showToast({ body: unknownMessage, type: 'error' });

        console.error(error);
        console.error('Unknown error object above ^');
      }
    },
    [showToast],
  );

  //
  // Config control
  //

  const importConfig = useCallback(() => {
    openFileDialog()
      .then((files) => {
        if (files === null) return null;

        return readAsText(files[0]);
      })
      .then((rawData) => {
        if (rawData === null) return;

        try {
          const configData = JSON.parse(rawData);

          setConfigReq(configData)
            .then(updateConfig)
            .then(() => {
              showToast({
                body: getMessage('settings_message_importConfig_success'),
              });
            })
            .catch(handleError);
        } catch (_error) {
          showToast({
            body: getMessage('settings_message_importConfig_invalidFile'),
            type: 'error',
          });
        }
      });
  }, [handleError, showToast, updateConfig]);

  const exportConfig = useCallback(() => {
    const dump = JSON.stringify(config);
    const file = new Blob([dump], { type: 'application/json' });

    saveFile(file, `lightling-config_${new Date().getTime()}.json`);
  }, [config]);

  const resetConfig = useCallback(() => {
    const isConfirmed = confirm(getMessage('settings_message_resetConfig_confirm'));
    if (!isConfirmed) return;

    resetConfigReq()
      .then(updateConfig)
      .then(() => {
        showToast({ body: getMessage('settings_message_resetConfig_success') });
      })
      .catch(handleError);
  }, [handleError, showToast, updateConfig]);

  //
  // Changes control
  //

  const cancelChanges = useCallback(() => {
    setModifiedConfig(null);
    setErrors(null);
  }, []);

  const llmTranslator = useMemo(
    () => getEffectiveLLMTranslator(config, modifiedConfig),
    [config, modifiedConfig],
  );

  const saveChanges = useCallback(() => {
    // Skip empty changes
    if (modifiedConfig === null) return;

    const profilesError = getLLMProfilesError(llmTranslator.profiles);
    if (profilesError !== null) {
      setErrors((currentErrors) => ({
        ...(currentErrors ?? {}),
        llmTranslator: profilesError,
      }));
      return;
    }

    const configChanges =
      'llmTranslator' in modifiedConfig
        ? {
            ...modifiedConfig,
            llmTranslator: normalizeLLMTranslatorConfig(llmTranslator),
          }
        : modifiedConfig;

    updateConfigReq(configChanges)
      .then(async ({ success, errors }) => {
        if (!success) {
          setErrors(errors);
          return;
        }

        const config = await getConfig();

        setConfig(config);
        setModifiedConfig(null);
        setErrors(null);

        showToast({ body: getMessage('settings_message_saveChanges_success') });
      })
      .catch(handleError);
  }, [handleError, llmTranslator, modifiedConfig, showToast]);

  //
  // Config actions
  //

  const clearCache = useCallback(() => {
    setClearCacheProcess(true);
    clearCacheReq()
      .then(() => {
        showToast({ body: getMessage('settings_message_clearCache_success') });
      })
      .catch(handleError)
      .finally(() => {
        setClearCacheProcess(false);
      });
  }, [handleError, showToast]);

  //
  // Utils
  //

  const setOptionValue = useCallback(
    (inputPath: string, value: OptionValue) => {
      setModifiedConfig((currentModifiedConfig) => {
        const nextModifiedConfig: ModifiedConfig = {};
        const currentConfig = currentModifiedConfig ?? {};

        for (const path in currentConfig) {
          const configItem = getValueAtPath(config, path);
          if (!isDeepEqual(configItem, currentConfig[path])) {
            nextModifiedConfig[path] = currentConfig[path];
          }
        }

        const modifiedConfigItem = getValueAtPath(currentModifiedConfig, inputPath);
        if (!isDeepEqual(modifiedConfigItem, value)) {
          const configItem = getValueAtPath(config, inputPath);
          if (isDeepEqual(configItem, value)) {
            delete nextModifiedConfig[inputPath];
          } else {
            nextModifiedConfig[inputPath] = value;
          }
        }

        return Object.keys(nextModifiedConfig).length === 0 ? null : nextModifiedConfig;
      });

      setErrors((currentErrors) => {
        if (currentErrors === null || !(inputPath in currentErrors)) {
          return currentErrors;
        }

        const nextErrors = { ...currentErrors };
        delete nextErrors[inputPath];
        return Object.keys(nextErrors).length === 0 ? null : nextErrors;
      });
    },
    [config],
  );

  // Init
  useEffect(() => {
    ping().then(updateConfig);
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const configTree = useMemo(
    () =>
      generateTree({
        clearCacheProcess,
        translatorModules,
        ttsModules,
        clearCache,
        toggleCustomTranslatorsWindow: () => {
          setIsOpenCustomTranslatorsWindow((value) => !value);
        },
        toggleTTSModulesWindow: () => {
          setIsTTSModulesWindowOpen((value) => !value);
        },
      }),
    [clearCache, clearCacheProcess, translatorModules, ttsModules],
  );

  //
  // Section navigation
  //

  const sections = useMemo(
    () => configTree.map(({ id, title }) => ({ id: id!, title })),
    [configTree],
  );

  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const isSearchActive = searchQuery.trim() !== '';

  // Sections render one at a time; the URL hash deep-links and restores them
  useEffect(() => {
    if (sections.length === 0) return;

    const hashSection = window.location.hash.replace(/^#/, '');
    setActiveSection((currentSection) => {
      if (currentSection !== null && sections.some(({ id }) => id === currentSection)) {
        return currentSection;
      }

      return sections.some(({ id }) => id === hashSection) ? hashSection : sections[0].id;
    });
  }, [sections]);

  // Sync browser back/forward navigation with the visible section
  useEffect(() => {
    const handlePopState = () => {
      const hashSection = window.location.hash.replace(/^#/, '');
      setActiveSection((currentSection) =>
        sections.some(({ id }) => id === hashSection) ? hashSection : currentSection,
      );
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [sections]);

  const handleSelectSection = useCallback(
    (id: string) => {
      if (id !== activeSection) {
        window.history.pushState(null, '', `#${id}`);
      }

      setActiveSection(id);
      setSearchQuery('');
      window.scrollTo({ top: 0 });
    },
    [activeSection],
  );

  const searchResults = useMemo(
    () => (isSearchActive ? filterOptionsTree(configTree, searchQuery) : []),
    [configTree, isSearchActive, searchQuery],
  );

  const visibleTree = useMemo(() => {
    if (isSearchActive) return searchResults;

    const activeGroup = configTree.find(({ id }) => id === activeSection);
    return activeGroup === undefined ? [] : [activeGroup];
  }, [activeSection, configTree, isSearchActive, searchResults]);

  //
  // Render
  //

  const isMobile = useMemo(() => isMobileBrowser(), []);

  if (!loaded || config === undefined) {
    return <Page loading />;
  }

  const editMode = modifiedConfig !== null;
  const ActionsStack = isMobile ? VStack : HStack;
  return (
    <Page>
      <VStack gap={0}>
        <VStack gap={0} xstyle={optionsPageStyles.page}>
          <PageSection title={getMessage('settings_pageTitle')} level={1}>
            <Text as="p" color="secondary" xstyle={optionsPageStyles.headerSubtitle}>
              {getMessage('settings_pageDescription')}
            </Text>
            <ActionsStack gap={3}>
              <Button onPress={importConfig} width={isMobile ? 'max' : undefined}>
                {getMessage('settings_button_import')}
              </Button>
              {!isMobile && (
                <Button onPress={exportConfig} width={isMobile ? 'max' : undefined}>
                  {getMessage('settings_button_export')}
                </Button>
              )}
              <Button
                view="action"
                onPress={resetConfig}
                width={isMobile ? 'max' : undefined}
              >
                {getMessage('settings_button_reset')}
              </Button>
            </ActionsStack>

            <HStack gap={6} align="start" xstyle={optionsPageStyles.optionsLayout}>
              <VStack gap={0} xstyle={optionsPageStyles.navColumn}>
                <OptionsNav
                  sections={sections}
                  activeId={isSearchActive ? null : activeSection}
                  onSelect={handleSelectSection}
                />
              </VStack>
              <VStack gap={4} xstyle={optionsPageStyles.contentColumn}>
                <VStack gap={0} xstyle={optionsPageStyles.mobileSectionPicker}>
                  <Selector
                    label={getMessage('settings_pageTitle')}
                    isLabelHidden
                    options={sections.map(({ id, title }) => ({
                      value: id,
                      label: title,
                    }))}
                    value={activeSection ?? undefined}
                    width="100%"
                    onChange={handleSelectSection}
                  />
                </VStack>
                <TextInput
                  label={getMessage('settings_search_placeholder')}
                  isLabelHidden
                  placeholder={getMessage('settings_search_placeholder')}
                  startIcon="search"
                  hasClear
                  value={searchQuery}
                  width="100%"
                  onChange={setSearchQuery}
                />
                {isSearchActive && visibleTree.length === 0 ? (
                  <Text color="secondary">{getMessage('settings_search_noResults')}</Text>
                ) : (
                  <OptionsTree
                    tree={visibleTree}
                    errors={errors ?? undefined}
                    config={config}
                    modifiedConfig={modifiedConfig}
                    setOptionValue={setOptionValue}
                  />
                )}
              </VStack>
            </HStack>
          </PageSection>
        </VStack>

        {editMode ? (
          <HStack gap={3} justify="end" xstyle={optionsPageStyles.confirmMenu}>
            <Button view="action" onPress={saveChanges}>
              {getMessage('settings_button_saveChanges')}
            </Button>
            <Button view="default" onPress={cancelChanges}>
              {getMessage('settings_button_cancel')}
            </Button>
          </HStack>
        ) : undefined}

        <VStack ref={windowsStackRef} gap={0} />

        <OptionsModalsContext.Provider value={windowsStackRef}>
          {isOpenCustomTranslatorsWindow && (
            <Suspense fallback={<Spinner />}>
              <TranslatorsManager
                visible
                onClose={() => {
                  setIsOpenCustomTranslatorsWindow(false);
                }}
                updateConfig={updateConfig}
              />
            </Suspense>
          )}
          {isTTSModulesWindowOpen && (
            <Suspense fallback={<Spinner />}>
              <TTSList
                visible
                onClose={() => {
                  setIsTTSModulesWindowOpen(false);
                }}
                updateConfig={updateConfig}
              />
            </Suspense>
          )}
        </OptionsModalsContext.Provider>
      </VStack>
    </Page>
  );
};
