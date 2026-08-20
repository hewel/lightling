import { type FC, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { TabList, useTabListContext } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import * as stylex from '@stylexjs/stylex';
import {
  IconListSearch,
  IconPlugConnected,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

import { InputGroupAction } from '@/components/controls/InputGroupAction/InputGroupAction';
import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { Textinput } from '@/components/primitives/Textinput/Textinput.bundle/desktop';
import { getMessage } from '@/lib/language';
import { fetchLLMModels, testLLMTranslator } from '@/lib/translators/llm/api';
import {
  type LLMProfile,
  type LLMProvider,
  type LLMTranslatorConfig,
} from '@/lib/translators/llm/LLMTranslator';
import {
  type LLMPresetId,
  llmPresetIds,
  llmProviderPresets,
  makeUniqueProfileName,
} from '@/lib/translators/llm/presets';

const llmProviders: readonly LLMProvider[] = [
  'openai',
  'anthropic',
  'openrouter',
  'openai-compatible',
];

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

const providerOptions = llmProviders.map((provider) => ({
  value: provider,
  label: providerLabels[provider],
}));

const presetOptions = llmPresetIds.map((preset) => ({
  value: preset,
  label: presetLabels[preset],
}));

const isLLMProvider = (value: string): value is LLMProvider =>
  llmProviders.some((provider) => provider === value);

const isLLMPreset = (value: string): value is LLMPresetId =>
  llmPresetIds.some((preset) => preset === value);

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : getMessage('message_unknownError');

const getLLMProfileNameErrors = (
  profiles: readonly LLMProfile[],
): (string | undefined)[] => {
  const normalizedNames = profiles.map(({ name }) => name.trim());
  const nameCounts = new Map<string, number>();

  for (const name of normalizedNames) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return normalizedNames.map((name) => {
    if (name === '') return getMessage('llmProfiles_emptyName');
    if ((nameCounts.get(name) ?? 0) > 1) {
      return getMessage('llmProfiles_duplicateName');
    }
    return undefined;
  });
};

export const getLLMProfilesError = (profiles: readonly LLMProfile[]): string | null =>
  getLLMProfileNameErrors(profiles).find((error) => error !== undefined) ?? null;

export const normalizeLLMTranslatorConfig = (
  value: LLMTranslatorConfig,
): LLMTranslatorConfig => {
  const profiles = value.profiles.map((profile) => ({
    ...profile,
    name: profile.name.trim(),
  }));
  const activeIndex = value.profiles.findIndex(
    ({ name }) => name === value.activeProfile,
  );

  return {
    activeProfile:
      activeIndex === -1 ? value.activeProfile : (profiles[activeIndex]?.name ?? ''),
    profiles,
  };
};

type FieldStatus = {
  type: 'error' | 'success' | 'warning';
  message: string;
};

type RowState = {
  models?: string[];
  modelsBusy?: boolean;
  testBusy?: boolean;
  modelsStatus?: FieldStatus;
  testStatus?: FieldStatus;
};

const styles = stylex.create({
  profileTab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--spacing-1)',
    paddingInline: 'var(--spacing-3)',
    height: 'var(--size-element-md)',
    color: {
      default: 'var(--color-text-secondary)',
      ':has([aria-selected="true"])': 'var(--color-text-primary)',
    },
    fontSize: 'var(--text-label-size)',
    lineHeight: 'var(--text-label-leading)',
    whiteSpace: 'nowrap',
    ':has(:focus-visible)': {
      outlineWidth: 'var(--focus-outline-width)',
      outlineStyle: 'var(--focus-outline-style)',
      outlineColor: 'var(--focus-outline-color)',
      outlineOffset: 'var(--focus-outline-offset)',
    },
  },
  profileTabSelect: {
    appearance: 'none',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-element)',
    padding: 0,
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    fontWeight: 'inherit',
    cursor: 'pointer',
    outline: 'none',
  },
  profileTabIndicator: {
    position: 'absolute',
    bottom: 'var(--_tab-indicator-bottom, -1px)',
    insetInlineStart: 'var(--spacing-3)',
    insetInlineEnd: 'var(--spacing-3)',
    height: 'calc(var(--spacing-1) / 2)',
    borderRadius: 'var(--radius-full)',
    backgroundColor: {
      default: 'transparent',
      ':has([aria-selected="true"])': 'var(--color-accent)',
    },
    pointerEvents: 'none',
  },
  fieldItem: {
    flexBasis: 'calc(var(--spacing-10) * 4)',
    minWidth: 0,
  },
  wideFieldItem: {
    flexBasis: 'calc(var(--spacing-10) * 6)',
    minWidth: 0,
  },
});

