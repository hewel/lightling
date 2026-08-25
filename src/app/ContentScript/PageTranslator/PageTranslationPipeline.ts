import {
  PAGE_TRANSLATION_LOG_SCHEMA_VERSION,
  type PageTranslationLog,
  type PageTranslationLogBatch,
  type PageTranslationLogParallelism,
} from '@/lib/pageTranslation/log';
import {
  type PageTranslationBatchRequest,
  type PageTranslationBatchResponse,
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
  TranslationBudgetController,
  type BudgetSnapshot,
} from '@/lib/translators/llm/budgetController';
import type { TranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import type { TranslationModelSizeTier } from '@/lib/translators/llm/sizeTier';
import type { TranslationTokenCounter } from '@/lib/translators/llm/tokenizer';
import { createUUID } from '@/lib/utils';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import {
  buildTokenAwareBatches,
  type PlannedBatch,
  type PlannedTarget,
} from './batching';
import {
  collectPageOccurrences,
  createPageCollectionContext,
  deduplicateOccurrences,
  getOccurrenceOriginalText,
  markOccurrenceSourceNodes,
  type CollectionOptions,
  type PageCollectionContext,
  type TextOccurrence,
  type TranslationUnit,
} from './domPipeline';
import { PageTranslationDomLifecycle } from './PageTranslationDomLifecycle';

export interface PagePipelineMetrics {
  occurrences: number;
  logicalSegments: number;
  uniqueUnits: number;
  deduplicationRatio: number;
  memoryHits: number;
  memoryMisses: number;
  sourceTokens: number;
  contextTokens: number;
  plannedBatches: number;
  retries: number;
  validationFailures: number;
  staleCancellations: number;
  navigationCancellations: number;
  terminologyConflicts: number;
  startedAt: number;
  firstVisibleTranslationAt?: number;
}
export const DEFAULT_STABILIZATION_MS = 400;

export interface PageTranslationPipelineOptions extends CollectionOptions {
  root: Element;
  sessionId: string;
  sessionSignature: string;
  modelProfile: TranslationModelProfile;
  tokenCounter: TranslationTokenCounter;
  stabilizationMs?: number;
  logEnabled?: boolean;
  debug?: boolean;
  debugIncludeText?: boolean;
  sizeTier?: TranslationModelSizeTier;
  persistedBudget?: BudgetSnapshot | null;
  userConcurrencyCeiling?: number | null;
  onBudgetSnapshot?: (snapshot: BudgetSnapshot) => void;
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
  plannedBatches: 0,
  retries: 0,
  validationFailures: 0,
  staleCancellations: 0,
  navigationCancellations: 0,
  terminologyConflicts: 0,
  startedAt: performance.now(),
});

const groupKey = (unit: TranslationUnit): string =>
  `${unit.kind}\\u0000${unit.slot}\\u0000${unit.contextClass}\\u0000${unit.sectionId ?? ''}`;
interface AdmissionProducer {
  generation: number;
  nextBatch: () => PlannedBatch | null;
  resolve: () => void;
  active: number;
  exhausted: boolean;
}

// Admission is shared by initial scans and rescans. Feedback is deliberately
// conservative: a batch may influence the controller only if every dispatched
// unit is still live when it completes.

export class PageTranslationPipeline {
  private readonly pageMemory = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly admissionQueue: AdmissionProducer[] = [];
  private admissionActive = 0;
  private admissionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingParts = new Map<
    string,
    { values: (string | undefined)[]; unit: TranslationUnit }
  >();
  private readonly liveUnits = new Set<TranslationUnit>();
  private readonly unitByOccurrence = new Map<TextOccurrence, TranslationUnit>();
  private readonly pendingRescans = new Map<Element, ReturnType<typeof setTimeout>>();
  private readonly stabilizationMs: number;
  private processedSlots = new WeakMap<Element, Set<string>>();
  private readonly accepted: AcceptedTranslation[] = [];
  private readonly terminology = new TerminologyMemory();
  private readonly ratioTracker = new OutputRatioTracker();
  private readonly budgetController: TranslationBudgetController | null;
  private readonly retriever: TranslationContextRetriever;
  private readonly domLifecycle: PageTranslationDomLifecycle;
  private metrics = createMetrics();
  private occurrences: TextOccurrence[] = [];
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
  private lastBudgetPersistAt = 0;
  private budgetSnapshotDirty = false;

