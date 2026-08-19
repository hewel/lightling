import { FC, useCallback, useContext, useEffect, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import * as stylex from '@stylexjs/stylex';

import { ModalLayout } from '@/components/layouts/ModalLayout/ModalLayout';
import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { Modal } from '@/components/primitives/Modal/Modal.bundle/desktop';
import { Textinput } from '@/components/primitives/Textinput/Textinput.bundle/desktop';
import { getMessage } from '@/lib/language';
import { fetchLLMModels, testLLMTranslator } from '@/lib/translators/llm/api';
import {
  LLMProfile,
  LLMProvider,
  LLMTranslatorConfig,
} from '@/lib/translators/llm/LLMTranslator';
import {
  LLMPresetId,
  llmPresetIds,
  llmProviderPresets,
  makeUniqueProfileName,
} from '@/lib/translators/llm/presets';
import { getConfig } from '@/requests/backend/getConfig';
import { updateConfig as updateConfigReq } from '@/requests/backend/updateConfig';

import { OptionsModalsContext } from '../../OptionsPage';

const providerLabels: Record<LLMProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  'openai-compatible': getMessage('llmProvider_openaiCompatible'),
};

const presetLabels: Record<LLMPresetId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  custom: getMessage('llmProvider_custom'),
};

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : getMessage('message_unknownError');

const styles = stylex.create({
  // Wider than the default `fit-content` dialog so URL/key fields are comfortable;
  // shared by both views to avoid a layout jump when switching between them
  content: {
    width: 'min(40rem, 90vw)',
    boxSizing: 'border-box',
  },
  error: {
    borderRadius: 'var(--typography-layout-border-radius)',
    padding: '0.6rem',
    background: 'var(--color-error)',
    color: 'var(--color-on-error)',
  },
});

