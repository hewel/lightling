import {
	createElement,
	type DialogHTMLAttributes,
	type FC,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from 'react';
import { createPortal } from 'react-dom';
import {
	Dialog as AstryxDialog,
	type DialogProps as AstryxDialogProps,
} from '@astryxdesign/core/Dialog';
import { Stack } from '@astryxdesign/core/Stack';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
	root: {
		maxWidth: '100vw',
	},
	hideBackdrop: {
		'::backdrop': {
			backgroundColor: 'transparent',
			backdropFilter: 'none',
		},
	},
	noAnimation: {
		animation: 'none',
	},
});

export type ModalCloseSource = 'click' | 'esc';
export type ModalCloseHandler = (
	event: KeyboardEvent | MouseEvent,
	source: ModalCloseSource,
) => void;

export interface IModalProps extends Omit<
	DialogHTMLAttributes<HTMLDialogElement>,
	'children' | 'onClose' | 'open'
> {
	children?: ReactNode;
	contentVerticalAlign?: 'bottom' | 'middle' | 'top';
	contentXstyle?: stylex.StyleXStyles;
	tableXstyle?: stylex.StyleXStyles;
	essentialRefs?: RefObject<HTMLElement | null>[];
	hasAnimation?: boolean;
	hideBackdrop?: boolean;
	hostRef?: RefObject<HTMLElement | null>;
	/**
	 * Receives the native event and the legacy dismissal source.
	 */
	onClose?: ModalCloseHandler;
	/**
	 * Retained for source compatibility. Astryx Dialog locks scrolling while it
	 * is modal; every current Linguist modal opts into the legacy behavior.
	 */
	preventBodyScroll?: boolean;
	renderAll?: boolean;
	renderToStack?: boolean;
	/** Portal destination. It may live inside a closed shadow root. */
	scope?: RefObject<HTMLElement | null>;
	visible?: boolean;
	view?: 'default';
	zIndex?: number;
	/**
	 * Ref to the native dialog root.
	 */
	innerRef?: Ref<HTMLDialogElement>;
	keepMounted?: boolean;
}

type PendingClose = {
	event: KeyboardEvent | MouseEvent;
	source: ModalCloseSource;
};

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === 'function') {
		ref(value);
	} else if (ref !== null && ref !== undefined) {
		ref.current = value;
	}
}

