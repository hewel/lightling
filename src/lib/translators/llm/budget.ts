import type {
  PageProfile,
  PageTranslationBatchRequest,
  SectionContext,
  TranslationRequestContext,
} from '@/lib/pageTranslation/protocol';

import type { TranslationModelProfile } from './modelProfile';
import {
  getStableTranslationPromptPrefix,
  getTranslationResponseSchemaText,
  promptVariantForRetry,
} from './prompts';
import type { TranslationTokenCounter } from './tokenizer';

export interface OutputTokenEstimateInput {
  sourceTokens: number;
  itemCount: number;
  placeholderCount: number;
  outputRatio: number;
  perItemOverhead: number;
  perPlaceholderOverhead: number;
  schemaOverhead: number;
  availableOutputTokens: number;
  modelMaximumOutputTokens?: number;
}

export const estimateMaxOutputTokens = (input: OutputTokenEstimateInput): number => {
  const estimated =
    Math.ceil(input.sourceTokens * input.outputRatio) +
    input.itemCount * input.perItemOverhead +
    input.placeholderCount * input.perPlaceholderOverhead +
    input.schemaOverhead;
  const modelLimit = input.modelMaximumOutputTokens ?? input.availableOutputTokens;
  return Math.max(64, Math.min(estimated, input.availableOutputTokens, modelLimit));
};

export interface TranslationTokenBudget {
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
  tokenizerId: string;
  tokenizerAccuracy: TranslationTokenCounter['accuracy'];
}

export interface BudgetedPageRequest {
  request: PageTranslationBatchRequest;
  budget: TranslationTokenBudget;
  reductions: string[];
  overBudget: boolean;
}

const placeholderCount = (request: PageTranslationBatchRequest): number => {
  let count = 0;
  const pattern = /<g id="[A-Za-z0-9_-]+">|<x id="[A-Za-z0-9_-]+"\/>/gu;
  for (const target of request.targets) {
    for (const _match of target.sourceText.matchAll(pattern)) count++;
  }
  return count;
};

const countJson = (counter: TranslationTokenCounter, value: unknown): number =>
  counter.count(JSON.stringify(value));

const sourceTokenCount = (
  request: PageTranslationBatchRequest,
  counter: TranslationTokenCounter,
): number =>
  request.targets.reduce(
    (total, target) =>
      total +
      countJson(counter, {
        id: target.id,
        kind: target.kind,
        source: target.sourceText,
      }),
    0,
  );

const computeBudget = (
  request: PageTranslationBatchRequest,
  profile: TranslationModelProfile,
  counter: TranslationTokenCounter,
  outputRatio: number,
): TranslationTokenBudget => {
  const variant = promptVariantForRetry(profile, request.retryStage);
  const fixedPromptTokens =
    counter.count(getStableTranslationPromptPrefix(profile, variant)) + 16;
  const pageMemoryTokens = countJson(counter, request.memory);
  const sectionMemoryTokens = countJson(counter, request.section ?? null);
  const localContextTokens = countJson(counter, {
    headingPath: request.context.headingPath,
    previous: request.context.previous,
    following: request.context.following,
  });
  const retrievedContextTokens = countJson(counter, request.context.retrieved);
  const sourceTokens = sourceTokenCount(request, counter);
  const schemaTokens = Math.max(
    profile.schemaReserveTokens,
    counter.count(getTranslationResponseSchemaText(profile)),
  );
  const inputWithoutOutput =
    fixedPromptTokens +
    pageMemoryTokens +
    sectionMemoryTokens +
    localContextTokens +
    retrievedContextTokens +
    sourceTokens +
    schemaTokens +
    profile.safetyReserveTokens;
  const availableOutputTokens = Math.max(0, profile.contextWindow - inputWithoutOutput);
  const reservedOutputTokens = estimateMaxOutputTokens({
    sourceTokens,
    itemCount: request.targets.length,
    placeholderCount: placeholderCount(request),
    outputRatio,
    perItemOverhead:
      profile.responseShape === 'array' ? 4 : profile.responseShape === 'pairs' ? 6 : 12,
    perPlaceholderOverhead: 4,
    schemaOverhead: schemaTokens,
    availableOutputTokens,
    ...(profile.maximumOutputTokens === undefined
      ? {}
      : { modelMaximumOutputTokens: profile.maximumOutputTokens }),
  });
  return {
    contextWindow: profile.contextWindow,
    fixedPromptTokens,
    pageMemoryTokens,
    sectionMemoryTokens,
    localContextTokens,
    retrievedContextTokens,
    sourceTokens,
    schemaTokens,
    reservedOutputTokens,
    safetyReserveTokens: profile.safetyReserveTokens,
    totalEstimatedTokens: inputWithoutOutput + reservedOutputTokens,
    tokenizerId: counter.id,
    tokenizerAccuracy: counter.accuracy,
  };
};

const relevant = (term: string, request: PageTranslationBatchRequest): boolean => {
  const needle = term.toLocaleLowerCase();
  return request.targets.some((target) =>
    target.sourceText.toLocaleLowerCase().includes(needle),
  );
};

const compactPageMemory = (
  memory: PageProfile,
  request: PageTranslationBatchRequest,
): PageProfile => ({
  languageDirection: memory.languageDirection,
  glossary: memory.glossary.filter(([source]) => relevant(source, request)),
  protectedTerms: memory.protectedTerms.filter((term) => relevant(term, request)),
  namedEntities: memory.namedEntities.filter((term) => relevant(term, request)),
});

const cloneContext = (context: TranslationRequestContext): TranslationRequestContext => ({
  headingPath: [...context.headingPath],
  previous: context.previous.map((item) => ({ ...item })),
  following: context.following.map((item) => ({ ...item })),
  retrieved: context.retrieved.map((item) => ({ ...item })),
});

