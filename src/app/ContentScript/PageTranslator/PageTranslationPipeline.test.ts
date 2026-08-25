import type {
  PageTranslationBatchRequest,
  PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';
import { TranslationBudgetController } from '@/lib/translators/llm/budgetController';
import { createConservativeTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import type { LaneBatchCaps } from './batching';
import { PageTranslationPipeline } from './PageTranslationPipeline';
import { pageTranslationProvenance } from './PageTranslationProvenance';
import { TranslationPriorityLane } from './priorityLanes';

vi.mock('@/requests/backend/translatePageBatch', () => ({
  translatePageBatch: vi.fn(),
}));
vi.mock('@/requests/backend/abortTranslation', () => ({
  abortTranslation: vi.fn(async () => {}),
}));
class MockIntersectionObserver implements IntersectionObserver {
  public static instances: MockIntersectionObserver[] = [];

  public readonly root: Element | Document | null;
  public readonly rootMargin: string;
  public readonly thresholds: readonly number[];
  public readonly scrollMargin = '0px';
  public readonly observed = new Set<Element>();
  public readonly observe = vi.fn((target: Element) => {
    this.observed.add(target);
  });
  public readonly unobserve = vi.fn((target: Element) => {
    this.observed.delete(target);
  });
  public readonly disconnect = vi.fn(() => {
    this.observed.clear();
  });
  public readonly takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

  public constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    MockIntersectionObserver.instances.push(this);
  }

  public trigger(...entries: IntersectionObserverEntry[]): void {
    this.callback(entries, this);
  }
}

const observerEntry = (
  target: Element,
  isIntersecting: boolean,
  top: number,
  bottom: number,
): IntersectionObserverEntry => {
  const boundingClientRect = DOMRect.fromRect({
    x: 0,
    y: top,
    width: 100,
    height: bottom - top,
  });
  const rootBounds = DOMRect.fromRect({
    x: 0,
    y: 0,
    width: 100,
    height: window.innerHeight,
  });
  return {
    target,
    isIntersecting,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect,
    intersectionRect: isIntersecting ? boundingClientRect : DOMRect.fromRect(),
    rootBounds,
    time: performance.now(),
  };
};

const responseFor = (
  request: PageTranslationBatchRequest,
): PageTranslationBatchResponse => ({
  translations: request.targets.map((target) => ({
    id: target.id,
    target: target.sourceText.replace('Save', 'Speichern').replace('Close', 'Schließen'),
    cacheKey: target.semanticKey,
    cacheHit: false,
    provenance: 'provider',
  })),
});

const baseModelProfile = createConservativeTranslationModelProfile('small-model');
const modelProfile = {
  ...baseModelProfile,
  batching: { ...baseModelProfile.batching, concurrency: 1 },
};
const createPipeline = (
  root: Element,
  logEnabled = false,
  stabilizationMs = 0,
  profile = modelProfile,
  onBudgetSnapshot?: (snapshot: {
    concurrency: number;
    batchSourceTokens: number;
    budgetTokens: number;
  }) => void,
  sizeTier: 'small' | 'medium' | 'large' = 'small',
  userConcurrencyCeiling: number | null = null,
  laneBatchCaps?: LaneBatchCaps,
) =>
  new PageTranslationPipeline({
    root,
    sourceLanguage: 'en',
    targetLanguage: 'de',
    identity: { provider: 'openai', model: 'small-model' },
    sessionId: crypto.randomUUID(),
    sessionSignature: crypto.randomUUID(),
    modelProfile: profile,
    tokenCounter: conservativeTokenCounter,
    logEnabled,
    stabilizationMs,
    sizeTier,
    userConcurrencyCeiling,
    onBudgetSnapshot,
    laneBatchCaps,
  });

describe('PageTranslationPipeline dynamic lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<main><button>Save</button></main>';
    vi.mocked(translatePageBatch).mockImplementation(async (request) =>
      responseFor(request),
    );
  });
  test('applies configured lane batch caps during pipeline planning', async () => {
    document.body.innerHTML =
      '<main><p>Visible one</p><p>Visible two</p><p>Visible three</p></main>';
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    for (const paragraph of main.querySelectorAll('p')) {
      paragraph.getBoundingClientRect = () =>
        DOMRect.fromRect({ y: 10, width: 100, height: 20 });
    }
    const staticProfile = {
      ...modelProfile,
      adaptive: { ...modelProfile.adaptive, enabled: false },
    };
    const pipeline = createPipeline(
      main,
      false,
      0,
      staticProfile,
      undefined,
      'small',
      null,
      {
        [TranslationPriorityLane.Visible]: { maxItems: 2, sourceTokens: 500 },
      },
    );

    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(translatePageBatch).mock.calls.map(([request]) => request.targets.length),
    ).toEqual([2, 1]);
    pipeline.stop();
  });

  test('counts unique units by their collection-time lanes', async () => {
    document.body.innerHTML = `
      <main>
        <p id="urgent" role="alert">Urgent unit</p>
        <p id="visible">Visible unit</p>
        <p id="near">Near unit</p>
        <p id="rest">Rest unit</p>
      </main>
    `;
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const positions = {
      urgent: 10,
      visible: 10,
      near: window.innerHeight + 10,
      rest: window.innerHeight * 3,
    };
    for (const [id, top] of Object.entries(positions)) {
      const element = document.querySelector(`#${id}`);
      if (element === null) throw new Error(`fixture ${id} missing`);
      element.getBoundingClientRect = () =>
        DOMRect.fromRect({ y: top, width: 100, height: 20 });
    }
    const pipeline = createPipeline(main);

    pipeline.start();
    await vi.waitFor(() => expect(pipeline.getMetrics().uniqueUnits).toBe(4));
    expect(pipeline.getMetrics().unitsByLane).toEqual({
      urgent: 1,
      visible: 1,
      near: 1,
      rest: 1,
    });
    pipeline.stop();
  });

  test('counts reranks only for lane changes touching undispatched units', async () => {
    document.body.innerHTML = '<main><p>First item</p><p>Second item</p></main>';
    const main = document.querySelector('main');
    const [first, second] = Array.from(document.querySelectorAll('p'));
    if (main === null || first === undefined || second === undefined) {
      throw new Error('fixture missing');
    }
    for (const paragraph of [first, second]) {
      paragraph.getBoundingClientRect = () =>
        DOMRect.fromRect({ y: window.innerHeight * 3, width: 100, height: 20 });
    }
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const firstResponse = Promise.withResolvers<PageTranslationBatchResponse>();
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      if (vi.mocked(translatePageBatch).mock.calls.length === 1) {
        return firstResponse.promise;
      }
      return {
        translations: request.targets.map((target) => ({
          id: target.id,
          target: `Translated ${target.sourceText}`,
          cacheKey: target.semanticKey,
          cacheHit: false,
          provenance: 'provider',
        })),
      };
    });
    const singleItemProfile = {
      ...modelProfile,
      adaptive: { ...modelProfile.adaptive, enabled: false },
      batching: { ...modelProfile.batching, concurrency: 1, maxItems: 1 },
    };
    const pipeline = createPipeline(main, false, 0, singleItemProfile);

    try {
      pipeline.start();
      await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));
      const visibleObserver = MockIntersectionObserver.instances[0];
      if (visibleObserver === undefined) throw new Error('visible observer missing');

      visibleObserver.trigger(observerEntry(first, true, 10, 30));
      await Promise.resolve();
      expect(pipeline.getMetrics().reranks).toBe(0);

      visibleObserver.trigger(observerEntry(second, true, 10, 30));
      await vi.waitFor(() => expect(pipeline.getMetrics().reranks).toBe(1));

      firstResponse.resolve(responseFor(vi.mocked(translatePageBatch).mock.calls[0][0]));
      await vi.waitFor(() => expect(second.textContent).toBe('Translated Second item'));

      visibleObserver.trigger(
        observerEntry(second, false, window.innerHeight * 3, window.innerHeight * 3 + 20),
      );
      await Promise.resolve();
      expect(pipeline.getMetrics().reranks).toBe(1);
    } finally {
      pipeline.stop();
      vi.unstubAllGlobals();
    }
  });

  test('admits a newly urgent dialog before queued Rest units without replacing the active batch', async () => {
    document.body.innerHTML =
      '<main><p>First item</p><p>Second item</p><p>Third item</p></main>';
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    for (const paragraph of main.querySelectorAll('p')) {
      paragraph.getBoundingClientRect = () =>
        DOMRect.fromRect({ y: window.innerHeight * 3, width: 100, height: 20 });
    }
    const firstResponse = Promise.withResolvers<PageTranslationBatchResponse>();
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      if (vi.mocked(translatePageBatch).mock.calls.length === 1) {
        return firstResponse.promise;
      }
      return responseFor(request);
    });
    const singleItemProfile = {
      ...modelProfile,
      adaptive: { ...modelProfile.adaptive, enabled: false },
      batching: { ...modelProfile.batching, concurrency: 1, maxItems: 1 },
    };
    const pipeline = createPipeline(main, false, 0, singleItemProfile);
    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));

    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.textContent = 'Urgent dialog item';
    main.append(alert);
    await vi.waitFor(() => expect(pipeline.getMetrics().uniqueUnits).toBe(4));

    firstResponse.resolve(responseFor(vi.mocked(translatePageBatch).mock.calls[0][0]));
    await vi.waitFor(() =>
      expect(vi.mocked(translatePageBatch).mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    const firstRequest = vi.mocked(translatePageBatch).mock.calls[0][0];
    const secondRequest = vi.mocked(translatePageBatch).mock.calls[1][0];
    expect(firstRequest.targets[0].sourceText).toBe('First item');
    expect(secondRequest.targets[0].sourceText).toBe('Urgent dialog item');
    expect(abortTranslation).not.toHaveBeenCalled();
    pipeline.stop();
  });

  test('keeps static profile behavior without creating an adaptive budget controller', async () => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const onBudgetSnapshot = vi.fn();
    const pipeline = createPipeline(
      main,
      true,
      0,
      { ...modelProfile, adaptive: { enabled: false } },
      onBudgetSnapshot,
    );
    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(pipeline.getLog()?.batches[0].completedAt).toEqual(expect.any(Number)),
    );
    const batch = pipeline.getLog()?.batches[0];
    if (batch === undefined) throw new Error('provider batch log missing');
    expect(batch.parallelism).toEqual({
      adaptive: false,
      sizeTier: 'small',
      dispatchConcurrency: modelProfile.batching.concurrency,
      batchSourceTokens: batch.sourceBudget,
      budgetTokens:
        modelProfile.batching.concurrency *
        (batch.sourceBudget + batch.tokenBudget.reservedOutputTokens),
    });
    expect(batch.latencyMs).toEqual(expect.any(Number));
    expect(batch.latencyMs).toBeGreaterThanOrEqual(0);
    expect(batch.terminologyConflicts).toBe(0);
    pipeline.stop();
    expect(onBudgetSnapshot).not.toHaveBeenCalled();
  });

  test('observes a 429 attempt and persists the adaptive snapshot on stop', async () => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    vi.mocked(translatePageBatch).mockImplementationOnce(async (request) => ({
      ...responseFor(request),
      metrics: {
        retryCount: 1,
        validationFailures: 0,
        attempts: [
          {
            kind: 'transport-retry',
            stage: 'initial',
            profileId: modelProfile.id,
            targetIds: request.targets.map((target) => target.id),
            httpStatus: 429,
            error: 'rate limit',
          },
        ],
      },
    }));
    const onBudgetSnapshot = vi.fn();
    const pipeline = createPipeline(main, false, 0, modelProfile, onBudgetSnapshot);
    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));
    pipeline.stop();
    expect(onBudgetSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ budgetTokens: expect.any(Number) }),
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
  test('shares admission across overlapping initial scan and rescan work', async () => {
    const profile = {
      ...modelProfile,
      batching: { ...modelProfile.batching, maxItems: 1, concurrency: 1 },
    };
    const first = Promise.withResolvers<PageTranslationBatchResponse>();
    let firstRequest: PageTranslationBatchRequest | undefined;
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      if (firstRequest === undefined) {
        firstRequest = request;
        return first.promise;
      }
      return responseFor(request);
    });
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, false, 0, profile);
    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));

    const second = document.createElement('button');
    second.textContent = 'Close';
    main.append(second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    if (firstRequest === undefined) throw new Error('first request missing');
    first.resolve(responseFor(firstRequest));
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    pipeline.stop();
  });
  test('pulls the current best producer from the shared admission buffer', async () => {
    type AdmissionProducer = {
      generation: number;
      nextBatch: () => unknown;
      peekUnit: () => unknown;
      resolve: () => void;
      active: number;
      exhausted: boolean;
    };
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, false, 0, {
      ...modelProfile,
      adaptive: { ...modelProfile.adaptive, enabled: false },
      batching: { ...modelProfile.batching, concurrency: 1 },
    });
    const admission = pipeline as unknown as {
      enqueueAdmission: (producer: AdmissionProducer) => Promise<void>;
    };
    const order: string[] = [];
    const createProducer = (label: string, batches: number): AdmissionProducer => {
      let cursor = 0;
      return {
        generation: 0,
        active: 0,
        exhausted: false,
        resolve: () => undefined,
        peekUnit: () =>
          cursor >= batches
            ? null
            : {
                lane: 3,
                distanceToViewport: 0,
                priority: 1,
                documentOrder: label === 'A' ? cursor * 2 : 1,
              },
        nextBatch: () => {
          if (cursor >= batches) return null;
          order.push(`${label}${++cursor}`);
          return {
            targets: [],
            pageProfile: {},
            context: {},
            sourceTokens: 0,
            sourceBudget: 0,
            budget: {},
            reductions: [],
          };
        },
      };
    };
    await Promise.all([
      admission.enqueueAdmission(createProducer('A', 2)),
      admission.enqueueAdmission(createProducer('B', 1)),
    ]);
    expect(order).toEqual(['A1', 'B1', 'A2']);
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
      parallelism: {
        adaptive: true,
        sizeTier: 'small',
        dispatchConcurrency: expect.any(Number),
        batchSourceTokens: expect.any(Number),
        budgetTokens: expect.any(Number),
      },
      latencyMs: expect.any(Number),
      terminologyConflicts: 0,
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
    expect(log?.batches[0].latencyMs).toBeGreaterThanOrEqual(0);

    expect(log?.batches[1]).toMatchObject({
      latencyMs: 0,
      terminologyConflicts: 0,
      targets: [
        {
          sourceText: 'Save',
          translatedText: 'Speichern',
          status: 'translated',
          cacheHit: true,
        },
      ],
    });
    expect(log?.batches[1]).not.toHaveProperty('parallelism');

    expect(() => structuredClone(log)).not.toThrow();
    expect(() => JSON.parse(JSON.stringify(log))).not.toThrow();

    if (log !== null) log.batches[0].targets[0].sourceText = 'mutated export';
    expect(pipeline.getLog()?.batches[0].targets[0].sourceText).toBe('Save');
    pipeline.stop();
  });

  test('attributes terminology conflicts to the provider batch that accepts them', async () => {
    document.body.innerHTML = '<main><button>Save</button><p>Save</p></main>';
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      const target = request.group.kind === 'button' ? 'Speichern' : 'Sichern';
      if (request.group.kind !== 'button') {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return {
        translations: request.targets.map((item) => ({
          id: item.id,
          target,
          cacheKey: item.semanticKey,
          cacheHit: false,
          provenance: 'provider',
        })),
      };
    });
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, true);
    pipeline.start();

    await vi.waitFor(() => {
      expect(main.querySelector('button')?.textContent).toBe('Speichern');
      expect(main.querySelector('p')?.textContent).toBe('Sichern');
    });
    const batches = pipeline.getLog()?.batches ?? [];
    const buttonBatch = batches.find((batch) => batch.group.kind === 'button');
    const bodyBatch = batches.find((batch) => batch.group.kind === 'body');
    expect(buttonBatch?.terminologyConflicts).toBe(0);
    expect(bodyBatch?.terminologyConflicts).toBe(1);
    expect(pipeline.getMetrics().terminologyConflicts).toBe(1);
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
            provenance: 'provider',
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

  test('observes structured terminal rate limits before failing targets', async () => {
    const onBudgetSnapshot = vi.fn();
    vi.mocked(translatePageBatch).mockImplementationOnce(async () => ({
      translations: [],
      failure: { name: 'HttpError', message: 'Too many requests' },
      metrics: {
        retryCount: 1,
        validationFailures: 0,
        attempts: [
          {
            kind: 'transport-retry',
            stage: 'initial',
            profileId: modelProfile.id,
            targetIds: ['target'],
            httpStatus: 429,
            retryAfterMs: 2500,
            error: 'rate limit',
          },
        ],
      },
    }));
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, true, 0, modelProfile, onBudgetSnapshot);
    pipeline.start();

    await vi.waitFor(() =>
      expect(pipeline.getLog()?.batches[0].completedAt).toEqual(expect.any(Number)),
    );
    expect(onBudgetSnapshot).toHaveBeenCalled();
    expect(pipeline.getLog()?.batches[0]).toMatchObject({
      error: { name: 'HttpError', message: 'Too many requests' },
      targets: [{ status: 'failed' }],
    });
    pipeline.stop();
  });
  test('blocks Retry-After queued dispatch and drops it after a stale stop', async () => {
    vi.useFakeTimers();
    const observeSpy = vi.spyOn(TranslationBudgetController.prototype, 'observe');
    let delayCalls = 0;
    const delaySpy = vi
      .spyOn(TranslationBudgetController.prototype, 'getDispatchDelayMs')
      .mockImplementation(() => (delayCalls++ === 0 ? 0 : 1000));
    try {
      const profile = {
        ...modelProfile,
        batching: { ...modelProfile.batching, maxItems: 1, concurrency: 1 },
      };
      let requestCount = 0;
      vi.mocked(translatePageBatch).mockImplementation(async (request) => {
        requestCount++;
        const response = responseFor(request);
        return requestCount === 1
          ? {
              ...response,
              metrics: {
                retryCount: 1,
                validationFailures: 0,
                attempts: [
                  {
                    kind: 'transport-retry',
                    stage: 'initial',
                    profileId: profile.id,
                    targetIds: request.targets.map((target) => target.id),
                    httpStatus: 429,
                    retryAfterMs: 1000,
                    error: 'rate limit',
                  },
                ],
              },
            }
          : response;
      });
      const main = document.querySelector('main');
      if (main === null) throw new Error('fixture main missing');
      const pipeline = createPipeline(main, false, 0, profile);
      pipeline.start();
      for (let index = 0; index < 20; index++) await Promise.resolve();
      expect(translatePageBatch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(999);
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(translatePageBatch).toHaveBeenCalledTimes(1);

      pipeline.stop();
      vi.advanceTimersByTime(1000);
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(translatePageBatch).toHaveBeenCalledTimes(1);
      expect(observeSpy).toHaveBeenCalledTimes(1);
    } finally {
      delaySpy.mockRestore();
      observeSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  test('rebuilds later batches from the reduced current-page budget', async () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 3 },
      (_, index) => `<button>Save ${index}</button>`,
    ).join('')}</main>`;
    const profile = {
      ...modelProfile,
      batching: { ...modelProfile.batching, maxItems: 1, concurrency: 1 },
    };
    let responseCount = 0;
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      responseCount++;
      const response = responseFor(request);
      return responseCount === 1
        ? {
            ...response,
            metrics: {
              retryCount: 1,
              validationFailures: 0,
              attempts: [
                {
                  kind: 'transport-retry',
                  stage: 'initial',
                  profileId: profile.id,
                  targetIds: request.targets.map((target) => target.id),
                  httpStatus: 429,
                  retryAfterMs: 0,
                  error: 'rate limit',
                },
              ],
            },
          }
        : response;
    });
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, true, 0, profile);
    const getBatchSourceTokens = vi
      .spyOn(TranslationBudgetController.prototype, 'getBatchSourceTokens')
      .mockReturnValueOnce(600)
      .mockReturnValue(256);
    pipeline.start();

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(pipeline.getLog()?.batches).toHaveLength(3));
    const batches = pipeline.getLog()?.batches ?? [];
    expect(batches[1]?.sourceBudget).toBeLessThan(batches[0]?.sourceBudget ?? Infinity);
    expect(getBatchSourceTokens).toHaveBeenCalledTimes(3);
    pipeline.stop();
    getBatchSourceTokens.mockRestore();
  });
  test('plans only admitted batches after feedback updates the size', async () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 3 },
      (_, index) => `<button>Save ${index}</button>`,
    ).join('')}</main>`;
    const profile = {
      ...modelProfile,
      batching: { ...modelProfile.batching, maxItems: 1, concurrency: 2 },
    };
    const deferred = [
      Promise.withResolvers<PageTranslationBatchResponse>(),
      Promise.withResolvers<PageTranslationBatchResponse>(),
    ];
    const requests: PageTranslationBatchRequest[] = [];
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      requests.push(request);
      if (requests.length <= deferred.length) {
        return deferred[requests.length - 1]?.promise ?? responseFor(request);
      }
      return responseFor(request);
    });
    let sourceTokenCalls = 0;
    const getBatchSourceTokens = vi
      .spyOn(TranslationBudgetController.prototype, 'getBatchSourceTokens')
      .mockImplementation(() => (sourceTokenCalls++ < 2 ? 600 : 256));
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, false, 0, profile, undefined, 'small', 2);
    pipeline.start();

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(sourceTokenCalls).toBe(2);

    const firstRequest = requests[0];
    if (firstRequest === undefined) throw new Error('first request missing');
    const firstResponse = responseFor(firstRequest);
    deferred[0]?.resolve({
      ...firstResponse,
      metrics: {
        retryCount: 0,
        validationFailures: 1,
        attempts: [
          {
            kind: 'parse',
            stage: 'initial',
            profileId: profile.id,
            targetIds: firstRequest.targets.map((target) => target.id),
            issues: [{ id: firstRequest.targets[0]?.id, failure: 'empty-translation' }],
          },
        ],
      },
    });

    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(sourceTokenCalls).toBe(3);
    expect(pipeline.getMetrics().plannedBatches).toBe(3);

    const secondRequest = requests[1];
    if (secondRequest !== undefined) deferred[1]?.resolve(responseFor(secondRequest));
    pipeline.stop();
    getBatchSourceTokens.mockRestore();
  });
  test('does not observe or persist an all-cache provider response', async () => {
    const observeSpy = vi.spyOn(TranslationBudgetController.prototype, 'observe');
    const onBudgetSnapshot = vi.fn();
    vi.mocked(translatePageBatch).mockImplementationOnce(async (request) => ({
      translations: request.targets.map((target) => ({
        id: target.id,
        target: 'Speichern',
        cacheKey: target.semanticKey,
        cacheHit: true,
        provenance: 'cache',
      })),
      metrics: { retryCount: 0, validationFailures: 0 },
    }));
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, false, 0, modelProfile, onBudgetSnapshot);
    pipeline.start();
    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Speichern'),
    );
    expect(observeSpy).not.toHaveBeenCalled();
    pipeline.stop();
    expect(onBudgetSnapshot).not.toHaveBeenCalled();
    observeSpy.mockRestore();
  });
  test('does not observe or persist an invariant-only provider response', async () => {
    const observeSpy = vi.spyOn(TranslationBudgetController.prototype, 'observe');
    const onBudgetSnapshot = vi.fn();
    vi.mocked(translatePageBatch).mockImplementationOnce(async (request) => ({
      translations: request.targets.map((target) => ({
        id: target.id,
        target: target.sourceText,
        cacheKey: target.semanticKey,
        cacheHit: false,
        provenance: 'invariant',
      })),
      metrics: { retryCount: 0, validationFailures: 0 },
    }));
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main, false, 0, modelProfile, onBudgetSnapshot);
    pipeline.start();
    await vi.waitFor(() =>
      expect(main.querySelector('button')?.textContent).toBe('Save'),
    );
    expect(observeSpy).not.toHaveBeenCalled();
    pipeline.stop();
    expect(onBudgetSnapshot).not.toHaveBeenCalled();
    observeSpy.mockRestore();
  });

  test('observes only provider misses in a mixed invariant response', async () => {
    const observeSpy = vi.spyOn(TranslationBudgetController.prototype, 'observe');
    vi.mocked(translatePageBatch).mockImplementationOnce(async (request) => {
      const hit = request.targets[0];
      const miss = request.targets[1];
      if (hit === undefined || miss === undefined) throw new Error('targets missing');
      return {
        translations: request.targets.map((target) => ({
          id: target.id,
          target: target.sourceText === 'Save' ? 'Speichern' : 'Schließen',
          cacheKey: target.semanticKey,
          cacheHit: false,
          provenance: target.id === hit.id ? 'invariant' : 'provider',
        })),
        metrics: {
          retryCount: 0,
          validationFailures: 1,
          attempts: [
            {
              kind: 'parse',
              stage: 'initial',
              profileId: modelProfile.id,
              targetIds: [miss.id],
              issues: [{ id: miss.id, failure: 'empty-translation' }],
            },
          ],
        },
      };
    });
    document.body.innerHTML = '<main><button>Save</button><button>Close</button></main>';
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture main missing');
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() =>
      expect(
        Array.from(main.querySelectorAll('button'), (button) => button.textContent),
      ).toEqual(['Speichern', 'Schließen']),
    );
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(observeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetCount: 1,
        sourceTokens: conservativeTokenCounter.count('Close'),
        validationFailures: 1,
      }),
    );
    pipeline.stop();
    observeSpy.mockRestore();
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

    const batch = pipeline.getLog()?.batches[0];
    expect(batch).toMatchObject({
      parallelism: {
        adaptive: true,
        sizeTier: 'small',
      },
      latencyMs: expect.any(Number),
      terminologyConflicts: 0,
      error: {
        name: 'Error',
        message: 'provider unavailable',
      },
      targets: [{ status: 'failed' }],
    });
    expect(batch?.latencyMs).toBeGreaterThanOrEqual(0);
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

  test('discards an in-flight response when the source changes before commit', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');

    const firstRequest = Promise.withResolvers<PageTranslationBatchResponse>();
    let firstRequestData: PageTranslationBatchRequest | null = null;
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      if (firstRequestData === null) {
        firstRequestData = request;
        return firstRequest.promise;
      }
      return responseFor(request);
    });

    const pipeline = createPipeline(main);
    pipeline.start();

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));
    expect(firstRequestData).not.toBeNull();

    button.textContent = 'Close';

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(translatePageBatch).mock.calls[1]?.[0].targets[0]?.sourceText).toBe(
      'Close',
    );

    if (firstRequestData !== null) {
      firstRequest.resolve(responseFor(firstRequestData));
    }

    await vi.waitFor(() => {
      expect(button.textContent).toBe('Schließen');
      expect(pipeline.getMetrics().staleCancellations).toBeGreaterThan(0);
    });
    expect(button.textContent).toBe('Schließen');
    pipeline.stop();
  });

  test('reuses a stale response from cache when the source returns', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');

    const firstRequest = Promise.withResolvers<PageTranslationBatchResponse>();
    let firstRequestData: PageTranslationBatchRequest | null = null;
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      if (firstRequestData === null) {
        firstRequestData = request;
        return firstRequest.promise;
      }
      return responseFor(request);
    });

    const pipeline = createPipeline(main);
    pipeline.start();

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));
    button.textContent = 'Close';

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    if (firstRequestData !== null) {
      firstRequest.resolve(responseFor(firstRequestData));
    }

    await vi.waitFor(() => {
      expect(button.textContent).toBe('Schließen');
      expect(pipeline.getMetrics().staleCancellations).toBeGreaterThan(0);
    });
    button.textContent = 'Save';
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(2);

    pipeline.stop();
  });

  test('defers dynamic rescans behind the stabilization window', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');

    const pipeline = createPipeline(main, false, 150);
    pipeline.start();

    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    button.textContent = 'Close';

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(translatePageBatch).mock.calls[1]?.[0].targets[0]?.sourceText).toBe(
      'Close',
    );
    await vi.waitFor(() => expect(button.textContent).toBe('Schließen'));

    pipeline.stop();
  });

  test('resets the stabilization window on repeated mutations of the same boundary', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');

    const pipeline = createPipeline(main, false, 200);
    pipeline.start();

    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    button.textContent = 'A';
    await new Promise((resolve) => setTimeout(resolve, 120));
    button.textContent = 'B';
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(translatePageBatch).mock.calls[1]?.[0].targets[0]?.sourceText).toBe(
      'B',
    );

    pipeline.stop();
  });

  test('does not requeue unchanged content after a query-only route change', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const originalHref = location.href;
    location.href = 'https://page.test/components/Button';
    const pipeline = createPipeline(main);
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    // Tab UIs switch routes through the query string; the document is unchanged.
    // The test environment mocks location as a bare URL, so assign href directly.
    location.href = 'https://page.test/components/Button?tab=examples';
    main.append(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(translatePageBatch).toHaveBeenCalledTimes(1);
    location.href = originalHref;
    pipeline.stop();
  });

  test('completes navigation reset before awaiting the backend abort', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main, true);
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    // A second unit stays in flight across the navigation.
    const inFlight = Promise.withResolvers<PageTranslationBatchResponse>();
    vi.mocked(translatePageBatch).mockImplementation(async (request) => {
      if (request.targets.some((target) => target.sourceText === 'Close')) {
        return inFlight.promise;
      }
      return responseFor(request);
    });
    const second = document.createElement('button');
    second.textContent = 'Close';
    main.append(second);
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(2));

    const abortDeferred = Promise.withResolvers<undefined>();
    vi.mocked(abortTranslation).mockImplementation(() => abortDeferred.promise);
    const originalHref = location.href;
    location.href = 'https://page.test/other-page';
    main.append(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The pre-navigation response arrives while the backend abort is pending.
    const request = vi.mocked(translatePageBatch).mock.calls[1]?.[0];
    if (request === undefined) throw new Error('second request missing');
    inFlight.resolve(responseFor(request));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The reset must already be complete: no pre-navigation batch may linger
    // in the exportable log to be marked stale during the abort window.
    const batches = pipeline.getLog()?.batches ?? [];
    const staleTargets = batches.flatMap((batch) =>
      batch.targets.filter((target) => target.status === 'stale'),
    );
    expect(staleTargets).toEqual([]);

    abortDeferred.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    location.href = originalHref;
    pipeline.stop();
  });

  test('resets the session when the pathname changes', async () => {
    const main = document.querySelector('main');
    const button = document.querySelector('button');
    if (main === null || button === null) throw new Error('fixture missing');
    const pipeline = createPipeline(main);
    const initialSessionId = pipeline.getSessionId();
    pipeline.start();
    await vi.waitFor(() => expect(button.textContent).toBe('Speichern'));
    expect(translatePageBatch).toHaveBeenCalledTimes(1);

    const originalHref = location.href;
    location.href = 'https://page.test/other-page';
    main.append(document.createElement('span'));

    await vi.waitFor(() => {
      expect(translatePageBatch).toHaveBeenCalledTimes(2);
      expect(abortTranslation).toHaveBeenCalledWith({ context: initialSessionId });
      expect(button.textContent).toBe('Speichern');
    });

    location.href = originalHref;
    pipeline.stop();
  });
});
