import {
  DEFAULT_ADAPTIVE_BATCHING,
  DEFAULT_LLM_FALLBACK_PROFILE,
  DEFAULT_TRANSLATION_PROFILE_OVERRIDES,
  DEFAULT_TRANSLATION_QUALITY_MODE,
} from '@/types/runtime';

import { LLMProfile } from './LLMTranslator';

export type LLMPresetId =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'google'
  | 'antling'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export const llmPresetIds: readonly LLMPresetId[] = [
  'openai',
  'anthropic',
  'openrouter',
  'google',
  'antling',
  'ollama',
  'lmstudio',
  'custom',
];

/**
 * Execution settings left as `null` resolve automatically at runtime
 */
const automaticExecution = (): Pick<
  LLMProfile,
  | 'contextWindowTokens'
  | 'preferredInputTokens'
  | 'maxOutputTokens'
  | 'maxConcurrentRequests'
  | 'qualityMode'
  | 'fallbackProfile'
  | 'adaptiveBatching'
  | 'translationProfile'
> => ({
  contextWindowTokens: null,
  preferredInputTokens: null,
  maxOutputTokens: null,
  maxConcurrentRequests: null,
  qualityMode: DEFAULT_TRANSLATION_QUALITY_MODE,
  fallbackProfile: DEFAULT_LLM_FALLBACK_PROFILE,
  adaptiveBatching: DEFAULT_ADAPTIVE_BATCHING,
  translationProfile: structuredClone(DEFAULT_TRANSLATION_PROFILE_OVERRIDES),
});

/**
 * Quick-fill profiles for known providers; key-less local servers leave `apiKey` empty
 */
export const llmProviderPresets: Record<LLMPresetId, LLMProfile> = {
  openai: {
    name: 'OpenAI',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    ...automaticExecution(),
  },
  anthropic: {
    name: 'Anthropic',
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: '',
    ...automaticExecution(),
  },
  openrouter: {
    name: 'OpenRouter',
    provider: 'openrouter',
    apiUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: '',
    ...automaticExecution(),
  },
  google: {
    name: 'Google AI Studio',
    provider: 'openai-compatible',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: '',
    model: 'gemini-3.7-flash',
    ...automaticExecution(),
  },
  antling: {
    name: 'Ant Ling',
    provider: 'openai-compatible',
    apiUrl: 'https://api.ant-ling.com/v1',
    apiKey: '',
    model: 'Ling-3.0-flash',
    ...automaticExecution(),
  },
  ollama: {
    name: 'Ollama',
    provider: 'openai-compatible',
    apiUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: '',
    ...automaticExecution(),
  },
  lmstudio: {
    name: 'LM Studio',
    provider: 'openai-compatible',
    apiUrl: 'http://localhost:1234/v1',
    apiKey: '',
    model: '',
    ...automaticExecution(),
  },
  custom: {
    name: 'Custom',
    provider: 'openai-compatible',
    apiUrl: '',
    apiKey: '',
    model: '',
    ...automaticExecution(),
  },
};

/**
 * Append " 2", " 3", … to a name until it is unique among existing profile names
 */
export const makeUniqueProfileName = (
  base: string,
  existingNames: readonly string[],
): string => {
  if (!existingNames.includes(base)) return base;

  let index = 2;
  while (existingNames.includes(`${base} ${index}`)) index++;
  return `${base} ${index}`;
};
