import {
	ChangeEvent,
	ChangeEventHandler,
	createElement,
	MouseEvent,
	ReactNode,
	Ref,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
} from 'react';
import { InputClearButton } from '@astryxdesign/core/Field';
import { Stack } from '@astryxdesign/core/Stack';
import { TextArea, TextAreaProps } from '@astryxdesign/core/TextArea';

import { INPUT_CONTROL_LAYER } from '@/themes/layers';

type LegacyTextAreaSize = 's' | 'm' | TextAreaProps['size'];

export interface TextareaControlProps {
	innerRef?: Ref<HTMLTextAreaElement>;
}

export interface TextareaProps extends Omit<
	TextAreaProps,
	| 'hasAutoFocus'
	| 'hasSpellCheck'
	| 'isDisabled'
	| 'label'
	| 'onChange'
	| 'ref'
	| 'size'
	| 'value'
> {
	label?: string;
	hint?: string;
	value?: string | number | readonly string[];
	disabled?: boolean;
	spellCheck?: boolean | 'true' | 'false';
	autoFocus?: boolean;
	size?: LegacyTextAreaSize;
	state?: 'error';
	onInputText?: (text: string) => void;
	onChange?: ChangeEventHandler<HTMLTextAreaElement>;
	hasClear?: boolean;
	onClearClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	autoResize?: boolean;
	addonBeforeControl?: ReactNode;
	addonAfterControl?: ReactNode;
	controlProps?: TextareaControlProps;
	ref?: Ref<HTMLTextAreaElement>;
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

const normalizeSize = (size: LegacyTextAreaSize | undefined): TextAreaProps['size'] => {
	if (size === 's') return 'sm';
	if (size === 'm') return 'md';
	return size;
};

export const Textarea = ({
	label,
	hint,
	isLabelHidden,
	value,
	disabled,
	spellCheck,
	autoFocus,
	size,
	state,
	status,
	onInputText,
	onChange,
	hasClear,
	onClearClick,
	autoResize,
	addonBeforeControl,
	addonAfterControl,
	controlProps,
	ref,
	placeholder,
	className,
	style,
	width,
	...props
}: TextareaProps) => {
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
	const controlRef = controlProps?.innerRef;
	const mergedRef = useMemo(
		() => (node: HTMLTextAreaElement | null) => {
			textAreaRef.current = node;
			setRef(ref, node);
			setRef(controlRef, node);
		},
		[controlRef, ref],
	);

	const updateHeight = useCallback(() => {
		const control = textAreaRef.current;
		if (control === null) return;

		if (!autoResize) {
			control.style.height = '';
			return;
		}

		control.style.height = 'auto';
		control.style.height = `${control.scrollHeight}px`;
	}, [autoResize]);

	useLayoutEffect(updateHeight, [updateHeight, value]);

	const handleChange = (text: string, event: ChangeEvent<HTMLTextAreaElement>) => {
		onChange?.(event);
		onInputText?.(text);
		if (autoResize) {
			requestAnimationFrame(updateHeight);
		}
	};

	const stringValue = value === undefined ? '' : String(value);
	const accessibleLabel = label ?? hint ?? placeholder ?? 'Text area';
	const resolvedStatus = status ?? (state === 'error' ? { type: 'error' } : undefined);
	const rootClassName = [
		'TextareaAdapter',
		hasClear ? 'TextareaAdapter_hasClear' : undefined,
		className,
	]
		.filter((value): value is string => value !== undefined)
		.join(' ');
	const clearControl =
		hasClear && stringValue !== '' && !disabled
			? createElement(InputClearButton, {
					label: `Clear ${accessibleLabel}`,
					onClick: (event) => {
						onClearClick?.(event);
						if (onClearClick === undefined) {
							onInputText?.('');
						}
						textAreaRef.current?.focus();
					},
				})
			: undefined;

	return createElement(
		Stack,
		{
			className: rootClassName,
			gap: 0,
			style,
			width,
		},
		createElement(
			Stack,
			{
				className: 'TextareaAdapter-ControlPlane',
				gap: 0,
			},
			addonBeforeControl,
			createElement(
				Stack,
				{
					className: 'TextareaAdapter-Input',
					gap: 0,
					width: '100%',
				},
				createElement(TextArea, {
					...props,
					className: 'TextareaAdapter-Field',
					label: accessibleLabel,
					isLabelHidden: isLabelHidden ?? label === undefined,
					value: stringValue,
					isDisabled: disabled,
					hasSpellCheck: normalizeSpellCheck(spellCheck),
					hasAutoFocus: autoFocus,
					size: normalizeSize(size),
					status: resolvedStatus,
					placeholder,
					width: '100%',
					onChange: handleChange,
					ref: mergedRef,
				}),
			),
			clearControl === undefined
				? undefined
				: createElement(
						Stack,
						{
							className: 'TextareaAdapter-Clear',
							direction: 'horizontal',
							style: { zIndex: INPUT_CONTROL_LAYER },
							onMouseDown: (event) => {
								event.preventDefault();
							},
						},
						clearControl,
					),
			addonAfterControl,
		),
	);
};

export type ITextareaProps = TextareaProps;

import '../Textarea.css';
