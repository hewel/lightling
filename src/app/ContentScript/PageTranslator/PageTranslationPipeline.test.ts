import type {
  PageTranslationBatchRequest,
  PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';
import { createConservativeTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import { PageTranslationPipeline } from './PageTranslationPipeline';
import { pageTranslationProvenance } from './PageTranslationProvenance';

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
    const request = vi.mocked(translatePageBatch).mock.calls[0]?.[0];
    expect(request?.sessionId).toEqual(expect.any(String));
    expect(request).not.toHaveProperty('sessionSignature');

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
  test('does not resubmit applied translations during a parent rescan', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));

    main.append(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);
    pipeline.stop();
  });

  test('ignores ambiguous mutations inside owned translated subtrees', async () => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Speichern'),
    );
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    // Own output re-observed without an occurrence binding must never be
    // re-collected: use unique text so a leak would force a second batch.
    const owned = document.createElement('button');
    pageTranslationProvenance.markNodes([owned]);
    main.append(owned);
    owned.append(document.createTextNode('Eindeutig'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    // Negative control: identical unmarked text IS collected, proving the
    // pipeline is alive and only provenance suppressed the owned copy.
    const external = document.createElement('button');
    external.textContent = 'Eindeutig';
    main.append(external);
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(translatePageBatch).mock.calls[1]?.[0].targets[0]?.sourceText,
    ).toContain('Eindeutig');

    pageTranslationProvenance.unmark(owned);
    pipeline.stop();
  });

  test('does not retranslate an applied text node recreated by the page', async () => {
    document.body.innerHTML = '<main><p>Save <code>token</code> Close</p></main>';
    const main = document.querySelector('main');
    const paragraph = document.querySelector('p');
    if (main === null || paragraph === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() =>
      expect(paragraph.textContent).toBe('Speichern token Schließen'),
    );

    const translatedText = paragraph.lastChild;
    if (!(translatedText instanceof Text)) throw new Error('translated text missing');
    translatedText.replaceWith(translatedText.nodeValue ?? '');
    const recreatedText = paragraph.lastChild;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(translatePageBatch).toHaveBeenCalledTimes(1);
    expect(paragraph.textContent).toBe('Speichern token Schließen');
    if (!(recreatedText instanceof Text)) throw new Error('recreated text missing');
    recreatedText.nodeValue = ' Open';
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(translatePageBatch).mock.calls[1]?.[0].targets[0]?.sourceText,
    ).toContain('Open');

    pipeline.stop();
    expect(paragraph.lastChild).toBe(recreatedText);
    expect(main.textContent).toBe('Save token Open');
  });

  test('backs off when the page keeps reverting an applied translation', async () => {
    document.body.innerHTML = '<main><p>Save</p></main>';
    const main = document.querySelector('main');
    const paragraph = document.querySelector('p');
    if (main === null || paragraph === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(paragraph.textContent).toBe('Speichern'));

    // Hostile page repeatedly resets the translated node to the source text.
    for (let attempt = 0; attempt < 5; attempt++) {
      paragraph.replaceChildren(document.createTextNode('Save'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // The translation comes from page memory, so the war must never re-request,
    // and the conflict backoff must stop re-applying after repeated reverts.
    expect(translatePageBatch).toHaveBeenCalledTimes(1);
    expect(paragraph.textContent).toBe('Save');
    pipeline.stop();
  });

  test('does not leak nested applied text when a link parent is rescanned', async () => {
    document.body.innerHTML = '<main><a><span>Save</span></a></main>';
    const main = document.querySelector('main');
    const link = document.querySelector('a');
    const span = document.querySelector('span');
    if (main === null || link === null || span === null)
      throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(span.textContent).toBe('Speichern'));

    link.append(document.createElement('i'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);
    pipeline.stop();
    expect(span.textContent).toBe('Save');
  });

  test('retranslates an application-updated label without forcing layout reads', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));

    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    button.textContent = 'Close';
    await vi.waitFor(() => expect(button.textContent).toBe('Schließen'));
    expect(translatePageBatch).toHaveBeenCalledTimes(2);
    expect(rectSpy).not.toHaveBeenCalled();
    rectSpy.mockRestore();

    pipeline.stop();
    expect(button.textContent).toBe('Close');
  });

  test('recollects external overwrites as new source text', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));

    const textNode = button.firstChild;
    if (!(textNode instanceof Text)) throw new Error('fixture text missing');
    textNode.nodeValue = 'Close';
    await vi.waitFor(() => expect(button.textContent).toBe('Schließen'));
    expect(translatePageBatch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(translatePageBatch).mock.calls[1]?.[0].targets[0]?.sourceText).toBe(
      'Close',
    );

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
