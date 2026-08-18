import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { trackClientEvent } from '@/requests/backend/telemetry';

export interface Options {
  /**
   * Key modifiers to activate translate of selected text
   */
  modifiers: ('ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey')[];

  /**
   * Skip when pointerdown not on the selected text
   */
  strictSelection: boolean;

  /**
   * Don't show translate button and translate at once
   */
  quickTranslate: boolean;

  /**
   * Page language for translate direction
   */
  pageLanguage?: string;

  /**
   * Detected language is firstly than page language
   */
  detectedLangFirst: boolean;

  /**
   * Use auto detection for `from` direction
   */
  isUseAutoForDetectLang: boolean;

  /**
   * Remember translate direction
   */
  rememberDirection: boolean;

  /**
   * CSS property for popup
   */
  zIndex?: number;

  /**
   * Hide translate button after delay when specified positive number
   */
  timeoutForHideButton?: number;

  /**
   * Useful for keyboard navigation
   */
  focusOnTranslateButton?: boolean;

  /**
   * Show translate block once for each text selection
   */
  showOnceForSelection?: boolean;

  /**
   * Show block with original text
   */
  showOriginalText: boolean;

  enableTranslateFromContextMenu?: boolean;
}
export type SelectTranslatorPopupRenderOptions = {
  closeHandler: () => void;
  quickTranslate: boolean;
  pageLanguage?: string;
  showOriginalText: boolean;
  detectedLangFirst: boolean;
  isUseAutoForDetectLang: boolean;
  rememberDirection: boolean;
  zIndex?: number;
  timeoutForHideButton?: number;
  focusOnTranslateButton?: boolean;
  text: string;
  x: number;
  y: number;
};

type PopupRenderer = {
  getRootNode: () => HTMLElement | null;
  show: (options: SelectTranslatorPopupRenderOptions) => void;
  hide: () => void;
  destroy: () => void;
};

export const getSelectedTextOfInput = (elm: HTMLInputElement | HTMLTextAreaElement) => {
  const { selectionStart, selectionEnd } = elm;

  if (selectionStart === null || selectionEnd === null) return '';
  return elm.value.slice(selectionStart, selectionEnd);
};

export const getAbsolutePositionOfElement = (element: HTMLElement) => {
  const bounds = element.getBoundingClientRect();
  // oxlint-disable-next-line typescript/no-useless-default-assignment
  const { scrollX = 0, scrollY = 0 } = window;
  return {
    x: bounds.x + scrollX,
    y: bounds.y + scrollY,
  };
};

/**
 * This wrapper on component need to allow convenient manage state
 */
export class SelectTranslator {
  private readonly options: Options = {
    modifiers: ['ctrlKey'],
    detectedLangFirst: false,
    quickTranslate: false,
    strictSelection: false,
    rememberDirection: false,
    showOnceForSelection: true,
    showOriginalText: true,
    isUseAutoForDetectLang: true,
    enableTranslateFromContextMenu: false,
  };

  constructor(options?: Partial<Options>) {
    if (options !== undefined) {
      Object.assign(this.options, options);
    }
  }

  // Flag which set while every selection event and reset while button shown
  private unhandledSelection = false;
  private selectionTarget: HTMLElement | null = null;
  private readonly selectionFlagUpdater = (evt: Event) => {
    this.unhandledSelection = true;
    this.selectionTarget = evt.target instanceof HTMLElement ? evt.target : null;
  };

  private started = false;
  private popupRenderer: PopupRenderer | null = null;
  private popupRendererPromise: Promise<PopupRenderer | null> | null = null;
  private popupContext = Symbol('popup');
  private lifecycleContext = Symbol('lifecycle');

  public start() {
    if (this.started) {
      throw new Error('Already started');
    }

    this.started = true;
    this.lifecycleContext = Symbol('lifecycle');
    document.addEventListener('selectionchange', this.selectionFlagUpdater);
    document.addEventListener('pointerdown', this.pointerDown);
    document.addEventListener('pointerup', this.pointerUp);
    document.addEventListener('touchstart', this.pointerDown);
    document.addEventListener('touchend', this.pointerUp);
  }

  public stop() {
    if (!this.started) {
      throw new Error('Not started');
    }

    this.started = false;
    this.popupContext = Symbol('popup');
    this.lifecycleContext = Symbol('lifecycle');
    document.removeEventListener('selectionchange', this.selectionFlagUpdater);
    document.removeEventListener('pointerdown', this.pointerDown);
    document.removeEventListener('pointerup', this.pointerUp);
    document.removeEventListener('touchstart', this.pointerDown);
    document.removeEventListener('touchend', this.pointerUp);

    this.popupRenderer?.destroy();
    this.popupRenderer = null;
    this.popupRendererPromise = null;
  }

  public isRun() {
    return this.started;
  }

  private readonly getPopupRenderer = async (): Promise<PopupRenderer | null> => {
    if (this.popupRenderer !== null) return this.popupRenderer;

    if (this.popupRendererPromise === null) {
      const lifecycleContext = this.lifecycleContext;
      // Performance seam: React popup code loads only after a qualifying selection.
      this.popupRendererPromise = import(
        /* webpackChunkName: "content-selected-translator" */
        './SelectTranslatorPopupRenderer'
      ).then(({ SelectTranslatorPopupRenderer }) => {
        const renderer = new SelectTranslatorPopupRenderer();
        if (!this.started || lifecycleContext !== this.lifecycleContext) {
          renderer.destroy();
          return null;
        }

        this.popupRenderer = renderer;
        return renderer;
      });
    }

    return this.popupRendererPromise;
  };