  constructor(
    private readonly options: PageTranslationPipelineOptions,
    retriever: TranslationContextRetriever = new DeterministicContextRetriever(),
  ) {
    this.stabilizationMs = options.stabilizationMs ?? DEFAULT_STABILIZATION_MS;
    this.budgetController = options.modelProfile.adaptive.enabled
      ? new TranslationBudgetController({
          tier: options.sizeTier ?? 'medium',
          profile: options.modelProfile,
          userConcurrencyCeiling: options.userConcurrencyCeiling ?? null,
          persisted: options.persistedBudget ?? null,
          getOutputRatio: () =>
            this.ratioTracker.getSession(
              options.modelProfile,
              options.sourceLanguage,
              options.targetLanguage,
            ),
        })
      : null;
    this.retriever = retriever;
    this.pageCollectionContext = createPageCollectionContext(options.root);
    this.pageProfile = this.pageCollectionContext.pageProfile;
    this.runtimeSessionId = options.sessionId;
    this.runtimeSignature = options.sessionSignature;
    this.logBatches = options.logEnabled ? [] : null;
    this.domLifecycle = new PageTranslationDomLifecycle({
      root: options.root,
      getOccurrences: () => this.occurrences,
      removeOccurrence: (occurrence) => {
        const index = this.occurrences.indexOf(occurrence);
        if (index >= 0) this.occurrences.splice(index, 1);
        this.killUnitForOccurrence(occurrence);
      },
      clearProcessedSlot: (occurrence) => {
        this.processedSlots.get(occurrence.element)?.delete(occurrence.slot);
      },
      isCurrent: (generation) => this.isCurrent(generation),
      isUnitLive: (unit) => this.liveUnits.has(unit),
      onMutations: (mutations) => this.onMutations(mutations),
      onUnitResolved: (count) => this.options.onUnitResolved?.(count),
      onApplied: (unit) => {
        if (this.metrics.firstVisibleTranslationAt === undefined && unit.priority >= 4) {
          this.metrics.firstVisibleTranslationAt = performance.now();
        }
      },
      onApplyChunk: (elapsed) => {
        this.perfProbe.applyChunks++;
        this.perfProbe.applyTotalMs += elapsed;
        this.perfProbe.applyMaxChunkMs = Math.max(
          this.perfProbe.applyMaxChunkMs,
          elapsed,
        );
      },
      onMutationLoop: (records, elapsed) => {
        this.perfProbe.mutationCallbacks++;
        this.perfProbe.mutationRecords += records;
        this.perfProbe.mutationMaxRecords = Math.max(
          this.perfProbe.mutationMaxRecords,
          records,
        );
        this.perfProbe.mutationTotalMs += elapsed;
        this.perfProbe.mutationMaxMs = Math.max(this.perfProbe.mutationMaxMs, elapsed);
      },
      onVolatileBackoff: () => {
        this.perfProbe.volatileBackoffs++;
      },
    });
  }

  public start(): void {
    const generation = ++this.generation;
    void this.scanAndTranslate(this.options.root, generation);
    this.domLifecycle.start();
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
    this.clearPendingRescans();
    this.clearAdmissionQueue();
    this.domLifecycle.stop();
    this.perfObserver?.disconnect();
    this.perfObserver = null;
    this.persistBudgetSnapshotIfDue(true);
    this.occurrences = [];
    this.liveUnits.clear();
    this.unitByOccurrence.clear();
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
      metrics: {
        ...this.metrics,
        batches: this.logBatches.length,
      },
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
  private enqueueAdmission(producer: AdmissionProducer): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    producer.resolve = resolve;
    this.admissionQueue.push(producer);
    this.pumpAdmissions();
    return promise;
  }

