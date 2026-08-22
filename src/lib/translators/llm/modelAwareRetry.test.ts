import { Effect } from 'effect';

import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';

import {
  LLMTranslationEngine,
  type LLMRequest,
  type LLMResponse,
} from './LLMTranslationEngine';
import { resolveLLMExecutionSettings } from './modelInfo';
import { llmProviderPresets } from './presets';

const configured = structuredClone(llmProviderPresets.custom);
configured.model = 'test-model';
configured.maxConcurrentRequests = 1;
const settings = resolveLLMExecutionSettings(configured, null);

const target = (id: string, sourceText: string) => ({
  id,
  sourceText,
  normalizedText: sourceText,
  kind: 'button' as const,
  slot: 'visible-text' as const,
  contextClass: 'settings:button',
  semanticKey: id,
  priority: 4,
});

const request: PageTranslationBatchRequest = {
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  sessionId: 'session',
  memory: {
    languageDirection: 'en>zh',
    glossary: [],
    protectedTerms: [],
    namedEntities: [],
  },
  section: {
    sectionId: 'settings',
    headingPath: ['Settings'],
    summary: 'Application settings.',
  },
  context: {
    headingPath: ['Settings'],
    previous: [{ source: 'Open settings.', translation: '打开设置。' }],
    following: [{ source: 'Close settings.' }],
    retrieved: [{ source: 'Save changes.', translation: '保存更改。' }],
  },
  group: {
    kind: 'button',
    slot: 'visible-text',
    contextClass: 'settings:button',
  },
  targets: [target('u1', 'Save'), target('u2', 'Cancel')],
};

const response = (text: string): LLMResponse => ({
  text,
  usage: { inputTokens: null, outputTokens: null },
});

const run = async (responses: string[]) => {
  const calls: LLMRequest[] = [];
  const engine = new LLMTranslationEngine({
    loadSettings: () => Promise.resolve(settings),
    fetch: (inferenceRequest) => {
      calls.push(inferenceRequest);
      return Effect.succeed(response(responses.shift() ?? ''));
    },
  });
  const result = await engine.translatePageBatch(request, {
    context: 'session',
    priority: 4,
    retryLimit: 0,
    isolateInvalidBatches: true,
  });
  return { calls, result };
};

describe('model-aware webpage retries', () => {
  test('invalid JSON retries isolated targets rather than resending the batch', async () => {
    const { calls, result } = await run([
      'not json',
      JSON.stringify({ translations: [['u1', '保存']] }),
      JSON.stringify({ translations: [['u2', '取消']] }),
    ]);

    expect(result).toEqual([
      { id: 'u1', target: '保存' },
      { id: 'u2', target: '取消' },
    ]);
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(calls[1].messages)).toContain('u1');
    expect(JSON.stringify(calls[1].messages)).not.toContain('u2');
    expect(JSON.stringify(calls[2].messages)).toContain('u2');
    expect(JSON.stringify(calls[2].messages)).not.toContain('u1');
  });

  test('language ambiguity retries with advanced local and retrieved context', async () => {
    const singleRequest = { ...request, targets: [target('u1', 'Open')] };
    const calls: LLMRequest[] = [];
    const responses = [
      JSON.stringify({ translations: [{ id: 'u1', target: 'Open' }] }),
      JSON.stringify({ translations: [{ id: 'u1', target: '打开' }] }),
    ];
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: (inferenceRequest) => {
        calls.push(inferenceRequest);
        return Effect.succeed(response(responses.shift() ?? ''));
      },
    });

    await expect(
      engine.translatePageBatch(singleRequest, {
        context: 'session',
        priority: 4,
        retryLimit: 0,
        isolateInvalidBatches: true,
      }),
    ).resolves.toEqual([{ id: 'u1', target: '打开' }]);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].messages)).toContain('Save changes.');
  });
});
