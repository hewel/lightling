import type { IScheduler } from 'anylang/scheduling';

import type {
  PageTranslationBatchRequest,
  TranslationTarget,
} from '@/lib/pageTranslation/protocol';
import { LLMTranslator } from '@/lib/translators/llm/LLMTranslator';

import {
  createPageBatchExecution,
  LLMPageBatchExecution,
  SchedulerPageBatchExecution,
} from './pageBatchExecution';

const createTarget = (id: string, priority: number): TranslationTarget => ({
  id,
  sourceText: `source-${id}`,
  normalizedText: `source-${id}`,
  kind: 'body',
  slot: 'visible-text',
  contextClass: 'body',
  semanticKey: `key-${id}`,
  priority,
});

const createRequest = (targets: TranslationTarget[]): PageTranslationBatchRequest => ({
  sourceLanguage: 'en',
  targetLanguage: 'de',
  sessionId: 'session-1',
  memory: {
    languageDirection: 'ltr',
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
    kind: 'body',
    slot: 'visible-text',
    contextClass: 'body',
  },
  targets,
});

test('LLM page batch execution forwards request options and metrics', async () => {
  const translatePageBatch = vi.fn(async () => [{ id: 'first', target: 'translated' }]);
  const translator = { translatePageBatch } as unknown as LLMTranslator;
  const request = createRequest([createTarget('first', 2), createTarget('second', 8)]);
  const onMetrics = vi.fn();
  const execution = new LLMPageBatchExecution(translator, 5);

  await expect(execution.execute(request, onMetrics)).resolves.toEqual([
    { id: 'first', target: 'translated' },
  ]);

  expect(translatePageBatch).toHaveBeenCalledWith(
    request,
    {
      context: 'session-1',
      priority: 8,
      retryLimit: 5,
    },
    onMetrics,
  );
});

test('scheduler page batch execution translates each target with its own priority', async () => {
  const translate = vi.fn(
    async (
      text: string,
      from: string,
      to: string,
      options?: { context?: string; priority?: number },
    ) => `${text}-${from}-${to}-${options?.context}-${options?.priority}`,
  );
  const scheduler = { translate } as unknown as IScheduler;
  const request = createRequest([createTarget('first', 2), createTarget('second', 8)]);
  const execution = new SchedulerPageBatchExecution(scheduler);

  await expect(execution.execute(request)).resolves.toEqual([
    {
      id: 'first',
      target: 'source-first-en-de-session-1-2',
    },
    {
      id: 'second',
      target: 'source-second-en-de-session-1-8',
    },
  ]);

  expect(translate).toHaveBeenCalledTimes(2);
  expect(translate).toHaveBeenNthCalledWith(1, 'source-first', 'en', 'de', {
    context: 'session-1',
    priority: 2,
  });
  expect(translate).toHaveBeenNthCalledWith(2, 'source-second', 'en', 'de', {
    context: 'session-1',
    priority: 8,
  });
});

test('page batch execution factory selects the explicit adapter', () => {
  const translator = { translatePageBatch: vi.fn() } as unknown as LLMTranslator;
  const scheduler = { translate: vi.fn() } as unknown as IScheduler;

  expect(
    createPageBatchExecution({
      translatorClass: LLMTranslator,
      getLLMTranslator: () => translator,
      getScheduler: () => scheduler,
      retryLimit: 2,
    }),
  ).toBeInstanceOf(LLMPageBatchExecution);
  expect(
    createPageBatchExecution({
      translatorClass: class OtherTranslator {},
      getLLMTranslator: () => translator,
      getScheduler: () => scheduler,
      retryLimit: 2,
    }),
  ).toBeInstanceOf(SchedulerPageBatchExecution);
});
