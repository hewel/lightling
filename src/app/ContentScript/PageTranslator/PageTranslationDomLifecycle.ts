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
}

export class PageTranslationDomLifecycle {
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
    this.restoreOccurrences();
  }

  public resetForNavigation(): void {
    this.observer?.disconnect();
    this.restoreOccurrences();
    this.observer?.takeRecords();
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
      if (pageTranslationProvenance.isOurs(mutation.target)) {
        const occurrence = this.findOccurrence(mutation);
        if (occurrence !== null) {
          this.restoreExternalMutation(occurrence, mutation);
          this.options.removeOccurrence(occurrence);
          this.options.clearProcessedSlot(occurrence);
          roots.add(occurrence.element);
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

  private applyUnit(unit: TranslationUnit, translation: string): void {
    for (const occurrence of unit.occurrences) {
      applyOccurrenceTranslation(occurrence, translation);
    }
    this.options.onApplied?.(unit);
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
}
