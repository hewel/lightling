import {
  createSemanticKey,
  DEFAULT_GLOSSARY_VERSION,
  normalizeTranslationText,
  type PageProfile,
  type SectionContext,
  type TranslationKind,
  type TranslationSlot,
  type TranslationTarget,
  WEBPAGE_TRANSLATION_PROMPT_VERSION,
} from '@/lib/pageTranslation/protocol';

const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'PRE',
  'IFRAME',
  'OBJECT',
  'CANVAS',
  'SVG',
]);
const SEMANTIC_BOUNDARIES = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'BUTTON',
  'LABEL',
  'OPTION',
  'SUMMARY',
  'FIGCAPTION',
  'CAPTION',
  'DT',
  'DD',
]);
const INLINE_GROUP_TAGS = new Set([
  'STRONG',
  'B',
  'EM',
  'I',
  'SPAN',
  'A',
  'SMALL',
  'MARK',
  'SUB',
  'SUP',
  'U',
  'S',
]);
const ATOMIC_TAGS = new Set([
  'CODE',
  'KBD',
  'SAMP',
  'VAR',
  'BR',
  'IMG',
  'INPUT',
  'SELECT',
]);
const BLOCK_DISPLAYS = new Set([
  'block',
  'flex',
  'grid',
  'table',
  'table-row',
  'table-cell',
  'list-item',
]);
const STATUS_PATTERN = /(?:status|state|availability|presence)/iu;
const PROTECTED_TEXT_PATTERN =
  /(?:https?:\/\/[^\s<]+|www\.[^\s<]+|(?:~\/|\/)(?:[\w.-]+\/)+[\w.-]*|\b[\w.-]+\.(?:js|ts|tsx|jsx|json|css|html|md|ya?ml|toml|ini|exe|dmg|zip|tar|gz)\b|\b[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)+\b|\b\d+(?:[.,]\d+)?\s?(?:%|px|em|rem|ms|s|KB|MB|GB|KiB|MiB|GiB|Hz|kHz|MHz|GHz)\b)/giu;

export interface PageTranslationIdentity {
  provider: string;
  model: string;
  glossaryVersion?: string;
  promptVersion?: string;
  profileVersion?: string;
}

interface SegmentBinding {
  type: 'segment';
  root: Element;
  placeholders: Map<string, Element>;
  protectedValues: Map<string, string>;
  originalChildren: Map<Element, Node[]>;
  originalText: Map<Text, string>;
  createdTextNodes: Set<Text>;
}

interface SerializedSegment {
  sourceText: string;
  binding: SegmentBinding;
}

interface AttributeBinding {
  type: 'attribute';
  element: Element;
  attribute: string;
  originalValue: string;
}

export type OccurrenceBinding = SegmentBinding | AttributeBinding;

export interface TextOccurrence extends TranslationTarget {
  occurrenceId: string;
  binding: OccurrenceBinding;
  element: Element;
  section: SectionContext;
}

export interface TranslationUnit extends TranslationTarget {
  occurrences: TextOccurrence[];
  section: SectionContext;
}

export interface CollectedPage {
  occurrences: TextOccurrence[];
  pageProfile: PageProfile;
  sections: Map<string, SectionContext>;
}

export interface PageCollectionContext {
  headings: readonly Element[];
  pageProfile: PageProfile;
}

export interface CollectionOptions {
  sourceLanguage: string;
  targetLanguage: string;
  identity: PageTranslationIdentity;
  translatableAttributes?: string[];
  excludeSelectors?: string[];
  includeEditable?: boolean;
}

const hasMeaningfulText = (value: string | null): value is string =>
  value !== null && normalizeTranslationText(value) !== '';

const hasTranslatableText = (value: string): boolean => /[\p{L}\p{N}]/u.test(value);

const isEditable = (element: Element): boolean =>
  element instanceof HTMLElement && element.isContentEditable;