function getActiveElement(node: HTMLElement | null): HTMLElement | null {
	const root = node?.getRootNode();
	const activeElement =
		root instanceof Document ||
		(typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
			? root.activeElement
			: document.activeElement;

	return activeElement instanceof HTMLElement ? activeElement : null;
}

/**
 * Compatibility wrapper for the retired legacy Modal.
 *
 * Astryx owns the native dialog, focus trap, Escape/backdrop handling, and
 * scroll lock. This wrapper keeps Linguist's legacy prop/class/portal contract
 * while consumers migrate incrementally.
 */
export const Modal: FC<IModalProps> = ({
	'aria-label': ariaLabel,
	'aria-labelledby': ariaLabelledBy,
	children,
	className,
	contentVerticalAlign = 'middle',
	contentXstyle,
	essentialRefs: _essentialRefs,
	tableXstyle,
	hasAnimation = true,
	hideBackdrop = false,
	hostRef: _hostRef,
	innerRef,
	keepMounted = false,
	onClickCapture,
	onKeyDownCapture,
	onMouseDownCapture,
	onClose,
	preventBodyScroll: _preventBodyScroll,
	renderAll: _renderAll,
	renderToStack: _renderToStack,
	scope,
	style,
	view: _view = 'default',
	visible = false,
	zIndex,
	...props
}) => {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const triggerRef = useRef<HTMLElement | null>(null);
	const wasVisibleRef = useRef(false);
	const restoreFocusRef = useRef(false);
	const mouseDownTargetRef = useRef<EventTarget | null>(null);
	const pendingCloseRef = useRef<PendingClose | null>(null);

	const attachDialog = useCallback(
		(dialog: HTMLDialogElement | null) => {
			dialogRef.current = dialog;
			setRef(innerRef, dialog);
		},
		[innerRef],
	);

	// document.activeElement is the shadow host for a closed root. Capture from
	// the dialog's own root before Astryx opens it so focus can return to the
	// actual trigger instead of stopping at the host.
	useLayoutEffect(() => {
		if (visible && !wasVisibleRef.current) {
			const activeElement = getActiveElement(dialogRef.current);

			if (
				activeElement !== null &&
				activeElement !== dialogRef.current &&
				!dialogRef.current?.contains(activeElement)
			) {
				triggerRef.current = activeElement;
			}

			restoreFocusRef.current = true;
		} else if (!visible && wasVisibleRef.current) {
			restoreFocusRef.current = true;
		}

		wasVisibleRef.current = visible;
	}, [visible]);

	// Astryx closes its native dialog in a child effect first. The wrapper effect
	// then corrects focus restoration for a trigger inside a closed shadow root.
	useEffect(() => {
		if (visible || !restoreFocusRef.current) return;

		const trigger = triggerRef.current;
		if (trigger?.isConnected) trigger.focus();

		triggerRef.current = null;
		restoreFocusRef.current = false;
	}, [visible]);

	useEffect(
		() => () => {
			if (!wasVisibleRef.current) return;

			const trigger = triggerRef.current;
			if (trigger?.isConnected) trigger.focus();
		},
		[],
	);

	const handleMouseDownCapture = useCallback(
		(event: ReactMouseEvent<HTMLDialogElement>) => {
			onMouseDownCapture?.(event);
			mouseDownTargetRef.current = event.nativeEvent.target;
		},
		[onMouseDownCapture],
	);

	const handleClickCapture = useCallback(
		(event: ReactMouseEvent<HTMLDialogElement>) => {
			onClickCapture?.(event);

			if (event.target !== event.currentTarget) return;

			// Preserve the legacy drag guard: an interaction that starts on content
			// and ends on the backdrop must not dismiss the modal.
			if (mouseDownTargetRef.current !== event.nativeEvent.target) {
				event.stopPropagation();
				return;
			}

			pendingCloseRef.current = {
				event: event.nativeEvent,
				source: 'click',
			};
			mouseDownTargetRef.current = null;
		},
		[onClickCapture],
	);

	const handleKeyDownCapture = useCallback(
		(event: ReactKeyboardEvent<HTMLDialogElement>) => {
			onKeyDownCapture?.(event);

			if (event.key === 'Escape' || event.code === 'Escape') {
				pendingCloseRef.current = {
					event: event.nativeEvent,
					source: 'esc',
				};
			}
		},
		[onKeyDownCapture],
	);

	const handleOpenChange = useCallback(
		(isOpen: boolean) => {
			if (isOpen || onClose === undefined) return;

			const pendingClose: PendingClose = pendingCloseRef.current ?? {
				event: new KeyboardEvent('keyup', {
					bubbles: true,
					code: 'Escape',
					key: 'Escape',
				}),
				source: 'esc',
			};

			pendingCloseRef.current = null;
			onClose(pendingClose.event, pendingClose.source);
		},
		[onClose],
	);

	if (!visible && !keepMounted) return null;

	const fallbackAriaLabel =
		ariaLabel === undefined && ariaLabelledBy === undefined ? 'Dialog' : undefined;
	const alignmentStyle =
		contentVerticalAlign === 'top'
			? {
					marginBlockEnd: 'auto',
					marginBlockStart: 'var(--spacing-1-5)',
				}
			: contentVerticalAlign === 'bottom'
				? {
						marginBlockEnd: 'var(--spacing-1-5)',
						marginBlockStart: 'auto',
					}
				: undefined;

	const content = createElement(
		Stack,
		{
			direction: 'horizontal',
			gap: 0,
			hAlign: 'center',
			isScrollable: true,
			minHeight: 0,
			xstyle: tableXstyle,
			vAlign: 'center',
			wrap: 'wrap',
		},
		createElement(
			Stack,
			{
				gap: 0,
				maxWidth: '100%',
				// Retains the legacy cell inset around the content surface.
				padding: 1.5,
			},
			createElement(
				Stack,
				{
					gap: 0,
					maxWidth: '100%',
					// Retains the separate legacy content-surface inset.
					padding: 1.5,
					xstyle: contentXstyle,
				},
				children,
			),
		),
	);

	const dialogProps: AstryxDialogProps = {
		...props,
		'aria-label': ariaLabel ?? fallbackAriaLabel,
		'aria-labelledby': ariaLabelledBy,
		className,
		isOpen: visible,
		maxHeight: '100vh',
		onClickCapture: handleClickCapture,
		onKeyDownCapture: handleKeyDownCapture,
		onMouseDownCapture: handleMouseDownCapture,
		onOpenChange: handleOpenChange,
		padding: 0,
		purpose: 'info',
		ref: attachDialog,
		style: {
			...alignmentStyle,
			...(zIndex === undefined ? undefined : { zIndex }),
			...style,
		},
		width: 'fit-content',
		xstyle: [
			styles.root,
			hideBackdrop && styles.hideBackdrop,
			!hasAnimation && styles.noAnimation,
		],
		children: content,
	};
	const dialog = createElement(AstryxDialog, dialogProps);
	const scopeElement = scope?.current ?? null;

	return scopeElement === null ? dialog : createPortal(dialog, scopeElement);
};

Modal.displayName = 'Modal';
