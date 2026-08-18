import { FC, ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';

import { optionsPageStyles } from '../OptionsPage.stylex';

export interface OptionSection {
	title?: string;
	description?: ReactNode;
	changed?: boolean;
	error?: string;
	children?: ReactNode;
}

export const OptionSection: FC<OptionSection> = ({
	title,
	description,
	changed,
	children,
	error,
}) => (
	<div
		{...stylex.props(
			optionsPageStyles.optionSection,
			changed && optionsPageStyles.changedOptionSection,
		)}
	>
		<div {...stylex.props(optionsPageStyles.optionTitle)}>{title}</div>
		<div
			{...stylex.props(
				optionsPageStyles.optionContainer,
				changed && optionsPageStyles.changedOptionContainer,
			)}
		>
			{children}

			{error !== undefined ? (
				<div {...stylex.props(optionsPageStyles.optionErrorMessage)}>{error}</div>
			) : undefined}

			{description !== undefined ? (
				<div {...stylex.props(optionsPageStyles.optionDescription)}>
					{description}
				</div>
			) : undefined}
		</div>
	</div>
);
