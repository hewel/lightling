import {
  applyOccurrenceTranslation,
  restoreOccurrence,
  type TextOccurrence,
  type TranslationUnit,
} from './domPipeline';
import { pageTranslationProvenance } from './PageTranslationProvenance';

const PAGE_MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['placeholder', 'title', 'aria-label', 'alt', 'value', 'hidden'],
};

const yieldToMain = (): Promise<void> => {
  if (
    'scheduler' in globalThis &&
    typeof globalThis.scheduler === 'object' &&
    globalThis.scheduler !== null &&
    'yield' in globalThis.scheduler &&
    typeof globalThis.scheduler.yield === 'function'
  ) {
    return globalThis.scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
};

export interface PageTranslationDomLifecycleOptions {
  root: Element;
  getOccurrences: () => TextOccurrence[];
  removeOccurrence: (occurrence: TextOccurrence) => void;
  clearProcessedSlot: (occurrence: TextOccurrence) => void;
  isCurrent: (generation: number) => boolean;
  onMutations: (mutations: MutationRecord[]) => Promise<void>;
  onUnitResolved?: (count: number) => void;
  onApplied?: (unit: TranslationUnit) => void;
  onApplyChunk?: (elapsed: number) => void;
  onMutationLoop?: (records: number, elapsed: number) => void;
  onVolatileBackoff?: () => void;
}

export class PageTranslationDomLifecycle {
  private appliedText = new WeakMap<Node, string>();
  private appliedAttributes = new WeakMap<Element, Map<string, string>>();
  private appliedChildren = new WeakMap<Element, Node[]>();
  private mutationConflicts = new WeakMap<
    Element,
    { count: number; windowStartedAt: number }
  >();
  private readonly volatileElements = new Set<Element>();
  private observer: MutationObserver | null = null;
  private readonly applyQueue: {
    unit: TranslationUnit;
    translation: string;
    generation: number;
    resolvedParts?: number;
  }[] = [];
  private applyPumpRunning = false;
  private static readonly APPLY_CHUNK_OCCURRENCES = 24;

  constructor(private readonly options: PageTranslationDomLifecycleOptions) {}

  public start(): void {
    this.observer = new MutationObserver((mutations) => {
      void this.options.onMutations(mutations);
    });
    this.observer.observe(this.options.root, PAGE_MUTATION_OBSERVER_OPTIONS);
  }

  public stop(): void {
    this.observer?.disconnect();
    this.observer?.takeRecords();
    this.observer = null;
    this.applyQueue.length = 0;
    this.mutationConflicts = new WeakMap();
    this.volatileElements.clear();
    this.restoreOccurrences();
    this.resetAppliedState();
  }

  public resetForNavigation(): void {
    this.observer?.disconnect();
    this.restoreOccurrences();
    this.observer?.takeRecords();
    this.resetAppliedState();
    this.mutationConflicts = new WeakMap();
    this.volatileElements.clear();
    this.observer?.observe(this.options.root, PAGE_MUTATION_OBSERVER_OPTIONS);
  }

  public scheduleApply(
    unit: TranslationUnit,
    translation: string,
    generation: number,
    resolvedParts?: number,
  ): void {
    this.applyQueue.push({ unit, translation, generation, resolvedParts });
    if (this.applyPumpRunning) return;
    this.applyPumpRunning = true;
    queueMicrotask(() => {
      void this.pumpApplies();
    });
  }

  public collectRescanRoots(mutations: MutationRecord[]): Set<Element> {
    const roots = new Set<Element>();
    const mutationLoopStartedAt = performance.now();
    for (const mutation of mutations) {
      if (this.isVolatileMutationTarget(mutation.target)) continue;
      if (this.isAppliedMutation(mutation)) continue;
      if (pageTranslationProvenance.isOurs(mutation.target)) {
        const occurrence = this.findOccurrence(mutation);
        if (occurrence !== null) {
          const shouldBackOff =
            this.isSourceReset(occurrence, mutation) ||
            this.hasRepeatedMutationConflict(occurrence.element);
          this.restoreExternalMutation(occurrence, mutation);
          this.options.removeOccurrence(occurrence);
          if (shouldBackOff) {
            this.options.onVolatileBackoff?.();
            this.volatileElements.add(occurrence.element);
            this.removeQueuedOccurrence(occurrence);
          } else {
            this.options.clearProcessedSlot(occurrence);
            roots.add(occurrence.element);
          }
        } else {
          // A marked subtree with no matching source occurrence is still owned by
          // the translator. Keep its output out of incremental collection.
        }
        continue;
      }
      if (this.isOurMutation(mutation)) continue;
      this.addMutationRoot(roots, mutation);
    }
    this.options.onMutationLoop?.(
      mutations.length,
      performance.now() - mutationLoopStartedAt,
    );
    return roots;
  }

  private isAppliedMutation(mutation: MutationRecord): boolean {
    if (mutation.type === 'characterData') {
      return this.appliedText.get(mutation.target) === mutation.target.nodeValue;
    }
    if (mutation.type === 'attributes' && mutation.target instanceof Element) {
      const attribute = mutation.attributeName;
      if (attribute === null) return false;
      return (
        this.appliedAttributes.get(mutation.target)?.get(attribute) ===
        mutation.target.getAttribute(attribute)
      );
    }
    if (mutation.type !== 'childList' || !(mutation.target instanceof Element)) {
      return false;
    }
    const expected = this.appliedChildren.get(mutation.target);
    const current = Array.from(mutation.target.childNodes);
    if (expected === undefined || expected.length !== current.length) return false;
    if (expected.every((node, index) => node === current[index])) return true;

    const occurrence = this.findOccurrence(mutation);
    return (
      occurrence !== null &&
      this.adoptEquivalentTextReplacement(occurrence, mutation.target, expected, current)
    );
  }

  private adoptEquivalentTextReplacement(
    occurrence: TextOccurrence,
    target: Element,
    expected: Node[],
    current: Node[],
  ): boolean {
    const binding = occurrence.binding;
    if (binding.type === 'attribute') return false;
    const originalChildren = binding.originalChildren.get(target);
    if (originalChildren === undefined || originalChildren.length !== expected.length) {
      return false;
    }

    const replacements: {
      previous: Text;
      replacement: Text;
      originalText: string;
      originalIndex: number;
    }[] = [];
    for (let index = 0; index < expected.length; index++) {
      const previous = expected[index];
      const replacement = current[index];
      if (previous === replacement) continue;
      if (
        !(previous instanceof Text) ||
        !(replacement instanceof Text) ||
        previous.nodeValue !== replacement.nodeValue
      ) {
        return false;
      }
      const originalText = binding.originalText.get(previous);
      const originalIndex = originalChildren.indexOf(previous);
      if (originalText === undefined || originalIndex < 0) return false;
      replacements.push({ previous, replacement, originalText, originalIndex });
    }
    if (replacements.length === 0) return false;

    const adoptedOriginalChildren = [...originalChildren];
    for (const { previous, replacement, originalText, originalIndex } of replacements) {
      adoptedOriginalChildren[originalIndex] = replacement;
      binding.originalText.delete(previous);
      binding.originalText.set(replacement, originalText);
      this.appliedText.delete(previous);
      this.appliedText.set(replacement, replacement.nodeValue ?? '');
      pageTranslationProvenance.markNodes([replacement]);
    }
    binding.originalChildren.set(target, adoptedOriginalChildren);
    this.appliedChildren.set(target, current);
    return true;
  }

  private isOurMutation(mutation: MutationRecord): boolean {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) return false;
    return Array.from(mutation.addedNodes).every((node) =>
      pageTranslationProvenance.isOurs(node),
    );
  }

  private addMutationRoot(roots: Set<Element>, mutation: MutationRecord): void {
    if (mutation.target instanceof Element) {
      roots.add(mutation.target);
      return;
    }
    if (mutation.target.parentElement !== null) roots.add(mutation.target.parentElement);
    for (const node of Array.from(mutation.addedNodes)) {
      if (node instanceof Element) roots.add(node);
      else if (node.parentElement !== null) roots.add(node.parentElement);
    }
  }

  private findOccurrence(mutation: MutationRecord): TextOccurrence | null {
    const occurrences = this.options.getOccurrences();
    for (let index = occurrences.length - 1; index >= 0; index--) {
      const occurrence = occurrences[index];
      const binding = occurrence.binding;
      if (
        binding.type === 'attribute' &&
        mutation.type === 'attributes' &&
        mutation.target === binding.element &&
        mutation.attributeName === binding.attribute
      ) {
        return occurrence;
      }
      if (
        binding.type === 'segment' &&
        mutation.type === 'characterData' &&
        mutation.target instanceof Text &&
        binding.originalText.has(mutation.target)
      ) {
        return occurrence;
      }
      if (
        binding.type === 'segment' &&
        mutation.type === 'childList' &&
        mutation.target instanceof Element &&
        binding.originalChildren.has(mutation.target)
      ) {
        return occurrence;
      }
    }
    return null;
  }

  private unmarkSubtree(node: Node): void {
    pageTranslationProvenance.unmark(node);
    for (const child of Array.from(node.childNodes)) this.unmarkSubtree(child);
  }

  private unmarkOccurrence(occurrence: TextOccurrence): void {
    if (occurrence.binding.type === 'attribute') {
      pageTranslationProvenance.unmark(occurrence.binding.element);
      return;
    }
    this.unmarkSubtree(occurrence.element);
    for (const [container, children] of occurrence.binding.originalChildren) {
      pageTranslationProvenance.unmark(container);
      for (const child of children) this.unmarkSubtree(child);
    }
    for (const node of occurrence.binding.originalText.keys()) {
      pageTranslationProvenance.unmark(node);
    }
    for (const element of occurrence.binding.placeholders.values()) {
      this.unmarkSubtree(element);
    }
  }
  private restoreExternalMutation(
    occurrence: TextOccurrence,
    mutation: MutationRecord,
  ): void {
    const externalText =
      mutation.type === 'characterData' && mutation.target instanceof Text
        ? mutation.target.nodeValue
        : null;
    const externalAttribute =
      mutation.type === 'attributes' &&
      mutation.target instanceof Element &&
      mutation.attributeName !== null
        ? {
            name: mutation.attributeName,
            value: mutation.target.getAttribute(mutation.attributeName),
          }
        : null;
    const externalChildren =
      mutation.type === 'childList' && mutation.target instanceof Element
        ? Array.from(mutation.target.childNodes)
        : null;

    this.unmarkOccurrence(occurrence);
    restoreOccurrence(occurrence);
    this.observer?.takeRecords();

    if (externalText !== null && mutation.target instanceof Text) {
      mutation.target.nodeValue = externalText;
    } else if (externalAttribute !== null && mutation.target instanceof Element) {
      if (externalAttribute.value === null) {
        mutation.target.removeAttribute(externalAttribute.name);
      } else {
        mutation.target.setAttribute(externalAttribute.name, externalAttribute.value);
      }
    } else if (externalChildren !== null && mutation.target instanceof Element) {
      mutation.target.replaceChildren(...externalChildren);
    }
    this.observer?.takeRecords();
  }

  private restoreOccurrences(): void {
    for (const occurrence of this.options.getOccurrences().slice().reverse()) {
      this.unmarkOccurrence(occurrence);
      restoreOccurrence(occurrence);
    }
    this.observer?.takeRecords();
  }
  private resetAppliedState(): void {
    this.appliedText = new WeakMap();
    this.appliedAttributes = new WeakMap();
    this.appliedChildren = new WeakMap();
  }

  private applyUnit(unit: TranslationUnit, translation: string): void {
    for (const occurrence of unit.occurrences) {
      applyOccurrenceTranslation(occurrence, translation);
      this.markApplied(occurrence);
    }
    this.options.onApplied?.(unit);
  }

  private markApplied(occurrence: TextOccurrence): void {
    if (occurrence.binding.type === 'attribute') {
      let attributes = this.appliedAttributes.get(occurrence.binding.element);
      if (attributes === undefined) {
        attributes = new Map();
        this.appliedAttributes.set(occurrence.binding.element, attributes);
      }
      attributes.set(
        occurrence.binding.attribute,
        occurrence.binding.element.getAttribute(occurrence.binding.attribute) ?? '',
      );
      return;
    }
    this.appliedChildren.set(
      occurrence.element,
      Array.from(occurrence.element.childNodes),
    );
    for (const node of Array.from(occurrence.element.childNodes)) {
      this.markAppliedNode(node);
    }
  }

  private markAppliedNode(node: Node): void {
    if (node instanceof Text) this.appliedText.set(node, node.nodeValue ?? '');
    if (node instanceof Element) {
      this.appliedChildren.set(node, Array.from(node.childNodes));
    }
    for (const child of Array.from(node.childNodes)) this.markAppliedNode(child);
  }

  private async pumpApplies(): Promise<void> {
    try {
      while (this.applyQueue.length > 0) {
        const pendingExternalMutations = this.observer?.takeRecords() ?? [];
        const chunkStartedAt = performance.now();
        let chunkOccurrences = 0;

        while (
          this.applyQueue.length > 0 &&
          chunkOccurrences < PageTranslationDomLifecycle.APPLY_CHUNK_OCCURRENCES
        ) {
          const item = this.applyQueue.shift();
          if (item === undefined) break;
          if (!this.options.isCurrent(item.generation)) continue;
          this.applyUnit(item.unit, item.translation);
          if (item.resolvedParts !== undefined) {
            this.options.onUnitResolved?.(item.resolvedParts);
          }
          chunkOccurrences += Math.max(1, item.unit.occurrences.length);
        }

        this.observer?.takeRecords();
        this.options.onApplyChunk?.(performance.now() - chunkStartedAt);
        if (pendingExternalMutations.length > 0) {
          await this.options.onMutations(pendingExternalMutations);
        }
        if (this.applyQueue.length > 0) await yieldToMain();
      }
    } finally {
      this.applyPumpRunning = false;
    }
  }
  private isVolatileMutationTarget(target: Node): boolean {
    for (const element of this.volatileElements) {
      if (!element.isConnected) {
        this.volatileElements.delete(element);
        continue;
      }
      if (element === target || element.contains(target)) return true;
    }
    return false;
  }

  private isSourceReset(occurrence: TextOccurrence, mutation: MutationRecord): boolean {
    const binding = occurrence.binding;
    if (binding.type === 'attribute') {
      return (
        mutation.type === 'attributes' &&
        mutation.target === binding.element &&
        mutation.attributeName === binding.attribute &&
        binding.element.getAttribute(binding.attribute) === binding.originalValue
      );
    }
    if (
      mutation.type === 'characterData' &&
      mutation.target instanceof Text &&
      binding.originalText.get(mutation.target) === mutation.target.nodeValue
    ) {
      return true;
    }
    if (mutation.type !== 'childList' || !(mutation.target instanceof Element)) {
      return false;
    }
    const originalChildren = binding.originalChildren.get(mutation.target);
    if (originalChildren === undefined) return false;
    const readOriginalText = (node: Node): string => {
      if (node instanceof Text) {
        return binding.originalText.get(node) ?? node.nodeValue ?? '';
      }
      if (!(node instanceof Element)) return '';
      const children = binding.originalChildren.get(node);
      if (children === undefined) return node.textContent ?? '';
      return children.map(readOriginalText).join('');
    };
    return (
      mutation.target.textContent === originalChildren.map(readOriginalText).join('')
    );
  }

  private hasRepeatedMutationConflict(element: Element): boolean {
    const now = performance.now();
    const existing = this.mutationConflicts.get(element);
    if (existing === undefined || now - existing.windowStartedAt > 1000) {
      this.mutationConflicts.set(element, { count: 1, windowStartedAt: now });
      return false;
    }
    existing.count++;
    return existing.count >= 3;
  }

  private removeQueuedOccurrence(occurrence: TextOccurrence): void {
    for (let index = this.applyQueue.length - 1; index >= 0; index--) {
      if (this.applyQueue[index].unit.occurrences.includes(occurrence)) {
        this.applyQueue.splice(index, 1);
      }
    }
  }
}
