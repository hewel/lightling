import { LLMProfile, LLMProvider, LLMTranslator } from './LLMTranslator';

export const DEFAULT_LLM_API_URL = 'https://api.openai.com/v1';

const providerDefaults: Record<
  LLMProvider,
  {
    apiUrl: string;
    modelsPath: string;
    authHeader: (apiKey: string) => Record<string, string>;
  }
> = {
  openai: {
    apiUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  anthropic: {
    apiUrl: 'https://api.anthropic.com',
    modelsPath: '/v1/models',
    authHeader: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
  openrouter: {
    apiUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  'openai-compatible': {
    apiUrl: DEFAULT_LLM_API_URL,
    modelsPath: '/models',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
};

/**
 * Fetch identifiers of models available at the profile's API.
 * Every supported provider exposes an OpenAI-style `GET {apiUrl}/models` listing;
 * only the base URL and the auth header differ.
 */
export const fetchLLMModels = async (
  profile: Pick<LLMProfile, 'provider' | 'apiUrl' | 'apiKey'>,
): Promise<string[]> => {
  const defaults = providerDefaults[profile.provider];
  const baseUrl = (profile.apiUrl === '' ? defaults.apiUrl : profile.apiUrl).replace(
    /\/+$/,
    '',
  );

  const response = await fetch(`${baseUrl}${defaults.modelsPath}`, {
    headers: profile.apiKey === '' ? {} : defaults.authHeader(profile.apiKey),
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
 * Verify LLM profile settings with a real translation request.
 * Resolves with the translated sample text.
 */
export const testLLMTranslator = (profile: LLMProfile): Promise<string> =>
  new LLMTranslator({ activeProfile: profile.name, profiles: [profile] }).translate(
    'Hello world',
    'en',
    'es',
  );
