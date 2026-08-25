import type {
  PageTranslationBatchRequest,
  PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';
import { createConservativeTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';
import { translatePageBatch } from '@/requests/backend/translatePageBatch';

import { collectPageOccurrences, deduplicateOccurrences } from './domPipeline';
import { PageTranslationPipeline } from './PageTranslationPipeline';
import { compareUnitPriority, TranslationPriorityLane } from './priorityLanes';

vi.mock('@/requests/backend/translatePageBatch', () => ({
  translatePageBatch: vi.fn(),
}));
vi.mock('@/requests/backend/abortTranslation', () => ({
  abortTranslation: vi.fn(async () => {}),
}));

interface ComparableTestUnit {
  name: string;
  lane: TranslationPriorityLane;
  distanceToViewport: number;
  priority: number;
  documentOrder: number;
}

const collectionOptions = {
  sourceLanguage: 'en',
  targetLanguage: 'de',
  identity: { provider: 'openai', model: 'small-model' },
};

const modelProfile = createConservativeTranslationModelProfile('small-model');

const responseFor = (
  request: PageTranslationBatchRequest,
): PageTranslationBatchResponse => ({
  translations: request.targets.map((target) => ({
    id: target.id,
    target: 'Translated message',
    cacheKey: target.semanticKey,
    cacheHit: false,
    provenance: 'provider',
  })),
});

const mockRect = (element: Element, top: number, bottom: number): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => undefined,
  });
};

const collectUnits = (root: Element) =>
  deduplicateOccurrences(collectPageOccurrences(root, collectionOptions).occurrences);

