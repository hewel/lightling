import { cloneElement, type FC, type MouseEvent, type ReactElement, useRef } from 'react';
import type { ButtonProps } from '@astryxdesign/core/Button';
import { InputGroup } from '@astryxdesign/core/InputGroup';
import type { SelectorProps } from '@astryxdesign/core/Selector';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  group: {
    overflow: 'hidden',
    borderWidth: 'var(--border-width)',
    borderStyle: 'solid',
    borderColor: {
      default: 'var(--color-border-emphasized)',
      ':has(:focus-visible)': 'var(--color-accent)',
    },
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-surface)',
    boxShadow: {
      default: 'none',
      ':has(:focus-visible)': 'inset 0 0 0 var(--border-width) var(--color-accent-muted)',
    },
  },
  control: {
    zIndex: 0,
    borderWidth: 0,
    borderStartEndRadius: 0,
    borderEndEndRadius: 0,
    borderColor: {
      default: 'transparent',
      ':focus-within': 'transparent',
    },
    backgroundColor: 'transparent',
    boxShadow: {
      default: 'none',
      ':hover:not(:focus-within)': 'none',
      ':focus-within': 'none',
    },
  },
  action: {
    height: '100%',
    borderStartStartRadius: 0,
    borderEndStartRadius: 0,
    borderInlineStartWidth: 'var(--border-width)',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'var(--color-border)',
    backgroundColor: {
      default: 'var(--color-neutral)',
      ':hover': 'var(--color-background-surface)',
    },
  },
  warning: {
    borderColor: 'var(--color-warning)',
  },
  error: {
    borderColor: 'var(--color-error)',
  },
  success: {
    borderColor: 'var(--color-success)',
  },
});

type GroupSize = 's' | 'm' | 'sm' | 'md' | 'lg';
type GroupControlProps = {
  label?: string;
  isLabelHidden?: boolean;
  size?: GroupSize;
  xstyle?: SelectorProps['xstyle'];
  status?: SelectorProps['status'];
};
type ActionProps = Pick<ButtonProps, 'variant' | 'xstyle' | 'className'>;

interface InputGroupActionProps {
  label: string;
  isLabelHidden?: boolean;
  control: ReactElement<GroupControlProps>;
  action: ReactElement<ActionProps>;
}

const normalizeSize = (size: GroupSize | undefined): 'sm' | 'md' | 'lg' | undefined => {
  if (size === 's') return 'sm';
  if (size === 'm') return 'md';
  return size;
};

/**
 * Joins one Astryx-compatible field and one trailing button into a connected
 * control. InputGroup owns the label and field semantics; the adapter provides
 * the shared surface because Astryx Button does not consume InputGroupContext.
 */
export const InputGroupAction: FC<InputGroupActionProps> = ({
  label,
  isLabelHidden = false,
  control,
  action,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  const focusControl = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Keep interactive members responsible for their own clicks.
    if (target.closest('button, input, a, select, textarea') !== null) return;

    rootRef.current?.querySelector<HTMLElement>('input, [role="combobox"]')?.focus();
  };

  return (
    <div ref={rootRef} onClick={focusControl}>
      <InputGroup
        label={label}
        isLabelHidden={isLabelHidden}
        size={normalizeSize(control.props.size)}
        status={control.props.status}
        xstyle={[
          styles.group,
          control.props.status?.type === 'warning' && styles.warning,
          control.props.status?.type === 'error' && styles.error,
          control.props.status?.type === 'success' && styles.success,
        ]}
      >
        {cloneElement(control, {
          label,
          isLabelHidden: true,
          xstyle: [control.props.xstyle, styles.control],
        })}
        {cloneElement(action, {
          variant: 'ghost',
          className: 'astryx-input-group-action',
          xstyle: [action.props.xstyle, styles.action],
        })}
      </InputGroup>
    </div>
  );
};