interface ProfileTabProps {
  value: string;
  label: string;
  isActive: boolean;
  onDelete: () => void;
}

/**
 * Astryx `Tab` renders one native button, so a remove button cannot be nested
 * inside its label. This adapter keeps TabList's roving focus contract while
 * rendering selection and deletion as sibling controls inside one tab surface.
 */
const ProfileTab: FC<ProfileTabProps> = ({ value, label, isActive, onDelete }) => {
  const tabList = useTabListContext();
  const isSelected = tabList.value === value;

  return (
    <HStack
      gap={1}
      align="center"
      className="astryx-tab"
      xstyle={styles.profileTab}
      data-tab-value={value}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => {
          tabList.onChange(value);
        }}
        {...stylex.props(styles.profileTabSelect)}
      >
        <Text
          type="label"
          color={isSelected ? 'primary' : 'secondary'}
          weight={isSelected ? 'medium' : undefined}
        >
          {label}
        </Text>
      </button>
      {isActive && (
        <Token label={getMessage('llmProfiles_active')} color="green" size="sm" />
      )}
      <IconButton
        label={getMessage('llmProfiles_delete')}
        tooltip={getMessage('llmProfiles_delete')}
        icon={<IconTrash />}
        variant="ghost"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      />
      <span aria-hidden="true" {...stylex.props(styles.profileTabIndicator)} />
    </HStack>
  );
};

interface LLMProfilesFieldListProps {
  label: string;
  description?: ReactNode;
  value: LLMTranslatorConfig;
  error?: string;
  onChange: (value: LLMTranslatorConfig) => void;
}

