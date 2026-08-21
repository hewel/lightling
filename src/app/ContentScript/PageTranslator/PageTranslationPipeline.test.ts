import type {
  PageTranslationBatchRequest,
  PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';
import { createConservativeTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import { PageTranslationPipeline } from './PageTranslationPipeline';

vi.mock('@/requests/backend/translatePageBatch', () => ({
  translatePageBatch: vi.fn(),
}));
vi.mock('@/requests/backend/abortTranslation', () => ({
  abortTranslation: vi.fn(async () => {}),
}));

const responseFor = (
  request: PageTranslationBatchRequest,
): PageTranslationBatchResponse => ({
  translations: request.targets.map((target) => ({
    id: target.id,
    target: target.sourceText.replace('Save', 'Speichern').replace('Close', 'Schließen'),
    cacheKey: target.semanticKey,
    cacheHit: false,
  })),
});

const baseModelProfile = createConservativeTranslationModelProfile('small-model');
const modelProfile = {
  ...baseModelProfile,
  batching: { ...baseModelProfile.batching, concurrency: 1 },
};
const createPipeline = (root: Element, logEnabled = false) =>
  new PageTranslationPipeline({
    root,
    sourceLanguage: 'en',
    targetLanguage: 'de',
    identity: { provider: 'openai', model: 'small-model' },
    sessionId: crypto.randomUUID(),
    sessionSignature: crypto.randomUUID(),
    modelProfile,
    tokenCounter: conservativeTokenCounter,
    logEnabled,
  });

describe('PageTranslationPipeline dynamic lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<main><button>Save</button></main>';
    vi.mocked(translatePageBatch).mockImplementation(async (request) =>
      responseFor(request),
    );
  });

  test('ignores observer feedback and applies a page-memory hit to new SPA content', async () => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main);
    pipeline.start();

    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Speichern'),
    );
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    const repeated = document.createElement('button');
    repeated.textContent = 'Save';
    main.append(repeated);
    await vi.waitFor(() => expect(repeated.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    pipeline.stop();
    expect(
      Array.from(main.querySelectorAll('button'), (button) => button.textContent),
    ).toEqual(['Save', 'Save']);
  });

  test('retranslates an application-updated label without entering a feedback loop', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));

    button.textContent = 'Close';
    await vi.waitFor(() => expect(button.textContent).toBe('Schließen'));
    expect(translatePageBatch).toHaveBeenCalledTimes(2);

    pipeline.stop();
    expect(button.textContent).toBe('Close');
  });

  test('never applies a result after the translation session stops', async () => {
    const deferred = Promise.withResolvers<PageTranslationBatchResponse>();
    let pendingRequest: PageTranslationBatchRequest | undefined;
    vi.mocked(translatePageBatch).mockImplementation((request) => {
      pendingRequest = request;
      return deferred.promise;
    });
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));

    pipeline.stop();
    if (pendingRequest === undefined) throw new Error('translation request missing');
    deferred.resolve(responseFor(pendingRequest));
    await Promise.resolve();
    expect(main.querySelector('button')?.textContent).toBe('Save');
    expect(abortTranslation).not.toHaveBeenCalled();
  });
  test('retains no exportable log while the setting is disabled', async () => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Speichern'),
    );

    expect(pipeline.getLog()).toBeNull();
    pipeline.stop();
  });

  test('exports an isolated agent-readable snapshot when logging is enabled', async () => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, true);
    pipeline.start();
    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Speichern'),
    );
    const repeated = document.createElement('button');
    repeated.textContent = 'Save';
    main.append(repeated);
    await vi.waitFor(() => expect(repeated.textContent).toBe('Speichern'));

    const log = pipeline.getLog();
    expect(log).not.toBeNull();
    expect(log).toMatchObject({
      schemaVersion: 'lightling.page-translation-log.v2',
      session: {
        sourceLanguage: 'en',
        targetLanguage: 'de',
        provider: 'openai',
        model: 'small-model',
      },
      droppedBatches: 0,
    });
    expect(log?.batches[0]).toMatchObject({
      retryCount: 0,
      validationFailures: 0,
      targets: [
        {
          sourceText: 'Save',
          translatedText: 'Speichern',
          kind: 'button',
          status: 'translated',
          cacheHit: false,
        },
      ],
    });
    expect(log?.batches[1]).toMatchObject({
      targets: [
        {
          sourceText: 'Save',
          translatedText: 'Speichern',
          status: 'translated',
          cacheHit: true,
        },
      ],
    });

    if (log !== null) log.batches[0].targets[0].sourceText = 'mutated export';
    expect(pipeline.getLog()?.batches[0].targets[0].sourceText).toBe('Save');
    pipeline.stop();
  });

  test('keeps accepted translations when one target remains unresolved', async () => {
    document.body.innerHTML = '<main><button>Save</button><button>Close</button></main>';
    vi.mocked(translatePageBatch).mockImplementationOnce(async (request) => {
      const accepted = request.targets[0];
      return {
        translations: [
          {
            id: accepted.id,
            target: 'Speichern',
            cacheKey: accepted.semanticKey,
            cacheHit: false,
          },
        ],
      };
    });
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, true);
    pipeline.start();

    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Speichern'),
    );
    expect(
      Array.from(main.querySelectorAll('button'), (button) => button.textContent),
    ).toEqual(['Speichern', 'Close']);
    expect(pipeline.getLog()?.batches[0].targets).toMatchObject([
      { sourceText: 'Save', status: 'translated' },
      { sourceText: 'Close', status: 'failed' },
    ]);
    pipeline.stop();
  });

  test('records provider failures without stack traces', async () => {
    vi.mocked(translatePageBatch).mockRejectedValueOnce(
      new Error('provider unavailable'),
    );
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, true);
    pipeline.start();
    await vi.waitFor(() =>
      expect(pipeline.getLog()?.batches[0].completedAt).toEqual(expect.any(Number)),
    );

    expect(pipeline.getLog()?.batches[0]).toMatchObject({
      error: {
        name: 'Error',
        message: 'provider unavailable',
      },
      targets: [{ status: 'failed' }],
    });
    expect(JSON.stringify(pipeline.getLog())).not.toContain('stack');
    pipeline.stop();
  });

  test('chunks bulk DOM application so a single task never applies the whole page', async () => {
    vi.useFakeTimers();
    const originalReplace = Element.prototype.replaceChildren;
    try {
      const buttons = Array.from(
        { length: 60 },
        (_, index) => `<button>Save ${index}</button>`,
      ).join('');
      document.body.innerHTML = `<main>${buttons}</main>`;
      let replaceChildrenCalls = 0;
      Element.prototype.replaceChildren = function (
        this: Element,
        ...nodes: (Node | string)[]
      ): void {
        replaceChildrenCalls++;
        originalReplace.apply(this, nodes);
      };

      const main = document.querySelector('main');
      if (main === null) throw new Error('fixture main missing');
      const pipeline = createPipeline(main);
      pipeline.start();

      // Flush microtasks only: collect, batch resolution, and the first
      // synchronous pump turn happen without any macrotask.
      for (let index = 0; index < 100; index++) await Promise.resolve();
      const appliedInFirstTask = replaceChildrenCalls;

      // Drain the remaining chunks. A 1ms step is used because
      // advanceTimersByTimeAsync(0) does not fire 0ms timers scheduled
      // during the same advance.
      for (let index = 0; index < 500 && replaceChildrenCalls < 60; index++) {
        await vi.advanceTimersByTimeAsync(1);
      }

      expect(replaceChildrenCalls).toBe(60);
      expect(appliedInFirstTask).toBeGreaterThan(0);
      expect(appliedInFirstTask).toBeLessThan(60);
      expect(
        Array.from(main.querySelectorAll('button'), (button) => button.textContent),
      ).toContain('Speichern 0');
      pipeline.stop();
    } finally {
      Element.prototype.replaceChildren = originalReplace;
      vi.useRealTimers();
    }
  });
});
