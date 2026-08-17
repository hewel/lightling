import { ComponentProps, FC, RefObject } from 'react';
import { Popup as ElegantPopup } from 'react-elegant-ui/esm/components/Popup/Popup.bundle/desktop';
import { VirtualElement } from '@popperjs/core';

export * from 'react-elegant-ui/esm/components/Popup/Popup.bundle/desktop';

type ElegantPopupProps = ComponentProps<typeof ElegantPopup>;

export type IPopupProps = Omit<
	ElegantPopupProps,
	'anchor' | 'essentialRefs' | 'hostRef' | 'scope'
> & {
	anchor?: RefObject<HTMLElement | VirtualElement | null>;
	essentialRefs?: RefObject<HTMLElement | null>[];
	hostRef?: RefObject<HTMLElement | null>;
	scope?: RefObject<HTMLElement | null>;
};

// react-elegant-ui's refs predate React 19's explicit nullable RefObject type.
export const Popup = ElegantPopup as FC<IPopupProps>;
