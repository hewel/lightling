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

  public getRootNode() {
    return this.shadowRoot.getRootNode();
  }

  public show({ closeHandler, ...options }: SelectTranslatorPopupRenderOptions) {
    this.shadowRoot.mountComponent(
      <TextTranslatorPopup
        closeHandler={closeHandler}
        translate={translate}
        {...options}
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
