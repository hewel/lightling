import { size, type Middleware, type Placement } from '@floating-ui/react';

const POPUP_VIEWPORT_PADDING = 16;

export const selectPopupDirections: Placement[] = [
	'bottom-start',
	'bottom',
	'bottom-end',
	'top-start',
	'top',
	'top-end',
];

export const selectPopupMiddleware: Middleware[] = [
	size({
		padding: POPUP_VIEWPORT_PADDING,
		apply({ availableHeight, elements, rects }) {
			elements.floating.style.minWidth = `${rects.reference.width}px`;
			elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
		},
	}),
];
