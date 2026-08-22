import type {
  PageProfile,
  TranslationKind,
  TranslationRequestContext,
  TranslationSlot,
} from './protocol';

export const PAGE_TRANSLATION_LOG_SCHEMA_VERSION = 'lightling.page-translation-log.v2';

export interface PageTranslationLogTarget {
  id: string;
  semanticKey: string;
  sourceText: string;
  translatedText?: string;
  kind: TranslationKind;
  slot: TranslationSlot;
  contextClass: string;
  sectionId?: string;
  componentId?: string;
  priority: number;
  cacheHit?: boolean;
  status: 'pending' | 'translated' | 'failed' | 'stale';
}

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

export interface PageTranslationLogAttempt {
  stage: 'initial' | 'isolated' | 'simplified-context' | 'rich-context';
  contextMode?: 'normal' | 'without-retrieved' | 'rich';
  profileId: string;
  targetIds: string[];
  /** Verbatim model output; absent when the fetch itself failed. */
  rawResponse?: string;
  issues?: { id?: string; failure: string }[];
  /** Fetch-level failure message after internal retries were exhausted. */
  error?: string;
}

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
  acceptedRetryStage?: 'initial' | 'isolated' | 'simplified-context' | 'rich-context';
  /** One entry per HTTP attempt; present when the engine reported metrics. */
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
