export const RICH_INLINE_TAGS = ['strong', 'em', 'u', 's', 'code', 'a'] as const;
export const RICH_BLOCK_TAGS = [
  'p',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
] as const;
export const RICH_CONTAINER_TAGS = [...RICH_INLINE_TAGS, ...RICH_BLOCK_TAGS] as const;

export type RichInlineTag = (typeof RICH_INLINE_TAGS)[number];
export type RichBlockTag = (typeof RICH_BLOCK_TAGS)[number];
export type RichContainerTag =
  | (typeof RICH_INLINE_TAGS)[number]
  | (typeof RICH_BLOCK_TAGS)[number];

export interface RichNodeInfo {
  tag: RichContainerTag;
  href?: string;
}

export interface RichMarkup {
  markup: string;
  nodes: Readonly<Record<string, RichNodeInfo>>;
}

export type RichAstNode =
  | { type: 'text'; text: string }
  | { type: 'container'; id: string; children: RichAstNode[] };

export const RICH_MARKUP_MAX_LENGTH = 10_000;
export const RICH_NODES_MAX_COUNT = 500;
