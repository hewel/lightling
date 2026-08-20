import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AstryxProvider } from '@/components/providers/AstryxProvider';
import type {
  LLMProfile,
  LLMTranslatorConfig,
} from '@/lib/translators/llm/LLMTranslator';
import type { LLMModelInfo } from '@/lib/translators/llm/modelInfo';

import {
  getLLMProfilesError,
  LLMProfilesFieldList,
  normalizeLLMTranslatorConfig,
} from './LLMProfilesFieldList';

const apiMocks = vi.hoisted(() => ({
  fetchLLMModels: vi.fn(),
  testLLMTranslator: vi.fn(),
}));

vi.mock('@/lib/translators/llm/api', () => apiMocks);
vi.mock('@/lib/language', () => ({
  getMessage: (name: string, substitutions?: string | string[]) =>
    substitutions === undefined
      ? name
      : `${name}:${Array.isArray(substitutions) ? substitutions.join(',') : substitutions}`,
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const autoExecution = {
  contextWindowTokens: null,
  preferredInputTokens: null,
  maxOutputTokens: null,
  maxConcurrentRequests: null,
} as const;

const makeModelInfo = (
  id: string,
  displayName = id,
  maxOutputTokens: number | null = null,
): LLMModelInfo => ({
  id,
  displayName,
  contextWindowTokens: null,
  maxInputTokens: null,
  maxOutputTokens,
  supportedParameters: null,
  contextWindowSource: null,
  maxInputSource: null,
  maxOutputSource: null,
});

const openAIProfile = (name = 'OpenAI'): LLMProfile => ({
  name,
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'secret',
  model: 'gpt-4o-mini',
  ...autoExecution,
});

const customProfile = (name = 'Local'): LLMProfile => ({
  name,
  provider: 'openai-compatible',
  apiUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'local-model',
  ...autoExecution,
});

describe('LLMProfilesFieldList', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    apiMocks.fetchLLMModels.mockReset();
    apiMocks.testLLMTranslator.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(initialValue: LLMTranslatorConfig) {
    const onChange = vi.fn();

    function Harness(): ReactNode {
      const [value, setValue] = useState(initialValue);
      return (
        <AstryxProvider>
          <LLMProfilesFieldList
            label="LLM providers"
            description="Edit provider profiles"
            value={value}
            onChange={(nextValue) => {
              onChange(nextValue);
              setValue(nextValue);
            }}
          />
        </AstryxProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    return onChange;
  }

  function findInput(labelText: string, index = 0): HTMLInputElement {
    const labels = Array.from(
      container.querySelectorAll<HTMLLabelElement>('label'),
    ).filter((label) => label.textContent?.trim() === labelText);
    const label = labels[index];
    if (label === undefined) throw new Error(`Expected label "${labelText}"`);

    const input = document.getElementById(label.htmlFor);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Expected input for label "${labelText}"`);
    }
    return input;
  }

  function findAction(label: string): HTMLButtonElement {
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label]'),
    ).find((button) => button.getAttribute('aria-label') === label);
    if (button === undefined) throw new Error(`Expected action "${label}"`);
    return button;
  }

  function findCollapsibleTrigger(): HTMLButtonElement {
    const trigger = container.querySelector('.astryx-collapsible-trigger');
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('Expected collapsible trigger');
    }
    return trigger;
  }

  async function inputText(input: HTMLInputElement, value: string) {
    const valueDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    if (valueDescriptor?.set === undefined) {
      throw new Error('Expected native input value setter');
    }

    await act(async () => {
      valueDescriptor.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function findClearButton(input: HTMLInputElement): HTMLButtonElement {
    const field = input.closest('.astryx-field');
    const button = field?.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected clear button');
    }
    return button;
  }

  async function clearInput(input: HTMLInputElement) {
    await act(async () => findClearButton(input).click());
  }

  it('renders provider tabs with the selected profile editor', async () => {
    const onChange = await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile(), customProfile()],
    });

    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('nav')?.classList.contains('astryx-tab-list')).toBe(
      true,
    );
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('nav button[role="tab"]'),
      ).map((button) => button.textContent),
    ).toEqual(['OpenAI', 'Local']);
    expect(
      container.querySelector('nav button[role="tab"]')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(container.textContent).toContain('OpenAI');
    expect(container.textContent).toContain('Local');
    expect(
      Array.from(container.querySelectorAll('label')).filter(
        (label) => label.textContent?.trim() === 'llmProfiles_profileName',
      ),
    ).toHaveLength(1);
    expect(findInput('llmProfiles_profileName').value).toBe('OpenAI');

    await inputText(findInput('llmProfiles_profileName'), 'Primary');

    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'Primary',
      profiles: [openAIProfile('Primary'), customProfile()],
    });
  });

  it('switches the editor fields with the selected tab', async () => {
    await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile(), customProfile()],
    });

    const localTab = container.querySelector<HTMLButtonElement>(
      'nav .astryx-tab[data-tab-value="1"] button[role="tab"]',
    );
    if (localTab === null) throw new Error('Expected Local tab');

    await act(async () => localTab.click());

    expect(findInput('llmProfiles_profileName').value).toBe('Local');
    expect(findInput('settings_option_llmTranslator_apiUrl').value).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('sizes fields through layout wrappers instead of stretching field shells', async () => {
    await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile()],
    });
    for (const label of [
      'llmProfiles_profileName',
      'settings_option_llmTranslator_apiUrl',
    ]) {
      const field = findInput(label).closest('.astryx-field');
      expect(field?.parentElement?.classList.contains('astryx-stack-item')).toBe(true);
    }

    for (const input of container.querySelectorAll('.astryx-input-group input')) {
      const group = input.closest('.astryx-input-group');
      expect(
        group?.closest('.astryx-stack-item') !== null ||
          group?.parentElement?.classList.contains('astryx-stack-item'),
      ).toBe(true);
    }
  });

  it('appends a preset inline and makes the first profile active', async () => {
    const onChange = await render({ activeProfile: '', profiles: [] });

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="llmProfiles_add"]',
    );
    if (addButton === null) throw new Error('Expected add action');
    await act(async () => addButton.click());

    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [
        {
          name: 'OpenAI',
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          ...autoExecution,
        },
      ],
    });
    expect(findInput('llmProfiles_profileName').value).toBe('OpenAI');
    expect(
      container.querySelector('nav button[role="tab"]')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('deletes inline rows from tab labels and moves the active selection', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const onChange = await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile(), customProfile()],
    });

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'nav .astryx-tab[data-tab-value="0"] button[aria-label="llmProfiles_delete"]',
    );
    if (deleteButton === null) throw new Error('Expected delete button');
    await act(async () => deleteButton.click());

    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'Local',
      profiles: [customProfile()],
    });
    expect(
      container.querySelector('nav button[role="tab"]')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('keeps model discovery and connection tests available per row', async () => {
    apiMocks.fetchLLMModels.mockResolvedValue([makeModelInfo('gpt-next')]);
    apiMocks.testLLMTranslator.mockResolvedValue('Hola');
    const profile = openAIProfile();
    await render({ activeProfile: profile.name, profiles: [profile] });

    const fetchModelsAction = findAction(
      'settings_option_llmTranslator_fetchModelsButton',
    );
    const testAction = findAction('settings_option_llmTranslator_testButton');

    expect(
      fetchModelsAction.parentElement?.classList.contains('astryx-input-group'),
    ).toBe(true);
    expect(testAction.parentElement?.classList.contains('astryx-input-group')).toBe(true);

    await act(async () => {
      fetchModelsAction.click();
      await Promise.resolve();
    });
    await act(async () => {
      testAction.click();
      await Promise.resolve();
    });

    expect(apiMocks.fetchLLMModels).toHaveBeenCalledWith(profile);
    expect(apiMocks.testLLMTranslator).toHaveBeenCalledWith(profile);
  });

  it('renders fetched models as a selector with id values and displayName labels', async () => {
    apiMocks.fetchLLMModels.mockResolvedValue([
      makeModelInfo('gpt-next', 'GPT Next'),
      makeModelInfo('gpt-4o', 'GPT-4o'),
    ]);
    const profile = openAIProfile();
    profile.model = 'gpt-next';
    await render({ activeProfile: profile.name, profiles: [profile] });

    const fetchModelsAction = findAction(
      'settings_option_llmTranslator_fetchModelsButton',
    );
    await act(async () => {
      fetchModelsAction.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('GPT Next');
    expect(container.textContent).not.toContain('gpt-next');
  });

  it('toggles the advanced execution collapsible', async () => {
    await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile()],
    });

    const trigger = findCollapsibleTrigger();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('patches valid execution overrides and ignores invalid drafts', async () => {
    const onChange = await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile()],
    });

    await act(async () => findCollapsibleTrigger().click());

    const concurrencyInput = findInput('llmProfiles_maxConcurrentRequests');
    onChange.mockClear();
    await inputText(concurrencyInput, '2');
    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [{ ...openAIProfile(), maxConcurrentRequests: 2 }],
    });

    onChange.mockClear();
    await inputText(concurrencyInput, '0');
    expect(onChange).not.toHaveBeenCalled();

    onChange.mockClear();
    await inputText(concurrencyInput, '9');
    expect(onChange).not.toHaveBeenCalled();

    onChange.mockClear();
    await inputText(concurrencyInput, '1.5');
    expect(onChange).not.toHaveBeenCalled();

    const contextInput = findInput('llmProfiles_contextWindowTokens');
    onChange.mockClear();
    await inputText(contextInput, '511');
    expect(onChange).not.toHaveBeenCalled();

    onChange.mockClear();
    await inputText(contextInput, '1024');
    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [
        { ...openAIProfile(), maxConcurrentRequests: 2, contextWindowTokens: 1024 },
      ],
    });
  });

  it('clears an execution override to null', async () => {
    const profile = openAIProfile();
    profile.maxConcurrentRequests = 2;
    const onChange = await render({
      activeProfile: 'OpenAI',
      profiles: [profile],
    });

    await act(async () => findCollapsibleTrigger().click());

    const concurrencyInput = findInput('llmProfiles_maxConcurrentRequests');
    onChange.mockClear();
    await clearInput(concurrencyInput);
    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [{ ...openAIProfile(), maxConcurrentRequests: null }],
    });
  });

  it('preserves fetched models and model status when editing model or overrides, but clears test status', async () => {
    apiMocks.fetchLLMModels.mockResolvedValue([
      makeModelInfo('gpt-next', 'GPT Next'),
      makeModelInfo('gpt-4o', 'GPT-4o'),
    ]);
    apiMocks.testLLMTranslator.mockResolvedValue('Hola');
    const profile = openAIProfile();
    profile.model = 'gpt-next';
    const onChange = await render({
      activeProfile: profile.name,
      profiles: [profile],
    });

    const fetchModelsAction = findAction(
      'settings_option_llmTranslator_fetchModelsButton',
    );
    const testAction = findAction('settings_option_llmTranslator_testButton');

    await act(async () => {
      fetchModelsAction.click();
      await Promise.resolve();
    });
    await act(async () => {
      testAction.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'settings_message_llmTranslator_modelsLoaded',
    );
    expect(container.textContent).toContain(
      'settings_message_llmTranslator_testSuccess "Hola"',
    );

    const modelSelectorTrigger = container.querySelector<HTMLButtonElement>(
      '.astryx-selector button',
    );
    if (modelSelectorTrigger === null) throw new Error('Expected model selector');
    await act(async () => {
      modelSelectorTrigger.click();
      await Promise.resolve();
    });

    const option = Array.from(
      document.body.querySelectorAll<HTMLDivElement>('[role="option"]'),
    ).find((el) => el.textContent?.trim() === 'GPT-4o');
    if (option === undefined) throw new Error('Expected GPT-4o option');
    await act(async () => option.click());

    expect(container.textContent).toContain(
      'settings_message_llmTranslator_modelsLoaded',
    );
    expect(container.textContent).not.toContain(
      'settings_message_llmTranslator_testSuccess "Hola"',
    );
    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [{ ...openAIProfile(), model: 'gpt-4o' }],
    });

    await act(async () => {
      testAction.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      'settings_message_llmTranslator_testSuccess "Hola"',
    );

    await act(async () => findCollapsibleTrigger().click());
    const concurrencyInput = findInput('llmProfiles_maxConcurrentRequests');
    await inputText(concurrencyInput, '3');

    expect(container.textContent).toContain(
      'settings_message_llmTranslator_modelsLoaded',
    );
    expect(container.textContent).not.toContain(
      'settings_message_llmTranslator_testSuccess "Hola"',
    );
  });

  it('clears fetched models and statuses when discovery identity changes and ignores stale fetch results', async () => {
    const deferred: {
      resolve: (models: LLMModelInfo[]) => void;
      reject: (error: unknown) => void;
    } = { resolve: () => {}, reject: () => {} };
    const promise = new Promise<LLMModelInfo[]>((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    apiMocks.fetchLLMModels.mockReturnValue(promise);
    const profile = openAIProfile();
    profile.model = 'gpt-next';
    const onChange = await render({
      activeProfile: profile.name,
      profiles: [profile],
    });

    const fetchModelsAction = findAction(
      'settings_option_llmTranslator_fetchModelsButton',
    );
    await act(async () => fetchModelsAction.click());

    const apiUrlInput = findInput('settings_option_llmTranslator_apiUrl');
    await inputText(apiUrlInput, 'https://api.openai.com/v2');

    deferred.resolve([makeModelInfo('gpt-next', 'GPT Next')]);
    await act(async () => Promise.resolve());

    expect(container.textContent).not.toContain(
      'settings_message_llmTranslator_modelsLoaded',
    );
    const modelField = Array.from(container.querySelectorAll('.astryx-field')).find(
      (field) => field.textContent?.includes('settings_option_llmTranslator_model'),
    );
    expect(modelField?.querySelector('input')).not.toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [
        { ...openAIProfile(), model: 'gpt-next', apiUrl: 'https://api.openai.com/v2' },
      ],
    });
  });

  it('shows auto output descriptions for uncapped and detected caps', async () => {
    apiMocks.fetchLLMModels.mockResolvedValue([
      makeModelInfo('gpt-next', 'GPT Next', 1024),
      makeModelInfo('gpt-4o', 'GPT-4o'),
    ]);
    const profile = openAIProfile();
    profile.model = 'gpt-next';
    profile.maxOutputTokens = null;
    await render({
      activeProfile: profile.name,
      profiles: [profile],
    });

    const fetchModelsAction = findAction(
      'settings_option_llmTranslator_fetchModelsButton',
    );
    await act(async () => {
      fetchModelsAction.click();
      await Promise.resolve();
    });

    await act(async () => findCollapsibleTrigger().click());

    expect(container.textContent).toContain(
      'llmProfiles_maxOutputTokens_desc:llmProfiles_outputAutoDetected:1024',
    );

    const modelSelectorTrigger = container.querySelector<HTMLButtonElement>(
      '.astryx-selector button',
    );
    if (modelSelectorTrigger === null) throw new Error('Expected model selector');
    await act(async () => {
      modelSelectorTrigger.click();
      await Promise.resolve();
    });

    const option = Array.from(
      document.body.querySelectorAll<HTMLDivElement>('[role="option"]'),
    ).find((el) => el.textContent?.trim() === 'GPT-4o');
    if (option === undefined) throw new Error('Expected GPT-4o option');
    await act(async () => option.click());

    expect(container.textContent).toContain(
      'llmProfiles_maxOutputTokens_desc:llmProfiles_outputAutoUncapped',
    );
  });

  it('keeps advanced execution fields inside stack items without nested field shells', async () => {
    await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile()],
    });

    await act(async () => findCollapsibleTrigger().click());

    for (const label of [
      'llmProfiles_contextWindowTokens',
      'llmProfiles_preferredInputTokens',
      'llmProfiles_maxOutputTokens',
      'llmProfiles_maxConcurrentRequests',
    ]) {
      const field = findInput(label).closest('.astryx-field');
      expect(field?.parentElement?.classList.contains('astryx-stack-item')).toBe(true);
    }
  });
});

describe('LLM profile validation', () => {
  it('rejects blank and duplicate names', () => {
    expect(getLLMProfilesError([openAIProfile('   ')])).toBe('llmProfiles_emptyName');
    expect(getLLMProfilesError([openAIProfile('Same'), customProfile(' Same ')])).toBe(
      'llmProfiles_duplicateName',
    );
  });

  it('normalizes names and the active profile before persistence', () => {
    expect(
      normalizeLLMTranslatorConfig({
        activeProfile: ' Primary ',
        profiles: [openAIProfile(' Primary ')],
      }),
    ).toEqual({
      activeProfile: 'Primary',
      profiles: [openAIProfile('Primary')],
    });
  });
});