  public translateSelectedText = () => {
    this.hidePopup();

    const { x, y } = this.lastPointerPosition || {
      x: window.scrollX,
      y: window.scrollY,
    };

    this.getSelectedText().then((selection) => {
      let text: string | null = null;

      // TODO: #refactor move this logic to one method `getSelectedText(target?: Node)`
      if (selection !== null) {
        text = selection.text;
      } else if (
        this.selectionTarget !== null &&
        (this.selectionTarget instanceof HTMLTextAreaElement ||
          this.selectionTarget instanceof HTMLInputElement)
      ) {
        text = getSelectedTextOfInput(this.selectionTarget);
      }

      if (text !== null) {
        void this.showPopup(text, x, y);
      }
    });
  };

  private readonly getSelectedText = () =>
    new Promise<{ selection: Selection; text: string } | null>((res) => {
      const root = this.popupRenderer?.getRootNode() ?? null;

      this.context = Symbol('context');
      const context = this.context;

      // Get selected text in next frame
      requestAnimationFrame(() => {
        if (context !== this.context) {
          res(null);
          return;
        }
        this.context = Symbol('context');

        const selection = window.getSelection();

        // Skip empty selection
        if (selection === null) {
          res(null);
          return;
        }

        if (
          root !== null &&
          (root.contains(selection.anchorNode) || root.contains(selection.focusNode))
        ) {
          res(null);
          return;
        }

        const selectedText = selection.toString();
        res(selectedText.length > 0 ? { selection, text: selectedText } : null);
      });
    });

  // NOTE: maybe it should be removed after start use popup
  /**
   * Close popup by click outside the root
   */
  private readonly pointerDown = (evt: PointerEvent | TouchEvent) => {
    const root = this.popupRenderer?.getRootNode() ?? null;
    if (root !== null && evt.target instanceof Node && root.contains(evt.target)) return;

    this.hidePopup();
  };

  private context = Symbol('context');

  private lastPointerPosition: { x: number; y: number } | null = null;

  /**
   * Open popup by text selection on the page
   */
  private readonly pointerUp = async (evt: PointerEvent | TouchEvent) => {
    await new Promise((res) => setTimeout(res, 10));

    const getIsTouchEvt = (evt: Event): evt is TouchEvent =>
      evt.type === 'touchstart' || evt.type === 'touchend';
    const isTouchEvt = getIsTouchEvt(evt);

    // Reject if press not left button or not just touch
    // Codes list: https://www.w3.org/TR/pointerevents1/#h5_chorded-button-interactions
    if (!isTouchEvt && evt.button !== 0) return;

    const { pageX, pageY } = isTouchEvt ? evt.changedTouches[0] : evt;
    this.lastPointerPosition = {
      x: pageX,
      y: pageY,
    };

    // Skip when enabled translation with context menu
    if (this.options.enableTranslateFromContextMenu) return;

    // Check modifier keys
    const requiredModifierKeys = this.options.modifiers;
    if (
      requiredModifierKeys.length > 0 &&
      !requiredModifierKeys.every((value) => evt[value])
    )
      return;

    const target = evt.target;
    const root = this.popupRenderer?.getRootNode() ?? null;

    // Skip events inside root node
    if (root !== null && target instanceof Node && root.contains(target)) return;

    this.getSelectedText().then((selectedTextObj) => {
      let text: string | null = null;

      if (selectedTextObj !== null) {
        // Use selected text on page
        text = selectedTextObj.text;

        const { selection } = selectedTextObj;

        // Skip when pointerdown not on the selected text
        if (this.options.strictSelection && selection.focusNode instanceof Text) {
          const parent = selection.focusNode.parentElement;
          if (parent !== null && parent !== target) return;
        }

        // Skip if it shown not first time
        if (this.options.showOnceForSelection && !this.unhandledSelection) return;
      } else if (
        this.selectionTarget !== null &&
        (this.selectionTarget instanceof HTMLTextAreaElement ||
          this.selectionTarget instanceof HTMLInputElement)
      ) {
        // Use selected text in input
        text = getSelectedTextOfInput(this.selectionTarget);
      }

      if (text !== null) {
        void this.showPopup(text, pageX, pageY);
      }
    });
  };

  private readonly showPopup = async (text: string, x: number, y: number) => {
    const trimmedText = text.trim();
    if (trimmedText.length === 0) return;

    this.unhandledSelection = false;
    const popupContext = Symbol('popup');
    this.popupContext = popupContext;

    const renderer = await this.getPopupRenderer();
    if (renderer === null || popupContext !== this.popupContext) return;

    const rootNode = renderer.getRootNode();
    if (rootNode === null) throw new Error('Root node is not found');

    const rootPosition = getAbsolutePositionOfElement(rootNode);
    const {
      pageLanguage,
      quickTranslate,
      detectedLangFirst,
      isUseAutoForDetectLang,
      rememberDirection,
      zIndex,
      timeoutForHideButton,
      focusOnTranslateButton,
      showOriginalText,
      enableTranslateFromContextMenu,
    } = this.options;

    renderer.show({
      closeHandler: this.hidePopup,
      quickTranslate: enableTranslateFromContextMenu === true || quickTranslate,
      pageLanguage,
      showOriginalText,
      detectedLangFirst,
      isUseAutoForDetectLang,
      rememberDirection,
      zIndex,
      timeoutForHideButton,
      focusOnTranslateButton,
      text: trimmedText,
      x: x - rootPosition.x,
      y: y - rootPosition.y,
    });

    trackClientEvent(TELEMETRY_EVENT_NAME.SELECTED_TEXT_POPUP_SHOWN, {
      length: trimmedText.length,
    });
  };

  private readonly hidePopup = () => {
    this.popupContext = Symbol('popup');
    this.popupRenderer?.hide();
  };
}
