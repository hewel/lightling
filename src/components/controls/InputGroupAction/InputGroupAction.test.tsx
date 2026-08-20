import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { IconPlus } from '@tabler/icons-react';

import { AstryxProvider } from '@/components/providers/AstryxProvider';

import { InputGroupAction } from './InputGroupAction';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('InputGroupAction', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
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

  it('joins a selector and action into one accessible field group', async () => {
    const onAction = vi.fn();

    function Harness(): ReactNode {
      const [value, setValue] = useState('openai');
      return (
        <InputGroupAction
          label="Add provider"
          control={
            <Selector
              label="Provider preset"
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'custom', label: 'Custom' },
              ]}
              value={value}
              variant="ghost"
              onChange={setValue}
            />
          }
          action={
            <IconButton
              label="Add"
              tooltip="Add"
              icon={<IconPlus />}
              variant="secondary"
              onClick={onAction}
            />
          }
        />
      );
    }

    await render(<Harness />);

    expect(container.querySelector('.astryx-input-group')).not.toBeNull();
    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(container.querySelector('.astryx-selector')).not.toBeNull();

    const group = container.querySelector('.astryx-input-group');
    const action = container.querySelector('button[aria-label="Add"]');
    expect(action?.parentElement).toBe(group);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Add"]')?.click();
    });

    expect(onAction).toHaveBeenCalledOnce();
  });

  it('focuses the control when the group label is clicked', async () => {
    await render(
      <InputGroupAction
        label="Add provider"
        control={
          <Selector
            label="Provider preset"
            options={[{ value: 'openai', label: 'OpenAI' }]}
            value="openai"
            variant="ghost"
            onChange={() => undefined}
          />
        }
        action={
          <IconButton label="Add" tooltip="Add" icon={<IconPlus />} variant="secondary" />
        }
      />,
    );

    const groupLabel = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent?.trim() === 'Add provider',
    );
    if (groupLabel === undefined) throw new Error('Expected group label');

    await act(async () => groupLabel.click());

    expect(document.activeElement).toBe(container.querySelector('[role="combobox"]'));
  });
});
