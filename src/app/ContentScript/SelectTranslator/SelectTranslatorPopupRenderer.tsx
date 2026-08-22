import { getContentScriptStyles } from '@/lib/browser';
import { ShadowDOMContainerManager } from '@/lib/ShadowDOMContainerManager';
import { translate } from '@/requests/backend/translate';

import { TextTranslatorPopup } from './components/TextTranslatorPopup/TextTranslatorPopup';
import type { SelectTranslatorPopupRenderOptions } from './SelectTranslator';

export class SelectTranslatorPopupRenderer {
  private readonly shadowRoot = new ShadowDOMContainerManager({
    styles: getContentScriptStyles(),
  });

  constructor() {
    this.shadowRoot.createRootNode();
    this.shadowRoot.getRootNode()?.addEventListener('keydown', this.handleKeyDown);
  }

  public contains(node: Node | null) {
    return this.shadowRoot.getRootNode()?.contains(node) ?? false;
  }

  public show({ closeHandler, x, y, ...options }: SelectTranslatorPopupRenderOptions) {
    const rootNode = this.shadowRoot.getRootNode();
    if (rootNode === null) throw new Error('Root node is not found');

    const bounds = rootNode.getBoundingClientRect();
    // oxlint-disable-next-line typescript/no-useless-default-assignment
    const { scrollX = 0, scrollY = 0 } = window;

    this.shadowRoot.mountComponent(
      <TextTranslatorPopup
        closeHandler={closeHandler}
        translate={translate}
        {...options}
        x={x - (bounds.x + scrollX)}
        y={y - (bounds.y + scrollY)}
      />,
    );
  }

  public hide() {
    this.shadowRoot.mountComponent();
  }

  public destroy() {
    this.shadowRoot.getRootNode()?.removeEventListener('keydown', this.handleKeyDown);
    this.shadowRoot.unmountComponent();
    this.shadowRoot.removeRootNode();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    event.stopImmediatePropagation();
  };
}
