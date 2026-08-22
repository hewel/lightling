import type {
  PageProfile,
  PageTranslationBatchAttempt,
  RetryStage,
  TranslationKind,
  TranslationRequestContext,
  TranslationSlot,
  TranslationTarget,
  TranslationValidationIssue,
} from './protocol';

export const PAGE_TRANSLATION_LOG_SCHEMA_VERSION = 'lightling.page-translation-log.v2';

export type PageTranslationLogTarget = Omit<TranslationTarget, 'normalizedText'> & {
  translatedText?: string;
  cacheHit?: boolean;
  status: 'pending' | 'translated' | 'failed' | 'stale';
};

export interface PageTranslationLogProfile {
  id: string;
  profileVersion: string;
  promptVersion: string;
  tokenizerId: string;
  promptVariant: 'compact' | 'standard' | 'advanced';
  structuredOutput:
    | 'json-schema'
    | 'grammar'
    | 'tool-call'
    | 'json-object'
    | 'prompt-only';
  reasoning: 'disabled' | 'minimal' | 'normal';
}

export interface PageTranslationLogTokenBudget {
  contextWindow: number;
  fixedPromptTokens: number;
  pageMemoryTokens: number;
  sectionMemoryTokens: number;
  localContextTokens: number;
  retrievedContextTokens: number;
  sourceTokens: number;
  schemaTokens: number;
  reservedOutputTokens: number;
  safetyReserveTokens: number;
  totalEstimatedTokens: number;
}

export type PageTranslationLogIssue = TranslationValidationIssue;

export type PageTranslationLogAttempt = PageTranslationBatchAttempt;

export interface PageTranslationLogBatch {
  batchId: number;
  queuedAt: number;
  completedAt?: number;
  sourceTokens: number;
  sourceBudget: number;
  group: {
    kind: TranslationKind;
    slot: TranslationSlot;
    contextClass: string;
  };
  context: TranslationRequestContext;
  targets: PageTranslationLogTarget[];
  retryCount: number;
  validationFailures: number;
  profile: PageTranslationLogProfile;
  tokenBudget: PageTranslationLogTokenBudget;
  reductions: string[];
  acceptedProfileId?: string;
  acceptedRetryStage?: RetryStage;
  /** Append-only parse and transport-retry journal emitted by the engine. */
  attempts?: PageTranslationLogAttempt[];
  error?: {
    name: string;
    message: string;
  };
}

export interface PageTranslationLogMetrics {
  occurrences: number;
  logicalSegments: number;
  uniqueUnits: number;
  deduplicationRatio: number;
  memoryHits: number;
  memoryMisses: number;
  sourceTokens: number;
  contextTokens: number;
  /** Number of planned provider batches, before actual log events are recorded. */
  plannedBatches?: number;
  /** Number of recorded log batches; derived from `PageTranslationLog.batches`. */
  batches: number;
  retries: number;
  validationFailures: number;
  staleCancellations: number;
  terminologyConflicts: number;
  startedAt: number;
  firstVisibleTranslationAt?: number;
}

export interface PageTranslationLog {
  schemaVersion: typeof PAGE_TRANSLATION_LOG_SCHEMA_VERSION;
  exportedAt: number;
  session: {
    id: string;
    signature: string;
    url: string;
    documentTitle: string;
    sourceLanguage: string;
    targetLanguage: string;
    provider: string;
    model: string;
    startedAt: number;
  };
  pageProfile: PageProfile;
  metrics: PageTranslationLogMetrics;
  batches: PageTranslationLogBatch[];
  droppedBatches: number;
  /** [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis. */
  debugPerf?: PageTranslationPerfProbe;
}

/** [DEBUG-perf1] Temporary real-world freeze probe; remove after diagnosis. */
export interface PageTranslationPerfProbe {
  longTasks: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  collectCalls: number;
  collectTotalMs: number;
  collectMaxMs: number;
  applyChunks: number;
  applyTotalMs: number;
  applyMaxChunkMs: number;
  mutationCallbacks: number;
  mutationRecords: number;
  volatileBackoffs: number;
  mutationMaxRecords: number;
  mutationTotalMs: number;
  mutationMaxMs: number;
}