const cloneSection = (section: SectionContext | undefined): SectionContext | undefined =>
  section === undefined
    ? undefined
    : {
        ...section,
        headingPath: [...section.headingPath],
      };

export const budgetPageTranslationRequest = (
  request: PageTranslationBatchRequest,
  profile: TranslationModelProfile,
  counter: TranslationTokenCounter,
  outputRatio: number,
): BudgetedPageRequest => {
  let reduced: PageTranslationBatchRequest = {
    ...request,
    memory: {
      ...request.memory,
      glossary: [...request.memory.glossary],
      protectedTerms: [...request.memory.protectedTerms],
      namedEntities: [...request.memory.namedEntities],
    },
    section: cloneSection(request.section),
    context: cloneContext(request.context),
    targets: [...request.targets],
  };
  const reductions: string[] = [];
  let budget = computeBudget(reduced, profile, counter, outputRatio);
  const exceeds = (): boolean =>
    budget.totalEstimatedTokens > profile.contextWindow ||
    budget.pageMemoryTokens > profile.batching.maxMemoryTokens ||
    budget.localContextTokens + budget.retrievedContextTokens >
      profile.batching.maxContextTokens ||
    budget.sourceTokens > profile.batching.maxSourceTokens ||
    budget.reservedOutputTokens < 64;

  while (exceeds() && reduced.context.retrieved.length > 0) {
    reduced.context.retrieved.pop();
    reductions.push('retrieved-context');
    budget = computeBudget(reduced, profile, counter, outputRatio);
  }
  while (exceeds() && reduced.context.following.length > 0) {
    reduced.context.following.pop();
    reductions.push('following-context');
    budget = computeBudget(reduced, profile, counter, outputRatio);
  }
  while (exceeds() && reduced.context.previous.length > 0) {
    reduced.context.previous.shift();
    reductions.push('previous-context');
    budget = computeBudget(reduced, profile, counter, outputRatio);
  }
  if (exceeds() && reduced.section?.summary !== undefined) {
    const { summary: _summary, ...sectionWithoutSummary } = reduced.section;
    reduced = { ...reduced, section: sectionWithoutSummary };
    reductions.push('section-summary');
    budget = computeBudget(reduced, profile, counter, outputRatio);
  }
  if (exceeds()) {
    const compacted = compactPageMemory(reduced.memory, reduced);
    if (JSON.stringify(compacted) !== JSON.stringify(reduced.memory)) {
      reduced = { ...reduced, memory: compacted };
      reductions.push('page-memory');
      budget = computeBudget(reduced, profile, counter, outputRatio);
    }
  }

  return { request: reduced, budget, reductions, overBudget: exceeds() };
};

export class OutputRatioTracker {
  private readonly ratios = new Map<string, number>();
  private readonly sessionTotals = new Map<
    string,
    { sourceTokens: number; targetTokens: number }
  >();

  public get(
    profile: TranslationModelProfile,
    sourceLanguage: string,
    targetLanguage: string,
    contentClass: string,
  ): number {
    const key = this.key(profile.id, sourceLanguage, targetLanguage, contentClass);
    return (
      this.ratios.get(key) ??
      profile.initialOutputRatios[
        `${sourceLanguage}>${targetLanguage}:${contentClass}`
      ] ??
      profile.initialOutputRatios[`${sourceLanguage}>${targetLanguage}`] ??
      profile.initialOutputRatios.default ??
      1.35
    );
  }
  public getSession(
    profile: TranslationModelProfile,
    sourceLanguage: string,
    targetLanguage: string,
  ): number {
    const key = this.key(profile.id, sourceLanguage, targetLanguage, 'session');
    const totals = this.sessionTotals.get(key);
    if (totals === undefined || totals.sourceTokens <= 0) {
      return this.get(profile, sourceLanguage, targetLanguage, 'body');
    }
    return Math.min(3, Math.max(0.5, totals.targetTokens / totals.sourceTokens));
  }

  public observe(
    profileId: string,
    sourceLanguage: string,
    targetLanguage: string,
    contentClass: string,
    sourceTokens: number,
    targetTokens: number,
  ): void {
    if (sourceTokens <= 0 || targetTokens <= 0) return;
    const key = this.key(profileId, sourceLanguage, targetLanguage, contentClass);
    const observed = Math.min(3, Math.max(0.5, targetTokens / sourceTokens));
    const previous = this.ratios.get(key) ?? observed;
    this.ratios.set(key, Math.min(3, Math.max(0.5, previous * 0.8 + observed * 0.2)));
    const sessionKey = this.key(profileId, sourceLanguage, targetLanguage, 'session');
    const totals = this.sessionTotals.get(sessionKey) ?? {
      sourceTokens: 0,
      targetTokens: 0,
    };
    totals.sourceTokens += sourceTokens;
    totals.targetTokens += targetTokens;
    this.sessionTotals.set(sessionKey, totals);
  }
  public clear(profileId?: string): void {
    if (profileId === undefined) {
      this.ratios.clear();
      this.sessionTotals.clear();
      return;
    }
    for (const key of this.ratios.keys()) {
      if (key.startsWith(`${profileId}\u0000`)) this.ratios.delete(key);
    }
    for (const key of this.sessionTotals.keys()) {
      if (key.startsWith(`${profileId}\u0000`)) this.sessionTotals.delete(key);
    }
  }

  private key(
    profileId: string,
    sourceLanguage: string,
    targetLanguage: string,
    contentClass: string,
  ): string {
    return `${profileId}\u0000${sourceLanguage}>${targetLanguage}\u0000${contentClass}`;
  }
}
