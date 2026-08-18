import { FC, ReactNode, RefObject } from 'react';
import * as stylex from '@stylexjs/stylex';

import { Popup } from '@/components/primitives/Popup/Popup';

const styles = stylex.create({
	root: {
		background: 'var(--color-background-muted)',
		color: 'var(--color-text-primary)',
		padding: '1rem',
		maxWidth: '25rem',
	},
});

export interface IOriginalTextPopupProps {
	target: RefObject<HTMLElement | null>;
	children?: ReactNode;
}

export const OriginalTextPopup: FC<IOriginalTextPopupProps> = ({ target, children }) => {
	return (
		<Popup
			target="anchor"
			anchor={target}
			view="default"
			visible={true}
			zIndex={999999999}
		>
			<div {...stylex.props(styles.root)}>{children}</div>
		</Popup>
	);
};
