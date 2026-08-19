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
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import * as stylex from '@stylexjs/stylex';

import { Page } from '@/components/layouts/Page/Page';
import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { isMobileBrowser } from '@/lib/browser';
import { openFileDialog, readAsText, saveFile } from '@/lib/files';
import { getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { testLLMTranslator } from '@/lib/translators/llm/api';
import { getActiveLLMProfile } from '@/lib/translators/llm/LLMTranslator';
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
import { optionsPageStyles } from './OptionsPage.stylex';
import { generateTree } from './OptionsPage.utils/generateTree';
import { type OptionsGroup, OptionsTree } from './OptionsTree/OptionsTree';
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
const LLMProfilesManager = lazy(() =>
  import('./OptionsPage.components/LLMProfilesManager/LLMProfilesManager').then(
    ({ LLMProfilesManager }) => ({ default: LLMProfilesManager }),
  ),
);

type Errors = null | Record<string, string>;

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
  const [modifiedConfig, setModifiedConfig] = useState<null | Record<string, any>>(null);
  const [configTree, setConfigTree] = useState<OptionsGroup[] | undefined>();

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

    saveFile(file, `linguist-config_${new Date().getTime()}.json`);
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

  const saveChanges = useCallback(() => {
    // Skip empty changes
    if (modifiedConfig === null) return;

    updateConfigReq(modifiedConfig)
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
  }, [handleError, modifiedConfig, showToast]);

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
  // LLM translator
  //

  const [llmTestProcess, setLLMTestProcess] = useState<boolean>(false);
  const [isLLMProfilesWindowOpen, setIsLLMProfilesWindowOpen] = useState(false);

  const llmProfiles = useMemo(
    () => config?.llmTranslator.profiles.map(({ name }) => name) ?? [],
    [config],
  );

  // The active profile, honoring an unsaved picker change
  const getLLMProfile = useCallback(() => {
    const llmTranslator = config?.llmTranslator ?? { activeProfile: '', profiles: [] };
    const activeProfile =
      modifiedConfig?.['llmTranslator.activeProfile'] ?? llmTranslator.activeProfile;
    return getActiveLLMProfile({ activeProfile, profiles: llmTranslator.profiles });
  }, [config, modifiedConfig]);

  const testLLMConnection = useCallback(() => {
    setLLMTestProcess(true);
    testLLMTranslator(getLLMProfile())
      .then((translatedText) => {
        showToast({
          body: `${getMessage('settings_message_llmTranslator_testSuccess')} "${translatedText}"`,
        });
      })
      .catch(handleError)
      .finally(() => {
        setLLMTestProcess(false);
      });
  }, [getLLMProfile, handleError, showToast]);

  //
  // Utils
  //

  const setOptionValue = useCallback(
    (inputPath: string, value: any) => {
      // Copy current object
      let modifiedConfigLocal: Record<string, any> | null = {};
      for (const path in modifiedConfig) {
        const configItem = getValueAtPath(config, path);

        // Copy only if it different from config value
        if (!isDeepEqual(configItem, modifiedConfig[path])) {
          modifiedConfigLocal[path] = modifiedConfig[path];
        }
      }

      // Set value if not exist equal
      const modConfigItem = getValueAtPath(modifiedConfig, inputPath);
      if (!isDeepEqual(modConfigItem, value)) {
        const configItem = getValueAtPath(config, inputPath);
        if (isDeepEqual(configItem, value)) {
          delete modifiedConfigLocal[inputPath];
        } else {
          modifiedConfigLocal[inputPath] = value;
        }
      }

      if (Object.keys(modifiedConfigLocal).length === 0) {
        modifiedConfigLocal = null;
      }

      setModifiedConfig(modifiedConfigLocal);

      // Remove error for option
      if (errors !== null && inputPath in errors) {
        let errorsLocal: Errors = { ...errors };

        delete errorsLocal[inputPath];
        if (Object.keys(errorsLocal).length === 0) {
          errorsLocal = null;
        }

        setErrors(errorsLocal);
      }
    },
    [config, errors, modifiedConfig],
  );

  // Init
  useEffect(() => {
    ping().then(updateConfig);
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  // Update config tree
  useEffect(() => {
    const configTree = generateTree({
      clearCacheProcess,
      translatorModules,
      ttsModules,
      llmProfiles,
      llmTestProcess,
      clearCache,
      testLLMConnection,
      toggleLLMProfilesWindow: () => {
        setIsLLMProfilesWindowOpen((value) => !value);
      },
      toggleCustomTranslatorsWindow: () => {
        setIsOpenCustomTranslatorsWindow((value) => !value);
      },
      toggleTTSModulesWindow: () => {
        setIsTTSModulesWindowOpen((value) => !value);
      },
    });

    setConfigTree(configTree);
  }, [
    translatorModules,
    clearCacheProcess,
    clearCache,
    ttsModules,
    llmProfiles,
    llmTestProcess,
    testLLMConnection,
  ]);

  //
  // Section navigation
  //

  const sections = useMemo(
    () => configTree?.map(({ id, title }) => ({ id: id!, title })) ?? [],
    [configTree],
  );

  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Scroll-spy: highlight the section crossing the upper viewport band
  useEffect(() => {
    if (!loaded || sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );

    for (const { id } of sections) {
      const element = document.getElementById(id);
      if (element !== null) {
        observer.observe(element);
      }
    }

    return () => observer.disconnect();
  }, [loaded, sections]);

  const handleSelectSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  //
  // Render
  //

  const isMobile = useMemo(() => isMobileBrowser(), []);

  if (!loaded || config === undefined || configTree === undefined) {
    return <Page loading />;
  }

  const editMode = modifiedConfig !== null;
  const ActionsStack = isMobile ? VStack : HStack;
  return (
    <Page>
      <div>
        <div {...stylex.props(optionsPageStyles.page)}>
          <PageSection title={getMessage('settings_pageTitle')} level={1}>
            <Text as="p" color="secondary" xstyle={optionsPageStyles.headerSubtitle}>
              {getMessage('settings_pageDescription')}
            </Text>
            <div {...stylex.props(optionsPageStyles.indentHorizontal)}>
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
            </div>

            <HStack gap={6} align="start" xstyle={optionsPageStyles.optionsTree}>
              <VStack gap={0} xstyle={optionsPageStyles.navColumn}>
                <OptionsNav
                  sections={sections}
                  activeId={activeSection}
                  onSelect={handleSelectSection}
                />
              </VStack>
              <VStack gap={0} xstyle={optionsPageStyles.contentColumn}>
                <OptionsTree
                  tree={configTree}
                  errors={errors ?? undefined}
                  config={config}
                  modifiedConfig={modifiedConfig}
                  setOptionValue={setOptionValue}
                />
              </VStack>
            </HStack>
          </PageSection>
        </div>

        {editMode ? (
          <div {...stylex.props(optionsPageStyles.confirmMenu)}>
            <Button view="action" onPress={saveChanges}>
              {getMessage('settings_button_saveChanges')}
            </Button>
            <Button view="default" onPress={cancelChanges}>
              {getMessage('settings_button_cancel')}
            </Button>
          </div>
        ) : undefined}

        <div ref={windowsStackRef} />

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
          {isLLMProfilesWindowOpen && (
            <Suspense fallback={<Spinner />}>
              <LLMProfilesManager
                visible
                onClose={() => {
                  setIsLLMProfilesWindowOpen(false);
                }}
                updateConfig={updateConfig}
              />
            </Suspense>
          )}
        </OptionsModalsContext.Provider>
      </div>
    </Page>
  );
};
