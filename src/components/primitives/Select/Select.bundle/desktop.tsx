import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FC,
	type HTMLAttributes,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type Ref,
} from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@bem-react/classname';

import { ANCHORED_POPUP_LAYER } from '@/themes/layers';

import { Popup } from '../../Popup/Popup';

import { selectPopupDirections, selectPopupMiddleware } from '../Select.registry/desktop';

export type SelectOption = {
	id: string;
	disabled?: boolean;
	hidden?: boolean;
	raw?: boolean;
	addonProps?: HTMLAttributes<HTMLElement>;
} & (
	| {
			content: string;
	  }
	| {
			content: ReactNode;
			textContent: string;
	  }
);

export type SelectGroup = {
	title?: string;
	items: Option[];
	hidden?: boolean;
};

export type Option = SelectOption | SelectGroup;

export const cnSelect = cn('Select');

export function isGroup(option: Option): option is SelectGroup {
	return 'items' in option;
}

export function getTextOfOption(option: SelectOption): string {
	return 'textContent' in option ? option.textContent : option.content;
}

function flattenOptions(
	options: readonly Option[],
	isRemoveHiddenGroups = false,
): SelectOption[] {
	return options.flatMap((option) => {
		if (!isGroup(option)) return option;
		if (option.hidden && isRemoveHiddenGroups) return [];
		return flattenOptions(option.items, isRemoveHiddenGroups);
	});
}

export function getTextOfSelectedOptions(
	options: readonly Option[],
	value: string | readonly string[] | undefined,
	opts: {
		separator?: string;
		isRemoveHiddenItems?: boolean;
		isRemoveHiddenGroups?: boolean;
	} = {},
): string {
	const {
		separator = ', ',
		isRemoveHiddenItems = false,
		isRemoveHiddenGroups = false,
	} = opts;
	const values = Array.isArray(value) ? value : value === undefined ? [] : [value];

	if (values.length === 0) return '';

	const valueIndexes = new Map(values.map((id, index) => [id, index]));
	const texts: (string | undefined)[] = Array.from({ length: values.length });

	for (const option of flattenOptions(options, isRemoveHiddenGroups)) {
		if (isRemoveHiddenItems && option.hidden) continue;

		const valueIndex = valueIndexes.get(option.id);
		if (valueIndex === undefined) continue;

		const text = getTextOfOption(option);
		if (text.length > 0) texts[valueIndex] = text;
	}

	return texts.filter((text): text is string => text !== undefined).join(separator);
}

export const defaultProps = {
	placeholder: '—',
	value: '',
};

type SelectRootProps = Omit<
	HTMLAttributes<HTMLElement>,
	'children' | 'onClick' | 'onKeyDownCapture' | 'style'
>;

export type ISelectProps = SelectRootProps & {
	addonAfter?: ReactNode;
	addonAfterMenu?: ReactNode;
	addonBefore?: ReactNode;
	addonBeforeMenu?: ReactNode;
	children?: ReactNode;
	disabled?: boolean;
	innerRef?: Ref<HTMLElement>;
	listboxSize?: 'max';
	nocollapse?: boolean;
	onClick?: HTMLAttributes<HTMLElement>['onClick'];
	onKeyDownCapture?: HTMLAttributes<HTMLElement>['onKeyDownCapture'];
	onPress?: (event: SelectPressEvent) => void;
	onPressChange?: (isPressed: boolean) => void;
	onPressEnd?: (event: SelectPressEvent) => void;
	onPressStart?: (event: SelectPressEvent) => void;
	onPressUp?: (event: SelectPressEvent) => void;
	opened?: boolean;
	options: Option[];
	placeholder?: string;
	setOpened?: (newState: boolean) => void;
	setValue?: (value?: string | string[]) => void;
	style?: CSSProperties;
	triggerRef?: Ref<HTMLElement>;
	value?: string | string[];
	width?: 'max';
};

export type ISelectDesktopProps = ISelectProps;

export type SelectPressEvent = {
	type: 'pressstart' | 'pressend' | 'pressup' | 'press';
	pointerType: 'mouse' | 'pen' | 'touch' | 'keyboard' | 'virtual';
	target: Element;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	x: number;
	y: number;
	key?: string;
	continuePropagation: () => void;
};

