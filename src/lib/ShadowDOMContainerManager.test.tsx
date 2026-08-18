import { act } from 'react';

import {
  resolveExtensionAssetUrl,
  ShadowDOMContainerManager,
} from './ShadowDOMContainerManager';

// Force the production code path: in the extension build this module is a URL
// that gets fetched at runtime, not inlined CSS. The bundler prepends a
// publicPath that falls back to "/" in content scripts.
vi.mock('../content-shadow.css.txt', () => ({
  default: '/assets/content-shadow.css.txt',
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const observeShadowRoots = () => {
  const roots: ShadowRoot[] = [];
  // oxlint-disable-next-line typescript/unbound-method
  const originalAttachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const shadowRoot = originalAttachShadow.call(this, init);
    roots.push(shadowRoot);
    return shadowRoot;
  });
  return roots;
};

describe('ShadowDOMContainerManager', () => {
  let manager: ShadowDOMContainerManager | undefined;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('.content {}', { status: 200 })),
    );
  });

  afterEach(async () => {
    await act(async () => manager?.unmountComponent());
    manager?.removeRootNode();
    manager = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mounts extension stylesheets inside the closed shadow root', async () => {
    const getURL = vi.spyOn(chrome.runtime, 'getURL');
    const shadowRoots = observeShadowRoots();

    manager = new ShadowDOMContainerManager({
      styles: ['content_scripts/content-0.css'],
    });
    manager.createRootNode();

    await act(async () => {
      manager?.mountComponent('Content');
      await Promise.resolve();
    });

    const stylesheet = shadowRoots[0]?.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"]',
    );
    expect(stylesheet?.href).toContain('content_scripts/content-0.css');
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull();

    // The bundled asset URL carries a leading "/" (webpack publicPath fallback
    // in content scripts); getURL must receive it normalized, without the slash.
    expect(getURL).toHaveBeenCalledWith('assets/content-shadow.css.txt');
  });

  it('still mounts when the shadow stylesheet fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shadowRoots = observeShadowRoots();

    manager = new ShadowDOMContainerManager({ styles: [] });
    manager.createRootNode();

    await act(async () => {
      manager?.mountComponent('Content');
      await Promise.resolve();
    });

    expect(shadowRoots[0]?.textContent).toContain('Content');
    expect(warn).toHaveBeenCalledOnce();

    // A failed mount must not cache the rejection: remounting stays quiet
    warn.mockClear();
    await act(async () => {
      manager?.mountComponent('Other content');
      await Promise.resolve();
    });

    expect(shadowRoots[0]?.textContent).toContain('Other content');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveExtensionAssetUrl', () => {
  it('passes absolute extension URLs through unchanged', () => {
    expect(
      resolveExtensionAssetUrl('chrome-extension://abc/assets/content-shadow.css.txt'),
    ).toBe('chrome-extension://abc/assets/content-shadow.css.txt');
  });

  it('strips the "/" publicPath fallback before resolving', () => {
    expect(resolveExtensionAssetUrl('/assets/content-shadow.css.txt')).toBe(
      chrome.runtime.getURL('assets/content-shadow.css.txt'),
    );
  });

  it('resolves plain relative paths via getURL', () => {
    expect(resolveExtensionAssetUrl('assets/content-shadow.css.txt')).toBe(
      chrome.runtime.getURL('assets/content-shadow.css.txt'),
    );
  });
});
