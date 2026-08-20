import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Mock } from 'vitest';

import { AstryxProvider } from '@/components/providers/AstryxProvider';
import type { AppConfigType } from '@/types/runtime';

import { type OptionsGroup, OptionsTree } from './OptionsTree';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const tree: OptionsGroup[] = [
  {
    title: 'Field specification',
    groupContent: [
      {
        description: 'Reuse the latest language selection.',
        path: 'test.checkbox',
        optionContent: { type: 'Checkbox', text: 'Remember text language' },
      },
      {
        title: 'Shortcut',
        description: 'Keyboard shortcut used to translate the page.',
        path: 'test.hotkey',
        optionContent: { type: 'Hotkey' },
      },
      {
        title: 'Modifier keys',
        path: 'test.group',
        optionContent: {
          type: 'CheckboxGroup',
          valueMap: ['ctrlKey', 'altKey'],
          options: [
            { type: 'Checkbox', text: 'Control' },
            { type: 'Checkbox', text: 'Alt' },
          ],
        },
      },
      {
        title: 'Manage translators',
        optionContent: {
          type: 'Button',
          text: 'Manage',
          action: () => undefined,
        },
      },
      {
        title: 'Excluded selectors',
        path: 'test.multiline',
        optionContent: { type: 'InputMultilineFromArray' },
      },
      {
        title: 'Retry limit',
        path: 'test.number',
        optionContent: { type: 'InputNumber', min: 0, isIntegerOnly: true },
      },
      {
        title: 'Profile name',
        path: 'test.text',
        optionContent: { type: 'InputText' },
      },
      {
        title: 'Translation mode',
        path: 'test.select',
        optionContent: {
          type: 'SelectList',
          options: [
            { id: 'popup', content: 'Popup' },
            { id: 'inline', content: 'Inline' },
          ],
        },
      },
    ],
  },
];

const config = {
  test: {
    checkbox: false,
    group: ['ctrlKey'],
    hotkey: 'Control+KeyL',
    multiline: ['.notranslate'],
    number: 3,
    select: 'popup',
    text: 'Default',
  },
} as unknown as AppConfigType;

describe('OptionsTree field specification', () => {
  let container: HTMLDivElement;
  let root: Root;
  let setOptionValue: Mock;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    setOptionValue = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(children: ReactNode) {
    await act(async () => {
      root.render(<AstryxProvider>{children}</AstryxProvider>);
    });
  }

  function findFieldLabel(text: string): HTMLElement {
    const label = Array.from(
      container.querySelectorAll<HTMLElement>('.astryx-field-label'),
    ).find((candidate) => candidate.textContent?.trim() === text);
    if (label === undefined) throw new Error(`Expected field label "${text}"`);
    return label;
  }

  beforeEach(async () => {
    await render(
      <OptionsTree
        tree={tree}
        config={config}
        modifiedConfig={null}
        setOptionValue={setOptionValue}
      />,
    );
  });

  it('uses each Astryx field owner without nesting Field shells', () => {
    for (const label of [
      'Remember text language',
      'Shortcut',
      'Modifier keys',
      'Manage translators',
      'Excluded selectors',
      'Retry limit',
      'Profile name',
      'Translation mode',
    ]) {
      expect(findFieldLabel(label)).toBeTruthy();
    }

    expect(container.querySelector('.astryx-field .astryx-field')).toBeNull();
  });

  it('keeps native label activation for Astryx checkbox fields', async () => {
    const label = findFieldLabel('Remember text language');
    expect(label.tagName).toBe('LABEL');

    await act(async () => label.click());

    expect(setOptionValue).toHaveBeenCalledWith('test.checkbox', true);
  });

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

  it('does not apply negative or fractional drafts to a constrained number option', async () => {
    const numberLabel = findFieldLabel('Retry limit') as HTMLLabelElement;
    const numberInput = document.getElementById(numberLabel.htmlFor);
    if (!(numberInput instanceof HTMLInputElement)) {
      throw new Error('Expected the number input associated with its Field label');
    }

    await inputText(numberInput, '-1');
    await inputText(numberInput, '1.5');
    expect(setOptionValue).not.toHaveBeenCalled();

    await inputText(numberInput, '4');
    expect(setOptionValue).toHaveBeenCalledWith('test.number', 4);
  });

  it('associates standard and custom Field labels with their controls', () => {
    const numberLabel = findFieldLabel('Retry limit') as HTMLLabelElement;
    const numberInput = document.getElementById(numberLabel.htmlFor);
    if (!(numberInput instanceof HTMLInputElement)) {
      throw new Error('Expected the number input associated with its Field label');
    }
    expect(numberLabel.htmlFor).toBe(numberInput.id);

    const buttonLabel = findFieldLabel('Manage translators') as HTMLLabelElement;
    const button = document.getElementById(buttonLabel.htmlFor);
    expect(buttonLabel.htmlFor).toBe(button?.id);
    expect(button?.classList.contains('astryx-button')).toBe(true);
  });
});
