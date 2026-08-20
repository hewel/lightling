import { defaultConfig } from '@/config';
import type { AppConfigType } from '@/types/runtime';

import { setConfig, setConfigFactory } from './setConfig';

describe('setConfig', () => {
  test('stores a decoded config with explicit null execution overrides', async () => {
    const setMock = vi.fn(async (_config: AppConfigType) => {});
    const cleanup = setConfigFactory({
      config: { set: setMock } as never,
      backgroundContext: {} as never,
    });

    try {
      // A version-11 profile lacks the execution override fields entirely
      const legacyProfile = {
        name: 'Default',
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: 'secret-key',
        model: 'test-model',
      };

      await setConfig({
        ...defaultConfig,
        llmTranslator: { activeProfile: 'Default', profiles: [legacyProfile] },
      } as never);

      expect(setMock).toHaveBeenCalledTimes(1);
      const storedConfig = setMock.mock.calls[0][0];
      expect(storedConfig.llmTranslator.profiles[0]).toEqual({
        ...legacyProfile,
        contextWindowTokens: null,
        preferredInputTokens: null,
        maxOutputTokens: null,
        maxConcurrentRequests: null,
      });
    } finally {
      cleanup();
    }
  });
});
