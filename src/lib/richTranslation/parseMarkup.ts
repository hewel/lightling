import type { RichAstNode } from './model';

const RICH_TOKEN_PATTERN = /<g id="([A-Za-z0-9_-]+)">|<\/g>/gu;
const RESIDUAL_PLACEHOLDER_PATTERN = /<\/?g\b|<x\b/u;

type RichContainerAstNode = Extract<RichAstNode, { type: 'container' }>;

export const parseRichMarkup = (markup: string): RichAstNode[] | null => {
  const root: RichAstNode[] = [];
  const containers: RichAstNode[][] = [root];
  let cursor = 0;

  for (const match of markup.matchAll(RICH_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      containers.at(-1)?.push({ type: 'text', text: markup.slice(cursor, matchIndex) });
    }

    if (match[1] !== undefined) {
      const node: RichContainerAstNode = {
        type: 'container',
        id: match[1],
        children: [],
      };
      containers.at(-1)?.push(node);
      containers.push(node.children);
    } else {
      if (containers.length === 1) return null;
      containers.pop();
    }
    cursor = matchIndex + match[0].length;
  }

  if (cursor < markup.length) {
    containers.at(-1)?.push({ type: 'text', text: markup.slice(cursor) });
  }
  if (containers.length !== 1) return null;

  return RESIDUAL_PLACEHOLDER_PATTERN.test(markup.replace(RICH_TOKEN_PATTERN, ''))
    ? null
    : root;
};
