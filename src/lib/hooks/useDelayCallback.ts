import { useCallback, useRef } from 'react';

import { useImmutableCallback } from './useImmutableCallback';

/**
 * Schedule a callback after a delay, replacing any callback that is still
 * pending.
 */
export const useDelayCallback = () => {
  const timerRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current === null) return;

    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const set = useImmutableCallback(
    (handler: () => void, time?: number) => {
      reset();
      timerRef.current = window.setTimeout(handler, time ?? 0);
    },
    [reset],
  );

  return [set, reset] as const;
};
