import type { TextOccurrence, TranslationUnit } from './domPipeline';
import { compareUnitPriority, TranslationPriorityLane } from './priorityLanes';
import { ViewportLaneTracker } from './viewportLaneTracker';

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

let unitSerial = 0;

const makeUnit = (
  elements: Element[],
  lane: TranslationPriorityLane = TranslationPriorityLane.Rest,
): TranslationUnit => {
  const unitId = `unit-${++unitSerial}`;
  const section = { sectionId: 'section:main', headingPath: [] };
  const occurrences: TextOccurrence[] = elements.map((element, index) => ({
    id: `${unitId}-occurrence-${index}`,
    occurrenceId: `${unitId}-occurrence-${index}`,
    sourceText: unitId,
    normalizedText: unitId,
    kind: 'body',
    slot: 'title',
    contextClass: 'main:body',
    sectionId: section.sectionId,
    semanticKey: `pdk:${unitId}`,
    priority: 1,
    lane,
    distanceToViewport: 0,
    documentOrder: index,
    binding: {
      type: 'attribute',
      element,
      attribute: 'title',
      originalValue: unitId,
    },
    element,
    section,
  }));

  return {
    id: unitId,
    sourceText: unitId,
    normalizedText: unitId,
    kind: 'body',
    slot: 'title',
    contextClass: 'main:body',
    sectionId: section.sectionId,
    semanticKey: `pdk:${unitId}`,
    priority: 1,
    lane,
    distanceToViewport: 0,
    documentOrder: unitSerial,
    occurrences,
    section,
  };
};

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
  const rootBounds = DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 100 });
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

const flushLaneUpdates = async (): Promise<void> => {
  await vi.runOnlyPendingTimersAsync();
};