export const LLMProfilesManager: FC<{
  visible: boolean;
  onClose: () => void;
  updateConfig: () => void;
}> = ({ visible, onClose, updateConfig }) => {
  const scope = useContext(OptionsModalsContext);

  // Profiles state
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<LLMTranslatorConfig>({
    activeProfile: '',
    profiles: [],
  });

  const reload = useCallback(async () => {
    const appConfig = await getConfig();
    setConfig(appConfig.llmTranslator);
    updateConfig();
  }, [updateConfig]);

  useEffect(() => {
    reload().finally(() => {
      setIsLoading(false);
    });
  }, [reload]);

  const [actionError, setActionError] = useState<string | null>(null);
  const persist = useCallback(
    async (value: LLMTranslatorConfig) => {
      const { success, errors } = await updateConfigReq({ llmTranslator: value });
      if (!success) {
        setActionError(Object.values(errors ?? {})[0] ?? null);
        return false;
      }

      setActionError(null);
      await reload();
      return true;
    },
    [reload],
  );

  // Editor state; `editedIndex` points into `config.profiles`
  const [editedIndex, setEditedIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<LLMProfile | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [draftModels, setDraftModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  const openEditor = useCallback(
    (index: number) => {
      setEditedIndex(index);
      setDraft({ ...config.profiles[index] });
      setDraftModels(null);
      setEditorError(null);
      setEditorNotice(null);
    },
    [config.profiles],
  );

  const closeEditor = useCallback(() => {
    setEditedIndex(null);
    setDraft(null);
    setDraftModels(null);
    setEditorError(null);
    setEditorNotice(null);
  }, []);

  const patchDraft = useCallback((patch: Partial<LLMProfile>) => {
    setDraft((draft) => (draft === null ? draft : { ...draft, ...patch }));
    // A different endpoint serves different models
    setDraftModels(null);
    setEditorNotice(null);
  }, []);

  // List actions
  const [presetId, setPresetId] = useState<LLMPresetId>('openai');

  const addFromPreset = useCallback(async () => {
    const preset = llmProviderPresets[presetId];
    const profile: LLMProfile = {
      ...preset,
      name: makeUniqueProfileName(
        preset.name,
        config.profiles.map(({ name }) => name),
      ),
    };
    const profiles = [...config.profiles, profile];

    if (await persist({ ...config, profiles })) {
      openEditor(profiles.length - 1);
    }
  }, [config, openEditor, persist, presetId]);

  const deleteProfile = useCallback(
    (index: number) => {
      const profile = config.profiles[index];
      const isConfirmed = confirm(
        getMessage('llmProfiles_deleteConfirm', [profile.name]),
      );
      if (!isConfirmed) return;

      const profiles = config.profiles.filter((_, i) => i !== index);
      const activeProfile =
        config.activeProfile === profile.name
          ? (profiles[0]?.name ?? '')
          : config.activeProfile;

      persist({ activeProfile, profiles });
    },
    [config, persist],
  );

  const setActive = useCallback(
    (name: string) => {
      persist({ ...config, activeProfile: name });
    },
    [config, persist],
  );

  // Editor actions
  const saveEditor = useCallback(async () => {
    if (draft === null || editedIndex === null) return;

    const name = draft.name.trim();
    if (name === '') {
      setEditorError(getMessage('llmProfiles_emptyName'));
      return;
    }

    const isDuplicate = config.profiles.some(
      (profile, i) => i !== editedIndex && profile.name === name,
    );
    if (isDuplicate) {
      setEditorError(getMessage('llmProfiles_duplicateName'));
      return;
    }

    const profiles = config.profiles.map((profile, i) =>
      i === editedIndex ? { ...draft, name } : profile,
    );
    const oldName = config.profiles[editedIndex]?.name;
    const activeProfile = config.activeProfile === oldName ? name : config.activeProfile;

    if (await persist({ activeProfile, profiles })) {
      closeEditor();
    } else {
      setEditorError(actionError);
    }
  }, [actionError, closeEditor, config, draft, editedIndex, persist]);

  const fetchDraftModels = useCallback(() => {
    if (draft === null) return;

    setModelsBusy(true);
    setEditorError(null);
    setEditorNotice(null);
    fetchLLMModels(draft)
      .then((models) => {
        if (models.length === 0) {
          setEditorNotice(getMessage('settings_message_llmTranslator_modelsEmpty'));
          return;
        }

        setDraftModels(models);
        setEditorNotice(getMessage('settings_message_llmTranslator_modelsLoaded'));
      })
      .catch((error: unknown) => {
        setEditorError(errorMessageOf(error));
      })
      .finally(() => {
        setModelsBusy(false);
      });
  }, [draft]);

  const testDraft = useCallback(() => {
    if (draft === null) return;

    setTestBusy(true);
    setEditorError(null);
    setEditorNotice(null);
    testLLMTranslator(draft)
      .then((translatedText) => {
        setEditorNotice(
          `${getMessage('settings_message_llmTranslator_testSuccess')} "${translatedText}"`,
        );
      })
      .catch((error: unknown) => {
        setEditorError(errorMessageOf(error));
      })
      .finally(() => {
        setTestBusy(false);
      });
  }, [draft]);

  const renderProfileList = () => (
    <ModalLayout
      title={getMessage('llmProfiles_managerTitle')}
      footer={[
        <Selector
          key="preset"
          label={getMessage('llmProfiles_addProvider')}
          isLabelHidden
          options={llmPresetIds.map((id) => ({ value: id, label: presetLabels[id] }))}
          value={presetId}
          onChange={(value) => {
            setPresetId(value as LLMPresetId);
          }}
        />,
        <Button key="add" view="action" onPress={addFromPreset}>
          {getMessage('llmProfiles_add')}
        </Button>,
        <Button key="close" onPress={onClose}>
          {getMessage('translatorsManagerWindow_close')}
        </Button>,
      ]}
    >
      <VStack gap={3}>
        {config.profiles.length === 0 ? (
          <Text color="secondary">{getMessage('llmProfiles_emptyList')}</Text>
        ) : (
          config.profiles.map((profile, index) => {
            const isActive = profile.name === config.activeProfile;
            return (
              <HStack key={profile.name} gap={3} align="center" justify="between">
                <VStack gap={0}>
                  <Text weight="medium">{profile.name}</Text>
                  <Text color="secondary" size="sm">
                    {providerLabels[profile.provider]}
                    {isActive ? ` · ${getMessage('llmProfiles_active')}` : ''}
                  </Text>
                </VStack>

                <HStack gap={2}>
                  {!isActive && (
                    <Button
                      onPress={() => {
                        setActive(profile.name);
                      }}
                    >
                      {getMessage('llmProfiles_setActive')}
                    </Button>
                  )}
                  <Button
                    onPress={() => {
                      openEditor(index);
                    }}
                  >
                    {getMessage('llmProfiles_edit')}
                  </Button>
                  <Button
                    onPress={() => {
                      deleteProfile(index);
                    }}
                  >
                    {getMessage('llmProfiles_delete')}
                  </Button>
                </HStack>
              </HStack>
            );
          })
        )}
        {actionError !== null && (
          <Text as="p" xstyle={styles.error}>
            {actionError}
          </Text>
        )}
      </VStack>
    </ModalLayout>
  );

  const renderEditor = () => {
    if (draft === null) return null;

    return (
      <ModalLayout
        title={getMessage('llmProfiles_editProfile')}
        footer={[
          <Button key="save" view="action" onPress={saveEditor}>
            {getMessage('llmProfiles_save')}
          </Button>,
          <Button key="cancel" onPress={closeEditor}>
            {getMessage('settings_button_cancel')}
          </Button>,
        ]}
      >
        <VStack gap={4}>
          <Textinput
            label={getMessage('llmProfiles_profileName')}
            value={draft.name}
            onInputText={(value) => {
              patchDraft({ name: value });
            }}
          />
          <Selector
            label={getMessage('llmProfiles_provider')}
            options={(Object.keys(providerLabels) as LLMProvider[]).map((id) => ({
              value: id,
              label: providerLabels[id],
            }))}
            value={draft.provider}
            onChange={(value) => {
              patchDraft({ provider: value as LLMProvider });
            }}
          />
          <Textinput
            label={getMessage('settings_option_llmTranslator_apiUrl')}
            value={draft.apiUrl}
            spellCheck={false}
            onInputText={(value) => {
              patchDraft({ apiUrl: value });
            }}
          />
          <Textinput
            label={getMessage('settings_option_llmTranslator_apiKey')}
            type="password"
            value={draft.apiKey}
            spellCheck={false}
            onInputText={(value) => {
              patchDraft({ apiKey: value });
            }}
          />

          {draftModels !== null ? (
            <Selector
              label={getMessage('settings_option_llmTranslator_model')}
              options={draftModels.map((id) => ({ value: id, label: id }))}
              value={draft.model}
              onChange={(value) => {
                patchDraft({ model: value });
              }}
            />
          ) : (
            <Textinput
              label={getMessage('settings_option_llmTranslator_model')}
              value={draft.model}
              spellCheck={false}
              onInputText={(value) => {
                patchDraft({ model: value });
              }}
            />
          )}

          <HStack gap={2}>
            <Button disabled={modelsBusy} onPress={fetchDraftModels}>
              {getMessage('settings_option_llmTranslator_fetchModelsButton')}
            </Button>
            <Button disabled={testBusy} onPress={testDraft}>
              {getMessage('settings_option_llmTranslator_testButton')}
            </Button>
          </HStack>

          {editorNotice !== null && <Text>{editorNotice}</Text>}
          {editorError !== null && (
            <Text as="p" xstyle={styles.error}>
              {editorError}
            </Text>
          )}
        </VStack>
      </ModalLayout>
    );
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      scope={scope}
      preventBodyScroll
      contentXstyle={styles.content}
    >
      {isLoading ? (
        <Spinner />
      ) : editedIndex === null ? (
        renderProfileList()
      ) : (
        renderEditor()
      )}
    </Modal>
  );
};
