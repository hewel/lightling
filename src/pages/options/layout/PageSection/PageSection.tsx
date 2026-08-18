import { FC, ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';

import { optionsPageStyles } from '../OptionsPage.stylex';

export interface PageSection {
  id?: string;
  title?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  xstyle?: stylex.StyleXStyles;
  children?: ReactNode;
}

export const PageSection: FC<PageSection> = ({
  id,
  title,
  level = 2,
  xstyle,
  children,
}) => {
  const HeadElement = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[level - 1];
  return (
    <div id={id} {...stylex.props(xstyle)}>
      {title !== undefined ? (
        <HeadElement {...stylex.props(optionsPageStyles.pageSectionTitle)}>
          {title}
        </HeadElement>
      ) : undefined}
      <div {...stylex.props(optionsPageStyles.indentVertical)}>{children}</div>
    </div>
  );
};