describe('translation priority lanes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(translatePageBatch).mockImplementation(async (request) =>
      responseFor(request),
    );
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('collects open dialog, alert, and assertive live-region content as Urgent', () => {
    document.body.innerHTML = `
      <dialog open><p>Dialog message</p></dialog>
      <div role="alert"><p>Alert message</p></div>
      <div aria-live="assertive"><p>Live message</p></div>`;

    const occurrences = collectPageOccurrences(
      document.body,
      collectionOptions,
    ).occurrences;

    expect(
      occurrences.map(({ normalizedText, lane }) => ({ normalizedText, lane })),
    ).toEqual([
      { normalizedText: 'Dialog message', lane: TranslationPriorityLane.Urgent },
      { normalizedText: 'Alert message', lane: TranslationPriorityLane.Urgent },
      { normalizedText: 'Live message', lane: TranslationPriorityLane.Urgent },
    ]);
  });

  test('orders a Visible unit ahead of a Rest unit inside main content', () => {
    document.body.innerHTML = `
      <main>
        <p id="rest">Background content</p>
        <p id="visible">Visible content</p>
      </main>`;
    const main = document.querySelector('main');
    const rest = document.querySelector('#rest');
    const visible = document.querySelector('#visible');
    if (main === null || rest === null || visible === null) {
      throw new Error('fixture missing');
    }
    mockRect(rest, 10_000, 10_020);
    mockRect(visible, 10, 30);

    const units = collectUnits(main).sort(compareUnitPriority);

    expect(units.map(({ normalizedText, lane }) => ({ normalizedText, lane }))).toEqual([
      { normalizedText: 'Visible content', lane: TranslationPriorityLane.Visible },
      { normalizedText: 'Background content', lane: TranslationPriorityLane.Rest },
    ]);
  });

  test('deduplicates Urgent and Rest occurrences into one Urgent unit translated once', async () => {
    document.body.innerHTML = `
      <main>
        <div aria-live="assertive"><p>Repeated message</p></div>
        <p id="rest">Repeated message</p>
      </main>`;
    const main = document.querySelector('main');
    const rest = document.querySelector('#rest');
    if (main === null || rest === null) throw new Error('fixture missing');
    mockRect(rest, 10_000, 10_020);

    const units = collectUnits(main);

    expect(units).toHaveLength(1);
    expect(units[0].lane).toBe(TranslationPriorityLane.Urgent);
    expect(units[0].occurrences).toHaveLength(2);

    const pipeline = new PageTranslationPipeline({
      ...collectionOptions,
      root: main,
      sessionId: crypto.randomUUID(),
      sessionSignature: crypto.randomUUID(),
      modelProfile,
      tokenCounter: conservativeTokenCounter,
      stabilizationMs: 0,
    });
    pipeline.start();
    await vi.waitFor(() => expect(translatePageBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(translatePageBatch).mock.calls[0]?.[0].targets).toHaveLength(1);
    await vi.waitFor(() =>
      expect(
        Array.from(main.querySelectorAll('p'), (element) => element.textContent),
      ).toEqual(['Translated message', 'Translated message']),
    );
    pipeline.stop();
  });

  test('keeps many repeated Rest occurrences behind one Visible unit', () => {
    document.body.innerHTML = `
      <main>
        ${Array.from(
          { length: 20 },
          (_, index) => `<p class="rest" data-index="${index}">Repeated background</p>`,
        ).join('')}
        <p id="visible">Visible once</p>
      </main>`;
    const main = document.querySelector('main');
    const visible = document.querySelector('#visible');
    if (main === null || visible === null) throw new Error('fixture missing');
    for (const rest of document.querySelectorAll('.rest')) {
      mockRect(rest, 10_000, 10_020);
    }
    mockRect(visible, 10, 30);

    const units = collectUnits(main).sort(compareUnitPriority);

    expect(units).toHaveLength(2);
    expect(units[0].normalizedText).toBe('Visible once');
    expect(units[1].occurrences).toHaveLength(20);
    expect(units[1].lane).toBe(TranslationPriorityLane.Rest);
  });

  test('compares lane, distance, numeric priority, and document order lexicographically with stable ties', () => {
    const makeUnit = (
      name: string,
      overrides: Partial<Omit<ComparableTestUnit, 'name'>> = {},
    ): ComparableTestUnit => ({
      name,
      lane: TranslationPriorityLane.Rest,
      distanceToViewport: 100,
      priority: 1,
      documentOrder: 10,
      ...overrides,
    });
    const namesInPriorityOrder = (units: ComparableTestUnit[]): string[] =>
      units.sort(compareUnitPriority).map(({ name }) => name);

    expect(
      namesInPriorityOrder([
        makeUnit('visible', {
          lane: TranslationPriorityLane.Visible,
          distanceToViewport: 0,
          priority: 100,
          documentOrder: 0,
        }),
        makeUnit('urgent', {
          lane: TranslationPriorityLane.Urgent,
          distanceToViewport: 10_000,
          priority: 0,
          documentOrder: 100,
        }),
      ]),
    ).toEqual(['urgent', 'visible']);
    expect(
      namesInPriorityOrder([
        makeUnit('far', { distanceToViewport: 200, priority: 100, documentOrder: 0 }),
        makeUnit('near', { distanceToViewport: 10, priority: 0, documentOrder: 100 }),
      ]),
    ).toEqual(['near', 'far']);
    expect(
      namesInPriorityOrder([
        makeUnit('low', { priority: 1, documentOrder: 0 }),
        makeUnit('high', { priority: 4, documentOrder: 100 }),
      ]),
    ).toEqual(['high', 'low']);
    expect(
      namesInPriorityOrder([
        makeUnit('later', { documentOrder: 20 }),
        makeUnit('earlier', { documentOrder: 5 }),
      ]),
    ).toEqual(['earlier', 'later']);

    const firstTie = makeUnit('first tie');
    const secondTie = makeUnit('second tie');
    expect(compareUnitPriority(firstTie, secondTie)).toBe(0);
    expect(namesInPriorityOrder([firstTie, secondTie])).toEqual([
      'first tie',
      'second tie',
    ]);
  });
});
