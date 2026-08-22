import {
  PAGE_TRANSLATION_LOG_SCHEMA_VERSION,
  type PageTranslationLog,
  type PageTranslationLogBatch,
} from '@/lib/pageTranslation/log';
import {
  type PageTranslationBatchRequest,
  type PageProfile,
  type TranslationContextItem,
  type TranslationRequestContext,
  validatePlaceholderIntegrity,
} from '@/lib/pageTranslation/protocol';
import {
  OutputRatioTracker,
  type TranslationTokenBudget,
} from '@/lib/translators/llm/budget';
import {
  AdaptiveBatchTuner,
  type TranslationModelProfile,
} from '@/lib/translators/llm/modelProfile';
import type { TranslationTokenCounter } from '@/lib/translators/llm/tokenizer';
import { createUUID } from '@/lib/utils';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import { buildTokenAwareBatches, type PlannedTarget } from './batching';
import {
  applyOccurrenceTranslation,
  adoptSourceMutation,
  collectPageOccurrences,
  createPageCollectionContext,
  deduplicateOccurrences,
  getOccurrenceOriginalText,
  restoreOccurrence,
  type CollectionOptions,
  type PageCollectionContext,
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
  modelProfile: TranslationModelProfile;
  tokenCounter: TranslationTokenCounter;
  logEnabled?: boolean;
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
  `${unit.kind}\\u0000${unit.slot}\\u0000${unit.contextClass}\\u0000${unit.sectionId ?? ''}`;

/**
 * Yields to the event loop so bulk DOM writes never monopolize the main
 * thread. Prefers `scheduler.yield()` (no clamping) where available.
 */
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

const PAGE_MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['placeholder', 'title', 'aria-label', 'alt', 'value', 'hidden'],
};

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
  private mutationConflicts = new WeakMap<
    Element,
    { count: number; windowStartedAt: number }
  >();
  private readonly volatileElements = new Set<Element>();
  private readonly accepted: AcceptedTranslation[] = [];
  private readonly terminology = new TerminologyMemory();
  private readonly ratioTracker = new OutputRatioTracker();
  private readonly adaptiveTuner = new AdaptiveBatchTuner();
  private readonly retriever: TranslationContextRetriever;
  private metrics = createMetrics();
  private occurrences: TextOccurrence[] = [];
  private observer: MutationObserver | null = null;
  /** [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis. */
  private perfObserver: PerformanceObserver | null = null;
  /** [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis. */
  private readonly perfProbe = {
    longTasks: 0,
    longTaskTotalMs: 0,
    longTaskMaxMs: 0,
    collectCalls: 0,
    collectTotalMs: 0,
    collectMaxMs: 0,
    applyChunks: 0,
    applyTotalMs: 0,
    applyMaxChunkMs: 0,
    mutationCallbacks: 0,
    mutationRecords: 0,
    volatileBackoffs: 0,
    mutationMaxRecords: 0,
    mutationTotalMs: 0,
    mutationMaxMs: 0,
  };
  private generation = 0;
  private pageCollectionContext: PageCollectionContext;
  private pageProfile: PageProfile;
  private currentUrl = location.href;
  private runtimeSessionId: string;
  private runtimeSignature: string;
  private readonly logBatches: PageTranslationLogBatch[] | null;
  private droppedLogBatches = 0;
  private logBatchSerial = 0;
  private sessionStartedAt = Date.now();

  constructor(
    private readonly options: PageTranslationPipelineOptions,
    retriever: TranslationContextRetriever = new DeterministicContextRetriever(),
  ) {
    this.retriever = retriever;
    this.pageCollectionContext = createPageCollectionContext(options.root);
    this.pageProfile = this.pageCollectionContext.pageProfile;
    this.runtimeSessionId = options.sessionId;
    this.runtimeSignature = options.sessionSignature;
    this.logBatches = options.logEnabled ? [] : null;
  }

  public start(): void {
    const generation = ++this.generation;
    void this.scanAndTranslate(this.options.root, generation);
    this.observer = new MutationObserver((mutations) => {
      void this.onMutations(mutations);
    });
    this.observer.observe(this.options.root, PAGE_MUTATION_OBSERVER_OPTIONS);
    // [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis.
    if (this.logBatches !== null) {
      try {
        this.perfObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.perfProbe.longTasks++;
            this.perfProbe.longTaskTotalMs += entry.duration;
            this.perfProbe.longTaskMaxMs = Math.max(
              this.perfProbe.longTaskMaxMs,
              entry.duration,
            );
          }
        });
        this.perfObserver.observe({ entryTypes: ['longtask'] });
      } catch {
        this.perfObserver = null;
      }
    }
  }

  public stop(): void {
    ++this.generation;
    this.observer?.disconnect();
    this.observer = null;
    this.perfObserver?.disconnect();
    this.perfObserver = null;
    this.applyQueue.length = 0;
    this.mutationConflicts = new WeakMap();
    this.volatileElements.clear();
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
  public getLog(): PageTranslationLog | null {
    if (this.logBatches === null) return null;
    return {
      schemaVersion: PAGE_TRANSLATION_LOG_SCHEMA_VERSION,
      exportedAt: Date.now(),
      session: {
        id: this.runtimeSessionId,
        signature: this.runtimeSignature,
        url: this.currentUrl,
        documentTitle: document.title,
        sourceLanguage: this.options.sourceLanguage,
        targetLanguage: this.options.targetLanguage,
        provider: this.options.identity.provider,
        model: this.options.identity.model,
        startedAt: this.sessionStartedAt,
      },
      pageProfile: structuredClone(this.pageProfile),
      metrics: { ...this.metrics },
      batches: structuredClone(this.logBatches),
      droppedBatches: this.droppedLogBatches,
      debugPerf: { ...this.perfProbe },
    };
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

  private appendLogBatch(batch: PageTranslationLogBatch): void {
    if (this.logBatches === null) return;
    const maximumBatches = 200;
    if (this.logBatches.length >= maximumBatches) {
      this.logBatches.shift();
      this.droppedLogBatches++;
    }
    this.logBatches.push(batch);
  }

  private recordPageMemoryHit(unit: TranslationUnit, translatedText: string): void {
    if (this.logBatches === null) return;
    const now = Date.now();
    const sourceTokens = this.options.tokenCounter.count(unit.sourceText);
    this.appendLogBatch({
      batchId: ++this.logBatchSerial,
      queuedAt: now,
      completedAt: now,
      sourceTokens,
      sourceBudget: this.options.modelProfile.batching.preferredSourceTokens,
      group: {
        kind: unit.kind,
        slot: unit.slot,
        contextClass: unit.contextClass,
      },
      context: {
        headingPath: unit.section.headingPath,
        previous: [],
        following: [],
        retrieved: [],
      },
      targets: [
        {
          id: unit.id,
          semanticKey: unit.semanticKey,
          sourceText: unit.sourceText,
          translatedText,
          kind: unit.kind,
          slot: unit.slot,
          contextClass: unit.contextClass,
          sectionId: unit.sectionId,
          componentId: unit.componentId,
          priority: unit.priority,
          cacheHit: true,
          status: 'translated',
        },
      ],
      retryCount: 0,
      validationFailures: 0,
      profile: {
        id: this.options.modelProfile.id,
        profileVersion: this.options.modelProfile.profileVersion,
        promptVersion: this.options.modelProfile.promptVersion,
        tokenizerId: this.options.tokenCounter.id,
        promptVariant: this.options.modelProfile.promptVariant,
        structuredOutput: this.options.modelProfile.structuredOutputMode,
        reasoning: this.options.modelProfile.reasoningMode,
      },
      tokenBudget: {
        contextWindow: this.options.modelProfile.contextWindow,
        fixedPromptTokens: 0,
        pageMemoryTokens: 0,
        sectionMemoryTokens: 0,
        localContextTokens: 0,
        retrievedContextTokens: 0,
        sourceTokens,
        schemaTokens: 0,
        reservedOutputTokens: 0,
        safetyReserveTokens: 0,
        totalEstimatedTokens: sourceTokens,
      },
      reductions: [],
    });
  }

  private buildContext(
    unit: TranslationUnit,
    orderedUnits: TranslationUnit[],
  ): TranslationRequestContext {
    const variant = this.options.modelProfile.promptVariant;
    const previousLimit = variant === 'compact' ? 1 : variant === 'advanced' ? 3 : 2;
    const retrievedLimit = variant === 'compact' ? 0 : variant === 'advanced' ? 3 : 2;
    const previous = this.accepted
      .filter((item) => item.sectionId === unit.sectionId)
      .slice(-previousLimit)
      .map((item) => ({ source: item.source, translation: item.translation }));
    const index = orderedUnits.indexOf(unit);
    const followingUnit = index >= 0 ? orderedUnits[index + 1] : undefined;
    return {
      headingPath: unit.section.headingPath,
      previous,
      following:
        followingUnit === undefined ? [] : [{ source: followingUnit.sourceText }],
      retrieved: this.retriever.retrieve(unit, this.accepted, retrievedLimit),
    };
  }

  private async scanAndTranslate(
    root: Element,
    generation: number,
    priorityOverride?: number,
  ): Promise<void> {
    if (!this.isCurrent(generation)) return;
    // [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis.
    const collectStartedAt = performance.now();
    const collectionContext =
      root === this.options.root
        ? (this.pageCollectionContext = createPageCollectionContext(root))
        : this.pageCollectionContext;
    const collected = collectPageOccurrences(
      root,
      this.options,
      priorityOverride,
      collectionContext,
    );
    const collectMs = performance.now() - collectStartedAt;
    this.perfProbe.collectCalls++;
    this.perfProbe.collectTotalMs += collectMs;
    this.perfProbe.collectMaxMs = Math.max(this.perfProbe.collectMaxMs, collectMs);
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
        this.recordPageMemoryHit(unit, cached);
        if (this.isCurrent(generation)) this.scheduleApply(unit, cached, generation);
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
      const contentClass = group[0].contextClass;
      const outputRatio = this.ratioTracker.get(
        this.options.modelProfile,
        this.options.sourceLanguage,
        this.options.targetLanguage,
        contentClass,
      );
      const preferredSourceTokens = this.adaptiveTuner.get(
        this.options.modelProfile,
        this.options.sourceLanguage,
        this.options.targetLanguage,
        contentClass,
      );
      const batches = buildTokenAwareBatches(group, {
        sourceLanguage: this.options.sourceLanguage,
        targetLanguage: this.options.targetLanguage,
        modelProfile: this.options.modelProfile,
        tokenCounter: this.options.tokenCounter,
        pageProfile: {
          ...this.pageProfile,
          glossary: this.terminology.glossary(24),
        },
        section: group[0].section,
        context,
        outputRatio,
        preferredSourceTokens,
      });
      for (const batch of batches) {
        this.metrics.batches++;
        this.metrics.sourceTokens += batch.sourceTokens;
        this.metrics.contextTokens +=
          batch.budget.localContextTokens + batch.budget.retrievedContextTokens;
        jobs.push(() =>
          this.translateBatch(
            batch.targets,
            batch.pageProfile,
            batch.context,
            generation,
            batch.sourceTokens,
            batch.sourceBudget,
            batch.budget,
            batch.reductions,
          ),
        );
      }
    }
    await this.runLimited(jobs, this.options.modelProfile.batching.concurrency);
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
    pageProfile: PageProfile,
    context: TranslationRequestContext,
    generation: number,
    sourceTokens: number,
    sourceBudget: number,
    tokenBudget: TranslationTokenBudget,
    reductions: string[],
  ): Promise<void> {
    const fresh = planned.filter((item) => !this.inFlight.has(item.target.id));
    if (fresh.length === 0) {
      await Promise.all(planned.map((item) => this.inFlight.get(item.target.id)));
      const applied = new Set<string>();
      for (const item of planned) {
        if (applied.has(item.unit.semanticKey)) continue;
        const translated = this.pageMemory.get(item.unit.semanticKey);
        if (translated !== undefined && this.isCurrent(generation)) {
          this.scheduleApply(item.unit, translated, generation);
          applied.add(item.unit.semanticKey);
        }
      }
      return;
    }

    const logBatch: PageTranslationLogBatch | null =
      this.logBatches === null
        ? null
        : {
            batchId: ++this.logBatchSerial,
            queuedAt: Date.now(),
            sourceTokens,
            sourceBudget,
            group: {
              kind: fresh[0].unit.kind,
              slot: fresh[0].unit.slot,
              contextClass: fresh[0].unit.contextClass,
            },
            context: structuredClone(context),
            targets: fresh.map((item) => ({
              id: item.target.id,
              semanticKey: item.unit.semanticKey,
              sourceText: item.target.sourceText,
              kind: item.target.kind,
              slot: item.target.slot,
              contextClass: item.target.contextClass,
              sectionId: item.target.sectionId,
              componentId: item.target.componentId,
              priority: item.target.priority,
              status: 'pending',
            })),
            retryCount: 0,
            validationFailures: 0,
            profile: {
              id: this.options.modelProfile.id,
              profileVersion: this.options.modelProfile.profileVersion,
              promptVersion: this.options.modelProfile.promptVersion,
              tokenizerId: this.options.tokenCounter.id,
              promptVariant: this.options.modelProfile.promptVariant,
              structuredOutput: this.options.modelProfile.structuredOutputMode,
              reasoning: this.options.modelProfile.reasoningMode,
            },
            tokenBudget: {
              contextWindow: tokenBudget.contextWindow,
              fixedPromptTokens: tokenBudget.fixedPromptTokens,
              pageMemoryTokens: tokenBudget.pageMemoryTokens,
              sectionMemoryTokens: tokenBudget.sectionMemoryTokens,
              localContextTokens: tokenBudget.localContextTokens,
              retrievedContextTokens: tokenBudget.retrievedContextTokens,
              sourceTokens: tokenBudget.sourceTokens,
              schemaTokens: tokenBudget.schemaTokens,
              reservedOutputTokens: tokenBudget.reservedOutputTokens,
              safetyReserveTokens: tokenBudget.safetyReserveTokens,
              totalEstimatedTokens: tokenBudget.totalEstimatedTokens,
            },
            reductions: [...reductions],
          };
    if (logBatch !== null) this.appendLogBatch(logBatch);
    this.options.onUnitStarted?.(fresh.length);
    const request: PageTranslationBatchRequest = {
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: this.options.targetLanguage,
      sessionId: this.runtimeSessionId,
      sessionSignature: this.runtimeSignature,
      memory: pageProfile,
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
        profile: this.options.modelProfile.id,
        profileVersion: this.options.modelProfile.profileVersion,
        promptVersion: this.options.modelProfile.promptVersion,
        provider: this.options.identity.provider,
        model: this.options.identity.model,
        tokenizer: this.options.tokenCounter.id,
        tokenizerAccuracy: this.options.tokenCounter.accuracy,
        promptVariant: this.options.modelProfile.promptVariant,
        structuredOutput: this.options.modelProfile.structuredOutputMode,
        reasoning: this.options.modelProfile.reasoningMode,
        items: fresh.length,
        sourceTokens: tokenBudget.sourceTokens,
        memoryTokens: tokenBudget.pageMemoryTokens + tokenBudget.sectionMemoryTokens,
        contextTokens:
          tokenBudget.localContextTokens + tokenBudget.retrievedContextTokens,
        reservedOutputTokens: tokenBudget.reservedOutputTokens,
        totalEstimatedTokens: tokenBudget.totalEstimatedTokens,
        contextWindow: tokenBudget.contextWindow,
        temperature: this.options.modelProfile.generation.temperature,
        topP: this.options.modelProfile.generation.topP,
        reductions,
        ...(this.options.debugIncludeText
          ? {
              targets: fresh.map((item) => ({
                id: item.target.id,
                sourceText: item.target.sourceText,
              })),
            }
          : {}),
      });
    }

    const batchStartedAt = performance.now();
    const batchPromise = translatePageBatch(request);
    for (const item of fresh) {
      const promise = batchPromise
        .then((response) => {
          const matching = response.translations.find(
            (translation) => translation.id === item.target.id,
          );
          if (matching === undefined) {
            throw new Error(`Missing translation ${item.target.id}`);
          }
          return matching.target;
        })
        .catch(() => '');
      this.inFlight.set(item.target.id, promise);
    }

    try {
      const response = await batchPromise;
      if (response.metrics !== undefined) {
        this.metrics.retries += response.metrics.retryCount;
        this.metrics.validationFailures += response.metrics.validationFailures;
        if (logBatch !== null) {
          logBatch.retryCount = response.metrics.retryCount;
          logBatch.validationFailures = response.metrics.validationFailures;
          logBatch.acceptedProfileId = response.metrics.acceptedProfileId;
          logBatch.acceptedRetryStage = response.metrics.acceptedRetryStage;
        }
      }
      const completedUnits = new Set<string>();
      const missingTargetIds = new Set<string>();
      const responseById = new Map(
        response.translations.map((translation) => [translation.id, translation]),
      );
      const failedSemanticKeys = new Set(
        fresh
          .filter((item) => !responseById.has(item.target.id))
          .map((item) => item.unit.semanticKey),
      );
      for (const item of fresh) {
        const matching = responseById.get(item.target.id);
        if (matching === undefined || failedSemanticKeys.has(item.unit.semanticKey)) {
          this.pendingParts.delete(item.unit.semanticKey);
          missingTargetIds.add(item.target.id);
          if (logBatch !== null) {
            const loggedTarget = logBatch.targets.find(
              (target) => target.id === item.target.id,
            );
            if (loggedTarget !== undefined) loggedTarget.status = 'failed';
          }
          continue;
        }
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
        if (logBatch !== null) {
          const loggedTarget = logBatch.targets.find(
            (target) => target.id === item.target.id,
          );
          if (loggedTarget !== undefined) {
            loggedTarget.translatedText = matching.target;
            loggedTarget.cacheHit = matching.cacheHit;
            loggedTarget.status = 'translated';
          }
        }
      }

      for (const item of fresh) {
        if (missingTargetIds.has(item.target.id)) continue;
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
          this.options.modelProfile.id,
          this.options.sourceLanguage,
          this.options.targetLanguage,
          item.unit.contextClass,
          this.options.tokenCounter.count(item.unit.sourceText),
          this.options.tokenCounter.count(translated),
        );
        this.observeAccepted(item.unit, translated);
        if (this.isCurrent(generation)) {
          this.scheduleApply(item.unit, translated, generation, assembly.values.length);
        } else {
          this.metrics.staleCancellations++;
          if (logBatch !== null) {
            for (const target of logBatch.targets) {
              if (target.semanticKey === item.unit.semanticKey) target.status = 'stale';
            }
          }
        }
      }
      if (missingTargetIds.size > 0) {
        this.options.onUnitRejected?.(missingTargetIds.size);
      }
      this.adaptiveTuner.observe(
        this.options.modelProfile,
        this.options.sourceLanguage,
        this.options.targetLanguage,
        fresh[0].unit.contextClass,
        {
          valid: missingTargetIds.size === 0,
          truncated: false,
          timedOut: false,
          latencyMs: performance.now() - batchStartedAt,
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.adaptiveTuner.observe(
        this.options.modelProfile,
        this.options.sourceLanguage,
        this.options.targetLanguage,
        fresh[0].unit.contextClass,
        {
          valid: false,
          truncated: /truncate|truncated|truncation|length|context/iu.test(errorMessage),
          timedOut: /timeout|timed out/iu.test(errorMessage),
          latencyMs: performance.now() - batchStartedAt,
        },
      );
      if (logBatch !== null) {
        const normalizedError =
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: 'UnknownError', message: String(error) };
        logBatch.error = normalizedError;
        for (const target of logBatch.targets) target.status = 'failed';
      }
      this.options.onUnitRejected?.(fresh.length);
      if (this.options.debug) console.warn('[page-translation] batch failed', error);
    } finally {
      if (logBatch !== null) logBatch.completedAt = Date.now();
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

  private readonly applyQueue: {
    unit: TranslationUnit;
    translation: string;
    generation: number;
    resolvedParts?: number;
  }[] = [];
  private applyPumpRunning = false;

  /**
   * Bulk DOM application goes through a chunked pump: at most
   * APPLY_CHUNK_OCCURRENCES occurrences per macrotask, then the main thread
   * is yielded. Applying a warm-cache replay or a large batch in one
   * synchronous run froze the host page.
   */
  private static readonly APPLY_CHUNK_OCCURRENCES = 24;

  private scheduleApply(
    unit: TranslationUnit,
    translation: string,
    generation: number,
    resolvedParts?: number,
  ): void {
    this.applyQueue.push({ unit, translation, generation, resolvedParts });
    if (this.applyPumpRunning) return;
    this.applyPumpRunning = true;
    // Deferred to a microtask so all units enqueued by the same synchronous
    // batch-completion loop accumulate into one chunked run.
    queueMicrotask(() => {
      void this.pumpApplies();
    });
  }

  private async pumpApplies(): Promise<void> {
    try {
      while (this.applyQueue.length > 0) {
        // Preserve mutations queued before this chunk; records generated by
        // the synchronous apply itself are drained immediately afterwards.
        const pendingExternalMutations = this.observer?.takeRecords() ?? [];
        const chunkStartedAt = performance.now();
        let chunkOccurrences = 0;

        while (
          this.applyQueue.length > 0 &&
          chunkOccurrences < PageTranslationPipeline.APPLY_CHUNK_OCCURRENCES
        ) {
          const item = this.applyQueue.shift();
          if (item === undefined) break;
          if (!this.isCurrent(item.generation)) continue;
          // Parse-safe: validatePlaceholderIntegrity ran before enqueueing.
          this.applyUnit(item.unit, item.translation);
          if (item.resolvedParts !== undefined) {
            this.options.onUnitResolved?.(item.resolvedParts);
          }
          chunkOccurrences += Math.max(1, item.unit.occurrences.length);
        }

        // MutationObserver delivery is deferred until this synchronous chunk
        // returns. Drain our own writes now so they cannot be misclassified
        // as source-page changes and trigger restore -> rescan feedback.
        this.observer?.takeRecords();

        const elapsed = performance.now() - chunkStartedAt;
        this.perfProbe.applyChunks++;
        this.perfProbe.applyTotalMs += elapsed;
        this.perfProbe.applyMaxChunkMs = Math.max(
          this.perfProbe.applyMaxChunkMs,
          elapsed,
        );

        if (pendingExternalMutations.length > 0) {
          await this.onMutations(pendingExternalMutations);
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
    for (let index = this.occurrences.length - 1; index >= 0; index--) {
      const occurrence = this.occurrences[index];
      if (!occurrence.element.contains(mutation.target)) continue;
      const sourceReset = this.isSourceReset(occurrence, mutation);
      if (!adoptSourceMutation(occurrence, mutation)) continue;

      const shouldBackOff =
        sourceReset || this.hasRepeatedMutationConflict(occurrence.element);
      restoreOccurrence(occurrence);
      // restoreOccurrence is our own write; never feed it back into adoption.
      this.observer?.takeRecords();
      this.occurrences.splice(index, 1);

      if (shouldBackOff) {
        this.perfProbe.volatileBackoffs++;
        this.volatileElements.add(occurrence.element);
        for (let queueIndex = this.applyQueue.length - 1; queueIndex >= 0; queueIndex--) {
          if (this.applyQueue[queueIndex].unit.occurrences.includes(occurrence)) {
            this.applyQueue.splice(queueIndex, 1);
          }
        }
        // Keep the processed slot: the page owns this volatile node and must
        // not enter another translate -> framework reset loop.
        return { root: occurrence.element, rescan: false };
      }

      this.processedSlots.get(occurrence.element)?.delete(occurrence.slot);
      return { root: occurrence.element, rescan: true };
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
      // Restore generates the same childList/characterData records as apply.
      // Observe only after the synchronous restore completes so those writes
      // cannot trigger a second restore -> rescan cycle.
      this.observer?.disconnect();
      for (const occurrence of this.occurrences.slice().reverse())
        restoreOccurrence(occurrence);
      this.observer?.observe(this.options.root, PAGE_MUTATION_OBSERVER_OPTIONS);
      this.metrics = createMetrics();
      this.logBatches?.splice(0);
      this.droppedLogBatches = 0;
      this.logBatchSerial = 0;
      this.sessionStartedAt = Date.now();
      this.occurrences = [];
      this.pageMemory.clear();
      this.inFlight.clear();
      this.pendingParts.clear();
      this.accepted.length = 0;
      this.processedSlots = new WeakMap();
      this.appliedText = new WeakMap();
      this.appliedAttributes = new WeakMap();
      this.appliedChildren = new WeakMap();
      this.mutationConflicts = new WeakMap();
      this.volatileElements.clear();
      this.runtimeSessionId = createUUID();
      this.runtimeSignature = `${this.currentUrl}\u0000${this.options.sourceLanguage}\u0000${this.options.targetLanguage}\u0000${this.options.identity.provider}\u0000${this.options.identity.model}\u0000${this.runtimeSessionId}`;
      const generation = ++this.generation;
      await this.scanAndTranslate(this.options.root, generation);
      return;
    }

    const roots = new Set<Element>();
    // [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis.
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
    // [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis.
    const mutationLoopMs = performance.now() - mutationLoopStartedAt;
    this.perfProbe.mutationCallbacks++;
    this.perfProbe.mutationRecords += mutations.length;
    this.perfProbe.mutationMaxRecords = Math.max(
      this.perfProbe.mutationMaxRecords,
      mutations.length,
    );
    this.perfProbe.mutationTotalMs += mutationLoopMs;
    this.perfProbe.mutationMaxMs = Math.max(this.perfProbe.mutationMaxMs, mutationLoopMs);

    const scanRoots: Element[] = [];
    if (roots.size > 16) {
      // A large mutation wave (framework rerender/navigation) is cheaper to
      // collect once from the pipeline root than to force layout and rescan
      // dozens of overlapping subtrees.
      scanRoots.push(this.options.root);
    } else {
      for (const root of roots) {
        if (scanRoots.some((candidate) => candidate.contains(root))) continue;
        for (let index = scanRoots.length - 1; index >= 0; index--) {
          if (root.contains(scanRoots[index])) scanRoots.splice(index, 1);
        }
        scanRoots.push(root);
      }
    }

    const generation = this.generation;
    // Dynamic rescans use a fixed near-viewport priority. Reading every
    // element's bounding box after DOM writes forced thousands of layouts in
    // the real trace; request scheduling does not need that precision here.
    for (const root of scanRoots) await this.scanAndTranslate(root, generation, 3);
  }
}
