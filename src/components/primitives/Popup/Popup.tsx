import {
	type CSSProperties,
	type FC,
	type HTMLAttributes,
	type MouseEventHandler,
	type ReactElement,
	type ReactNode,
	type Ref,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@astryxdesign/core/Card';
import {
	arrow,
	autoUpdate,
	flip,
	hide,
	limitShift,
	offset,
	shift,
	useFloating,
	useMergeRefs,
	type Middleware,
	type Placement,
	type ReferenceElement,
} from '@floating-ui/react';

import { POPUP_TAIL_LAYER } from '@/themes/layers';

const defaultDirections: Placement[] = [
	'top-start',
	'top',
	'top-end',
	'bottom-start',
	'bottom',
	'bottom-end',
	'right-start',
	'right',
	'right-end',
	'left-start',
	'left',
	'left-end',
];

const emptyMiddleware: Middleware[] = [];
const emptyElementRefs: RefObject<HTMLElement | null>[] = [];

type PopupCloseSource = 'click' | 'esc';
type PopupCloseHandler = (
	event: KeyboardEvent | MouseEvent,
	source: PopupCloseSource,
) => void;
type PopupChildren =
	| ReactNode
	| ((props: { tailRef?: Ref<HTMLDivElement> }) => ReactNode);

type PopupBaseProps = Omit<
	HTMLAttributes<HTMLDivElement>,
	'children' | 'className' | 'onClick' | 'style'
> & {
	addonAfter?: ReactNode;
	addonBefore?: ReactNode;
	children?: PopupChildren;
	className?: string;
	essentialRefs?: RefObject<HTMLElement | null>[];
	hasTail?: boolean;
	hostRef?: RefObject<HTMLElement | null>;
	innerRef?: Ref<HTMLDivElement>;
	keepMounted?: boolean;
	onClick?: MouseEventHandler<HTMLDivElement>;
	onClose?: PopupCloseHandler;
	scope?: RefObject<HTMLElement | null>;
	style?: CSSProperties;
	tailRef?: Ref<HTMLDivElement>;
	UNSTABLE_onRenderTail?: (tail: ReactElement) => ReactElement;
	view?: 'default';
	visible?: boolean;
	zIndex?: number;
};

export type PopupBoundary =
	| RefObject<HTMLElement | null>
	| RefObject<HTMLElement | null>[];

export type AnchoredPopupProps = PopupBaseProps & {
	anchor: RefObject<ReferenceElement | null>;
	boundary?: PopupBoundary;
	direction?: Placement | Placement[];
	hideWhenDetached?: boolean;
	mainOffset?: number;
	middleware?: Middleware[];
	motionless?: boolean;
	secondaryOffset?: number;
	tailOffset?: number;
	target: 'anchor';
	UNSTABLE_updatePosition?: Ref<() => void>;
	viewportOffset?: number;
};

type StaticPopupProps = PopupBaseProps & {
	anchor?: undefined;
	target?: undefined;
};

export type IPopupProps = AnchoredPopupProps | StaticPopupProps;

type LayerRecord = {
	essentialRefs: RefObject<HTMLElement | null>[];
	id: symbol;
	onClose?: PopupCloseHandler;
};

const layerStack: LayerRecord[] = [];
const handledClickEvents = new WeakSet<Event>();
const handledEscapeEvents = new WeakSet<Event>();

function removeLayer(layer: LayerRecord) {
	const index = layerStack.indexOf(layer);

	if (index !== -1) layerStack.splice(index, 1);
}

function getTopLayer(): LayerRecord | undefined {
	return layerStack[layerStack.length - 1];
}

function getShadowRoots(refs: RefObject<HTMLElement | null>[]): ShadowRoot[] {
	if (typeof ShadowRoot === 'undefined') return [];

	const roots = new Set<ShadowRoot>();

	for (const ref of refs) {
		const root = ref.current?.getRootNode();

		if (root instanceof ShadowRoot) roots.add(root);
	}

	return [...roots];
}

function isNode(target: EventTarget | null): target is Node {
	return target !== null && 'nodeType' in target;
}

function usePopupDismissal({
	essentialRefs,
	listenerRefs,
	onClose,
	visible,
}: {
	essentialRefs: RefObject<HTMLElement | null>[];
	listenerRefs: RefObject<HTMLElement | null>[];
	onClose?: PopupCloseHandler;
	visible: boolean;
}) {
	const mouseDownTargetRef = useRef<EventTarget | null>(null);
	const layerRef = useRef<LayerRecord>(undefined);

	if (layerRef.current === undefined) {
		layerRef.current = {
			essentialRefs,
			id: Symbol('popup-layer'),
			onClose,
		};
	}

	const layer = layerRef.current;
	layer.essentialRefs = essentialRefs;
	layer.onClose = onClose;

	useEffect(() => {
		if (!visible) return;

		layerStack.push(layer);

		return () => removeLayer(layer);
	}, [layer, visible]);

	useEffect(() => {
		if (!visible) return;

		const shadowRoots = getShadowRoots(listenerRefs);
		const isShadowRootHost = (target: EventTarget | null) =>
			shadowRoots.some((root) => root.host === target);
		const onKeyUp = (event: KeyboardEvent) => {
			if (
				(event.code === 'Escape' || event.key === 'Escape') &&
				!handledEscapeEvents.has(event) &&
				getTopLayer() === layer
			) {
				handledEscapeEvents.add(event);
				layer.onClose?.(event, 'esc');
			}
		};
		const onMouseDown = (event: MouseEvent) => {
			// Closed shadow events are retargeted to their host at document level.
			// The listener on the root sees the real target and handles it instead.
			if (isShadowRootHost(event.target)) return;

			mouseDownTargetRef.current = event.target;
		};
		const onClick = (event: MouseEvent) => {
			const target = event.target;

			if (
				isShadowRootHost(target) ||
				handledClickEvents.has(event) ||
				mouseDownTargetRef.current !== target ||
				getTopLayer() !== layer
			) {
				return;
			}

			const essentialClick =
				isNode(target) &&
				layer.essentialRefs.some((ref) => ref.current?.contains(target));

			if (!essentialClick && layer.onClose !== undefined) {
				handledClickEvents.add(event);
				layer.onClose(event, 'click');
			}
		};
		const onShadowMouseDown: EventListener = (event) => {
			if (event instanceof MouseEvent) onMouseDown(event);
		};
		const onShadowClick: EventListener = (event) => {
			if (event instanceof MouseEvent) onClick(event);
		};

		document.addEventListener('keyup', onKeyUp);
		document.addEventListener('mousedown', onMouseDown, true);
		document.addEventListener('click', onClick, true);

		for (const root of shadowRoots) {
			root.addEventListener('mousedown', onShadowMouseDown, true);
			root.addEventListener('click', onShadowClick, true);
		}

		return () => {
			document.removeEventListener('keyup', onKeyUp);
			document.removeEventListener('mousedown', onMouseDown, true);
			document.removeEventListener('click', onClick, true);

			for (const root of shadowRoots) {
				root.removeEventListener('mousedown', onShadowMouseDown, true);
				root.removeEventListener('click', onShadowClick, true);
			}
		};
	});
}

function getPopupClassName({
	className,
	view,
	visible,
}: Pick<PopupBaseProps, 'className' | 'view' | 'visible'>): string {
	return [
		'Popup',
		view === undefined ? undefined : `Popup_view_${view}`,
		visible ? 'Popup_visible' : undefined,
		className,
	]
		.filter((value): value is string => Boolean(value))
		.join(' ');
}

const tailBaseStyle: CSSProperties = {
	boxSizing: 'border-box',
	height: 'var(--spacing-4)',
	pointerEvents: 'none',
	position: 'absolute',
	transform: 'rotate(45deg)',
	width: 'var(--spacing-4)',
	zIndex: POPUP_TAIL_LAYER,
};

const defaultTailSurfaceStyle: CSSProperties = {
	backgroundColor: 'var(--color-background-card)',
	borderColor: 'var(--color-border)',
	borderStyle: 'solid',
	borderWidth: 'var(--border-width)',
};

const PopupTail: FC<{
	innerRef?: Ref<HTMLDivElement>;
	style?: CSSProperties;
	view?: PopupBaseProps['view'];
}> = ({ innerRef, style, view }) => {
	// Infrastructure exception: Floating UI and the retained public tailRef API
	// require a measurable HTMLDivElement rather than a layout/surface primitive.
	return (
		<div
			aria-hidden="true"
			className="Popup-Tail"
			ref={innerRef}
			style={{
				...tailBaseStyle,
				...(view === 'default' ? defaultTailSurfaceStyle : {}),
				...style,
			}}
		/>
	);
};

type PopupShellProps = PopupBaseProps & {
	popupTailStyle?: CSSProperties;
};

const PopupShell: FC<PopupShellProps> = ({
	addonAfter,
	addonBefore,
	children,
	className,
	essentialRefs = emptyElementRefs,
	hasTail,
	hostRef,
	innerRef,
	keepMounted = true,
	onClose,
	popupTailStyle,
	scope,
	style,
	tailRef,
	UNSTABLE_onRenderTail,
	view,
	visible = false,
	zIndex,
	...props
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const containerRefMix = useMergeRefs<HTMLDivElement>([containerRef, innerRef]);
	const effectiveHostRef = hostRef ?? containerRef;

	usePopupDismissal({
		essentialRefs: [effectiveHostRef, ...essentialRefs],
		listenerRefs: [containerRef, effectiveHostRef, ...essentialRefs],
		onClose,
		visible,
	});

	if (!visible && !keepMounted) return null;

	const tail = <PopupTail innerRef={tailRef} style={popupTailStyle} view={view} />;
	const renderedTail =
		UNSTABLE_onRenderTail !== undefined
			? UNSTABLE_onRenderTail(tail)
			: hasTail
				? tail
				: null;
	const surface = (
		<Card
			{...props}
			className={getPopupClassName({ className, view, visible })}
			elevation={view === 'default' ? 'high' : 'none'}
			padding={0}
			ref={containerRefMix}
			style={{
				isolation: 'isolate',
				overflow: 'visible',
				...style,
				...(style?.visibility === undefined && !visible && view === 'default'
					? { visibility: 'hidden' }
					: {}),
				zIndex,
			}}
			variant={view === 'default' ? 'default' : 'transparent'}
		>
			{addonBefore}
			{typeof children === 'function' ? children({ tailRef }) : children}
			{addonAfter}
			{renderedTail}
		</Card>
	);
	const scopeElement = scope?.current ?? null;

	return scopeElement === null ? surface : createPortal(surface, scopeElement);
};

function getBoundaryElements(boundary?: PopupBoundary): HTMLElement[] {
	if (boundary === undefined) return [];

	const refs = Array.isArray(boundary) ? boundary : [boundary];

	return refs.flatMap((ref) => (ref.current === null ? [] : [ref.current]));
}

function getTailEdgeStyle(placement: Placement): CSSProperties {
	switch (placement.split('-')[0]) {
		case 'bottom':
			return { bottom: 'calc(100% - var(--spacing-2))' };
		case 'left':
			return { left: 'calc(100% - var(--spacing-2))' };
		case 'right':
			return { right: 'calc(100% - var(--spacing-2))' };
		default:
			return { top: 'calc(100% - var(--spacing-2))' };
	}
}

/**
 * Popper-compatible visual shell positioned by Floating UI.
 */
const AnchoredPopup: FC<AnchoredPopupProps> = ({
	anchor,
	boundary,
	direction = defaultDirections,
	essentialRefs = emptyElementRefs,
	hasTail,
	hideWhenDetached = true,
	innerRef,
	keepMounted = true,
	mainOffset = hasTail ? 0 : 4,
	middleware = emptyMiddleware,
	motionless = false,
	secondaryOffset = 0,
	style,
	tailOffset = 0,
	tailRef,
	target: _target,
	UNSTABLE_updatePosition,
	visible = false,
	viewportOffset = 16,
	...props
}) => {
	const placements = Array.isArray(direction) ? direction : [direction];
	const boundaryElements = getBoundaryElements(boundary);
	const boundaryOptions =
		boundaryElements.length === 0 ? {} : { boundary: boundaryElements };
	const anchorElementRef = useRef<HTMLElement | null>(null);
	const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);
	const floatingMiddleware: Middleware[] = [
		offset({
			crossAxis: secondaryOffset,
			mainAxis: mainOffset + (hasTail ? 8 : 0),
		}),
		flip({
			...boundaryOptions,
			altBoundary: true,
			fallbackPlacements: placements.slice(1),
			padding: viewportOffset,
		}),
		shift({
			...boundaryOptions,
			altBoundary: true,
			limiter: limitShift(),
		}),
		...middleware,
	];

	if (hasTail && arrowElement !== null) {
		floatingMiddleware.push(arrow({ element: arrowElement, padding: 4 }));
	}

	if (hideWhenDetached) {
		floatingMiddleware.push(
			hide({ ...boundaryOptions, strategy: 'referenceHidden' }),
			hide({ ...boundaryOptions, strategy: 'escaped' }),
		);
	}

	const {
		elements,
		floatingStyles,
		isPositioned,
		middlewareData,
		placement,
		refs,
		update,
	} = useFloating({
		middleware: floatingMiddleware,
		open: visible,
		placement: placements[0] ?? defaultDirections[0],
		strategy: 'absolute',
		transform: false,
	});

	useLayoutEffect(() => {
		const reference = anchor.current;
		refs.setReference(reference);
		anchorElementRef.current =
			typeof HTMLElement !== 'undefined' && reference instanceof HTMLElement
				? reference
				: typeof HTMLElement !== 'undefined' &&
					  reference !== null &&
					  'contextElement' in reference &&
					  reference.contextElement instanceof HTMLElement
					? reference.contextElement
					: null;
	});

	useLayoutEffect(() => {
		return () => {
			refs.setReference(null);
			anchorElementRef.current = null;
		};
	}, [refs]);

	useEffect(() => {
		if (
			!visible ||
			motionless ||
			elements.reference === null ||
			elements.floating === null
		) {
			return;
		}

		return autoUpdate(elements.reference, elements.floating, update);
	}, [elements.floating, elements.reference, motionless, update, visible]);

	useImperativeHandle(UNSTABLE_updatePosition, () => update, [update]);

	const floatingRef = useMergeRefs<HTMLDivElement>([refs.setFloating, innerRef]);
	const floatingTailRef = useMergeRefs<HTMLDivElement>([setArrowElement, tailRef]);
	const arrowX = middlewareData.arrow?.x;
	const arrowY = middlewareData.arrow?.y;
	const tailStyle = useMemo<CSSProperties>(
		() => ({
			...getTailEdgeStyle(placement),
			...(arrowX === undefined ? {} : { left: arrowX + tailOffset }),
			...(arrowY === undefined ? {} : { top: arrowY + tailOffset }),
		}),
		[arrowX, arrowY, placement, tailOffset],
	);
	const referenceHidden = hideWhenDetached && middlewareData.hide?.referenceHidden;
	const escaped = hideWhenDetached && middlewareData.hide?.escaped;
	const hidden = visible && (!isPositioned || referenceHidden || escaped);

	return (
		<PopupShell
			{...props}
			data-popper-escaped={escaped ? 'true' : undefined}
			data-popper-placement={placement}
			data-popper-reference-hidden={referenceHidden ? 'true' : undefined}
			essentialRefs={[anchorElementRef, ...essentialRefs]}
			hasTail={hasTail}
			innerRef={floatingRef}
			keepMounted={keepMounted}
			popupTailStyle={tailStyle}
			style={{
				...style,
				...floatingStyles,
				visibility: hidden ? 'hidden' : style?.visibility,
			}}
			tailRef={floatingTailRef}
			visible={visible}
		/>
	);
};

const StaticPopup: FC<StaticPopupProps> = ({
	anchor: _anchor,
	essentialRefs = emptyElementRefs,
	keepMounted = true,
	target: _target,
	...props
}) => {
	return (
		<PopupShell {...props} essentialRefs={essentialRefs} keepMounted={keepMounted} />
	);
};

/**
 * Popup visual shell with optional Floating UI anchor positioning.
 */
export const Popup: FC<IPopupProps> = (props) =>
	props.target === 'anchor' ? <AnchoredPopup {...props} /> : <StaticPopup {...props} />;
