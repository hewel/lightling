import {
	type ComponentProps,
	type CSSProperties,
	type FC,
	type Ref,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	Popup as ElegantPopup,
	cnPopup,
} from 'react-elegant-ui/esm/components/Popup/Popup';
import { PopupDesktopRegistry } from 'react-elegant-ui/esm/components/Popup/Popup.registry/desktop';
import { TailContext } from 'react-elegant-ui/esm/components/Popup/Tail/Popup-Tail';
import { withRegistry } from 'react-elegant-ui/esm/lib/di';
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

import 'react-elegant-ui/esm/components/Popup/_view/Popup_view_default.css';

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

type ElegantPopupProps = ComponentProps<typeof ElegantPopup>;

type NullableElegantPopupProps = Omit<ElegantPopupProps, 'hostRef' | 'scope'> & {
	hostRef?: RefObject<HTMLElement | null>;
	scope?: RefObject<HTMLElement | null>;
};

// The dependency predates React 19's explicit nullable RefObject type, but its
// runtime reads current defensively and supports null throughout.
function adaptLegacyRef<T>(ref?: RefObject<T | null>): RefObject<T> | undefined {
	return ref as RefObject<T> | undefined;
}

function adaptLegacyRefs<T>(refs: RefObject<T | null>[]): RefObject<T>[] {
	return refs as RefObject<T>[];
}

const NullableElegantPopup: FC<NullableElegantPopupProps> = ({
	hostRef,
	scope,
	...props
}) => {
	return (
		<ElegantPopup
			{...props}
			hostRef={adaptLegacyRef(hostRef)}
			scope={adaptLegacyRef(scope)}
		/>
	);
};

const RegisteredElegantPopup = withRegistry(PopupDesktopRegistry)(NullableElegantPopup);

export type PopupBoundary =
	| RefObject<HTMLElement | null>
	| RefObject<HTMLElement | null>[];

type PopupBaseProps = Omit<NullableElegantPopupProps, 'essentialRefs'> & {
	essentialRefs?: RefObject<HTMLElement | null>[];
	view?: 'default';
};

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

function getBoundaryElements(boundary?: PopupBoundary): HTMLElement[] {
	if (boundary === undefined) return [];

	const refs = Array.isArray(boundary) ? boundary : [boundary];

	return refs.flatMap((ref) => (ref.current === null ? [] : [ref.current]));
}

/**
 * Popper-compatible visual shell positioned by Floating UI.
 */
const AnchoredPopup: FC<AnchoredPopupProps> = ({
	anchor,
	boundary,
	className,
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
	view,
	visible = false,
	viewportOffset = 16,
	...props
}) => {
	const placements = Array.isArray(direction) ? direction : [direction];
	const boundaryElements = getBoundaryElements(boundary);
	const boundaryOptions =
		boundaryElements.length === 0 ? {} : { boundary: boundaryElements };
	const [fallbackAnchorElement] = useState(() => document.createElement('span'));
	const anchorElementRef = useRef<HTMLElement>(fallbackAnchorElement);
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
					: fallbackAnchorElement;
	});

	useLayoutEffect(() => {
		return () => {
			refs.setReference(null);
			anchorElementRef.current = fallbackAnchorElement;
		};
	}, [fallbackAnchorElement, refs]);

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
			position: 'absolute',
			...(arrowX === undefined ? {} : { left: arrowX + tailOffset }),
			...(arrowY === undefined ? {} : { top: arrowY + tailOffset }),
		}),
		[arrowX, arrowY, tailOffset],
	);
	const referenceHidden = hideWhenDetached && middlewareData.hide?.referenceHidden;
	const escaped = hideWhenDetached && middlewareData.hide?.escaped;
	const hidden = visible && (!isPositioned || referenceHidden || escaped);

	return (
		<TailContext.Provider value={{ style: tailStyle }}>
			<RegisteredElegantPopup
				{...props}
				className={cnPopup({ view }, [className])}
				data-popper-escaped={escaped || undefined}
				data-popper-placement={placement}
				data-popper-reference-hidden={referenceHidden || undefined}
				essentialRefs={[anchorElementRef, ...adaptLegacyRefs(essentialRefs)]}
				hasTail={hasTail}
				innerRef={floatingRef}
				keepMounted={keepMounted}
				style={{
					...style,
					...floatingStyles,
					visibility: hidden ? 'hidden' : style?.visibility,
				}}
				tailRef={floatingTailRef}
				visible={visible}
			/>
		</TailContext.Provider>
	);
};

const StaticPopup: FC<StaticPopupProps> = ({
	anchor: _anchor,
	className,
	essentialRefs = emptyElementRefs,
	keepMounted = true,
	target: _target,
	view,
	...props
}) => {
	return (
		<RegisteredElegantPopup
			{...props}
			className={cnPopup({ view }, [className])}
			essentialRefs={adaptLegacyRefs(essentialRefs)}
			keepMounted={keepMounted}
		/>
	);
};

/**
 * Popup visual shell with optional Floating UI anchor positioning.
 */
export const Popup: FC<IPopupProps> = (props) =>
	props.target === 'anchor' ? <AnchoredPopup {...props} /> : <StaticPopup {...props} />;
