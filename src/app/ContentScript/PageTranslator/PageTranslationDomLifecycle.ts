import {
  adoptSourceMutation,
  applyOccurrenceTranslation,
  restoreOccurrence,
  type TextOccurrence,
  type TranslationUnit,
} from './domPipeline';

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
      if (mutation.type === 'characterData') {
        const current = mutation.target.nodeValue ?? '';
        if (this.appliedText.get(mutation.target) === current) continue;
        const adopted = this.adoptApplicationMutation(mutation);
        if (adopted !== null) {
          if (adopted.rescan) roots.add(adopted.root);
        } else if (mutation.target.parentElement !== null) {
          roots.add(mutation.target.parentElement);
        }
        continue;
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        const attribute = mutation.attributeName;
        const expected = this.appliedAttributes
          .get(mutation.target)
          ?.get(attribute ?? '');
        if (attribute !== null && expected === mutation.target.getAttribute(attribute))
          continue;
        const adopted = this.adoptApplicationMutation(mutation);
        if (adopted === null) roots.add(mutation.target);
        else if (adopted.rescan) roots.add(adopted.root);
        continue;
      }
      if (mutation.type === 'childList' && mutation.target instanceof Element) {
        const expected = this.appliedChildren.get(mutation.target);
        const current = Array.from(mutation.target.childNodes);
        if (
          expected !== undefined &&
          expected.length === current.length &&
          expected.every((node, index) => node === current[index])
        ) {
          continue;
        }
        const adopted = this.adoptApplicationMutation(mutation);
        if (adopted !== null) {
          if (adopted.rescan) roots.add(adopted.root);
          continue;
        }
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) roots.add(node);
        else if (node.parentElement !== null) roots.add(node.parentElement);
      }
    }
    this.options.onMutationLoop?.(
      mutations.length,
      performance.now() - mutationLoopStartedAt,
    );
    return roots;
  }

  private restoreOccurrences(): void {
    for (const occurrence of this.options.getOccurrences().slice().reverse()) {
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

  private adoptApplicationMutation(
    mutation: MutationRecord,
  ): { root: Element; rescan: boolean } | null {
    const occurrences = this.options.getOccurrences();
    for (let index = occurrences.length - 1; index >= 0; index--) {
      const occurrence = occurrences[index];
      if (!occurrence.element.contains(mutation.target)) continue;
      const sourceReset = this.isSourceReset(occurrence, mutation);
      if (!adoptSourceMutation(occurrence, mutation)) continue;

      const shouldBackOff =
        sourceReset || this.hasRepeatedMutationConflict(occurrence.element);
      restoreOccurrence(occurrence);
      this.observer?.takeRecords();
      this.options.removeOccurrence(occurrence);

      if (shouldBackOff) {
        this.options.onVolatileBackoff?.();
        this.volatileElements.add(occurrence.element);
        for (let queueIndex = this.applyQueue.length - 1; queueIndex >= 0; queueIndex--) {
          if (this.applyQueue[queueIndex].unit.occurrences.includes(occurrence)) {
            this.applyQueue.splice(queueIndex, 1);
          }
        }
        return { root: occurrence.element, rescan: false };
      }

      this.options.clearProcessedSlot(occurrence);
      return { root: occurrence.element, rescan: true };
    }
    return null;
  }
}
