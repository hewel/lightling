import { LLMProfile, LLMTranslator } from './LLMTranslator';
import { DEFAULT_LLM_API_URL, fetchLLMModels } from './modelInfo';

export { DEFAULT_LLM_API_URL, fetchLLMModels };

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
