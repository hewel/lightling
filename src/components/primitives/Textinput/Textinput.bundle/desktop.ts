import {
  ChangeEvent,
  ChangeEventHandler,
  createElement,
  KeyboardEventHandler,
  Ref,
  useMemo,
} from 'react';
import { TextInput, TextInputProps } from '@astryxdesign/core/TextInput';

type LegacyTextValue = string | number | readonly string[];
type LegacyTextInputSize = 's' | 'm' | TextInputProps['size'];
type TextInputChangeEvent = ChangeEvent<HTMLInputElement> | null;

interface NativeTextInputProps extends TextInputProps {
  spellCheck?: boolean;
}

const NativeTextInput = (props: NativeTextInputProps) => createElement(TextInput, props);

export interface TextinputControlProps {
  innerRef?: Ref<HTMLInputElement>;
}

export interface TextinputProps extends Omit<
  TextInputProps,
  | 'hasAutoFocus'
  | 'isDisabled'
  | 'label'
  | 'onChange'
  | 'onKeyDown'
  | 'ref'
  | 'size'
  | 'type'
  | 'value'
> {
  label?: string;
  hint?: string;
  value?: LegacyTextValue;
  disabled?: boolean;
  spellCheck?: boolean | 'true' | 'false';
  autoFocus?: boolean;
  type?: TextInputProps['type'];
  size?: LegacyTextInputSize;
  state?: 'error';
  setValue?: (value: string) => void;
  onInputText?: (text: string) => void;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onClearClick?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  controlProps?: TextinputControlProps;
  ref?: Ref<HTMLInputElement>;
}

const setRef = <T>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref !== null && ref !== undefined) {
    ref.current = value;
  }
};

const normalizeSpellCheck = (spellCheck: boolean | 'true' | 'false' | undefined) =>
  spellCheck === undefined ? undefined : spellCheck !== false && spellCheck !== 'false';

const normalizeSize = (size: LegacyTextInputSize | undefined): TextInputProps['size'] => {
  if (size === 's') return 'sm';
  if (size === 'm') return 'md';
  return size;
};

export const Textinput = ({
  label,
  hint,
  isLabelHidden,
  value,
  disabled,
  spellCheck,
  autoFocus,
  type,
  size,
  state,
  status,
  setValue,
  onInputText,
  onChange,
  onClearClick,
  onKeyDown,
  controlProps,
  ref,
  placeholder,
  ...props
}: TextinputProps) => {
  const controlRef = controlProps?.innerRef;
  const mergedRef = useMemo(
    () => (node: HTMLInputElement | null) => {
      setRef(ref, node);
      setRef(controlRef, node);
    },
    [controlRef, ref],
  );

  const handleChange = (text: string, event: TextInputChangeEvent) => {
    // Astryx signals its clear button with a null event. Keep the legacy
    // callback separate because some consumers reset related state there.
    if (event === null) {
      if (onClearClick !== undefined) {
        onClearClick();
      } else {
        onInputText?.('');
        setValue?.('');
      }
      return;
    }

    onChange?.(event);
    onInputText?.(text);
    setValue?.(text);
  };

  const accessibleLabel = label ?? hint ?? placeholder ?? 'Text input';
  const resolvedStatus = status ?? (state === 'error' ? { type: 'error' } : undefined);

  return createElement(NativeTextInput, {
    ...props,
    label: accessibleLabel,
    isLabelHidden: isLabelHidden ?? label === undefined,
    value: value === undefined ? '' : String(value),
    isDisabled: disabled,
    spellCheck: normalizeSpellCheck(spellCheck),
    hasAutoFocus: autoFocus,
    type,
    size: normalizeSize(size),
    status: resolvedStatus,
    placeholder,
    onChange: handleChange,
    onKeyDown,
    ref: mergedRef,
  });
};

export type ITextinputProps = TextinputProps;