const isUnavailable = (element: Element, options: CollectionOptions): boolean => {
  if (SKIPPED_TAGS.has(element.tagName)) return true;
  if (!options.includeEditable && isEditable(element)) return true;
  if (element.hasAttribute('hidden') || element.hasAttribute('inert')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  try {
    const style = getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden';
  } catch {
    return false;
  }
};

const matchesExcludeSelector = (
  element: Element,
  options: CollectionOptions,
): boolean => {
  for (const selector of options.excludeSelectors ?? []) {
    if (selector === '') continue;
    try {
      if (element.matches(selector)) return true;
    } catch {
      // Ignore malformed user selectors instead of aborting the page scan.
    }
  }
  return false;
};

const isExcluded = (element: Element, options: CollectionOptions): boolean =>
  isUnavailable(element, options) || matchesExcludeSelector(element, options);

const elementRole = (element: Element): string => element.getAttribute('role') ?? '';

const isBoundary = (element: Element): boolean => {
  if (SEMANTIC_BOUNDARIES.has(element.tagName)) return true;
  if (element.tagName === 'A') return true;
  const role = elementRole(element);
  if (
    [
      'button',
      'menuitem',
      'tab',
      'heading',
      'cell',
      'columnheader',
      'rowheader',
      'status',
      'alert',
    ].includes(role)
  ) {
    return true;
  }
  const hasDirectText = Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && hasMeaningfulText(node.nodeValue),
  );
  if (!hasDirectText) return false;
  try {
    return BLOCK_DISPLAYS.has(getComputedStyle(element).display);
  } catch {
    return true;
  }
};

const classifyKind = (element: Element, slot: TranslationSlot): TranslationKind => {
  if (slot === 'placeholder') return 'placeholder';
  if (slot === 'title') return 'tooltip';
  if (slot === 'aria-label') return 'accessible-label';
  if (slot === 'alt') return 'image-alt';

  const role = elementRole(element);
  if (element.tagName === 'BUTTON' || role === 'button') return 'button';
  if (role === 'menuitem' || role.startsWith('menuitem')) return 'menu-item';
  if (role === 'tab') return 'tab';
  if (element.closest('nav,[role="navigation"]') !== null) return 'navigation-item';
  if (/^H[1-6]$/u.test(element.tagName) || role === 'heading') return 'heading';
  if (element.tagName === 'LABEL') return 'form-label';
  if (element.tagName === 'TH' || role === 'columnheader' || role === 'rowheader') {
    return 'table-header';
  }
  if (role === 'status' || role === 'alert' || STATUS_PATTERN.test(element.className)) {
    return 'status';
  }
  return 'body';
};

const getContextClass = (element: Element, kind: TranslationKind): string => {
  const landmark = element.closest(
    'nav,main,aside,header,footer,form,dialog,[role="navigation"],[role="main"],[role="dialog"],[role="menu"],[role="tablist"]',
  );
  const landmarkName = landmark?.getAttribute('aria-label');
  const component =
    element.closest('[data-component],[data-testid]')?.getAttribute('data-component') ??
    element.closest('[data-component],[data-testid]')?.getAttribute('data-testid');
  return [
    landmark?.getAttribute('role') ?? landmark?.tagName.toLowerCase() ?? 'document',
    landmarkName === null || landmarkName === undefined
      ? ''
      : normalizeTranslationText(landmarkName),
    component ?? '',
    kind,
  ]
    .filter((part) => part !== '')
    .join(':');
};

const getPriority = (element: Element): number => {
  try {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (rect.bottom >= 0 && rect.top <= viewportHeight) return 4;
    if (rect.bottom >= -viewportHeight && rect.top <= viewportHeight * 2) return 3;
    return 1;
  } catch {
    return 1;
  }
};

const protectText = (
  text: string,
  protectedValues: Map<string, string>,
  nextId: () => string,
): string =>
  text.replace(PROTECTED_TEXT_PATTERN, (value) => {
    const id = nextId();
    protectedValues.set(id, value);
    return `<x id="${id}"/>`;
  });

const serializeSegment = (
  root: Element,
  options: CollectionOptions,
): SerializedSegment => {
  const placeholders = new Map<string, Element>();
  const protectedValues = new Map<string, string>();
  const originalChildren = new Map<Element, Node[]>();
  const originalText = new Map<Text, string>();
  const createdTextNodes = new Set<Text>();
  let placeholderSerial = 0;
  const nextId = (prefix: 'g' | 'x') => `${prefix}-${++placeholderSerial}`;

  const serializeChildren = (container: Element): string => {
    originalChildren.set(container, Array.from(container.childNodes));
    let result = '';
    for (const child of Array.from(container.childNodes)) {
      if (child instanceof Text) {
        const text = child.nodeValue ?? '';
        originalText.set(child, text);
        result += protectText(text, protectedValues, () => nextId('x'));
        continue;
      }
      if (!(child instanceof Element) || isUnavailable(child, options)) continue;
      if (ATOMIC_TAGS.has(child.tagName) || matchesExcludeSelector(child, options)) {
        const id = nextId('x');
        placeholders.set(id, child);
        result += `<x id="${id}"/>`;
        continue;
      }
      let isInline = INLINE_GROUP_TAGS.has(child.tagName);
      if (!isInline) {
        try {
          isInline = getComputedStyle(child).display.startsWith('inline');
        } catch {
          isInline = false;
        }
      }
      if (!isInline) {
        const id = nextId('x');
        placeholders.set(id, child);
        result += `<x id="${id}"/>`;
        continue;
      }
      const id = nextId('g');
      placeholders.set(id, child);
      result += `<g id="${id}">${serializeChildren(child)}</g>`;
    }
    return result;
  };

  return {
    sourceText: serializeChildren(root),
    binding: {
      type: 'segment',
      root,
      placeholders,
      protectedValues,
      originalChildren,
      originalText,
      createdTextNodes,
    },
  };
};

