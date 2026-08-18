import { FC, ReactNode } from 'react';
import { Section } from '@astryxdesign/core/Section';
import { Spinner } from '@astryxdesign/core/Spinner';

export interface IPageProps {
  loading?: boolean;
  renderWhileLoading?: boolean;
  children?: ReactNode;
}

/**
 * Component for represent any standalone page
 */
export const Page: FC<IPageProps> = ({ loading, renderWhileLoading, children }) => (
  <Section>
    {loading ? <Spinner size="lg" /> : null}
    {!loading || renderWhileLoading ? children : null}
  </Section>
);
