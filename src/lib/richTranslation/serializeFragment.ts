import {
  RICH_CONTAINER_TAGS,
  RICH_MARKUP_MAX_LENGTH,
  RICH_NODES_MAX_COUNT,
  type RichContainerTag,
  type RichMarkup,
  type RichNodeInfo,
} from './model';

const SKIPPED_TAGS: Record<string, true> = {
  script: true,
  style: true,
  noscript: true,
  template: true,
};

const getContainerTag = (tag: string): RichContainerTag | null => {
  if (tag === 'b') return 'strong';
  if (tag === 'i') return 'em';
  if (tag === 'strike' || tag === 'del') return 's';
  if ((RICH_CONTAINER_TAGS as readonly string[]).includes(tag))
    return tag as RichContainerTag;
  return null;
};

export const serializeSelectionFragment = (root: ParentNode): RichMarkup | null => {
  const nodes: Record<string, RichNodeInfo> = {};
  let nextNode = 0;

  const serializeChildren = (parent: ParentNode): string | null => {
    let markup = '';
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        markup += child.nodeValue ?? '';
        continue;
      }
      if (!(child instanceof Element)) continue;

      const tag = child.tagName.toLowerCase();
      if (SKIPPED_TAGS[tag]) continue;
      if (tag === 'br') {
        markup += '\n';
        continue;
      }

      const containerTag = getContainerTag(tag);
      if (containerTag === null) {
        const nestedMarkup = serializeChildren(child);
        if (nestedMarkup === null) return null;
        markup += nestedMarkup;
        continue;
      }

      nextNode += 1;
      if (nextNode > RICH_NODES_MAX_COUNT) return null;
      const id = `r${nextNode}`;
      const nodeInfo: RichNodeInfo = { tag: containerTag };
      if (containerTag === 'a') {
        const href = child.getAttribute('href');
        if (href !== null) nodeInfo.href = href;
      }
      nodes[id] = nodeInfo;
      const nestedMarkup = serializeChildren(child);
      if (nestedMarkup === null) return null;
      markup += `<g id="${id}">${nestedMarkup}</g>`;
    }
    return markup;
  };

  const markup = serializeChildren(root);
  if (markup === null) return null;
  const trimmedMarkup = markup.trim();
  if (Object.keys(nodes).length === 0) return null;
  if (trimmedMarkup.length > RICH_MARKUP_MAX_LENGTH) return null;
  return { markup: trimmedMarkup, nodes };
};
