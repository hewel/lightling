import { CSSProperties, ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import root from 'react-shadow';
import browser from 'webextension-polyfill';

import { AstryxShadowRootProvider } from '../components/providers/AstryxProvider';

// Set position explicitly
const rootContainerStyles = {
  all: 'unset',
  position: 'absolute',
  top: 0,
  left: 0,
} satisfies CSSProperties;

/**
 * Shadow DOM container manager
 */
export class ShadowDOMContainerManager {
  private root: HTMLElement | null = null;
  private reactRoot: Root | null = null;

  private readonly styles: string[];

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
    // Skip when root node is not exist
    if (this.root === null) return;

    // #123 attach root node again on the page, for cases when whole DOM been replaced
    if (!document.body.contains(this.root)) {
      document.body.appendChild(this.root);
    }

    this.reactRoot ??= createRoot(this.root);
    this.reactRoot.render(
      <root.div style={{ ...rootContainerStyles }} mode="closed">
        {/* Include styles and scripts */}
        {this.styles.map((path, index) => (
          <link key={index} rel="stylesheet" href={browser.runtime.getURL(path)} />
        ))}
        <AstryxShadowRootProvider>{child}</AstryxShadowRootProvider>
      </root.div>,
    );
  };

  public unmountComponent = () => {
    if (this.reactRoot !== null) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  };
}