export const LLMProfilesFieldList: FC<LLMProfilesFieldListProps> = ({
  label,
  description,
  value,
  error,
  onChange,
}) => {
  const [preset, setPreset] = useState<LLMPresetId>('openai');
  const [selectedTab, setSelectedTab] = useState('0');
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});
  const currentValue = useRef(value);
  currentValue.current = value;

  const selectTab = useCallback((index: number) => {
    setSelectedTab(String(index));
  }, []);

  const nameErrors = useMemo(
    () => getLLMProfileNameErrors(value.profiles),
    [value.profiles],
  );
  const localError = nameErrors.find((nameError) => nameError !== undefined) ?? null;

  const clearRowState = useCallback((index: number) => {
    setRowStates((currentStates) => {
      if (!(index in currentStates)) return currentStates;

      const nextStates = { ...currentStates };
      delete nextStates[index];
      return nextStates;
    });
  }, []);

  const patchProfile = useCallback(
    (index: number, patch: Partial<LLMProfile>) => {
      const profile = value.profiles[index];
      if (profile === undefined) return;

      const nextProfile = { ...profile, ...patch };
      const profiles = value.profiles.map((currentProfile, currentIndex) =>
        currentIndex === index ? nextProfile : currentProfile,
      );
      const activeProfile =
        patch.name !== undefined && value.activeProfile === profile.name
          ? patch.name
          : value.activeProfile;

      clearRowState(index);
      onChange({ activeProfile, profiles });
    },
    [clearRowState, onChange, value],
  );

  const addFromPreset = useCallback(() => {
    const selectedPreset = llmProviderPresets[preset];
    const profile: LLMProfile = {
      ...selectedPreset,
      name: makeUniqueProfileName(
        selectedPreset.name,
        value.profiles.map(({ name }) => name),
      ),
    };
    const profiles = [...value.profiles, profile];
    const activeProfile = value.profiles.some(({ name }) => name === value.activeProfile)
      ? value.activeProfile
      : profile.name;

    selectTab(profiles.length - 1);
    onChange({ activeProfile, profiles });
  }, [onChange, preset, selectTab, value]);

  const deleteProfile = useCallback(
    (index: number) => {
      const profile = value.profiles[index];
      if (profile === undefined) return;

      const isConfirmed = confirm(
        getMessage('llmProfiles_deleteConfirm', [profile.name]),
      );
      if (!isConfirmed) return;

      const profiles = value.profiles.filter((_, profileIndex) => profileIndex !== index);
      const activeProfile = profiles.some(({ name }) => name === value.activeProfile)
        ? value.activeProfile
        : (profiles[0]?.name ?? '');

      setRowStates({});
      selectTab(Math.min(index, profiles.length - 1));
      onChange({ activeProfile, profiles });
    },
    [onChange, selectTab, value],
  );

  const setActiveProfile = useCallback(
    (name: string) => {
      onChange({ ...value, activeProfile: name });
    },
    [onChange, value],
  );

  const fetchModels = useCallback((profile: LLMProfile, index: number) => {
    const signature = JSON.stringify(profile);
    setRowStates((currentStates) => ({
      ...currentStates,
      [index]: {
        ...currentStates[index],
        modelsBusy: true,
        modelsStatus: undefined,
      },
    }));

    fetchLLMModels(profile)
      .then((models) => {
        if (JSON.stringify(currentValue.current.profiles[index]) !== signature) return;

        setRowStates((currentStates) => ({
          ...currentStates,
          [index]: {
            ...currentStates[index],
            models: models.length === 0 ? undefined : models,
            modelsStatus: {
              type: models.length === 0 ? 'warning' : 'success',
              message: getMessage(
                models.length === 0
                  ? 'settings_message_llmTranslator_modelsEmpty'
                  : 'settings_message_llmTranslator_modelsLoaded',
              ),
            },
          },
        }));
      })
      .catch((error: unknown) => {
        if (JSON.stringify(currentValue.current.profiles[index]) !== signature) return;

        setRowStates((currentStates) => ({
          ...currentStates,
          [index]: {
            ...currentStates[index],
            modelsStatus: { type: 'error', message: errorMessageOf(error) },
          },
        }));
      })
      .finally(() => {
        if (JSON.stringify(currentValue.current.profiles[index]) !== signature) return;

        setRowStates((currentStates) => ({
          ...currentStates,
          [index]: { ...currentStates[index], modelsBusy: false },
        }));
      });
  }, []);

  const testProfile = useCallback((profile: LLMProfile, index: number) => {
    const signature = JSON.stringify(profile);
    setRowStates((currentStates) => ({
      ...currentStates,
      [index]: {
        ...currentStates[index],
        testBusy: true,
        testStatus: undefined,
      },
    }));

    testLLMTranslator(profile)
      .then((translatedText) => {
        if (JSON.stringify(currentValue.current.profiles[index]) !== signature) return;

        setRowStates((currentStates) => ({
          ...currentStates,
          [index]: {
            ...currentStates[index],
            testStatus: {
              type: 'success',
              message: `${getMessage('settings_message_llmTranslator_testSuccess')} "${translatedText}"`,
            },
          },
        }));
      })
      .catch((error: unknown) => {
        if (JSON.stringify(currentValue.current.profiles[index]) !== signature) return;

        setRowStates((currentStates) => ({
          ...currentStates,
          [index]: {
            ...currentStates[index],
            testStatus: { type: 'error', message: errorMessageOf(error) },
          },
        }));
      })
      .finally(() => {
        if (JSON.stringify(currentValue.current.profiles[index]) !== signature) return;

        setRowStates((currentStates) => ({
          ...currentStates,
          [index]: { ...currentStates[index], testBusy: false },
        }));
      });
  }, []);

  const profileCount = value.profiles.length;
  const selectedProfileIndex = Math.min(Number(selectedTab), profileCount - 1);
  const selectedProfile = value.profiles[selectedProfileIndex];
  const selectedRowState =
    selectedProfileIndex >= 0 ? rowStates[selectedProfileIndex] : undefined;
  const selectedNameError =
    selectedProfileIndex >= 0 ? nameErrors[selectedProfileIndex] : undefined;
  const selectedIsActive =
    selectedProfile !== undefined && selectedProfile.name === value.activeProfile;

  return (
    <VStack gap={3} width="100%">
      <VStack gap={1}>
        <Heading level={4} textWrap="balance">
          {label}
        </Heading>
        {description !== undefined && (
          <Text as="p" color="secondary" textWrap="pretty">
            {description}
          </Text>
        )}
      </VStack>

      {error !== undefined && error !== localError && (
        <Banner status="error" title={error} container="section" />
      )}

      <TabList
        value={selectedProfile === undefined ? '' : String(selectedProfileIndex)}
        onChange={(selectedValue) => {
          const index = Number(selectedValue);
          if (index < value.profiles.length) selectTab(index);
        }}
        aria-label={label}
        hasDivider
      >
        {value.profiles.map((profile, index) => (
          <ProfileTab
            key={index}
            value={String(index)}
            label={profile.name.trim() || providerLabels[profile.provider]}
            isActive={profile.name === value.activeProfile}
            onDelete={() => {
              deleteProfile(index);
            }}
          />
        ))}
        <InputGroupAction
          label={getMessage('llmProfiles_addProvider')}
          isLabelHidden
          control={
            <Selector
              label={getMessage('llmProfiles_addProvider')}
              options={presetOptions}
              value={preset}
              variant="ghost"
              size="sm"
              onChange={(nextPreset) => {
                if (isLLMPreset(nextPreset)) setPreset(nextPreset);
              }}
            />
          }
          action={
            <IconButton
              label={getMessage('llmProfiles_add')}
              tooltip={getMessage('llmProfiles_add')}
              icon={<IconPlus />}
              variant="secondary"
              size="sm"
              onClick={addFromPreset}
            />
          }
        />
      </TabList>

      {profileCount === 0 || selectedProfile === undefined ? (
        <EmptyState
          isCompact
          headingLevel={5}
          title={getMessage('llmProfiles_emptyList')}
        />
      ) : (
        <VStack gap={3} width="100%">
          <HStack gap={2} align="center" justify="end" wrap="wrap">
            {!selectedIsActive && (
              <Button
                onPress={() => {
                  setActiveProfile(selectedProfile.name);
                }}
              >
                {getMessage('llmProfiles_setActive')}
              </Button>
            )}
          </HStack>

          <HStack gap={2} align="end" wrap="wrap" width="100%">
            <StackItem size="fill" xstyle={styles.wideFieldItem}>
              <Textinput
                label={getMessage('llmProfiles_profileName')}
                value={selectedProfile.name}
                width="100%"
                status={
                  selectedNameError === undefined
                    ? undefined
                    : { type: 'error', message: selectedNameError }
                }
                onInputText={(name) => {
                  patchProfile(selectedProfileIndex, { name });
                }}
              />
            </StackItem>
            <StackItem size="fill" xstyle={styles.fieldItem}>
              <Selector
                label={getMessage('llmProfiles_provider')}
                options={providerOptions}
                value={selectedProfile.provider}
                width="100%"
                onChange={(provider) => {
                  if (isLLMProvider(provider)) {
                    patchProfile(selectedProfileIndex, { provider });
                  }
                }}
              />
            </StackItem>
          </HStack>

          <HStack gap={2} align="start" wrap="wrap" width="100%">
            <StackItem size="fill" xstyle={styles.wideFieldItem}>
              <Textinput
                label={getMessage('settings_option_llmTranslator_apiUrl')}
                value={selectedProfile.apiUrl}
                width="100%"
                spellCheck={false}
                onInputText={(apiUrl) => {
                  patchProfile(selectedProfileIndex, { apiUrl });
                }}
              />
            </StackItem>
            <StackItem size="fill" xstyle={styles.fieldItem}>
              <InputGroupAction
                label={getMessage('settings_option_llmTranslator_apiKey')}
                control={
                  <Textinput
                    label={getMessage('settings_option_llmTranslator_apiKey')}
                    type="password"
                    value={selectedProfile.apiKey}
                    width="100%"
                    spellCheck={false}
                    status={selectedRowState?.testStatus}
                    onInputText={(apiKey) => {
                      patchProfile(selectedProfileIndex, { apiKey });
                    }}
                  />
                }
                action={
                  <IconButton
                    label={getMessage('settings_option_llmTranslator_testButton')}
                    tooltip={getMessage('settings_option_llmTranslator_testButton')}
                    icon={<IconPlugConnected />}
                    variant="secondary"
                    isDisabled={selectedRowState?.testBusy}
                    onClick={() => {
                      testProfile(selectedProfile, selectedProfileIndex);
                    }}
                  />
                }
              />
            </StackItem>
          </HStack>

          <HStack gap={2} align="end" wrap="wrap" width="100%">
            <StackItem size="fill" xstyle={styles.wideFieldItem}>
              <InputGroupAction
                label={getMessage('settings_option_llmTranslator_model')}
                control={
                  selectedRowState?.models === undefined ? (
                    <Textinput
                      label={getMessage('settings_option_llmTranslator_model')}
                      value={selectedProfile.model}
                      width="100%"
                      spellCheck={false}
                      status={selectedRowState?.modelsStatus}
                      onInputText={(model) => {
                        patchProfile(selectedProfileIndex, { model });
                      }}
                    />
                  ) : (
                    <Selector
                      label={getMessage('settings_option_llmTranslator_model')}
                      options={selectedRowState.models.map((model) => ({
                        value: model,
                        label: model,
                      }))}
                      value={selectedProfile.model}
                      width="100%"
                      status={selectedRowState.modelsStatus}
                      onChange={(model) => {
                        patchProfile(selectedProfileIndex, { model });
                      }}
                    />
                  )
                }
                action={
                  <IconButton
                    label={getMessage('settings_option_llmTranslator_fetchModelsButton')}
                    tooltip={getMessage(
                      'settings_option_llmTranslator_fetchModelsButton',
                    )}
                    icon={<IconListSearch />}
                    variant="secondary"
                    isDisabled={selectedRowState?.modelsBusy}
                    onClick={() => {
                      fetchModels(selectedProfile, selectedProfileIndex);
                    }}
                  />
                }
              />
            </StackItem>
          </HStack>
        </VStack>
      )}
    </VStack>
  );
};