  private pumpAdmissions(): void {
    while (this.admissionQueue.length > 0) {
      const producer = this.admissionQueue.shift();
      if (producer === undefined) return;
      if (producer.exhausted || !this.isCurrent(producer.generation)) {
        producer.exhausted = true;
        if (producer.active === 0) producer.resolve();
        continue;
      }

      const limit = Math.max(
        1,
        this.budgetController?.getConcurrency() ??
          this.options.modelProfile.batching.concurrency,
      );
      if (this.admissionActive >= limit) {
        this.admissionQueue.push(producer);
        return;
      }

      const delay = this.budgetController?.getDispatchDelayMs() ?? 0;
      if (delay > 0) {
        this.admissionQueue.unshift(producer);
        if (this.admissionTimer === null) {
          this.admissionTimer = setTimeout(() => {
            this.admissionTimer = null;
            this.pumpAdmissions();
          }, delay);
        }
        return;
      }

      const batch = producer.nextBatch();
      if (batch === null) {
        producer.exhausted = true;
        if (producer.active === 0) producer.resolve();
        continue;
      }

      this.admissionActive++;
      producer.active++;
      if (this.isCurrent(producer.generation)) this.admissionQueue.push(producer);
      void this.translateBatch(
        batch.targets,
        batch.pageProfile,
        batch.context,
        producer.generation,
        batch.sourceTokens,
        batch.sourceBudget,
        batch.budget,
        batch.reductions,
      )
        .catch(() => undefined)
        .finally(() => {
          this.admissionActive--;
          producer.active--;
          if (producer.exhausted && producer.active === 0) producer.resolve();
          this.pumpAdmissions();
        });
    }
  }