const collectTranslatableSegments = (
  root: Element,
  options: CollectionOptions,
): SerializedSegment[] => {
  const hasDirectTranslatableText = Array.from(root.childNodes).some(
    (node) =>
      node instanceof Text &&
      hasTranslatableText((node.nodeValue ?? '').replace(PROTECTED_TEXT_PATTERN, '')),
  );
  if (hasDirectTranslatableText) return [serializeSegment(root, options)];

  return Array.from(root.children).flatMap((child) =>
    ATOMIC_TAGS.has(child.tagName) || isExcluded(child, options)
      ? []
      : collectTranslatableSegments(child, options),
  );
};

const headingPathFor = (element: Element, headings: readonly Element[]): string[] => {
  const path: string[] = [];
  for (const heading of headings) {
    if (
      heading === element ||
      heading.compareDocumentPosition(element) !== Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      continue;
    }
    const level =
      Number(heading.tagName.slice(1)) || Number(heading.getAttribute('aria-level')) || 1;
    path.length = Math.max(0, level - 1);
    path[level - 1] = normalizeTranslationText(heading.textContent ?? '');
  }
  return path.filter(Boolean);
};

const makeSection = (element: Element, headings: readonly Element[]): SectionContext => {
  const headingPath = headingPathFor(element, headings);
  const sectionRoot = element.closest(
    'section,article,nav,aside,main,form,dialog,[role]',
  );
  const componentType =
    sectionRoot?.getAttribute('role') ?? sectionRoot?.tagName.toLowerCase();
  const key = `${componentType ?? 'document'}\u0000${headingPath.join('\u0000')}`;
  return {
    sectionId: `section:${key}`,
    headingPath,
    componentType,
  };
};

const getNamedEntities = (root: ParentNode): string[] => {
  const values = new Set<string>();
  const text = root instanceof Element ? (root.textContent ?? '') : document.title;
  for (const match of text.matchAll(
    /\b[A-Z][\p{L}\p{N}_-]{2,}(?:\s+[A-Z][\p{L}\p{N}_-]{2,}){0,2}\b/gu,
  )) {
    values.add(match[0]);
    if (values.size >= 24) break;
  }
  return Array.from(values).sort();
};

export const buildPageProfile = (root: ParentNode): PageProfile => {
  const h1 = root.querySelector?.('h1,[role="heading"][aria-level="1"]')?.textContent;
  const pageTitle = normalizeTranslationText(document.title || h1 || '');
  const pageType = root.querySelector?.('form')
    ? 'form interface'
    : root.querySelector?.('article')
      ? 'document article'
      : root.querySelector?.('[role="dialog"]')
        ? 'dialog interface'
        : 'webpage';
  return {
    pageTitle: pageTitle || undefined,
    pageType,
    domain: location.hostname || undefined,
    targetStyle: 'natural, concise webpage language',
    languageDirection: document.documentElement.dir || 'auto',
    glossary: [],
    protectedTerms: [],
    namedEntities: getNamedEntities(root),
  };
};

export const createPageCollectionContext = (root: Element): PageCollectionContext => ({
  headings: Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')),
  pageProfile: buildPageProfile(root),
});

const attributeSlot = (attribute: string): TranslationSlot | null => {
  if (attribute === 'placeholder') return 'placeholder';
  if (attribute === 'title') return 'title';
  if (attribute === 'aria-label') return 'aria-label';
  if (attribute === 'alt') return 'alt';
  if (attribute === 'value') return 'value';
  return null;
};

