import { FC, ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
	optionSpacing: {
		marginBlockEnd: '0.5rem',
	},
	fullOption: {
		display: 'table-row',
	},
	fullTitle: {
		display: 'table-cell',
		lineHeight: '200%',
		paddingBlockEnd: '0.3rem',
		paddingInlineEnd: '0.3rem',
	},
	mobileOption: {
		display: 'block',
	},
	mobileTitle: {
		display: 'block',
		marginBlockEnd: '0.3rem',
	},
	optionBody: {
		display: 'block',
	},
});

export type Option = {
	title?: ReactNode;
	content?: ReactNode;
};

export interface IOptionsPanelProps {
	options: Option[];
	view: 'mobile' | 'full';
}

/**
 * Component which render typical options lists
 */
export const OptionsPanel: FC<IOptionsPanelProps> = ({ options, view }) => {
	return (
		<div>
			{options.map((option, idx) => (
				<div
					{...stylex.props(
						idx !== options.length - 1 && styles.optionSpacing,
						view === 'full' ? styles.fullOption : styles.mobileOption,
					)}
					key={idx}
				>
					{option.title && (
						<div
							{...stylex.props(
								view === 'full' ? styles.fullTitle : styles.mobileTitle,
							)}
						>
							{option.title}
						</div>
					)}
					{option.content && (
						<div {...stylex.props(styles.optionBody)}>{option.content}</div>
					)}
				</div>
			))}
		</div>
	);
};
