import {
  type PageTranslationBatchRequest,
  type PageProfile,
  type TranslationContextItem,
  type TranslationRequestContext,
  validatePlaceholderIntegrity,
} from '@/lib/pageTranslation/protocol';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import {
  buildTokenAwareBatches,
  openAICompatibleTokenCounter,
  OutputRatioTracker,
  type PlannedTarget,
} from './batching';
import {
  applyOccurrenceTranslation,
  adoptSourceMutation,
  buildPageProfile,
  collectPageOccurrences,
  deduplicateOccurrences,
  getOccurrenceOriginalText,
  restoreOccurrence,
  type CollectionOptions,
  type TextOccurrence,
  type TranslationUnit,
} from './domPipeline';

export interface PagePipelineMetrics {
  occurrences: number;
  logicalSegments: number;
  uniqueUnits: number;
  deduplicationRatio: number;
  memoryHits: number;
  memoryMisses: number;
  sourceTokens: number;
  contextTokens: number;
  batches: number;
  retries: number;
  validationFailures: number;
  staleCancellations: number;
  terminologyConflicts: number;
  startedAt: number;
  firstVisibleTranslationAt?: number;
}

export interface PageTranslationPipelineOptions extends CollectionOptions {
  root: Element;
  sessionId: string;
  sessionSignature: string;
  contextWindow: number;
  preferredInputTokens: number;
  concurrency?: number;
  debug?: boolean;
  debugIncludeText?: boolean;
  onUnitStarted?: (count: number) => void;
  onUnitResolved?: (count: number) => void;
  onUnitRejected?: (count: number) => void;
  onMetrics?: (metrics: Readonly<PagePipelineMetrics>) => void;
}

interface AcceptedTranslation {
  source: string;
  translation: string;
  sectionId?: string;
  contextClass: string;
  terms: string[];
}

export interface TranslationContextRetriever {
  retrieve(
    unit: TranslationUnit,
    accepted: readonly AcceptedTranslation[],
    limit: number,
  ): TranslationContextItem[];
}

const termsOf = (text: string): string[] =>
  Array.from(
    new Set(
      text
        .replace(/<[^>]+>/gu, ' ')
        .normalize('NFC')
        .match(/[\p{L}\p{N}_-]{4,}/gu) ?? [],
    ),
  ).slice(0, 16);

export class DeterministicContextRetriever implements TranslationContextRetriever {
  public retrieve(
    unit: TranslationUnit,
    accepted: readonly AcceptedTranslation[],
    limit: number,
  ): TranslationContextItem[] {
    const terms = new Set(termsOf(unit.sourceText));
    return accepted
      .map((candidate, index) => {
        let score = 0;
        if (candidate.sectionId === unit.sectionId) score += 6;
        if (candidate.contextClass === unit.contextClass) score += 4;
        for (const term of candidate.terms) if (terms.has(term)) score += 2;
        return { candidate, score, index };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || right.index - left.index)
      .slice(0, limit)
      .map(({ candidate }) => ({
        source: candidate.source,
        translation: candidate.translation,
      }));
  }
}

class TerminologyMemory {
  private readonly choices = new Map<string, Set<string>>();

  public observe(source: string, target: string): boolean {
    if (source.includes('<') || source.length > 48 || source.split(/\s+/u).length > 4) {
      return false;
    }
    let choices = this.choices.get(source);
    if (choices === undefined) {
      choices = new Set();
      this.choices.set(source, choices);
    }
    choices.add(target);
    return choices.size > 1;
  }

  public glossary(limit: number): [string, string][] {
    const result: [string, string][] = [];
    for (const [source, choices] of this.choices) {
      const chosen = choices.values().next().value;
      if (chosen !== undefined) result.push([source, chosen]);
      if (result.length >= limit) break;
    }
    return result.sort(([left], [right]) => left.localeCompare(right));
  }
}

const createMetrics = (): PagePipelineMetrics => ({
  occurrences: 0,
  logicalSegments: 0,
  uniqueUnits: 0,
  deduplicationRatio: 0,
  memoryHits: 0,
  memoryMisses: 0,
  sourceTokens: 0,
  contextTokens: 0,
  batches: 0,
  retries: 0,
  validationFailures: 0,
  staleCancellations: 0,
  terminologyConflicts: 0,
  startedAt: performance.now(),
});

const groupKey = (unit: TranslationUnit): string =>
  `${unit.kind}\u0000${unit.slot}\u0000${unit.contextClass}\u0000${unit.sectionId ?? ''}`;

export class PageTranslationPipeline {
  private readonly pageMemory = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly pendingParts = new Map<
    string,
    { values: (string | undefined)[]; unit: TranslationUnit }
  >();
  private processedSlots = new WeakMap<Element, Set<string>>();
  private appliedText = new WeakMap<Node, string>();
  private appliedAttributes = new WeakMap<Element, Map<string, string>>();
  private appliedChildren = new WeakMap<Element, Node[]>();
  private readonly accepted: AcceptedTranslation[] = [];
  private readonly terminology = new TerminologyMemory();
  private readonly ratioTracker = new OutputRatioTracker();
  private readonly retriever: TranslationContextRetriever;
  private readonly metrics = createMetrics();
  private occurrences: TextOccurrence[] = [];
  private observer: MutationObserver | null = null;
  private generation = 0;
  private pageProfile: PageProfile;
  private currentUrl = location.href;
  private runtimeSessionId: string;
  private runtimeSignature: string;

