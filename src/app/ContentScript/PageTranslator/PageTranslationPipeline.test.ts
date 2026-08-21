import type {
  PageTranslationBatchRequest,
  PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';
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

const createPipeline = (root: Element) =>
  new PageTranslationPipeline({
    root,
    sourceLanguage: 'en',
    targetLanguage: 'de',
    identity: { provider: 'openai', model: 'small-model' },
    sessionId: crypto.randomUUID(),
    sessionSignature: crypto.randomUUID(),
    contextWindow: 4096,
    preferredInputTokens: 1200,
    concurrency: 1,
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
});
