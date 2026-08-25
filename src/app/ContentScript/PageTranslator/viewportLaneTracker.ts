import type { TextOccurrence, TranslationUnit } from './domPipeline';
import { TranslationPriorityLane } from './priorityLanes';

const VISIBLE_THRESHOLDS = [0, 0.01, 0.25, 0.5];
const DEFAULT_NEAR_ROOT_MARGIN = '100% 0px';

type LaneChangeCallback = (units: ReadonlySet<TranslationUnit>) => void;

type ScrollDirection = -1 | 0 | 1;

interface TrackedOccurrence {
  occurrence: TextOccurrence;
  unit: TranslationUnit;
  element: Element;
  urgent: boolean;
  visible: boolean;
  near: boolean;
  documentTop: number | null;
  documentBottom: number | null;
  rootTop: number;
  rootBottom: number;
}

export interface ViewportLaneTrackerOptions {
  nearRootMargin?: string;
}

const isHiddenAtRegistration = (element: Element): boolean => {
  if (element.closest('[aria-hidden="true"]') !== null) return true;

  for (
    let current: Element | null = element;
    current !== null;
    current = current.parentElement
  ) {
    try {
      if (getComputedStyle(current).display === 'none') return true;
    } catch {
      return false;
    }
  }
  return false;
};

const minimumOccurrenceLane = (unit: TranslationUnit): TranslationPriorityLane => {
  let lane = TranslationPriorityLane.Rest;
  for (const occurrence of unit.occurrences) {
    if (!occurrence.element.isConnected) continue;
    lane = Math.min(lane, occurrence.lane);
  }
  return lane;
};

const minimumLaneDistance = (
  unit: TranslationUnit,
  lane: TranslationPriorityLane,
): number => {
  let distance = Number.POSITIVE_INFINITY;
  for (const occurrence of unit.occurrences) {
    if (!occurrence.element.isConnected || occurrence.lane !== lane) continue;
    distance = Math.min(distance, occurrence.distanceToViewport);
  }
  return Number.isFinite(distance) ? distance : 0;
};

export class ViewportLaneTracker {
  private readonly nearRootMargin: string;
  private visibleObserver: IntersectionObserver | null = null;
  private nearObserver: IntersectionObserver | null = null;
  private readonly statesByOccurrence = new Map<TextOccurrence, TrackedOccurrence>();
  private readonly statesByElement = new Map<Element, Set<TrackedOccurrence>>();
  private readonly dirtyStates = new Set<TrackedOccurrence>();
  private callback: LaneChangeCallback = () => undefined;
  private flushTimer: number | null = null;
  private previousScrollY = 0;
  private scrollDirection: ScrollDirection = 0;
  private observerGeneration = 0;
  private listeningForScroll = false;

  public constructor(options: ViewportLaneTrackerOptions = {}) {
    this.nearRootMargin = options.nearRootMargin ?? DEFAULT_NEAR_ROOT_MARGIN;
  }

  public observe(units: readonly TranslationUnit[], callback: LaneChangeCallback): void {
    this.callback = callback;
    this.ensureStarted();

    const affectedUnits = new Set<TranslationUnit>();
    for (const unit of units) {
      affectedUnits.add(unit);
      for (const occurrence of unit.occurrences) {
        if (this.statesByOccurrence.has(occurrence)) continue;
        if (
          !occurrence.element.isConnected ||
          isHiddenAtRegistration(occurrence.element)
        ) {
          occurrence.lane = TranslationPriorityLane.Rest;
          continue;
        }

        const state: TrackedOccurrence = {
          occurrence,
          unit,
          element: occurrence.element,
          urgent: occurrence.lane === TranslationPriorityLane.Urgent,
          visible: occurrence.lane === TranslationPriorityLane.Visible,
          near:
            occurrence.lane === TranslationPriorityLane.Visible ||
            occurrence.lane === TranslationPriorityLane.Near,
          documentTop: null,
          documentBottom: null,
          rootTop: 0,
          rootBottom: window.innerHeight || document.documentElement.clientHeight,
        };
        this.statesByOccurrence.set(occurrence, state);
        let elementStates = this.statesByElement.get(state.element);
        if (elementStates === undefined) {
          elementStates = new Set();
          this.statesByElement.set(state.element, elementStates);
          this.visibleObserver?.observe(state.element);
          this.nearObserver?.observe(state.element);
        }
        elementStates.add(state);
      }
    }

    for (const unit of affectedUnits) this.updateUnitPriority(unit);
  }

  public unobserve(units: readonly TranslationUnit[]): void {
    for (const unit of units) {
      for (const occurrence of unit.occurrences) {
        const state = this.statesByOccurrence.get(occurrence);
        if (state !== undefined) this.removeState(state);
      }
    }
  }