const rootBaseStyle: CSSProperties = {
	display: 'inline-flex',
	minWidth: 0,
	position: 'relative',
};

const listboxBaseStyle: CSSProperties = {
	boxSizing: 'border-box',
	listStyle: 'none',
	margin: 0,
	maxHeight: 'inherit',
	minWidth: '100%',
	overflowY: 'auto',
	paddingBlock: 'var(--spacing-1)',
	paddingInline: 'var(--spacing-1)',
};

const groupBaseStyle: CSSProperties = {
	listStyle: 'none',
	margin: 0,
	padding: 0,
};

const groupTitleStyle: CSSProperties = {
	paddingBlock: 'var(--spacing-1)',
	paddingInline: 'var(--spacing-2)',
	userSelect: 'none',
};

const optionBaseStyle: CSSProperties = {
	boxSizing: 'border-box',
	minHeight: 'var(--spacing-10)',
	width: '100%',
};

function classNames(...classes: (string | false | undefined)[]): string {
	return classes
		.filter((className): className is string => Boolean(className))
		.join(' ');
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (typeof ref === 'function') {
		ref(value);
	} else if (ref !== null && ref !== undefined) {
		ref.current = value;
	}
}

function isAvailableOption(option: SelectOption | undefined): option is SelectOption {
	return option !== undefined && !option.disabled && !option.hidden;
}

function findAvailableOption(
	options: readonly SelectOption[],
	startIndex: number,
	direction: 1 | -1,
): number {
	if (options.length === 0) return -1;

	for (let offset = 0; offset < options.length; offset += 1) {
		const index = (startIndex + offset * direction + options.length) % options.length;
		if (isAvailableOption(options[index])) return index;
	}

	return -1;
}

function findNextAvailableOption(
	options: readonly SelectOption[],
	currentIndex: number,
	direction: 1 | -1,
): number {
	if (options.length === 0) return -1;
	return findAvailableOption(options, currentIndex + direction, direction);
}

function isPrintableKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
	return event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

