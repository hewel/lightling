import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';

import { LLMTranslator } from './LLMTranslator';
import { llmProviderPresets } from './presets';

vi.stubGlobal('location', new URL('https://localhost/_generated_background_page.html'));

const completionResponse = (model: string, content: string) =>
  new Response(
    JSON.stringify({
      id: `response-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const request: PageTranslationBatchRequest = {
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  sessionId: 'session',
  sessionSignature: 'signature',
  memory: {
    languageDirection: 'en>zh',
    glossary: [],
    protectedTerms: [],
    namedEntities: [],
  },
  context: {
    headingPath: [],
    previous: [],
    following: [],
    retrieved: [],
  },
  group: {
    kind: 'button',
    slot: 'visible-text',
    contextClass: 'settings:button',
  },
  targets: [
    {
      id: 'u1',
      sourceText: 'Save',
      normalizedText: 'Save',
      kind: 'button',
      slot: 'visible-text',
      contextClass: 'settings:button',
      semanticKey: 'u1',
      priority: 4,
    },
  ],
};

describe('translation model fallback', () => {
  test('escalates only the failed batch to the explicitly configured fallback', async () => {
    const requestModels: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/models')) {
        return new Response(
          JSON.stringify({
            data: [{ id: 'primary-model' }, { id: 'fallback-model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const bodyText =
        init?.body === undefined ? '{}' : await new Response(init.body).text();
      const body = JSON.parse(bodyText);
      const model = typeof body.model === 'string' ? body.model : '';
      requestModels.push(model);
      return completionResponse(
        model,
        model === 'fallback-model'
          ? JSON.stringify({ translations: [{ id: 'u1', target: '保存' }] })
          : 'invalid json',
      );
    });

    const primary = structuredClone(llmProviderPresets.custom);
    primary.name = 'Primary';
    primary.apiUrl = 'https://llm.example/v1';
    primary.model = 'primary-model';
    primary.fallbackProfile = 'Fallback';
    primary.translationProfile.retry.maxRetries = 1;
    const fallback = structuredClone(llmProviderPresets.custom);
    fallback.name = 'Fallback';
    fallback.apiUrl = 'https://llm.example/v1';
    fallback.model = 'fallback-model';

    const translator = new LLMTranslator({
      activeProfile: primary.name,
      profiles: [primary, fallback],
    });
    const result = await translator.translatePageBatch(request, {
      context: 'session',
      priority: 4,
      retryLimit: 0,
    });
    expect(result).toEqual([{ id: 'u1', target: '保存' }]);
    expect(requestModels.at(-1)).toBe('fallback-model');
    expect(requestModels).toContain('primary-model');
    translator.dispose();
    vi.unstubAllGlobals();
  });
});