describe('ViewportLaneTracker', () => {
  let scrollY = 0;
  let tracker: ViewportLaneTracker | null = null;

  beforeEach(() => {
    tracker = null;
    vi.useFakeTimers();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    scrollY = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    document.body.replaceChildren();
  });

  afterEach(() => {
    tracker?.stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  test('promotes a visible occurrence and demotes it after leaving the observed regions', async () => {
    const element = document.createElement('p');
    document.body.append(element);
    const unit = makeUnit([element]);
    const onChanged = vi.fn();
    tracker = new ViewportLaneTracker();
    tracker.observe([unit], onChanged);
    const [visible, near] = MockIntersectionObserver.instances;

    visible.trigger(observerEntry(element, true, 10, 30));
    near.trigger(observerEntry(element, true, 10, 30));
    await flushLaneUpdates();
    expect(unit.occurrences[0].lane).toBe(TranslationPriorityLane.Visible);
    expect(unit.lane).toBe(TranslationPriorityLane.Visible);

    visible.trigger(observerEntry(element, false, 150, 170));
    near.trigger(observerEntry(element, false, 150, 170));
    await flushLaneUpdates();
    expect(unit.occurrences[0].lane).toBe(TranslationPriorityLane.Rest);
    expect(unit.lane).toBe(TranslationPriorityLane.Rest);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
  test('keeps an observed Urgent occurrence sticky across observer exits', async () => {
    const element = document.createElement('p');
    document.body.append(element);
    const unit = makeUnit([element], TranslationPriorityLane.Urgent);
    tracker = new ViewportLaneTracker();
    tracker.observe([unit], vi.fn());
    const [visible, near] = MockIntersectionObserver.instances;

    visible.trigger(observerEntry(element, false, 250, 270));
    near.trigger(observerEntry(element, false, 250, 270));
    await flushLaneUpdates();

    expect(unit.occurrences[0].lane).toBe(TranslationPriorityLane.Urgent);
    expect(unit.lane).toBe(TranslationPriorityLane.Urgent);
  });

  test('assigns Near when only the root-margin observer intersects', async () => {
    const element = document.createElement('p');
    document.body.append(element);
    const unit = makeUnit([element]);
    tracker = new ViewportLaneTracker({ nearRootMargin: '150% 0px' });
    tracker.observe([unit], vi.fn());
    const [visible, near] = MockIntersectionObserver.instances;

    visible.trigger(observerEntry(element, false, 150, 170));
    near.trigger(observerEntry(element, true, 150, 170));
    await flushLaneUpdates();

    expect(near.rootMargin).toBe('150% 0px');
    expect(unit.occurrences[0].lane).toBe(TranslationPriorityLane.Near);
    expect(unit.lane).toBe(TranslationPriorityLane.Near);
  });

  test('derives a deduplicated unit lane from its visible and hidden occurrences', async () => {
    const visibleElement = document.createElement('p');
    const hiddenElement = document.createElement('p');
    hiddenElement.style.display = 'none';
    document.body.append(visibleElement, hiddenElement);
    const unit = makeUnit([visibleElement, hiddenElement]);
    tracker = new ViewportLaneTracker();
    tracker.observe([unit], vi.fn());
    const [visible, near] = MockIntersectionObserver.instances;

    expect(visible.observed).toEqual(new Set([visibleElement]));
    visible.trigger(observerEntry(visibleElement, true, 10, 30));
    near.trigger(observerEntry(visibleElement, true, 10, 30));
    await flushLaneUpdates();
    expect(unit.lane).toBe(TranslationPriorityLane.Visible);

    visible.trigger(observerEntry(visibleElement, false, 250, 270));
    near.trigger(observerEntry(visibleElement, false, 250, 270));
    await flushLaneUpdates();
    expect(unit.lane).toBe(TranslationPriorityLane.Rest);
    expect(unit.occurrences[1].lane).toBe(TranslationPriorityLane.Rest);
  });

  test('biases equal Near distances toward the current scroll direction', async () => {
    const aboveElement = document.createElement('p');
    const belowElement = document.createElement('p');
    document.body.append(aboveElement, belowElement);
    const aboveUnit = makeUnit([aboveElement]);
    const belowUnit = makeUnit([belowElement]);
    tracker = new ViewportLaneTracker();
    tracker.observe([aboveUnit, belowUnit], vi.fn());
    const [visible, near] = MockIntersectionObserver.instances;

    visible.trigger(
      observerEntry(aboveElement, false, -60, -50),
      observerEntry(belowElement, false, 150, 160),
    );
    near.trigger(
      observerEntry(aboveElement, true, -60, -50),
      observerEntry(belowElement, true, 150, 160),
    );
    await flushLaneUpdates();

    scrollY = 1;
    window.dispatchEvent(new Event('scroll'));
    await flushLaneUpdates();
    expect(compareUnitPriority(belowUnit, aboveUnit)).toBeLessThan(0);

    scrollY = 0;
    window.dispatchEvent(new Event('scroll'));
    await flushLaneUpdates();
    expect(compareUnitPriority(aboveUnit, belowUnit)).toBeLessThan(0);
  });

  test('does not observe display-none or aria-hidden occurrences', () => {
    const displayNone = document.createElement('p');
    displayNone.style.display = 'none';
    const ariaHidden = document.createElement('section');
    ariaHidden.setAttribute('aria-hidden', 'true');
    const ariaHiddenChild = document.createElement('p');
    ariaHidden.append(ariaHiddenChild);
    document.body.append(displayNone, ariaHidden);
    const units = [makeUnit([displayNone]), makeUnit([ariaHiddenChild])];
    tracker = new ViewportLaneTracker();

    tracker.observe(units, vi.fn());
    const [visible, near] = MockIntersectionObserver.instances;
    expect(visible.observed.size).toBe(0);
    expect(near.observed.size).toBe(0);
    expect(units.map((unit) => unit.lane)).toEqual([
      TranslationPriorityLane.Rest,
      TranslationPriorityLane.Rest,
    ]);
  });

  test('disconnects both observers and ignores queued entries after stop', async () => {
    const element = document.createElement('p');
    document.body.append(element);
    const unit = makeUnit([element]);
    const onChanged = vi.fn();
    tracker = new ViewportLaneTracker();
    tracker.observe([unit], onChanged);
    const [visible, near] = MockIntersectionObserver.instances;

    visible.trigger(observerEntry(element, true, 10, 30));
    tracker.stop();
    await flushLaneUpdates();
    visible.trigger(observerEntry(element, false, 150, 170));
    near.trigger(observerEntry(element, false, 150, 170));
    await flushLaneUpdates();

    expect(visible.disconnect).toHaveBeenCalledTimes(1);
    expect(near.disconnect).toHaveBeenCalledTimes(1);
    expect(visible.observed.size).toBe(0);
    expect(near.observed.size).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
