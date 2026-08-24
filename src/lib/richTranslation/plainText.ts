import { RICH_BLOCK_TAGS, type RichAstNode, type RichNodeInfo } from './model';
import { parseRichMarkup } from './parseMarkup';

const isBlockTag = (tag: string): boolean =>
  (RICH_BLOCK_TAGS as readonly string[]).includes(tag);

const normalizePlainText = (text: string): string =>
  text.trim().replace(/\n{3,}/g, '\n\n');

const astToPlainText = (
  ast: RichAstNode[],
  nodes: Readonly<Record<string, RichNodeInfo>>,
): string =>
  ast
    .map((node) => {
      if (node.type === 'text') return node.text;
      const text = astToPlainText(node.children, nodes);
      const info = nodes[node.id];
      return info !== undefined && isBlockTag(info.tag) ? `${text}\n` : text;
    })
    .join('');

export const richMarkupToPlainText = (
  markup: string,
  nodes: Readonly<Record<string, RichNodeInfo>>,
): string => {
  const parsed = parseRichMarkup(markup);
  if (parsed === null) {
    return normalizePlainText(markup.replace(/<\/?g\b[^>]*>/gi, ''));
  }
  return normalizePlainText(astToPlainText(parsed, nodes));
};