export const collectPageOccurrences = (
  root: Element,
  options: CollectionOptions,
  priorityOverride?: number,
  collectionContext?: PageCollectionContext,
): CollectedPage => {
  const occurrences: TextOccurrence[] = [];
  const sections = new Map<string, SectionContext>();
  const context = collectionContext ?? createPageCollectionContext(root);
  const headings = context.headings;
  let occurrenceSerial = 0;

  const addOccurrence = (
    element: Element,
    sourceText: string,
    slot: TranslationSlot,
    binding: OccurrenceBinding,
    semanticElement = element,
  ) => {
    if (!hasMeaningfulText(sourceText)) return;
    const kind = classifyKind(semanticElement, slot);
    const contextClass = getContextClass(semanticElement, kind);
    const section = makeSection(semanticElement, headings);
    sections.set(section.sectionId, section);
    const normalizedText = normalizeTranslationText(sourceText);
    const semanticKey = createSemanticKey({
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      normalizedText,
      kind,
      slot,
      contextClass,
      provider: options.identity.provider,
      model: options.identity.model,
      glossaryVersion: options.identity.glossaryVersion ?? DEFAULT_GLOSSARY_VERSION,
      promptVersion: options.identity.promptVersion ?? WEBPAGE_TRANSLATION_PROMPT_VERSION,
      profileVersion: options.identity.profileVersion ?? 'legacy-profile-v1',
    });
    const occurrenceId = `o-${++occurrenceSerial}`;
    occurrences.push({
      id: occurrenceId,
      occurrenceId,
      sourceText,
      normalizedText,
      kind,
      slot,
      contextClass,
      sectionId: section.sectionId,
      componentId: semanticElement.getAttribute('id') ?? undefined,
      semanticKey,
      priority: priorityOverride ?? getPriority(semanticElement),
      binding,
      element,
      section,
    });
  };

  const visit = (element: Element) => {
    if (isExcluded(element, options)) return;
    if (isBoundary(element)) {
      for (const serialized of collectTranslatableSegments(element, options)) {
        addOccurrence(
          serialized.binding.root,
          serialized.sourceText,
          'visible-text',
          serialized.binding,
          element,
        );
      }
      return;
    }
    for (const child of Array.from(element.children)) visit(child);
  };
  visit(root);

  const configuredAttributes = options.translatableAttributes ?? [
    'placeholder',
    'title',
    'aria-label',
    'alt',
  ];
  const candidates = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of candidates) {
    if (isExcluded(element, options)) continue;
    for (const attribute of configuredAttributes) {
      const slot = attributeSlot(attribute);
      const value = element.getAttribute(attribute);
      if (slot === null || !hasMeaningfulText(value)) continue;
      addOccurrence(element, value, slot, {
        type: 'attribute',
        element,
        attribute,
        originalValue: value,
      });
    }
  }

  return {
    occurrences,
    pageProfile: context.pageProfile,
    sections,
  };
};

export const deduplicateOccurrences = (
  occurrences: TextOccurrence[],
): TranslationUnit[] => {
  const units = new Map<string, TranslationUnit>();
  for (const occurrence of occurrences) {
    const existing = units.get(occurrence.semanticKey);
    if (existing !== undefined) {
      existing.occurrences.push(occurrence);
      existing.priority = Math.max(existing.priority, occurrence.priority);
      continue;
    }
    units.set(occurrence.semanticKey, {
      id: `u-${occurrence.semanticKey.slice(4)}`,
      sourceText: occurrence.sourceText,
      normalizedText: occurrence.normalizedText,
      kind: occurrence.kind,
      slot: occurrence.slot,
      contextClass: occurrence.contextClass,
      sectionId: occurrence.sectionId,
      componentId: occurrence.componentId,
      semanticKey: occurrence.semanticKey,
      priority: occurrence.priority,
      occurrences: [occurrence],
      section: occurrence.section,
    });
  }
  return Array.from(units.values());
};

interface ParsedText {
  type: 'text';
  value: string;
}
interface ParsedPlaceholder {
  type: 'g' | 'x';
  id: string;
  children: ParsedNode[];
}
type ParsedNode = ParsedText | ParsedPlaceholder;

