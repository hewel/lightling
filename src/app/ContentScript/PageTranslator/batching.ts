import {
  type PageProfile,
  type PageTranslationBatchRequest,
  type SectionContext,
  type TranslationRequestContext,
  type TranslationTarget,
  validatePlaceholderIntegrity,
} from '@/lib/pageTranslation/protocol';
import {
  budgetPageTranslationRequest,
  type TranslationTokenBudget,
} from '@/lib/translators/llm/budget';
import type { TranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import type { TranslationTokenCounter } from '@/lib/translators/llm/tokenizer';

import type { TranslationUnit } from './domPipeline';
import { TranslationPriorityLane } from './priorityLanes';

export interface TokenBudgetInput {
  contextWindow: number;
  promptTokens: number;
  memoryTokens: number;
  contextTokens: number;
  schemaTokens: number;
  safetyTokens: number;
  outputRatio: number;
}

export const calculateSourceBudget = (input: TokenBudgetInput): number => {
  const remaining =
    input.contextWindow -
    input.promptTokens -
    input.memoryTokens -
    input.contextTokens -
    input.schemaTokens -
    input.safetyTokens;
  if (remaining <= 0) return 0;
  return Math.floor(remaining / (1 + input.outputRatio));
};

export interface LaneBatchCap {
  maxItems: number;
  sourceTokens: number;
}

export type LaneBatchCaps = Partial<Record<TranslationPriorityLane, LaneBatchCap>>;

export const DEFAULT_LANE_BATCH_CAPS: Readonly<LaneBatchCaps> = {
  [TranslationPriorityLane.Urgent]: { maxItems: 16, sourceTokens: 1000 },
  [TranslationPriorityLane.Visible]: { maxItems: 16, sourceTokens: 1000 },
};

export interface PlannedTarget {
  target: TranslationTarget;
  unit: TranslationUnit;
  partIndex: number;
  partCount: number;
}

// TranslationUnit carries DOM references (occurrences[].element, binding) that
// must never reach the background message: Firefox structured-clones extension
// messages and throws DataCloneError on DOM nodes. Keep wire targets plain.
const toWireTarget = (
  unit: TranslationUnit,
  overrides?: Pick<TranslationTarget, 'id' | 'sourceText' | 'normalizedText'>,
): TranslationTarget => ({
  id: unit.id,
  sourceText: unit.sourceText,
  normalizedText: unit.normalizedText,
  kind: unit.kind,
  slot: unit.slot,
  contextClass: unit.contextClass,
  ...(unit.sectionId === undefined ? {} : { sectionId: unit.sectionId }),
  ...(unit.componentId === undefined ? {} : { componentId: unit.componentId }),
  semanticKey: unit.semanticKey,
  priority: unit.priority,
  ...overrides,
});

export interface PlannedBatch {
  targets: PlannedTarget[];
  sourceTokens: number;
  sourceBudget: number;
  pageProfile: PageProfile;
  context: TranslationRequestContext;
  budget: TranslationTokenBudget;
  reductions: string[];
}

export interface BatchPlanOptions {
  sourceLanguage: string;
  targetLanguage: string;
  modelProfile: TranslationModelProfile;
  tokenCounter: TranslationTokenCounter;
  pageProfile: PageProfile;
  section?: SectionContext;
  context: TranslationRequestContext;
  outputRatio: number;
  preferredSourceTokens?: number;
  /** Lane limits only shrink the model/controller allowances. */
  laneBatchCaps?: LaneBatchCaps;
}

const splitAtSafeSentenceBoundaries = (
  unit: TranslationUnit,
  sourceBudget: number,
  counter: TranslationTokenCounter,
): PlannedTarget[] => {
  let sentences: string[] = [];
  try {
    sentences = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(unit.sourceText),
      (segment) => segment.segment,
    );
  } catch {
    sentences = [unit.sourceText];
  }
  if (sentences.length <= 1) return [];

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current + sentence;
    if (!validatePlaceholderIntegrity(candidate, candidate)) return [];
    if (current !== '' && counter.count(candidate) > sourceBudget) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current !== '') chunks.push(current);
  if (
    chunks.length <= 1 ||
    chunks.some(
      (chunk) =>
        counter.count(chunk) > sourceBudget ||
        !validatePlaceholderIntegrity(chunk, chunk),
    )
  ) {
    return [];
  }

  return chunks.map((sourceText, partIndex) => ({
    target: toWireTarget(unit, {
      id: `${unit.id}:part-${partIndex + 1}`,
      sourceText,
      normalizedText: sourceText.normalize('NFC').replace(/\s+/gu, ' ').trim(),
    }),
    unit,
    partIndex,
    partCount: chunks.length,
  }));
};

