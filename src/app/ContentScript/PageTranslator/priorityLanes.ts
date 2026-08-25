import type { TranslationUnit } from './domPipeline';

export enum TranslationPriorityLane {
  Urgent = 0,
  Visible = 1,
  Near = 2,
  Rest = 3,
}

export const URGENT_SURFACE_SELECTOR =
  'dialog[open],[role="dialog"][aria-modal="true"],[role="alertdialog"],[role="alert"],[aria-live="assertive"]';

export const initialLaneForElement = (
  element: Element,
  numericPriority: number,
): TranslationPriorityLane => {
  if (element.closest(URGENT_SURFACE_SELECTOR) !== null) {
    return TranslationPriorityLane.Urgent;
  }
  if (numericPriority === 4) return TranslationPriorityLane.Visible;
  if (numericPriority === 3) return TranslationPriorityLane.Near;
  return TranslationPriorityLane.Rest;
};

type ComparableUnitPriority = Pick<
  TranslationUnit,
  'lane' | 'distanceToViewport' | 'priority' | 'documentOrder'
>;

export const compareUnitPriority = (
  left: ComparableUnitPriority,
  right: ComparableUnitPriority,
): number =>
  left.lane - right.lane ||
  left.distanceToViewport - right.distanceToViewport ||
  right.priority - left.priority ||
  left.documentOrder - right.documentOrder;