const parsePlaceholderTree = (text: string): ParsedNode[] | null => {
  const root: ParsedNode[] = [];
  const lists: ParsedNode[][] = [root];
  const ids: string[] = [];
  const pattern = /<g id="([A-Za-z0-9_-]+)">|<\/g>|<x id="([A-Za-z0-9_-]+)"\/>/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor)
      lists.at(-1)?.push({ type: 'text', value: text.slice(cursor, match.index) });
    if (match[1] !== undefined) {
      const node: ParsedPlaceholder = { type: 'g', id: match[1], children: [] };
      lists.at(-1)?.push(node);
      lists.push(node.children);
      ids.push(match[1]);
    } else if (match[2] !== undefined) {
      lists.at(-1)?.push({ type: 'x', id: match[2], children: [] });
    } else {
      if (lists.length === 1 || ids.pop() === undefined) return null;
      lists.pop();
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length)
    lists.at(-1)?.push({ type: 'text', value: text.slice(cursor) });
  return lists.length === 1 ? root : null;
};

const applyNodes = (
  container: Element,
  nodes: ParsedNode[],
  binding: SegmentBinding,
): void => {
  const availableTextNodes = (binding.originalChildren.get(container) ?? []).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  );
  let textIndex = 0;
  const desired: Node[] = [];

  const appendText = (value: string) => {
    if (value === '') return;
    let textNode = availableTextNodes[textIndex++];
    if (textNode === undefined) {
      textNode = document.createTextNode('');
      binding.createdTextNodes.add(textNode);
    }
    textNode.nodeValue = value;
    desired.push(textNode);
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      appendText(node.value);
      continue;
    }
    const protectedValue = binding.protectedValues.get(node.id);
    if (protectedValue !== undefined) {
      appendText(protectedValue);
      continue;
    }
    const element = binding.placeholders.get(node.id);
    if (element === undefined) continue;
    if (node.type === 'g') applyNodes(element, node.children, binding);
    desired.push(element);
  }

  while (textIndex < availableTextNodes.length) {
    availableTextNodes[textIndex++].nodeValue = '';
  }
  container.replaceChildren(...desired);
};

export const getOccurrenceOriginalText = (occurrence: TextOccurrence): string => {
  if (occurrence.binding.type === 'attribute') return occurrence.binding.originalValue;
  return Array.from(occurrence.binding.originalText.values()).join('');
};

export const applyOccurrenceTranslation = (
  occurrence: TextOccurrence,
  translatedText: string,
): void => {
  if (occurrence.binding.type === 'attribute') {
    occurrence.binding.element.setAttribute(occurrence.binding.attribute, translatedText);
    return;
  }
  const parsed = parsePlaceholderTree(translatedText);
  if (parsed === null)
    throw new Error('Validated placeholder output could not be parsed');
  applyNodes(occurrence.binding.root, parsed, occurrence.binding);
};

export const adoptSourceMutation = (
  occurrence: TextOccurrence,
  mutation: MutationRecord,
): boolean => {
  const binding = occurrence.binding;
  if (binding.type === 'attribute') {
    if (
      mutation.type !== 'attributes' ||
      mutation.target !== binding.element ||
      mutation.attributeName !== binding.attribute
    ) {
      return false;
    }
    binding.originalValue = binding.element.getAttribute(binding.attribute) ?? '';
    return true;
  }

  if (mutation.type === 'characterData' && mutation.target instanceof Text) {
    if (!binding.originalText.has(mutation.target)) return false;
    binding.originalText.set(mutation.target, mutation.target.nodeValue ?? '');
    return true;
  }

  if (mutation.type === 'childList' && mutation.target instanceof Element) {
    if (!binding.originalChildren.has(mutation.target)) return false;
    const children = Array.from(mutation.target.childNodes);
    binding.originalChildren.set(mutation.target, children);
    const rememberNewText = (node: Node) => {
      if (node instanceof Text && !binding.originalText.has(node)) {
        binding.originalText.set(node, node.nodeValue ?? '');
      }
      for (const child of Array.from(node.childNodes)) rememberNewText(child);
    };
    for (const node of children) rememberNewText(node);
    return true;
  }
  return false;
};

export const restoreOccurrence = (occurrence: TextOccurrence): void => {
  if (occurrence.binding.type === 'attribute') {
    occurrence.binding.element.setAttribute(
      occurrence.binding.attribute,
      occurrence.binding.originalValue,
    );
    return;
  }
  const binding = occurrence.binding;
  const containers = Array.from(binding.originalChildren.keys()).reverse();
  for (const container of containers) {
    const children = binding.originalChildren.get(container);
    if (children !== undefined) container.replaceChildren(...children);
  }
  for (const [node, value] of binding.originalText) node.nodeValue = value;
  binding.createdTextNodes.clear();
};