export const Select: FC<ISelectProps> = ({
	addonAfter,
	addonAfterMenu,
	addonBefore,
	addonBeforeMenu,
	children: _children,
	className,
	disabled = false,
	innerRef,
	listboxSize = 'max',
	nocollapse = false,
	onClick,
	onKeyDownCapture,
	onPress: _onPress,
	onPressChange: _onPressChange,
	onPressEnd: _onPressEnd,
	onPressStart: _onPressStart,
	onPressUp: _onPressUp,
	opened,
	options,
	placeholder = defaultProps.placeholder,
	setOpened: _setOpened,
	setValue,
	style,
	triggerRef,
	value = defaultProps.value,
	width,
	...rootProps
}) => {
	const rootRef = useRef<HTMLElement | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const optionRefs = useRef(new Map<number, HTMLElement>());
	const typeaheadBufferRef = useRef('');
	const typeaheadTimeoutRef = useRef<number | undefined>(undefined);
	const [isOpened, setIsOpened] = useState(Boolean(opened));
	const [activeIndex, setActiveIndex] = useState(-1);
	const triggerId = useId();
	const listboxId = useId();
	const isMultiple = Array.isArray(value);
	const flatOptions = useMemo(() => flattenOptions(options, true), [options]);
	const flatOptionIds = useMemo(
		() =>
			flatOptions.map(
				(option, index) => option.addonProps?.id ?? `${listboxId}-${index}`,
			),
		[flatOptions, listboxId],
	);
	const selectedText = useMemo(
		() => getTextOfSelectedOptions(options, value),
		[options, value],
	);
	const selectText = selectedText.length > 0 ? selectedText : placeholder;
	const selectedValues = useMemo(
		() => new Set(Array.isArray(value) ? value : value.length > 0 ? [value] : []),
		[value],
	);

	const updateOpened = useCallback((nextOpened: boolean) => {
		setIsOpened(nextOpened);
	}, []);

	const clearTypeahead = useCallback(() => {
		if (typeaheadTimeoutRef.current !== undefined) {
			window.clearTimeout(typeaheadTimeoutRef.current);
		}
		typeaheadTimeoutRef.current = undefined;
		typeaheadBufferRef.current = '';
	}, []);

	const close = useCallback(
		(restoreFocus: boolean) => {
			clearTypeahead();
			updateOpened(false);
			if (restoreFocus) buttonRef.current?.focus();
		},
		[clearTypeahead, updateOpened],
	);

	const pickOption = useCallback(
		(option: SelectOption) => {
			if (!isAvailableOption(option)) return;

			if (isMultiple) {
				const nextValue = value.filter((id) => id !== option.id);
				setValue?.(
					nextValue.length === value.length
						? [...nextValue, option.id]
						: nextValue,
				);
				return;
			}
			setValue?.(option.id);
			if (!nocollapse) close(true);
		},
		[close, isMultiple, nocollapse, setValue, value],
	);

	useEffect(() => {
		if (!isOpened) {
			setActiveIndex(-1);
			clearTypeahead();
			return;
		}

		setActiveIndex((currentIndex) => {
			if (isAvailableOption(flatOptions[currentIndex])) return currentIndex;

			const selectedIndex = flatOptions.findIndex(
				(option) => isAvailableOption(option) && selectedValues.has(option.id),
			);
			return selectedIndex === -1
				? findAvailableOption(flatOptions, 0, 1)
				: selectedIndex;
		});
	}, [clearTypeahead, flatOptions, isOpened, selectedValues]);

	useEffect(() => {
		if (!isOpened || activeIndex < 0) return;
		optionRefs.current.get(activeIndex)?.scrollIntoView?.({ block: 'nearest' });
	}, [activeIndex, isOpened]);

	useEffect(() => {
		if (!isOpened) return;

		const root = rootRef.current;
		if (root === null) return;

		const rootNode = root.getRootNode();
		const shadowRoot =
			typeof ShadowRoot !== 'undefined' && rootNode instanceof ShadowRoot
				? rootNode
				: null;
		const onFocusOutside = (event: Event) => {
			if (!(event.target instanceof Node)) return;

			// A closed shadow root retargets the document-level event to its host.
			// Its own listener receives the real target and handles the close.
			if (shadowRoot !== null && event.target === shadowRoot.host) return;
			if (!root.contains(event.target)) close(false);
		};

		document.addEventListener('focusin', onFocusOutside);
		shadowRoot?.addEventListener('focusin', onFocusOutside);

		return () => {
			document.removeEventListener('focusin', onFocusOutside);
			shadowRoot?.removeEventListener('focusin', onFocusOutside);
		};
	}, [close, isOpened]);

	useEffect(() => clearTypeahead, [clearTypeahead]);

	const runTypeahead = useCallback(
		(input: string) => {
			const currentInput = `${typeaheadBufferRef.current}${input}`;
			const matches = (searchText: string, checkCurrent: boolean) => {
				if (flatOptions.length === 0) return -1;

				const normalizedSearchText = searchText.toLocaleLowerCase();
				const startIndex = checkCurrent
					? Math.max(activeIndex, 0)
					: activeIndex + 1;

				for (let offset = 0; offset < flatOptions.length; offset += 1) {
					const index =
						(startIndex + offset + flatOptions.length) % flatOptions.length;
					const option = flatOptions[index];
					if (
						isAvailableOption(option) &&
						getTextOfOption(option)
							.toLocaleLowerCase()
							.startsWith(normalizedSearchText)
					) {
						return index;
					}
				}

				return -1;
			};

			let nextIndex =
				currentInput.length > input.length ? matches(currentInput, true) : -1;
			if (nextIndex === -1) {
				typeaheadBufferRef.current = '';
				nextIndex = matches(input, false);
			}

			typeaheadBufferRef.current += input;
			if (typeaheadTimeoutRef.current !== undefined) {
				window.clearTimeout(typeaheadTimeoutRef.current);
			}
			typeaheadTimeoutRef.current = window.setTimeout(clearTypeahead, 500);

			if (nextIndex !== -1) setActiveIndex(nextIndex);
		},
		[activeIndex, clearTypeahead, flatOptions],
	);

	const handleKeyDownCapture = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			onKeyDownCapture?.(event);
			if (event.defaultPrevented || disabled) return;

			if (!isOpened) {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					updateOpened(true);
				}
				return;
			}

			if (event.key === 'Tab') {
				close(false);
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				close(true);
				return;
			}

			if (isEditableTarget(event.target)) return;

			switch (event.key) {
				case 'ArrowDown':
					event.preventDefault();
					setActiveIndex((index) =>
						findNextAvailableOption(flatOptions, index, 1),
					);
					return;
				case 'ArrowUp':
					event.preventDefault();
					setActiveIndex((index) =>
						findNextAvailableOption(flatOptions, index, -1),
					);
					return;
				case 'Home':
					event.preventDefault();
					setActiveIndex(findAvailableOption(flatOptions, 0, 1));
					return;
				case 'End':
					event.preventDefault();
					setActiveIndex(
						findAvailableOption(flatOptions, flatOptions.length - 1, -1),
					);
					return;
				case 'Enter':
				case ' ':
					event.preventDefault();
					pickOption(flatOptions[activeIndex]);
					return;
				default:
					if (isPrintableKey(event)) runTypeahead(event.key);
			}
		},
		[
			activeIndex,
			close,
			disabled,
			flatOptions,
			isOpened,
			onKeyDownCapture,
			pickOption,
			runTypeahead,
			updateOpened,
		],
	);

	const handleTriggerClick = useCallback(() => {
		if (!disabled) updateOpened(!isOpened);
	}, [disabled, isOpened, updateOpened]);

	const handlePopupClose = useCallback(
		(_event: KeyboardEvent | MouseEvent, source: 'click' | 'esc') => {
			close(source === 'esc');
		},
		[close],
	);

	let flatIndex = 0;
	const renderOptions = (
		items: readonly Option[],
		path: string,
		isParentHidden = false,
	): ReactNode =>
		items.map((option, localIndex) => {
			const optionPath = `${path}-${localIndex}`;

			if (isGroup(option)) {
				const isHidden = isParentHidden || Boolean(option.hidden);
				return (
					<Stack
						as="li"
						className={classNames(
							'Select-Group',
							isHidden && 'Select-Group_hidden',
						)}
						hidden={isHidden}
						key={optionPath}
						role="presentation"
						style={groupBaseStyle}
					>
						{option.title === undefined ? null : (
							<Text
								className="Select-GroupTitle"
								color="secondary"
								display="block"
								style={groupTitleStyle}
								type="supporting"
							>
								{option.title}
							</Text>
						)}
						<Stack
							aria-label={option.title}
							as="ul"
							className="Select-GroupItems"
							role="group"
							style={groupBaseStyle}
						>
							{renderOptions(option.items, optionPath, isHidden)}
						</Stack>
					</Stack>
				);
			}

			const optionIndex = isParentHidden ? -1 : flatIndex++;
			const isSelected = selectedValues.has(option.id);
			const isDisabled = disabled || Boolean(option.disabled);
			const isHidden = isParentHidden || Boolean(option.hidden);
			const addonProps = option.addonProps ?? {};
			const optionId =
				addonProps.id ??
				(optionIndex < 0
					? `${listboxId}-hidden-${optionPath}`
					: flatOptionIds[optionIndex]);
			const handleOptionMouseEnter = (event: ReactMouseEvent) => {
				if (
					!event.defaultPrevented &&
					!isDisabled &&
					!isHidden &&
					optionIndex >= 0
				) {
					setActiveIndex(optionIndex);
				}
			};
			const handleOptionClick = (event: ReactMouseEvent) => {
				if (!event.defaultPrevented) pickOption(option);
			};
			const setOptionRef = (element: HTMLElement | null) => {
				if (optionIndex < 0) return;
				if (element === null) optionRefs.current.delete(optionIndex);
				else optionRefs.current.set(optionIndex, element);
			};
			const optionClassName = classNames(
				'Select-Option',
				option.raw && 'Select-Option_raw',
				isDisabled && 'Select-Option_disabled',
				isHidden && 'Select-Option_hidden',
				addonProps.className,
			);
			const optionStyle: CSSProperties = {
				...optionBaseStyle,
				...addonProps.style,
				...(isDisabled
					? {
							color: 'var(--color-text-disabled)',
							cursor: 'not-allowed',
						}
					: {}),
			};
			const selectionIndicator = (
				<Icon
					color={isDisabled ? 'disabled' : 'primary'}
					icon="check"
					size="sm"
					style={{ visibility: isSelected ? 'visible' : 'hidden' }}
				/>
			);

			if (option.raw) {
				return (
					<Stack
						{...addonProps}
						aria-disabled={isDisabled || undefined}
						aria-selected={isSelected}
						as="li"
						className={optionClassName}
						direction="horizontal"
						gap={2}
						hidden={isHidden}
						id={optionId}
						key={optionPath}
						onClick={isDisabled || isHidden ? undefined : handleOptionClick}
						onMouseEnter={handleOptionMouseEnter}
						ref={setOptionRef}
						role="option"
						style={{
							...optionStyle,
							padding: 'var(--spacing-0)',
							...(isSelected || (isOpened && optionIndex === activeIndex)
								? { backgroundColor: 'var(--color-overlay-hover)' }
								: {}),
							...(isSelected
								? { fontWeight: 'var(--font-weight-medium)' }
								: {}),
						}}
						vAlign="center"
					>
						{selectionIndicator}
						{option.content}
					</Stack>
				);
			}

			return (
				<Item
					{...addonProps}
					aria-disabled={isDisabled || undefined}
					as="li"
					className={optionClassName}
					density="balanced"
					hidden={isHidden}
					id={optionId}
					isDisabled={isDisabled}
					isHighlighted={isOpened && optionIndex === activeIndex}
					isSelected={isSelected}
					key={optionPath}
					label={option.content}
					onClick={isDisabled || isHidden ? undefined : handleOptionClick}
					onMouseEnter={handleOptionMouseEnter}
					ref={setOptionRef}
					role="option"
					startContent={selectionIndicator}
					style={optionStyle}
				/>
			);
		});

	const rootClassName = classNames(
		'Select',
		disabled && 'Select_disabled',
		isOpened && 'Select_opened',
		width === 'max' && 'Select_width_max',
		listboxSize === 'max' && 'Select_listboxSize_max',
		className,
	);
	const activeDescendant =
		isOpened && activeIndex >= 0 ? flatOptionIds[activeIndex] : undefined;

	return (
		<Stack
			{...rootProps}
			as="span"
			className={rootClassName}
			direction="horizontal"
			onClick={onClick}
			onKeyDownCapture={handleKeyDownCapture}
			ref={(element) => {
				rootRef.current = element;
				assignRef(innerRef, element);
			}}
			style={{
				...rootBaseStyle,
				...(width === 'max' ? { width: '100%' } : {}),
				...style,
			}}
		>
			{addonBefore}
			<Button
				aria-activedescendant={activeDescendant}
				aria-controls={listboxId}
				aria-expanded={isOpened}
				aria-haspopup="listbox"
				className="Select-Trigger"
				endContent={<Icon icon="arrowsUpDown" size="sm" />}
				id={triggerId}
				isDisabled={disabled}
				label={selectText}
				onClick={handleTriggerClick}
				ref={(element) => {
					buttonRef.current = element;
					assignRef(triggerRef, element);
				}}
				role="combobox"
				size="md"
				variant="secondary"
				width="100%"
			/>
			<Popup
				anchor={rootRef}
				className="Select-Popup"
				direction={selectPopupDirections}
				middleware={selectPopupMiddleware}
				onClose={handlePopupClose}
				tabIndex={-1}
				target="anchor"
				view="default"
				visible={isOpened}
				zIndex={ANCHORED_POPUP_LAYER}
			>
				{addonBeforeMenu}
				<Stack
					aria-labelledby={triggerId}
					aria-multiselectable={isMultiple || undefined}
					as="ul"
					className={classNames(
						'Select-List',
						isOpened && 'Select-List_visible',
					)}
					id={listboxId}
					role="listbox"
					style={{
						...listboxBaseStyle,
						...(listboxSize === 'max' ? { minWidth: 'max-content' } : {}),
					}}
				>
					{renderOptions(options, 'option')}
				</Stack>
				{addonAfterMenu}
			</Popup>
			{addonAfter}
		</Stack>
	);
};

Select.displayName = 'Select';
