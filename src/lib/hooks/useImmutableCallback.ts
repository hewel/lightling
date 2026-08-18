import { DependencyList, useCallback, useRef } from 'react';

/**
 * Return a callback with a stable identity that invokes the latest callback
 * selected by the provided dependencies.
 */
export const useImmutableCallback = <Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
	deps: DependencyList,
): ((...args: Args) => Result) => {
	// oxlint-disable-next-line react/exhaustive-deps
	const actualCallback = useCallback(callback, deps);
	const callbackRef = useRef(actualCallback);
	callbackRef.current = actualCallback;

	return useCallback((...args: Args) => callbackRef.current(...args), []);
};
