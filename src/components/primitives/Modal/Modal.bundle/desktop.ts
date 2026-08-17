import { ComponentProps, FC, RefObject } from 'react';
import { Modal as ElegantModal } from 'react-elegant-ui/components/Modal/Modal.bundle/desktop';

export * from 'react-elegant-ui/components/Modal/Modal.bundle/desktop';

type ElegantModalProps = ComponentProps<typeof ElegantModal>;

export type IModalProps = Omit<
	ElegantModalProps,
	'essentialRefs' | 'hostRef' | 'scope'
> & {
	essentialRefs?: RefObject<HTMLElement | null>[];
	hostRef?: RefObject<HTMLElement | null>;
	scope?: RefObject<HTMLElement | null>;
};

// react-elegant-ui's refs predate React 19's explicit nullable RefObject type.
export const Modal = ElegantModal as FC<IModalProps>;

import '../Modal.css';
