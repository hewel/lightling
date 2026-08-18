import assert from 'node:assert/strict';

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
	getTextOfOption,
	getTextOfSelectedOptions,
	isGroup,
	Select,
	type Option,
} from './desktop';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

const options: Option[] = [
	{ id: 'alpha', content: 'Alpha', disabled: true },
	{ id: 'hidden', content: 'Hidden', hidden: true },
	{
		title: 'Available',
		items: [
			{ id: 'beta', content: 'Beta', addonProps: { id: 'custom-beta-id' } },
			{ id: 'charlie', content: 'Charlie' },
			{ id: 'delta', content: 'Delta' },
			{
				id: 'raw',
				content: <strong data-raw-content="true">Raw custom</strong>,
				textContent: 'Raw custom',
				raw: true,
			},
		],
	},
];

describe('Select', () => {
	let container: HTMLDivElement;
	let host: HTMLDivElement;
	let root: Root;
	let shadowRoot: ShadowRoot;

	beforeEach(() => {
		host = document.createElement('div');
		document.body.append(host);
		shadowRoot = host.attachShadow({ mode: 'closed' });
		container = document.createElement('div');
		shadowRoot.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		host.remove();
	});

	async function renderSelect(element: ReactNode): Promise<void> {
		await act(async () => {
			root.render(element);
			await Promise.resolve();
		});
		await act(async () => Promise.resolve());
	}

	async function click(element: Element): Promise<void> {
		await act(async () => {
			element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			await Promise.resolve();
		});
		await act(async () => Promise.resolve());
	}

	async function keyDown(element: Element, key: string): Promise<void> {
		await act(async () => {
			element.dispatchEvent(
				new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }),
			);
			await Promise.resolve();
		});
		await act(async () => Promise.resolve());
	}

	function getTrigger(): HTMLButtonElement {
		const trigger = container.querySelector('.Select-Trigger');
		assert(trigger instanceof HTMLButtonElement);
		return trigger;
	}

	function getOption(label: string): HTMLElement {
		const option = [
			...container.querySelectorAll<HTMLElement>('[role="option"]'),
		].find((element) => element.textContent?.includes(label));
		assert(option !== undefined);
		return option;
	}

	it('preserves the recursive option helpers and selected-value order', () => {
		const group = options[2];
		assert(group !== undefined);
		expect(isGroup(group)).toBe(true);

		const option = options[0];
		assert(option !== undefined && !isGroup(option));
		expect(getTextOfOption(option)).toBe('Alpha');
		expect(getTextOfSelectedOptions(options, ['delta', 'beta'])).toBe('Delta, Beta');
		expect(
			getTextOfSelectedOptions(options, ['hidden', 'beta'], {
				isRemoveHiddenItems: true,
			}),
		).toBe('Beta');
	});

	it('uses Astryx controls while keeping value changes controlled', async () => {
		const setValue = vi.fn();

		await renderSelect(
			<Select
				className="consumer-select"
				options={options}
				setValue={setValue}
				value="beta"
			/>,
		);

		let trigger = getTrigger();
		expect(trigger.classList.contains('astryx-button')).toBe(true);
		expect(trigger.getAttribute('role')).toBe('combobox');
		expect(trigger.textContent).toContain('Beta');
		expect(
			container.querySelector('.Select')?.classList.contains('consumer-select'),
		).toBe(true);

		await click(trigger);

		const popup = container.querySelector<HTMLElement>('.Select-Popup');
		assert(popup !== null);
		expect(popup.classList.contains('astryx-card')).toBe(true);
		expect(popup.classList.contains('Popup_visible')).toBe(true);
		expect(popup.style.position).toBe('absolute');
		expect(getOption('Beta').classList.contains('astryx-item')).toBe(true);
		expect(getOption('Beta').getAttribute('aria-selected')).toBe('true');
		expect(getOption('Alpha').getAttribute('aria-disabled')).toBe('true');
		expect(getOption('Hidden').hidden).toBe(true);
		const rawContent = getOption('Raw custom').querySelector('[data-raw-content]');
		expect(rawContent?.parentElement).toBe(getOption('Raw custom'));

		await click(getOption('Charlie'));

		expect(setValue).toHaveBeenCalledWith('charlie');
		trigger = getTrigger();
		expect(trigger.textContent).toContain('Beta');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(shadowRoot.activeElement).toBe(trigger);

		await renderSelect(
			<Select
				className="consumer-select"
				options={options}
				setValue={setValue}
				value="charlie"
			/>,
		);
		expect(getTrigger().textContent).toContain('Charlie');
	});

	it('supports arrow, jump, typeahead, and commit keyboard behavior', async () => {
		const ControlledSelect = () => {
			const [value, setValue] = useState('beta');
			return (
				<Select
					options={options}
					setValue={(nextValue) => {
						if (typeof nextValue === 'string') setValue(nextValue);
					}}
					value={value}
				/>
			);
		};

		await renderSelect(<ControlledSelect />);
		const trigger = getTrigger();
		await act(async () => trigger.focus());

		await keyDown(trigger, 'ArrowDown');
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(getOption('Beta').id);

		await keyDown(trigger, 'ArrowDown');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(
			getOption('Charlie').id,
		);

		await keyDown(trigger, 'Home');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(getOption('Beta').id);

		await keyDown(trigger, 'd');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(getOption('Delta').id);

		await keyDown(trigger, 'Enter');
		expect(trigger.textContent).toContain('Delta');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(shadowRoot.activeElement).toBe(trigger);
	});

	it('keeps a multiselect open while toggling its controlled array', async () => {
		const ControlledMultiSelect = () => {
			const [value, setValue] = useState<string[]>(['beta']);
			return (
				<Select
					options={options}
					setValue={(nextValue) => {
						if (Array.isArray(nextValue)) setValue(nextValue);
					}}
					value={value}
				/>
			);
		};

		await renderSelect(<ControlledMultiSelect />);
		const trigger = getTrigger();
		await click(trigger);
		await click(getOption('Charlie'));

		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(trigger.textContent).toContain('Beta, Charlie');
		expect(
			container
				.querySelector('[role="listbox"]')
				?.getAttribute('aria-multiselectable'),
		).toBe('true');
		expect(getOption('Beta').getAttribute('aria-selected')).toBe('true');
		expect(getOption('Charlie').getAttribute('aria-selected')).toBe('true');
	});

	it('uses opened as an initial value and retains internal open ownership', async () => {
		const setOpened = vi.fn();

		await renderSelect(
			<Select opened options={options} setOpened={setOpened} value="beta" />,
		);
		let trigger = getTrigger();
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		await click(trigger);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(setOpened).not.toHaveBeenCalled();

		await renderSelect(
			<Select opened options={options} setOpened={setOpened} value="beta" />,
		);
		trigger = getTrigger();
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
	});

	it('closes on focus leaving a closed shadow root and restores focus on Escape', async () => {
		await renderSelect(<Select options={options} value="beta" />);
		const trigger = getTrigger();
		const outsideButton = document.createElement('button');
		shadowRoot.append(outsideButton);

		await click(trigger);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');

		await act(async () => outsideButton.focus());
		expect(trigger.getAttribute('aria-expanded')).toBe('false');

		await click(trigger);
		await keyDown(trigger, 'Escape');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(shadowRoot.activeElement).toBe(trigger);
	});
});
