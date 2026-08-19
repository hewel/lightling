import { LLMProfile } from './LLMTranslator';

export type LLMPresetId =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export const llmPresetIds: readonly LLMPresetId[] = [
  'openai',
  'anthropic',
  'openrouter',
  'ollama',
  'lmstudio',
  'custom',
];

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
  },
  anthropic: {
    name: 'Anthropic',
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: '',
  },
  openrouter: {
    name: 'OpenRouter',
    provider: 'openrouter',
    apiUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: '',
  },
  ollama: {
    name: 'Ollama',
    provider: 'openai-compatible',
    apiUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: '',
  },
  lmstudio: {
    name: 'LM Studio',
    provider: 'openai-compatible',
    apiUrl: 'http://localhost:1234/v1',
    apiKey: '',
    model: '',
  },
  custom: {
    name: 'Custom',
    provider: 'openai-compatible',
    apiUrl: '',
    apiKey: '',
    model: '',
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