  public stop(): void {
    this.observerGeneration++;
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.visibleObserver?.disconnect();
    this.nearObserver?.disconnect();
    this.visibleObserver = null;
    this.nearObserver = null;
    if (this.listeningForScroll) {
      window.removeEventListener('scroll', this.onScroll);
      this.listeningForScroll = false;
    }
    this.statesByOccurrence.clear();
    this.statesByElement.clear();
    this.dirtyStates.clear();
    this.callback = () => undefined;
    this.scrollDirection = 0;
  }

  private ensureStarted(): void {
    if (this.visibleObserver !== null || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const generation = ++this.observerGeneration;
    this.previousScrollY = window.scrollY;
    this.visibleObserver = new IntersectionObserver(
      (entries) => this.recordEntries(entries, true, generation),
      { threshold: VISIBLE_THRESHOLDS },
    );
    this.nearObserver = new IntersectionObserver(
      (entries) => this.recordEntries(entries, false, generation),
      { rootMargin: this.nearRootMargin, threshold: 0 },
    );
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.listeningForScroll = true;
  }

  private readonly onScroll = (): void => {
    const scrollY = window.scrollY;
    this.scrollDirection =
      scrollY > this.previousScrollY ? 1 : scrollY < this.previousScrollY ? -1 : 0;
    this.previousScrollY = scrollY;
    for (const state of this.statesByOccurrence.values()) this.dirtyStates.add(state);
    this.scheduleFlush();
  };

  private recordEntries(
    entries: readonly IntersectionObserverEntry[],
    visibleObserver: boolean,
    generation: number,
  ): void {
    if (generation !== this.observerGeneration) return;

    for (const entry of entries) {
      const states = this.statesByElement.get(entry.target);
      if (states === undefined) continue;
      for (const state of states) {
        if (visibleObserver) {
          state.visible = entry.isIntersecting;
          if (entry.rootBounds !== null) {
            state.rootTop = entry.rootBounds.top;
            state.rootBottom = entry.rootBounds.bottom;
          }
        } else {
          state.near = entry.isIntersecting;
        }
        state.documentTop = entry.boundingClientRect.top + window.scrollY;
        state.documentBottom = entry.boundingClientRect.bottom + window.scrollY;
        this.dirtyStates.add(state);
      }
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.dirtyStates.size === 0) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 0);
  }

  private flush(): void {
    const affectedUnits = new Set<TranslationUnit>();
    for (const state of this.dirtyStates) {
      affectedUnits.add(state.unit);
      if (!state.element.isConnected) {
        state.occurrence.lane = TranslationPriorityLane.Rest;
        state.occurrence.distanceToViewport = 0;
        this.removeState(state);
        continue;
      }

      state.occurrence.lane = state.urgent
        ? TranslationPriorityLane.Urgent
        : state.visible
          ? TranslationPriorityLane.Visible
          : state.near
            ? TranslationPriorityLane.Near
            : TranslationPriorityLane.Rest;
      state.occurrence.distanceToViewport = this.distanceToViewport(state);
    }
    this.dirtyStates.clear();

    const changedUnits = new Set<TranslationUnit>();
    for (const unit of affectedUnits) {
      const previousLane = unit.lane;
      const previousDistance = unit.distanceToViewport;
      this.updateUnitPriority(unit);
      if (unit.lane !== previousLane || unit.distanceToViewport !== previousDistance) {
        changedUnits.add(unit);
      }
    }
    if (changedUnits.size > 0) this.callback(changedUnits);
  }

  private distanceToViewport(state: TrackedOccurrence): number {
    if (state.documentTop === null || state.documentBottom === null) {
      return state.occurrence.distanceToViewport;
    }

    const top = state.documentTop - window.scrollY;
    const bottom = state.documentBottom - window.scrollY;
    const position: ScrollDirection =
      bottom < state.rootTop ? -1 : top > state.rootBottom ? 1 : 0;
    const gap =
      position < 0 ? state.rootTop - bottom : position > 0 ? top - state.rootBottom : 0;
    const directionPenalty =
      this.scrollDirection !== 0 && position !== 0 && position !== this.scrollDirection
        ? 1
        : 0;

    // Quantize to a thousandth of a CSS pixel, then reserve the low bit for
    // direction. Distance remains dominant; equal distances favor the scroll direction.
    return Math.round(gap * 1000) * 2 + directionPenalty;
  }

  private updateUnitPriority(unit: TranslationUnit): void {
    unit.lane = minimumOccurrenceLane(unit);
    unit.distanceToViewport = minimumLaneDistance(unit, unit.lane);
  }

  private removeState(state: TrackedOccurrence): void {
    this.statesByOccurrence.delete(state.occurrence);
    this.dirtyStates.delete(state);
    const elementStates = this.statesByElement.get(state.element);
    elementStates?.delete(state);
    if (elementStates === undefined || elementStates.size > 0) return;
    this.statesByElement.delete(state.element);
    this.visibleObserver?.unobserve(state.element);
    this.nearObserver?.unobserve(state.element);
  }
}