const makeBudgetRequest = (
  planned: PlannedTarget[],
  options: BatchPlanOptions,
): PageTranslationBatchRequest => ({
  sourceLanguage: options.sourceLanguage,
  targetLanguage: options.targetLanguage,
  sessionId: 'planning',
  memory: options.pageProfile,
  ...(options.section === undefined ? {} : { section: options.section }),
  context: options.context,
  group: {
    kind: planned[0].target.kind,
    slot: planned[0].target.slot,
    contextClass: planned[0].target.contextClass,
  },
  targets: planned.map((item) => item.target),
  retryStage: 'initial',
});

const finalizeBatch = (
  planned: PlannedTarget[],
  options: BatchPlanOptions,
  sourceBudget: number,
): PlannedBatch[] => {
  const budgeted = budgetPageTranslationRequest(
    makeBudgetRequest(planned, options),
    options.modelProfile,
    options.tokenCounter,
    options.outputRatio,
  );
  if (budgeted.overBudget) {
    if (planned.length === 1) {
      throw new Error(
        `Logical segment ${planned[0].target.id} cannot fit the model profile budget`,
      );
    }
    const midpoint = Math.floor(planned.length / 2);
    return [
      ...finalizeBatch(planned.slice(0, midpoint), options, sourceBudget),
      ...finalizeBatch(planned.slice(midpoint), options, sourceBudget),
    ];
  }
  const targetById = new Map(planned.map((item) => [item.target.id, item]));
  const targets = budgeted.request.targets.map((target) => {
    const plannedTarget = targetById.get(target.id);
    if (plannedTarget === undefined) {
      throw new Error(`Budget planning lost target ${target.id}`);
    }
    return { ...plannedTarget, target };
  });
  return [
    {
      targets,
      sourceTokens: budgeted.budget.sourceTokens,
      sourceBudget,
      pageProfile: budgeted.request.memory,
      context: budgeted.request.context,
      budget: budgeted.budget,
      reductions: budgeted.reductions,
    },
  ];
};

export const buildTokenAwareBatches = (
  units: TranslationUnit[],
  options: BatchPlanOptions,
): PlannedBatch[] => {
  const counter = options.tokenCounter;
  const controllerSourceBudget = Math.max(
    1,
    Math.min(
      options.preferredSourceTokens ??
        options.modelProfile.batching.preferredSourceTokens,
      options.modelProfile.batching.maxSourceTokens,
    ),
  );
  const controllerMaxItems = options.modelProfile.batching.maxItems;

  const planned: PlannedTarget[] = [];
  for (const unit of units) {
    const laneCap = options.laneBatchCaps?.[unit.lane];
    const sourceBudget = Math.max(
      1,
      Math.min(controllerSourceBudget, laneCap?.sourceTokens ?? controllerSourceBudget),
    );
    const sourceTokens = counter.count(unit.sourceText);
    if (sourceTokens <= sourceBudget) {
      planned.push({ target: toWireTarget(unit), unit, partIndex: 0, partCount: 1 });
      continue;
    }
    const parts = splitAtSafeSentenceBoundaries(unit, sourceBudget, counter);
    if (parts.length === 0) {
      throw new Error(
        `Logical segment ${unit.id} cannot be split at a safe sentence boundary`,
      );
    }
    planned.push(...parts);
  }

  const batches: PlannedBatch[] = [];
  let current: PlannedTarget[] = [];
  let currentTokens = 0;
  let currentSourceBudget = controllerSourceBudget;
  let currentMaxItems = controllerMaxItems;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(...finalizeBatch(current, options, currentSourceBudget));
    current = [];
    currentTokens = 0;
    currentSourceBudget = controllerSourceBudget;
    currentMaxItems = controllerMaxItems;
  };

  for (const item of planned) {
    const laneCap = options.laneBatchCaps?.[item.unit.lane];
    const itemSourceBudget = Math.max(
      1,
      Math.min(controllerSourceBudget, laneCap?.sourceTokens ?? controllerSourceBudget),
    );
    const itemMaxItems = Math.max(
      1,
      Math.min(controllerMaxItems, laneCap?.maxItems ?? controllerMaxItems),
    );
    const itemTokens = counter.count(
      JSON.stringify({
        id: item.target.id,
        kind: item.target.kind,
        source: item.target.sourceText,
      }),
    );
    if (
      current.length > 0 &&
      (currentSourceBudget !== itemSourceBudget ||
        currentMaxItems !== itemMaxItems ||
        current.length >= currentMaxItems ||
        currentTokens + itemTokens > currentSourceBudget)
    ) {
      flush();
    }
    currentSourceBudget = itemSourceBudget;
    currentMaxItems = itemMaxItems;
    current.push(item);
    currentTokens += itemTokens;
  }
  flush();
  return batches;
};
