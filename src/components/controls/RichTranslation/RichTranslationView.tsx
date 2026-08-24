import { Fragment, type FC, type ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';

import type { RichAstNode, RichNodeInfo } from '@/lib/richTranslation/model';
import { parseRichMarkup } from '@/lib/richTranslation/parseMarkup';
import { richMarkupToPlainText } from '@/lib/richTranslation/plainText';

import { sanitizeHref } from './sanitizeHref';

const styles = stylex.create({
  strong: {
    fontWeight: 'var(--text-heading-3-weight)',
  },
  em: {
    fontStyle: 'italic',
  },
  underline: {
    textDecorationLine: 'underline',
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  code: {
    backgroundColor: 'var(--color-background-muted)',
    borderRadius: 'var(--radius-inner)',
    fontFamily: 'var(--font-family-code)',
    paddingInline: 'var(--spacing-1)',
  },
  link: {
    color: 'var(--color-accent)',
    textDecorationLine: 'underline',
  },
  block: {
    marginBlock: 'var(--spacing-1)',
  },
  list: {
    marginBlock: 'var(--spacing-1)',
    paddingInlineStart: 'var(--spacing-3)',
  },
  blockquote: {
    borderInlineStart: 'var(--spacing-0-5) solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    marginBlock: 'var(--spacing-2)',
    paddingInlineStart: 'var(--spacing-2)',
  },
  pre: {
    backgroundColor: 'var(--color-background-muted)',
    borderRadius: 'var(--radius-inner)',
    fontFamily: 'var(--font-family-code)',
    marginBlock: 'var(--spacing-1)',
    overflowX: 'auto',
    padding: 'var(--spacing-2)',
    whiteSpace: 'pre',
  },
  heading1: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--text-heading-1-size)',
    fontWeight: 'var(--text-heading-1-weight)',
    lineHeight: 'var(--text-heading-1-leading)',
    marginBlock: 'var(--spacing-2)',
  },
  heading2: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--text-heading-2-size)',
    fontWeight: 'var(--text-heading-2-weight)',
    lineHeight: 'var(--text-heading-2-leading)',
    marginBlock: 'var(--spacing-2)',
  },
  heading3: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--text-heading-3-size)',
    fontWeight: 'var(--text-heading-3-weight)',
    lineHeight: 'var(--text-heading-3-leading)',
    marginBlock: 'var(--spacing-2)',
  },
  heading4: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--text-heading-4-size)',
    fontWeight: 'var(--text-heading-4-weight)',
    lineHeight: 'var(--text-heading-4-leading)',
    marginBlock: 'var(--spacing-1)',
  },
  heading5: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--text-heading-5-size)',
    fontWeight: 'var(--text-heading-5-weight)',
    lineHeight: 'var(--text-heading-5-leading)',
    marginBlock: 'var(--spacing-1)',
  },
  heading6: {
    fontFamily: 'var(--font-family-heading)',
    fontSize: 'var(--text-heading-6-size)',
    fontWeight: 'var(--text-heading-6-weight)',
    lineHeight: 'var(--text-heading-6-leading)',
    marginBlock: 'var(--spacing-1)',
  },
});

export interface RichTranslationViewProps {
  markup: string;
  nodes: Readonly<Record<string, RichNodeInfo>>;
}

function renderNode(
  node: RichAstNode,
  nodes: Readonly<Record<string, RichNodeInfo>>,
  path: string,
): ReactNode {
  if (node.type === 'text') return node.text;

  const info = nodes[node.id];
  const children = node.children.map((child, index) =>
    renderNode(child, nodes, `${path}.${index}`),
  );

  if (info === undefined) return <Fragment key={path}>{children}</Fragment>;

  switch (info.tag) {
    case 'strong':
      return (
        <strong key={path} {...stylex.props(styles.strong)}>
          {children}
        </strong>
      );
    case 'em':
      return (
        <em key={path} {...stylex.props(styles.em)}>
          {children}
        </em>
      );
    case 'u':
      return (
        <u key={path} {...stylex.props(styles.underline)}>
          {children}
        </u>
      );
    case 's':
      return (
        <s key={path} {...stylex.props(styles.strike)}>
          {children}
        </s>
      );
    case 'code':
      return (
        <code key={path} {...stylex.props(styles.code)}>
          {children}
        </code>
      );
    case 'a': {
      const href = sanitizeHref(info.href);
      if (href === undefined) return <Fragment key={path}>{children}</Fragment>;

      return (
        <a
          key={path}
          href={href}
          target="_blank"
          rel="noreferrer"
          {...stylex.props(styles.link)}
        >
          {children}
        </a>
      );
    }
    case 'p':
      return (
        <p key={path} {...stylex.props(styles.block)}>
          {children}
        </p>
      );
    case 'ul':
      return (
        <ul key={path} {...stylex.props(styles.list)}>
          {children}
        </ul>
      );
    case 'ol':
      return (
        <ol key={path} {...stylex.props(styles.list)}>
          {children}
        </ol>
      );
    case 'li':
      return (
        <li key={path} {...stylex.props(styles.block)}>
          {children}
        </li>
      );
    case 'blockquote':
      return (
        <blockquote key={path} {...stylex.props(styles.blockquote)}>
          {children}
        </blockquote>
      );
    case 'pre':
      return (
        <pre key={path} {...stylex.props(styles.pre)}>
          {children}
        </pre>
      );
    case 'h1':
      return (
        <h1 key={path} {...stylex.props(styles.heading1)}>
          {children}
        </h1>
      );
    case 'h2':
      return (
        <h2 key={path} {...stylex.props(styles.heading2)}>
          {children}
        </h2>
      );
    case 'h3':
      return (
        <h3 key={path} {...stylex.props(styles.heading3)}>
          {children}
        </h3>
      );
    case 'h4':
      return (
        <h4 key={path} {...stylex.props(styles.heading4)}>
          {children}
        </h4>
      );
    case 'h5':
      return (
        <h5 key={path} {...stylex.props(styles.heading5)}>
          {children}
        </h5>
      );
    case 'h6':
      return (
        <h6 key={path} {...stylex.props(styles.heading6)}>
          {children}
        </h6>
      );
  }
}

export const RichTranslationView: FC<RichTranslationViewProps> = ({ markup, nodes }) => {
  const parsed = parseRichMarkup(markup);
  if (parsed === null) return <>{richMarkupToPlainText(markup, nodes)}</>;

  const children = parsed.map((node, index) => renderNode(node, nodes, `${index}`));

  return <>{children}</>;
};
