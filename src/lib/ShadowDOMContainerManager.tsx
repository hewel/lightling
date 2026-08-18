import type { CSSProperties, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import root from 'react-shadow';
import browser from 'webextension-polyfill';

import { AstryxShadowRootProvider } from '../components/providers/AstryxShadowRootProvider';
import contentShadowStylesUrl from '../content-shadow.css.txt';

// Set position explicitly
const rootContainerStyles = {
  all: 'unset',
  position: 'absolute',
  top: 0,
  left: 0,
} satisfies CSSProperties;

/**
 * Resolve a bundler-emitted asset URL to a fetchable extension URL.
 *
 * The bundler emits `publicPath + assetPath` where publicPath varies by build:
 * an absolute extension URL (`chrome-extension://…/`), the content-script
 * fallback "/", or "". `runtime.getURL` only accepts relative paths — absolute
 * URLs get their origin doubled, and a leading "/" yields an unresolvable
 * "//assets/…" URL in Chrome — so normalize before resolving.
 */
export const resolveExtensionAssetUrl = (url: string): string => {
  if (/^[a-z][\w+.-]*:/i.test(url)) return url;

  const path = url.replace(/^\/+/, '');
  return typeof browser?.runtime?.getURL === 'function'
    ? browser.runtime.getURL(path)
    : path;
};

/**
 * Shadow DOM container manager
 */
export class ShadowDOMContainerManager {
  private root: HTMLElement | null = null;
  private reactRoot: Root | null = null;

  private readonly styles: string[];
  private child: ReactNode;
  private contentShadowStyles: string | null = null;
  private contentShadowStylesPromise: Promise<string> | null = null;

  constructor(options?: { styles?: string[] }) {
    const { styles } = options ?? {};
    this.styles = styles ?? [];
  }

  public createRootNode() {
    // Skip
    if (this.root !== null) return this.root;

    // Create and insert root node
    this.root = document.createElement('div');
    document.body.appendChild(this.root);

    // Reset all styles
    for (const style of Object.entries(rootContainerStyles)) {
      const [name, value] = style;
      this.root.style.setProperty(name, String(value));
    }

    return this.root;
  }

  public removeRootNode() {
    // Skip
    if (this.root === null) return;

    this.root.remove();
    this.root = null;
  }

  public getRootNode() {
    return this.root;
  }

  public mountComponent = (child?: ReactNode) => {
    if (this.root === null) return;

    this.child = child;
    if (this.contentShadowStyles !== null) {
      this.render();
      return;
    }

    void this.getContentShadowStyles()
      .catch((error: unknown) => {
        // A stale content script (extension reloaded without a page refresh) can no
        // longer fetch extension assets. Render without injected styles instead of
        // never mounting, and don't cache the rejection for the next mount.
        this.contentShadowStylesPromise = null;
        console.warn('Could not load Shadow DOM styles; rendering without them', error);
        return '';
      })
      .then((styles) => {
        this.contentShadowStyles = styles;
        this.render();
      });
  };

  private getContentShadowStyles() {
    if (
      typeof contentShadowStylesUrl === 'string' &&
      (contentShadowStylesUrl.startsWith('/*') ||
        contentShadowStylesUrl.startsWith('@layer') ||
        contentShadowStylesUrl.includes('{'))
    ) {
      return Promise.resolve(contentShadowStylesUrl);
    }

    const resolvedUrl = resolveExtensionAssetUrl(contentShadowStylesUrl);

    this.contentShadowStylesPromise ??= fetch(resolvedUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Could not load Shadow DOM styles: ${response.status} ${response.statusText}`,
        );
      }
      return response.text();
    });
    return this.contentShadowStylesPromise;
  }

  private render() {
    if (this.root === null || this.contentShadowStyles === null) return;

    // #123 attach root node again on the page, for cases when whole DOM been replaced
    if (!document.body.contains(this.root)) {
      document.body.appendChild(this.root);
    }

    this.reactRoot ??= createRoot(this.root);
    this.reactRoot.render(
      <root.div style={{ ...rootContainerStyles }} mode="closed">
        {/* Infrastructure seam: raw CSS stays inside this closed shadow tree. */}
        <style>{this.contentShadowStyles}</style>
        {this.styles.map((path, index) => (
          <link key={index} rel="stylesheet" href={browser.runtime.getURL(path)} />
        ))}
        <AstryxShadowRootProvider>{this.child}</AstryxShadowRootProvider>
      </root.div>,
    );
  }

  public unmountComponent = () => {
    this.child = undefined;
    if (this.reactRoot !== null) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  };
}
