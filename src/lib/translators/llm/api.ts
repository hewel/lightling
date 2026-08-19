import { LLMTranslator, LLMTranslatorConfig } from './LLMTranslator';

export const DEFAULT_LLM_API_URL = 'https://api.openai.com/v1';

/**
 * Fetch identifiers of models available at an OpenAI-compatible API
 */
export const fetchLLMModels = async (
  config: Pick<LLMTranslatorConfig, 'apiUrl' | 'apiKey'>,
): Promise<string[]> => {
  const baseUrl = (config.apiUrl === '' ? DEFAULT_LLM_API_URL : config.apiUrl).replace(
    /\/+$/,
    '',
  );

  const response = await fetch(`${baseUrl}/models`, {
    headers: config.apiKey === '' ? {} : { Authorization: `Bearer ${config.apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch a model list: HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('data' in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw new Error('Invalid model list response');
  }

  return (payload.data as unknown[])
    .map((entry) =>
      typeof entry === 'object' && entry !== null && 'id' in entry ? entry.id : null,
    )
    .filter((id): id is string => typeof id === 'string')
    .sort();
};

/**
 * Verify LLM translator settings with a real translation request.
 * Resolves with the translated sample text.
 */
export const testLLMTranslator = (config: LLMTranslatorConfig): Promise<string> =>
  new LLMTranslator(config).translate('Hello world', 'en', 'es');
