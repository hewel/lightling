import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useThemeName } from '@astryxdesign/core/theme';

import { AstryxShadowRootProvider } from './AstryxShadowRootProvider';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const ThemeNameProbe = () => <output>{useThemeName()}</output>;

describe('AstryxShadowRootProvider', () => {
  let container: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    const shadowRoot = host.attachShadow({ mode: 'closed' });
    container = document.createElement('div');
    shadowRoot.append(container);
    root = createRoot(container);
    document.documentElement.dataset.astryxTheme = 'host-theme';
    document.documentElement.dataset.theme = 'dark';
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    host.remove();
    document.documentElement.removeAttribute('data-astryx-theme');
    document.documentElement.removeAttribute('data-theme');
  });

  async function render(children: ReactNode) {
    await act(async () => {
      root.render(<AstryxShadowRootProvider>{children}</AstryxShadowRootProvider>);
    });
  }

  it('scopes vivid tokens without changing the host document theme', async () => {
    await render(<ThemeNameProbe />);

    const scope = container.querySelector<HTMLElement>('[data-astryx-theme="vivid"]');
    expect(scope).not.toBeNull();
    expect(scope?.style.getPropertyValue('--color-accent')).not.toBe('');
    expect(scope?.style.getPropertyValue('--spacing-2')).not.toBe('');
    expect(scope?.style.getPropertyValue('--size-element-md')).not.toBe('');
    expect(scope?.style.getPropertyValue('--focus-outline-offset')).not.toBe('');
    expect(scope?.style.getPropertyValue('--ease-standard')).not.toBe('');
    expect(scope?.querySelector('output')?.textContent).toBe('vivid');
    expect(document.documentElement.dataset.astryxTheme).toBe('host-theme');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await act(async () => root.unmount());
    expect(document.documentElement.dataset.astryxTheme).toBe('host-theme');
    expect(document.documentElement.dataset.theme).toBe('dark');

    root = createRoot(container);
  });
});
