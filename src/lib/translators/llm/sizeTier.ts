import type { LLMModelInfo } from './modelInfo';
import {
  getRegisteredTranslationModelPatch,
  type ConfiguredLLMProfile,
} from './modelProfile';

export type TranslationModelSizeTier = 'small' | 'medium' | 'large';

export interface SizeTierBudgetSpec {
  initialConcurrency: number;
  initialBatchSourceTokens: number;
  minConcurrency: number;
  maxConcurrency: number;
  minBatchSourceTokens: number;
  maxBatchSourceTokens: number;
  budgetCeilingTokens: number;
}

export const SIZE_TIER_BUDGETS: Record<TranslationModelSizeTier, SizeTierBudgetSpec> = {
  small: {
    initialConcurrency: 4,
    initialBatchSourceTokens: 600,
    minConcurrency: 2,
    maxConcurrency: 12,
    minBatchSourceTokens: 256,
    maxBatchSourceTokens: 1200,
    budgetCeilingTokens: 9600,
  },
  medium: {
    initialConcurrency: 2,
    initialBatchSourceTokens: 1200,
    minConcurrency: 1,
    maxConcurrency: 8,
    minBatchSourceTokens: 512,
    maxBatchSourceTokens: 1600,
    budgetCeilingTokens: 4800,
  },
  large: {
    initialConcurrency: 2,
    initialBatchSourceTokens: 1600,
    minConcurrency: 1,
    maxConcurrency: 3,
    minBatchSourceTokens: 800,
    maxBatchSourceTokens: 2400,
    budgetCeilingTokens: 3200,
  },
};

const modelNameTier = (name: string): TranslationModelSizeTier | null => {
  const normalized = name.toLowerCase();
  if (/(tiny|mini|flash|nano|lite|haiku|turbo)/u.test(normalized)) return 'small';
  if (/(pro|opus|ultra|reasoning|o1|o3|r1)/u.test(normalized)) return 'large';
  return null;
};

const priceTier = (modelInfo: LLMModelInfo): TranslationModelSizeTier | null => {
  const input = modelInfo.inputPricePerMillionTokens ?? null;
  const output = modelInfo.outputPricePerMillionTokens ?? null;
  if (input === null && output === null) return null;
  if ((input !== null && input >= 5) || (output !== null && output >= 20)) {
    return 'large';
  }
  if ((input === null || input <= 1) && (output === null || output <= 4)) {
    return 'small';
  }
  return 'medium';
};

export const resolveSizeTier = (
  configured: ConfiguredLLMProfile,
  modelInfo: LLMModelInfo | null,
): TranslationModelSizeTier => {
  const registeredPatch = getRegisteredTranslationModelPatch(configured.model);
  if (registeredPatch?.sizeTier !== undefined) return registeredPatch.sizeTier;

  if (modelInfo !== null) {
    const metadataTier = priceTier(modelInfo);
    if (metadataTier !== null) return metadataTier;
  }

  const nameTier = modelNameTier(
    [configured.model, modelInfo?.id ?? '', modelInfo?.displayName ?? ''].join(' '),
  );
  if (nameTier !== null) return nameTier;

  const contextWindowTokens =
    modelInfo?.contextWindowTokens ??
    configured.contextWindowTokens ??
    registeredPatch?.contextWindow;
  if (
    contextWindowTokens !== undefined &&
    contextWindowTokens !== null &&
    contextWindowTokens < 32_000
  ) {
    return 'small';
  }

  return 'medium';
};
