import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from '@astryxdesign/core/Text';

import { AstryxProvider } from '@/components/providers/AstryxProvider';

import { Textarea } from './Textarea.bundle/desktop';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

describe('Textarea compatibility adapter', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	async function render(children: ReactNode) {
		await act(async () => {
			root.render(<AstryxProvider>{children}</AstryxProvider>);
		});
	}

	it('keeps the clear action interactive inside the shared control plane', async () => {
		const controlRef = createRef<HTMLTextAreaElement>();
		const onClearClick = vi.fn();

		await render(
			<Textarea
				addonAfterControl={<Text>Text actions</Text>}
				controlProps={{ innerRef: controlRef }}
				hasClear
				label="Translate text"
				onClearClick={onClearClick}
				value="Hello"
			/>,
		);

		const controlPlane = container.querySelector<HTMLElement>(
			'.TextareaAdapter-ControlPlane',
		);
		if (controlPlane === null) throw new Error('Expected a textarea control plane');

		const textarea = controlPlane.querySelector('textarea');
		if (textarea === null) throw new Error('Expected the Astryx textarea');

		const clearButton = controlPlane.querySelector<HTMLButtonElement>(
			'button[aria-label="Clear Translate text"]',
		);
		if (clearButton === null) throw new Error('Expected an interactive clear button');

		expect(controlRef.current).toBe(textarea);
		expect(clearButton.closest('.TextareaAdapter-Clear')).not.toBeNull();
		expect(clearButton.closest('.TextareaAdapter-Field')).toBeNull();
		expect(controlPlane.textContent).toContain('Text actions');

		textarea.focus();
		const mouseDown = new MouseEvent('mousedown', {
			bubbles: true,
			cancelable: true,
		});
		clearButton.dispatchEvent(mouseDown);
		expect(mouseDown.defaultPrevented).toBe(true);

		await act(async () => clearButton.click());
		expect(onClearClick).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(textarea);
	});
});
