import { FC, ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack, VStack } from '@astryxdesign/core/Stack';

export const ModalLayout: FC<{
  title?: string | ReactNode;
  footer?: ReactNode | ReactNode[];
  children?: ReactNode;
}> = ({ title, footer, children }) => (
  <VStack gap={5}>
    {title !== undefined ? <Heading level={2}>{title}</Heading> : null}
    {children}
    {footer !== undefined ? (
      <HStack gap={2} justify="end">
        {footer}
      </HStack>
    ) : null}
  </VStack>
);
