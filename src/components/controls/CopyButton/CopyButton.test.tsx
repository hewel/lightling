import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Mock } from 'vitest';

import { AstryxProvider } from '@/components/providers/AstryxProvider';

import { CopyButton } from './CopyButton';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('CopyButton', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: Mock;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

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

  it('copies the text to the clipboard on click', async () => {
    await render(<CopyButton text="hola" />);

    const button = container.querySelector('button');
    if (button === null) throw new Error('Expected Astryx icon button to render');

    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith('hola');
  });

  it('stays disabled and never copies when text is null', async () => {
    await render(<CopyButton text={null} />);

    const button = container.querySelector('button');
    if (button === null) throw new Error('Expected Astryx icon button to render');

    expect(button.getAttribute('aria-disabled')).toBe('true');
    await act(async () => button.click());
    expect(writeText).not.toHaveBeenCalled();
  });
});
