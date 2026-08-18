import { Ref, useEffect, useRef } from 'react';

const setRefValue = <T>(ref: Ref<T>, value: T | null) => {
  if (ref === null) return;

  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  ref.current = value;
};

/**
 * Host an imperative value in an external ref and clear the currently hosted
 * ref when the component unmounts.
 */
export const useRefHost = <T>(ref: Ref<T> | undefined, value: T) => {
  const localRef = useRef<Ref<T> | undefined>(undefined);
  const localValue = useRef<T | undefined>(undefined);

  if (localRef.current !== ref || localValue.current !== value) {
    localRef.current = ref;
    localValue.current = value;

    if (ref !== undefined) {
      setRefValue(ref, value);
    }
  }

  useEffect(
    () => () => {
      if (localRef.current !== undefined) {
        setRefValue(localRef.current, null);
      }
    },
    [],
  );
};