  constructor(
    private readonly options: PageTranslationPipelineOptions,
    retriever: TranslationContextRetriever = new DeterministicContextRetriever(),
  ) {
    this.retriever = retriever;
    this.pageProfile = buildPageProfile(options.root);
    this.runtimeSessionId = options.sessionId;
    this.runtimeSignature = options.sessionSignature;
  }

  public start(): void {
    const generation = ++this.generation;
    void this.scanAndTranslate(this.options.root, generation);
    this.observer = new MutationObserver((mutations) => {
      void this.onMutations(mutations);
    });
    this.observer.observe(this.options.root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt', 'value', 'hidden'],
    });
  }

  public stop(): void {
    ++this.generation;
    this.observer?.disconnect();
    this.observer = null;
    for (const occurrence of this.occurrences.slice().reverse())
      restoreOccurrence(occurrence);
    this.occurrences = [];
    this.inFlight.clear();
  }

  public getMetrics(): Readonly<PagePipelineMetrics> {
    return this.metrics;
  }
  public getSessionId(): string {
    return this.runtimeSessionId;
  }

  public getOriginalText(element: Element): string {
    for (let index = this.occurrences.length - 1; index >= 0; index--) {
      const occurrence = this.occurrences[index];
      if (occurrence.slot !== 'visible-text') continue;
      if (occurrence.element === element || occurrence.element.contains(element)) {
        return getOccurrenceOriginalText(occurrence);
      }
    }
    return '';
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private emitMetrics(): void {
    this.options.onMetrics?.(this.metrics);
    if (this.options.debug) {
      const payload = {
        session: this.runtimeSessionId,
        provider: this.options.identity.provider,
        model: this.options.identity.model,
        ...this.metrics,
      };
      console.debug('[page-translation]', payload);
    }
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

  private buildContext(
    unit: TranslationUnit,
    orderedUnits: TranslationUnit[],
  ): TranslationRequestContext {
    const previous = this.accepted
      .filter((item) => item.sectionId === unit.sectionId)
      .slice(-2)
      .map((item) => ({ source: item.source, translation: item.translation }));
    const index = orderedUnits.indexOf(unit);
    const followingUnit = index >= 0 ? orderedUnits[index + 1] : undefined;
    return {
      headingPath: unit.section.headingPath,
      previous,
      following:
        followingUnit === undefined ? [] : [{ source: followingUnit.sourceText }],
      retrieved: this.retriever.retrieve(unit, this.accepted, 3),
    };
  }

  private async scanAndTranslate(root: Element, generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return;
    const collected = collectPageOccurrences(root, this.options);
    this.pageProfile = collected.pageProfile;
    const newOccurrences = collected.occurrences.filter((occurrence) => {
      let slots = this.processedSlots.get(occurrence.element);
      if (slots === undefined) {
        slots = new Set();
        this.processedSlots.set(occurrence.element, slots);
      }
      if (slots.has(occurrence.slot)) return false;
      slots.add(occurrence.slot);
      return true;
    });
    if (newOccurrences.length === 0) return;

    this.occurrences.push(...newOccurrences);
    const units = deduplicateOccurrences(newOccurrences).sort(
      (left, right) => right.priority - left.priority,
    );
    this.metrics.occurrences += newOccurrences.length;
    this.metrics.logicalSegments += newOccurrences.filter(
      (occurrence) => occurrence.slot === 'visible-text',
    ).length;
    this.metrics.uniqueUnits += units.length;
    this.metrics.deduplicationRatio =
      this.metrics.occurrences === 0
        ? 0
        : 1 - this.metrics.uniqueUnits / this.metrics.occurrences;

    const waiting: TranslationUnit[] = [];
    for (const unit of units) {
      const cached = this.pageMemory.get(unit.semanticKey);
      if (cached !== undefined) {
        this.metrics.memoryHits++;
        if (this.isCurrent(generation)) this.applyUnit(unit, cached);
      } else {
        this.metrics.memoryMisses++;
        waiting.push(unit);
      }
    }
    if (waiting.length === 0) {
      this.emitMetrics();
      return;
    }

    const groups = new Map<string, TranslationUnit[]>();
    for (const unit of waiting) {
      const key = groupKey(unit);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [unit]);
      else group.push(unit);
    }

    const jobs: (() => Promise<void>)[] = [];
    for (const group of groups.values()) {
      const context = this.buildContext(group[0], units);
      const batches = buildTokenAwareBatches(group, {
        sourceLanguage: this.options.sourceLanguage,
        targetLanguage: this.options.targetLanguage,
        contextWindow: this.options.contextWindow,
        preferredInputTokens: this.options.preferredInputTokens,
        pageProfile: this.pageProfile,
        context,
        outputRatio: this.ratioTracker.get(
          this.options.sourceLanguage,
          this.options.targetLanguage,
        ),
      });
      for (const batch of batches) {
        this.metrics.batches++;
        this.metrics.sourceTokens += batch.sourceTokens;
        this.metrics.contextTokens += openAICompatibleTokenCounter.count(
          JSON.stringify(context),
        );
        jobs.push(() => this.translateBatch(batch.targets, context, generation));
      }
    }
    await this.runLimited(jobs, this.options.concurrency ?? 2);
    this.emitMetrics();
  }

  private async runLimited(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        await job();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, jobs.length) }, () => worker()),
    );
  }

  private async translateBatch(
    planned: PlannedTarget[],
    context: TranslationRequestContext,
    generation: number,
  ): Promise<void> {
    const fresh = planned.filter((item) => !this.inFlight.has(item.target.id));
    if (fresh.length === 0) {
      await Promise.all(planned.map((item) => this.inFlight.get(item.target.id)));
      const applied = new Set<string>();
      for (const item of planned) {
        if (applied.has(item.unit.semanticKey)) continue;
        const translated = this.pageMemory.get(item.unit.semanticKey);
        if (translated !== undefined && this.isCurrent(generation)) {
          this.applyUnit(item.unit, translated);
          applied.add(item.unit.semanticKey);
        }
      }
      return;
    }

    this.options.onUnitStarted?.(fresh.length);
    const request: PageTranslationBatchRequest = {
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: this.options.targetLanguage,
      sessionId: this.runtimeSessionId,
      sessionSignature: this.runtimeSignature,
      memory: {
        ...this.pageProfile,
        glossary: this.terminology.glossary(24),
      },
      section: fresh[0].unit.section,
      context,
      group: {
        kind: fresh[0].unit.kind,
        slot: fresh[0].unit.slot,
        contextClass: fresh[0].unit.contextClass,
      },
      targets: fresh.map((item) => item.target),
      retryStage: 'initial',
    };
    if (this.options.debug) {
      console.debug('[page-translation] batch', {
        session: this.runtimeSessionId,
        group: request.group,
        contextTokens: openAICompatibleTokenCounter.count(JSON.stringify(context)),
        targets: fresh.map((item) => ({
          id: item.target.id,
          kind: item.target.kind,
          slot: item.target.slot,
          contextClass: item.target.contextClass,
          tokens: openAICompatibleTokenCounter.count(item.target.sourceText),
          ...(this.options.debugIncludeText
            ? { sourceText: item.target.sourceText }
            : {}),
        })),
      });
    }

    const batchPromise = translatePageBatch(request);
    for (const item of fresh) {
      const promise = batchPromise.then((response) => {
        const matching = response.translations.find(
          (translation) => translation.id === item.target.id,
        );
        if (matching === undefined)
          throw new Error(`Missing translation ${item.target.id}`);
        return matching.target;
      });
      this.inFlight.set(item.target.id, promise);
    }

    try {
      const response = await batchPromise;
      if (response.metrics !== undefined) {
        this.metrics.retries += response.metrics.retryCount;
        this.metrics.validationFailures += response.metrics.validationFailures;
      }
      const completedUnits = new Set<string>();
      for (const item of fresh) {
        const matching = response.translations.find(
          (translation) => translation.id === item.target.id,
        );
        if (matching === undefined)
          throw new Error(`Missing translation ${item.target.id}`);
        let assembly = this.pendingParts.get(item.unit.semanticKey);
        if (assembly === undefined) {
          assembly = {
            values: new Array<string | undefined>(item.partCount),
            unit: item.unit,
          };
          this.pendingParts.set(item.unit.semanticKey, assembly);
        }
        assembly.values[item.partIndex] = matching.target;
        if (matching.cacheHit) this.metrics.memoryHits++;
      }

      for (const item of fresh) {
        if (completedUnits.has(item.unit.semanticKey)) continue;
        const assembly = this.pendingParts.get(item.unit.semanticKey);
        if (
          assembly === undefined ||
          assembly.values.some((value) => value === undefined)
        ) {
          continue;
        }
        completedUnits.add(item.unit.semanticKey);
        const translated = assembly.values.join('');
        this.pendingParts.delete(item.unit.semanticKey);
        if (!validatePlaceholderIntegrity(item.unit.sourceText, translated)) {
          this.metrics.validationFailures++;
          throw new Error(`Placeholder validation failed for ${item.unit.id}`);
        }
        this.pageMemory.set(item.unit.semanticKey, translated);
        this.ratioTracker.observe(
          this.options.sourceLanguage,
          this.options.targetLanguage,
          openAICompatibleTokenCounter.count(item.unit.sourceText),
          openAICompatibleTokenCounter.count(translated),
        );
        this.observeAccepted(item.unit, translated);
        if (this.isCurrent(generation)) {
          this.applyUnit(item.unit, translated);
          this.options.onUnitResolved?.(assembly.values.length);
        } else {
          this.metrics.staleCancellations++;
        }
      }
    } catch (error) {
      this.options.onUnitRejected?.(fresh.length);
      if (this.options.debug) console.warn('[page-translation] batch failed', error);
    } finally {
      for (const item of fresh) this.inFlight.delete(item.target.id);
    }
  }

  private observeAccepted(unit: TranslationUnit, translation: string): void {
    this.accepted.push({
      source: unit.sourceText,
      translation,
      sectionId: unit.sectionId,
      contextClass: unit.contextClass,
      terms: termsOf(unit.sourceText),
    });
    if (this.terminology.observe(unit.normalizedText, translation)) {
      this.metrics.terminologyConflicts++;
    }
  }

  private applyUnit(unit: TranslationUnit, translation: string): void {
    for (const occurrence of unit.occurrences) {
      applyOccurrenceTranslation(occurrence, translation);
      this.markApplied(occurrence);
    }
    if (this.metrics.firstVisibleTranslationAt === undefined && unit.priority >= 4) {
      this.metrics.firstVisibleTranslationAt = performance.now();
    }
  }

  private adoptApplicationMutation(mutation: MutationRecord): Element | null {
    for (let index = this.occurrences.length - 1; index >= 0; index--) {
      const occurrence = this.occurrences[index];
      if (!occurrence.element.contains(mutation.target)) continue;
      if (!adoptSourceMutation(occurrence, mutation)) continue;
      restoreOccurrence(occurrence);
      this.occurrences.splice(index, 1);
      this.processedSlots.get(occurrence.element)?.delete(occurrence.slot);
      return occurrence.element;
    }
    return null;
  }

  private async onMutations(mutations: MutationRecord[]): Promise<void> {
    if (location.href !== this.currentUrl) {
      const previousSession = this.runtimeSessionId;
      this.currentUrl = location.href;
      ++this.generation;
      this.metrics.staleCancellations++;
      await abortTranslation({ context: previousSession }).catch(() => undefined);
      for (const occurrence of this.occurrences.slice().reverse())
        restoreOccurrence(occurrence);
      this.occurrences = [];
      this.pageMemory.clear();
      this.inFlight.clear();
      this.pendingParts.clear();
      this.accepted.length = 0;
      this.processedSlots = new WeakMap();
      this.appliedText = new WeakMap();
      this.appliedAttributes = new WeakMap();
      this.appliedChildren = new WeakMap();
      this.runtimeSessionId = crypto.randomUUID();
      this.runtimeSignature = `${this.currentUrl}\u0000${this.options.sourceLanguage}\u0000${this.options.targetLanguage}\u0000${this.options.identity.provider}\u0000${this.options.identity.model}\u0000${this.runtimeSessionId}`;
      const generation = ++this.generation;
      await this.scanAndTranslate(this.options.root, generation);
      return;
    }

    const roots = new Set<Element>();
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const current = mutation.target.nodeValue ?? '';
        if (this.appliedText.get(mutation.target) === current) continue;
        const root = this.adoptApplicationMutation(mutation);
        if (root !== null) roots.add(root);
        else if (mutation.target.parentElement !== null) {
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
        const root = this.adoptApplicationMutation(mutation);
        roots.add(root ?? mutation.target);
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
        const root = this.adoptApplicationMutation(mutation);
        if (root !== null) {
          roots.add(root);
          continue;
        }
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) roots.add(node);
        else if (node.parentElement !== null) roots.add(node.parentElement);
      }
    }
    const generation = this.generation;
    for (const root of roots) await this.scanAndTranslate(root, generation);
  }
}