  private clearAdmissionQueue(): void {
    if (this.admissionTimer !== null) {
      clearTimeout(this.admissionTimer);
      this.admissionTimer = null;
    }
    while (this.admissionQueue.length > 0) {
      const producer = this.admissionQueue.shift();
      if (producer === undefined) continue;
      producer.exhausted = true;
      if (producer.active === 0) producer.resolve();
    }
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

  private appendLogBatch(batch: PageTranslationLogBatch): void {
    if (this.logBatches === null) return;
    const maximumBatches = 200;
    if (this.logBatches.length >= maximumBatches) {
      this.logBatches.shift();
      this.droppedLogBatches++;
    }
    this.logBatches.push(batch);
  }

  private captureBatchParallelism(
    sourceBudget: number,
    reservedOutputTokens: number,
  ): PageTranslationLogParallelism {
    const sizeTier = this.options.sizeTier ?? 'medium';
    if (this.budgetController !== null) {
      const snapshot = this.budgetController.snapshot();
      return {
        adaptive: true,
        sizeTier,
        dispatchConcurrency: snapshot.concurrency,
        batchSourceTokens: snapshot.batchSourceTokens,
        budgetTokens: snapshot.budgetTokens,
      };
    }

    const dispatchConcurrency = this.options.modelProfile.batching.concurrency;
    return {
      adaptive: false,
      sizeTier,
      dispatchConcurrency,
      batchSourceTokens: sourceBudget,
      budgetTokens: dispatchConcurrency * (sourceBudget + reservedOutputTokens),
    };
  }

  private recordPageMemoryHit(unit: TranslationUnit, translatedText: string): void {
    const sourceTokens = this.options.tokenCounter.count(unit.sourceText);
    this.ratioTracker.observe(
      this.options.modelProfile.id,
      this.options.sourceLanguage,
      this.options.targetLanguage,

      unit.contextClass,
      sourceTokens,
      this.options.tokenCounter.count(translatedText),
    );
    if (this.logBatches === null) return;
    const now = Date.now();
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
      latencyMs: 0,
      terminologyConflicts: 0,
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

    for (const occurrence of newOccurrences) {
      markOccurrenceSourceNodes(occurrence);
    }
    this.occurrences.push(...newOccurrences);
    const units = deduplicateOccurrences(newOccurrences).sort(
      (left, right) => right.priority - left.priority,
    );
    this.registerUnits(units);
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

    const groupPlans = Array.from(groups.values()).map((group) => ({
      group,
      cursor: 0,
      context: this.buildContext(group[0], units),
    }));
    await this.runLimited(groupPlans, generation);
    this.emitMetrics();
  }

  private async runLimited(
    groupPlans: {
      group: TranslationUnit[];
      cursor: number;
      context: TranslationRequestContext;
    }[],
    generation: number,
  ): Promise<void> {
    const submitted = groupPlans.map((plan) => {
      const nextBatch = (): PlannedBatch | null => {
        if (plan.cursor >= plan.group.length) return null;
        const remaining = plan.group.slice(plan.cursor);
        const outputRatio = this.ratioTracker.get(
          this.options.modelProfile,
          this.options.sourceLanguage,
          this.options.targetLanguage,
          remaining[0].contextClass,
        );
        const preferredSourceTokens =
          this.budgetController?.getBatchSourceTokens() ??
          this.options.modelProfile.batching.preferredSourceTokens;
        const batches = buildTokenAwareBatches(remaining, {
          sourceLanguage: this.options.sourceLanguage,
          targetLanguage: this.options.targetLanguage,
          modelProfile: this.options.modelProfile,
          tokenCounter: this.options.tokenCounter,
          pageProfile: {
            ...this.pageProfile,
            glossary: this.terminology.glossary(24),
          },
          section: remaining[0].section,
          context: plan.context,
          outputRatio,
          preferredSourceTokens,
        });
        const batch = batches[0];
        if (batch === undefined) return null;
        const consumedUnits = new Set(batch.targets.map((target) => target.unit));
        let consumed = 0;
        while (consumed < remaining.length && consumedUnits.has(remaining[consumed])) {
          consumed++;
        }
        if (consumed === 0) consumed = 1;
        plan.cursor += consumed;
        this.metrics.plannedBatches++;
        this.metrics.sourceTokens += batch.sourceTokens;
        this.metrics.contextTokens +=
          batch.budget.localContextTokens + batch.budget.retrievedContextTokens;
        return batch;
      };
      return this.enqueueAdmission({
        generation,
        nextBatch,
        resolve: () => undefined,
        active: 0,
        exhausted: false,
      });
    });
    await Promise.all(submitted);
  }
  private providerMissIds(
    response: PageTranslationBatchResponse,
    planned: readonly PlannedTarget[],
  ): Set<string> {
    const plannedIds = new Set(planned.map((item) => item.target.id));
    const nonProviderIds = new Set(
      response.translations
        .filter((translation) => translation.provenance !== 'provider')
        .map((translation) => translation.id),
    );
    const missIds = new Set<string>();
    for (const translation of response.translations) {
      if (translation.provenance === 'provider' && plannedIds.has(translation.id)) {
        missIds.add(translation.id);
      }
    }
    for (const id of response.metrics?.failedIds ?? []) {
      if (plannedIds.has(id) && !nonProviderIds.has(id)) missIds.add(id);
    }
    for (const attempt of response.metrics?.attempts ?? []) {
      for (const id of attempt.targetIds) {
        if (plannedIds.has(id) && !nonProviderIds.has(id)) missIds.add(id);
      }
      for (const issue of attempt.issues ?? []) {
        if (
          issue.id !== undefined &&
          plannedIds.has(issue.id) &&
          !nonProviderIds.has(issue.id)
        ) {
          missIds.add(issue.id);
        }
      }
    }
    if (response.failure !== undefined && missIds.size === 0) {
      for (const item of planned) {
        if (!nonProviderIds.has(item.target.id)) missIds.add(item.target.id);
      }
    }
    return missIds;
  }

  private providerValidationFailures(
    response: PageTranslationBatchResponse,
    missIds: ReadonlySet<string>,
  ): number {
    if (missIds.size === 0) return 0;
    const attempts = response.metrics?.attempts ?? [];
    if (attempts.length > 0) {
      const failures = attempts.reduce(
        (count, attempt) =>
          count +
          (attempt.issues?.filter(
            (issue) => issue.id === undefined || missIds.has(issue.id),
          ).length ?? 0),
        0,
      );
      if (failures > 0) return failures;
    }
    return Math.max(0, response.metrics?.validationFailures ?? 0);
  }

  private observeBudget(
    response: PageTranslationBatchResponse,
    valid: boolean,
    planned: readonly PlannedTarget[],
    latencyMs: number,
  ): void {
    if (this.budgetController === null) return;
    const missIds = this.providerMissIds(response, planned);
    if (missIds.size === 0) return;
    const sourceTokens = planned
      .filter((item) => missIds.has(item.target.id))
      .reduce(
        (total, item) => total + this.options.tokenCounter.count(item.target.sourceText),
        0,
      );
    const attempts = response.metrics?.attempts ?? [];
    const failureMessage = response.failure?.message ?? '';
    const rateLimitedAttempt = attempts.find(
      (attempt) =>
        attempt.httpStatus === 429 ||
        /(?:429|rate[\s-]?limit)/iu.test(attempt.error ?? ''),
    );
    const rateLimited =
      rateLimitedAttempt !== undefined ||
      /(?:429|rate[\s-]?limit)/iu.test(failureMessage);
    const retryAfterMatch = /retry[\s-]?after\D+(\d+(?:\.\d+)?)/iu.exec(
      rateLimitedAttempt?.error ?? failureMessage,
    );
    const retryAfterValue =
      rateLimitedAttempt?.retryAfterMs ??
      (retryAfterMatch?.[1] === undefined ? null : Number(retryAfterMatch[1]));
    this.budgetController.observe({
      valid,
      truncated: attempts.some((attempt) =>
        /truncate|truncated|truncation|context|length/iu.test(attempt.error ?? ''),
      ),
      timedOut: attempts.some((attempt) =>
        /timeout|timed out/iu.test(attempt.error ?? ''),
      ),
      latencyMs,
      validationFailures: this.providerValidationFailures(response, missIds),
      rateLimited,
      retryAfterMs:
        rateLimitedAttempt?.retryAfterMs ??
        (retryAfterValue === null || !Number.isFinite(retryAfterValue)
          ? null
          : retryAfterValue < 1000
            ? retryAfterValue * 1000
            : retryAfterValue),
      sourceTokens,
      targetCount: missIds.size,
    });
    this.budgetSnapshotDirty = true;
    this.persistBudgetSnapshotIfDue();
  }

  private canObserveBudget(
    generation: number,
    planned: readonly PlannedTarget[],
  ): boolean {
    return (
      this.isCurrent(generation) && planned.every((item) => this.liveUnits.has(item.unit))
    );
  }

  private persistBudgetSnapshotIfDue(force = false): void {
    if (
      this.budgetController === null ||
      this.options.onBudgetSnapshot === undefined ||
      !this.budgetSnapshotDirty
    )
      return;
    const now = Date.now();
    if (!force && now - this.lastBudgetPersistAt < 30_000) return;
    this.lastBudgetPersistAt = now;
    this.options.onBudgetSnapshot(this.budgetController.snapshot());
    this.budgetSnapshotDirty = false;
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
        if (
          translated !== undefined &&
          this.isCurrent(generation) &&
          this.liveUnits.has(item.unit)
        ) {
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
            latencyMs: 0,
            terminologyConflicts: 0,
          };
    if (logBatch !== null) this.appendLogBatch(logBatch);
    this.options.onUnitStarted?.(fresh.length);

    const request: PageTranslationBatchRequest = {
      sourceLanguage: this.options.sourceLanguage,
      targetLanguage: this.options.targetLanguage,
      sessionId: this.runtimeSessionId,
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
    if (logBatch !== null) {
      logBatch.parallelism = this.captureBatchParallelism(
        sourceBudget,
        tokenBudget.reservedOutputTokens,
      );
    }
    const batchStartedAt = performance.now();
    let budgetObserved = false;
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

    let responseForFeedback: PageTranslationBatchResponse | null = null;
    try {
      responseForFeedback = await batchPromise;
      const response = responseForFeedback;
      if (response.metrics !== undefined) {
        this.metrics.retries += response.metrics.retryCount;
        this.metrics.validationFailures += response.metrics.validationFailures;
        if (logBatch !== null) {
          logBatch.retryCount = response.metrics.retryCount;
          logBatch.validationFailures = response.metrics.validationFailures;
          logBatch.acceptedProfileId = response.metrics.acceptedProfileId;
          if (response.metrics.attempts !== undefined) {
            logBatch.attempts = response.metrics.attempts;
          }
        }
      }
      if (response.failure !== undefined) {
        if (this.canObserveBudget(generation, fresh)) {
          this.observeBudget(response, false, fresh, performance.now() - batchStartedAt);
          budgetObserved = true;
        }
        const failure = new Error(response.failure.message);
        failure.name = response.failure.name;
        throw failure;
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
        this.observeAccepted(item.unit, translated, logBatch);

        if (this.isCurrent(generation) && this.liveUnits.has(item.unit)) {
          this.scheduleApply(item.unit, translated, generation, assembly.values.length);
        } else {
          if (!this.isCurrent(generation)) this.metrics.navigationCancellations++;
          else this.metrics.staleCancellations++;
          if (logBatch !== null) {
            for (const target of logBatch.targets) {
              if (target.semanticKey === item.unit.semanticKey) target.status = 'stale';
            }
          }
        }
      }
      if (missingTargetIds.size > 0 && this.isCurrent(generation)) {
        this.options.onUnitRejected?.(missingTargetIds.size);
      }
      if (this.canObserveBudget(generation, fresh)) {
        this.observeBudget(
          response,
          missingTargetIds.size === 0,
          fresh,
          performance.now() - batchStartedAt,
        );
        budgetObserved = true;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        this.budgetController !== null &&
        !budgetObserved &&
        this.canObserveBudget(generation, fresh)
      ) {
        const feedbackResponse: PageTranslationBatchResponse = responseForFeedback ?? {
          translations: [],
          metrics: {
            retryCount: 0,
            validationFailures: /Placeholder validation failed/iu.test(errorMessage)
              ? 1
              : 0,
            failedIds: fresh.map((item) => item.target.id),
          },
          failure: { name: 'Error', message: errorMessage },
        };
        this.observeBudget(
          feedbackResponse,
          false,
          fresh,
          performance.now() - batchStartedAt,
        );
        budgetObserved = true;
      }
      if (logBatch !== null) {
        const normalizedError =
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: 'UnknownError', message: String(error) };
        logBatch.error = normalizedError;
        for (const target of logBatch.targets) target.status = 'failed';
      }
      if (this.isCurrent(generation)) this.options.onUnitRejected?.(fresh.length);
      if (this.options.debug) console.warn('[page-translation] batch failed', error);
    } finally {
      if (logBatch !== null) {
        logBatch.completedAt = Date.now();
        logBatch.latencyMs = Math.max(0, performance.now() - batchStartedAt);
      }
      for (const item of fresh) this.inFlight.delete(item.target.id);
    }
  }

  private observeAccepted(
    unit: TranslationUnit,
    translation: string,
    logBatch: PageTranslationLogBatch | null,
  ): void {
    this.accepted.push({
      source: unit.sourceText,
      translation,
      sectionId: unit.sectionId,
      contextClass: unit.contextClass,
      terms: termsOf(unit.sourceText),
    });
    if (this.terminology.observe(unit.normalizedText, translation)) {
      this.metrics.terminologyConflicts++;
      if (logBatch !== null) {
        logBatch.terminologyConflicts = (logBatch.terminologyConflicts ?? 0) + 1;
      }
    }
  }

  private scheduleApply(
    unit: TranslationUnit,
    translation: string,
    generation: number,
    resolvedParts?: number,
  ): void {
    this.domLifecycle.scheduleApply(unit, translation, generation, resolvedParts);
  }

  private async onMutations(mutations: MutationRecord[]): Promise<void> {
    if (location.href !== this.currentUrl) {
      let isPathChange = true;
      try {
        const previous = new URL(this.currentUrl);
        const current = new URL(location.href);
        isPathChange =
          previous.origin !== current.origin || previous.pathname !== current.pathname;
      } catch {
        isPathChange = true;
      }

      if (!isPathChange) {
        this.currentUrl = location.href;
      } else {
        const previousSession = this.runtimeSessionId;
        this.currentUrl = location.href;
        ++this.generation;
        this.clearAdmissionQueue();
        this.metrics.navigationCancellations++;
        void abortTranslation({ context: previousSession }).catch(() => undefined);
        // Restore generates the same childList/characterData records as apply.
        // Observe only after the synchronous restore completes so those writes
        // cannot trigger a second restore -> rescan cycle.
        this.clearPendingRescans();
        this.domLifecycle.resetForNavigation();
        this.metrics = createMetrics();
        this.logBatches?.splice(0);
        this.droppedLogBatches = 0;
        this.logBatchSerial = 0;
        this.sessionStartedAt = Date.now();
        this.occurrences = [];
        this.liveUnits.clear();
        this.unitByOccurrence.clear();
        this.pageMemory.clear();
        this.inFlight.clear();
        this.pendingParts.clear();
        this.accepted.length = 0;
        this.processedSlots = new WeakMap();
        this.runtimeSessionId = createUUID();
        this.runtimeSignature = `${this.currentUrl}\u0000${this.options.sourceLanguage}\u0000${this.options.targetLanguage}\u0000${this.options.identity.provider}\u0000${this.options.identity.model}\u0000${this.runtimeSessionId}`;
        const generation = ++this.generation;
        await this.scanAndTranslate(this.options.root, generation);
        return;
      }
    }

    const roots = this.domLifecycle.collectRescanRoots(mutations);

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

    for (const root of scanRoots) {
      this.scheduleRescan(root);
    }
  }

  private registerUnits(units: TranslationUnit[]): void {
    for (const unit of units) {
      this.liveUnits.add(unit);
      for (const occurrence of unit.occurrences) {
        this.unitByOccurrence.set(occurrence, unit);
      }
    }
  }

  private killUnitForOccurrence(occurrence: TextOccurrence): void {
    const unit = this.unitByOccurrence.get(occurrence);
    if (unit === undefined) return;
    this.liveUnits.delete(unit);
    for (const member of unit.occurrences) {
      this.unitByOccurrence.delete(member);
    }
    this.pendingParts.delete(unit.semanticKey);
  }

  private scheduleRescan(root: Element): void {
    for (const [pending, timer] of this.pendingRescans) {
      if (pending === root || pending.contains(root)) {
        clearTimeout(timer);
        this.pendingRescans.set(
          pending,
          setTimeout(() => {
            this.pendingRescans.delete(pending);
            if (!pending.isConnected && pending !== this.options.root) return;
            void this.scanAndTranslate(pending, this.generation, 3);
          }, this.stabilizationMs),
        );
        return;
      }
    }
    for (const [pending, timer] of this.pendingRescans) {
      if (root.contains(pending)) {
        clearTimeout(timer);
        this.pendingRescans.delete(pending);
      }
    }
    this.pendingRescans.set(
      root,
      setTimeout(() => {
        this.pendingRescans.delete(root);
        if (!root.isConnected && root !== this.options.root) return;
        void this.scanAndTranslate(root, this.generation, 3);
      }, this.stabilizationMs),
    );
  }

  private clearPendingRescans(): void {
    for (const timer of this.pendingRescans.values()) {
      clearTimeout(timer);
    }
    this.pendingRescans.clear();
  }
}
