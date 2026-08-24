'use client';

import { useCallback, useEffect, useState, type Ref } from 'react';
import type { BaseProps } from '@astryxdesign/core/BaseProps';
import { InputClearButton } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import {
  colorVars,
  durationVars,
  easeVars,
  radiusVars,
  spacingVars,
  typeScaleVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import { mergeProps } from '@astryxdesign/core/utils';
import * as stylex from '@stylexjs/stylex';

export type InteractionModality = 'keyboard' | 'pointer';

let modality: InteractionModality = 'keyboard';
let isListening = false;

function onPointerDown(): void {
  modality = 'pointer';
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.metaKey || event.altKey || event.ctrlKey) {
    return;
  }
  modality = 'keyboard';
}

export function trackInteractionModality(): void {
  if (isListening || typeof document === 'undefined') {
    return;
  }
  isListening = true;
  document.addEventListener('pointerdown', onPointerDown, {
    capture: true,
    passive: true,
  });
  document.addEventListener('keydown', onKeyDown, {
    capture: true,
    passive: true,
  });
}

export function getInteractionModality(): InteractionModality {
  return modality;
}

const styles = stylex.create({
  wrapper: {
    paddingBlock: spacingVars['--spacing-1'],
    paddingInline: spacingVars['--spacing-1'],
  },
  field: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    paddingBlock: spacingVars['--spacing-1-5'],
    paddingInline: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    transitionProperty: 'box-shadow',
    transitionDuration: {
      default: durationVars['--duration-fast'],
      '@media (prefers-reduced-motion: reduce)': '0s',
    },
    transitionTimingFunction: easeVars['--ease-standard'],
  },
  fieldKeyboardFocus: {
    boxShadow: {
      default: 'none',
      ':has(input:focus-visible)': `inset 0 0 0 2px ${colorVars['--color-accent']}`,
    },
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    padding: 0,
    margin: 0,
    borderWidth: 0,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    color: colorVars['--color-text-primary'],
    fontFamily: typographyVars['--font-family-body'],
    fontSize: {
      default: typeScaleVars['--text-label-size'],
      '@media (pointer: coarse)': `max(1rem, ${typeScaleVars['--text-label-size']})`,
    },
    lineHeight: typeScaleVars['--text-label-leading'],
    outline: 'none',
    '::placeholder': {
      color: colorVars['--color-text-secondary'],
    },
  },
});

export interface PanelSearchInputProps extends Omit<
  BaseProps<HTMLInputElement>,
  'onChange'
> {
  ref?: Ref<HTMLInputElement>;
  label: string;
  clearLabel: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onContainerKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

export function PanelSearchInput({
  ref,
  label,
  clearLabel,
  placeholder,
  value,
  onValueChange,
  onKeyDown,
  onFocus,
  onBlur,
  onContainerKeyDown,
  xstyle,
  className,
  style,
  ...props
}: PanelSearchInputProps) {
  const [isKeyboardFocus, setIsKeyboardFocus] = useState(false);

  useEffect(() => {
    trackInteractionModality();
  }, []);

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      setIsKeyboardFocus(getInteractionModality() === 'keyboard');
      onFocus?.(e);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      setIsKeyboardFocus(false);
      onBlur?.(e);
    },
    [onBlur],
  );

  const handleClear = useCallback(() => {
    onValueChange('');
    if (typeof ref === 'object' && ref?.current) {
      ref.current.focus();
    }
  }, [onValueChange, ref]);

  return (
    <div
      onKeyDown={onContainerKeyDown}
      {...mergeProps(stylex.props(styles.wrapper, xstyle), className, style)}
    >
      <div
        data-keyboard-focus={isKeyboardFocus ? 'true' : undefined}
        {...stylex.props(styles.field, isKeyboardFocus && styles.fieldKeyboardFocus)}
      >
        <Icon icon="search" size="sm" color="secondary" xstyle={styles.icon} />
        <input
          ref={ref}
          type="text"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...stylex.props(styles.input)}
          {...props}
        />
        {value !== '' && <InputClearButton label={clearLabel} onClick={handleClear} />}
      </div>
    </div>
  );
}

PanelSearchInput.displayName = 'PanelSearchInput';
