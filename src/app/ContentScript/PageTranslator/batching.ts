import { encode } from 'gpt-tokenizer-v4';

import {
  type PageProfile,
  type TranslationRequestContext,
  type TranslationTarget,
  validatePlaceholderIntegrity,
  WEBPAGE_SYSTEM_PROMPT,
} from '@/lib/pageTranslation/protocol';

import type { TranslationUnit } from './domPipeline';

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

export interface TokenCounter {
  count(text: string): number;
  id: string;
}

export const openAICompatibleTokenCounter: TokenCounter = {
  id: 'o200k_base',
  count: (text) => encode(text).length,
};

export class OutputRatioTracker {
  private readonly ratios = new Map<string, number>();

  public get(sourceLanguage: string, targetLanguage: string): number {
    return this.ratios.get(`${sourceLanguage}>${targetLanguage}`) ?? 1.35;
  }

  public observe(
    sourceLanguage: string,
    targetLanguage: string,
    sourceTokens: number,
    targetTokens: number,
  ): void {
    if (sourceTokens <= 0 || targetTokens <= 0) return;
    const key = `${sourceLanguage}>${targetLanguage}`;
    const observed = Math.min(3, Math.max(0.5, targetTokens / sourceTokens));
    const previous = this.ratios.get(key) ?? observed;
    this.ratios.set(key, Math.min(3, Math.max(0.5, previous * 0.8 + observed * 0.2)));
  }
}

export interface PlannedTarget {
  target: TranslationTarget;
  unit: TranslationUnit;
  partIndex: number;
  partCount: number;
}

export interface PlannedBatch {
  targets: PlannedTarget[];
  sourceTokens: number;
  sourceBudget: number;
}

export interface BatchPlanOptions {
  sourceLanguage: string;
  targetLanguage: string;
  contextWindow: number;
  preferredInputTokens: number;
  pageProfile: PageProfile;
  context: TranslationRequestContext;
  maxItems?: number;
  safetyTokens?: number;
  outputRatio: number;
  tokenCounter?: TokenCounter;
}

const splitAtSafeSentenceBoundaries = (
  unit: TranslationUnit,
  sourceBudget: number,
  counter: TokenCounter,
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
    target: {
      ...unit,
      id: `${unit.id}:part-${partIndex + 1}`,
      sourceText,
      normalizedText: sourceText.normalize('NFC').replace(/\s+/gu, ' ').trim(),
    },
    unit,
    partIndex,
    partCount: chunks.length,
  }));
};

const getFixedCosts = (
  options: BatchPlanOptions,
  counter: TokenCounter,
): Omit<TokenBudgetInput, 'outputRatio'> => ({
  contextWindow: options.contextWindow,
  promptTokens: counter.count(WEBPAGE_SYSTEM_PROMPT),
  memoryTokens: counter.count(JSON.stringify(options.pageProfile)),
  contextTokens: counter.count(JSON.stringify(options.context)),
  schemaTokens: 96,
  safetyTokens: options.safetyTokens ?? 256,
});

export const buildTokenAwareBatches = (
  units: TranslationUnit[],
  options: BatchPlanOptions,
): PlannedBatch[] => {
  const counter = options.tokenCounter ?? openAICompatibleTokenCounter;
  const fixed = getFixedCosts(options, counter);
  const calculatedBudget = calculateSourceBudget({
    ...fixed,
    outputRatio: options.outputRatio,
  });
  const sourceBudget = Math.max(
    0,
    Math.min(calculatedBudget, options.preferredInputTokens),
  );
  if (sourceBudget === 0)
    throw new Error('Model context is too small for webpage translation');

  const planned: PlannedTarget[] = [];
  for (const unit of units) {
    const sourceTokens = counter.count(unit.sourceText);
    if (sourceTokens <= sourceBudget) {
      planned.push({ target: unit, unit, partIndex: 0, partCount: 1 });
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
  const maxItems = options.maxItems ?? 48;

  for (const item of planned) {
    const itemTokens = counter.count(
      JSON.stringify({
        id: item.target.id,
        kind: item.target.kind,
        source: item.target.sourceText,
      }),
    );
    if (
      current.length > 0 &&
      (current.length >= maxItems || currentTokens + itemTokens > sourceBudget)
    ) {
      batches.push({
        targets: current,
        sourceTokens: currentTokens,
        sourceBudget,
      });
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += itemTokens;
  }
  if (current.length > 0) {
    batches.push({ targets: current, sourceTokens: currentTokens, sourceBudget });
  }
  return batches;
};
