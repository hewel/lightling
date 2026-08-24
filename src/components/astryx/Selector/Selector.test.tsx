import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Selector } from './Selector';
import type { SelectorOptionType } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('Selector virtualization', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return {
          width: 200,
          height: 300,
          top: 0,
          left: 0,
          bottom: 300,
          right: 200,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      },
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 300,
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const options = Array.from({ length: 200 }, (_, i) => ({
    value: `opt-${i}`,
    label: `Option ${i}`,
  }));

  it('renders all 200 option nodes when virtualize is false', async () => {
    await act(async () => {
      root.render(
        <Selector
          label="Test non-virtualized"
          options={options}
          value="opt-0"
          isDefaultOpen
          virtualize={false}
        />,
      );
    });

    const optionElements = document.querySelectorAll('[role="option"]');
    expect(optionElements.length).toBe(200);
  });

  it('renders significantly fewer than 200 option nodes when virtualize is true', async () => {
    await act(async () => {
      root.render(
        <Selector
          label="Test virtualized"
          options={options}
          value="opt-0"
          isDefaultOpen
          virtualize
        />,
      );
    });

    const optionElements = document.querySelectorAll('[role="option"]');
    expect(optionElements.length).toBeLessThan(50);
    expect(optionElements.length).toBeGreaterThan(0);
  });

  it('sets aria-setsize and aria-posinset on virtualized option nodes', async () => {
    await act(async () => {
      root.render(
        <Selector
          label="Test a11y"
          options={options}
          value="opt-0"
          isDefaultOpen
          virtualize
        />,
      );
    });

    const firstOption = document.querySelector('[role="option"]');
    expect(firstOption).not.toBeNull();
    expect(firstOption?.getAttribute('aria-setsize')).toBe('200');
    expect(firstOption?.getAttribute('aria-posinset')).toBe('1');
  });

  it('supports sections and dividers in virtualized mode', async () => {
    const complexOptions: SelectorOptionType[] = [
      {
        type: 'section',
        title: 'Group A',
        options: [
          { value: 'a1', label: 'Item A1' },
          { value: 'a2', label: 'Item A2' },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        title: 'Group B',
        options: [
          { value: 'b1', label: 'Item B1' },
          { value: 'b2', label: 'Item B2' },
        ],
      },
    ];

    await act(async () => {
      root.render(
        <Selector
          label="Test sections"
          options={complexOptions}
          value="a1"
          isDefaultOpen
          virtualize
        />,
      );
    });

    const optionElements = document.querySelectorAll('[role="option"]');
    expect(optionElements.length).toBeGreaterThanOrEqual(3);
    expect(document.body.textContent).toContain('Group A');
    expect(document.body.textContent).toContain('Group B');
  });

  it('handles item selection via click in virtualized mode', async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <Selector
          label="Test selection"
          options={options}
          value="opt-0"
          onChange={onChange}
          isDefaultOpen
          virtualize
        />,
      );
    });

    const optionElements = document.querySelectorAll<HTMLElement>('[role="option"]');
    expect(optionElements.length).toBeGreaterThan(1);

    await act(async () => {
      optionElements[1]?.click();
    });

    expect(onChange).toHaveBeenCalledWith('opt-1');
  });
});
