import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AstryxProvider } from '@/components/providers/AstryxProvider';
import type {
  LLMProfile,
  LLMTranslatorConfig,
} from '@/lib/translators/llm/LLMTranslator';

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

const openAIProfile = (name = 'OpenAI'): LLMProfile => ({
  name,
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'secret',
  model: 'gpt-4o-mini',
});

const customProfile = (name = 'Local'): LLMProfile => ({
  name,
  provider: 'openai-compatible',
  apiUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'local-model',
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

  function findButton(label: string, index = 0): HTMLButtonElement {
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).filter((button) => button.textContent?.trim() === label);
    const button = buttons[index];
    if (button === undefined) throw new Error(`Expected button "${label}"`);
    return button;
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
        container.querySelectorAll<HTMLButtonElement>('nav button[data-tab-value]'),
      ).map((button) => button.dataset.tabValue),
    ).toEqual(['0', '1']);
    expect(
      container
        .querySelector('nav button[data-tab-value="0"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
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
      'nav button[data-tab-value="1"]',
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
      'settings_option_llmTranslator_apiKey',
      'settings_option_llmTranslator_model',
    ]) {
      const field = findInput(label).closest('.astryx-field');
      expect(field?.parentElement?.classList.contains('astryx-stack-item')).toBe(true);
    }
  });

  it('appends a preset inline and makes the first profile active', async () => {
    const onChange = await render({ activeProfile: '', profiles: [] });

    await act(async () => findButton('llmProfiles_add').click());

    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'OpenAI',
      profiles: [
        {
          name: 'OpenAI',
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
        },
      ],
    });
    expect(findInput('llmProfiles_profileName').value).toBe('OpenAI');
    expect(
      container
        .querySelector('nav button[data-tab-value="0"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
  });

  it('deletes inline rows and moves the active selection to the next profile', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const onChange = await render({
      activeProfile: 'OpenAI',
      profiles: [openAIProfile(), customProfile()],
    });

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="llmProfiles_delete"]',
    );
    if (deleteButton === null) throw new Error('Expected delete button');
    await act(async () => deleteButton.click());

    expect(onChange).toHaveBeenLastCalledWith({
      activeProfile: 'Local',
      profiles: [customProfile()],
    });
  });

  it('keeps model discovery and connection tests available per row', async () => {
    apiMocks.fetchLLMModels.mockResolvedValue(['gpt-next']);
    apiMocks.testLLMTranslator.mockResolvedValue('Hola');
    const profile = openAIProfile();
    await render({ activeProfile: profile.name, profiles: [profile] });

    await act(async () => {
      findButton('settings_option_llmTranslator_fetchModelsButton').click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton('settings_option_llmTranslator_testButton').click();
      await Promise.resolve();
    });

    expect(apiMocks.fetchLLMModels).toHaveBeenCalledWith(profile);
    expect(apiMocks.testLLMTranslator).toHaveBeenCalledWith(profile);
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
