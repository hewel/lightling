import { act, createRef, FC } from 'react';
import { createRoot, Root } from 'react-dom/client';

import { useDelayCallback } from './useDelayCallback';
import { useImmutableCallback } from './useImmutableCallback';
import { useRefHost } from './useRefHost';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('utility hooks', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container.remove();
    vi.useRealTimers();
  });

  it('keeps callback identity stable while invoking the latest callback', async () => {
    let exposedCallback: (() => string) | undefined;
    const CallbackHarness: FC<{ value: string }> = ({ value }) => {
      exposedCallback = useImmutableCallback(() => value, [value]);
      return null;
    };

    await act(async () => root?.render(<CallbackHarness value="first" />));
    const initialCallback = exposedCallback;
    expect(initialCallback?.()).toBe('first');

    await act(async () => root?.render(<CallbackHarness value="second" />));
    expect(exposedCallback).toBe(initialCallback);
    expect(exposedCallback?.()).toBe('second');
  });

  it('replaces a pending delayed callback and supports cancellation', async () => {
    vi.useFakeTimers();

    let schedule: ((handler: () => void, time?: number) => void) | undefined;
    let cancel: (() => void) | undefined;
    const DelayHarness = () => {
      [schedule, cancel] = useDelayCallback();
      return null;
    };

    await act(async () => root?.render(<DelayHarness />));
    const first = vi.fn();
    const second = vi.fn();

    schedule?.(first, 100);
    schedule?.(second, 100);
    vi.advanceTimersByTime(100);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    schedule?.(second, 100);
    cancel?.();
    vi.advanceTimersByTime(100);
    expect(second).toHaveBeenCalledOnce();
  });

  it('hosts an imperative value and clears it on unmount', async () => {
    const hostedRef = createRef<{ version: number }>();
    const RefHarness: FC<{ value: { version: number } }> = ({ value }) => {
      useRefHost(hostedRef, value);
      return null;
    };
    const firstValue = { version: 1 };
    const secondValue = { version: 2 };

    await act(async () => root?.render(<RefHarness value={firstValue} />));
    expect(hostedRef.current).toBe(firstValue);

    await act(async () => root?.render(<RefHarness value={secondValue} />));
    expect(hostedRef.current).toBe(secondValue);

    await act(async () => root?.unmount());
    root = null;
    expect(hostedRef.current).toBeNull();
  });
});
