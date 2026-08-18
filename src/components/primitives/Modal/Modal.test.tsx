import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Modal, type IModalProps } from './Modal.bundle/desktop';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});
Object.defineProperty(globalThis, 'CSS', {
	configurable: true,
	value: {
		escape: (value: string) => value.replaceAll(':', '\\:'),
	},
});

function click(target: EventTarget, mouseDownTarget: EventTarget = target) {
	mouseDownTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
	target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function getDialog(container: HTMLElement) {
	const dialog = container.querySelector<HTMLDialogElement>('dialog');
	if (dialog === null) throw new Error('Expected the modal dialog to render');

	return dialog;
}

function getModalContent(dialog: HTMLDialogElement) {
	const content = dialog.querySelector<HTMLElement>('[data-autofocus]');
	if (content === null) throw new Error('Expected modal content to render');

	return content;
}

describe('Modal', () => {
	let container: HTMLDivElement;
	let host: HTMLDivElement;
	let root: Root;
	let shadowRoot: ShadowRoot;

	beforeEach(() => {
		Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
			configurable: true,
			value: vi.fn(function (this: HTMLDialogElement) {
				this.setAttribute('open', '');
			}),
		});
		Object.defineProperty(HTMLDialogElement.prototype, 'close', {
			configurable: true,
			value: vi.fn(function (this: HTMLDialogElement) {
				this.removeAttribute('open');
			}),
		});
		vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

		host = document.createElement('div');
		document.body.append(host);
		shadowRoot = host.attachShadow({ mode: 'closed' });
		container = document.createElement('div');
		shadowRoot.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		vi.restoreAllMocks();
		container.remove();
		host.remove();
	});

	async function renderModal(props: IModalProps) {
		await act(async () => {
			root.render(
				<Modal {...props}>
					<button data-autofocus type="button">
						Modal action
					</button>
				</Modal>,
			);
			await Promise.resolve();
		});
	}

	it('renders the Astryx dialog with content and a fallback name', async () => {
		const innerRef = createRef<HTMLDialogElement>();

		await renderModal({
			className: 'custom-modal',
			innerRef,
			style: { maxWidth: 'var(--spacing-12)' },
			visible: true,
			zIndex: 73,
		});

		const dialog = container.querySelector<HTMLDialogElement>('dialog');
		expect(dialog).not.toBeNull();
		expect(dialog).toBe(innerRef.current);
		expect(dialog?.open).toBe(true);
		expect(dialog?.classList.contains('astryx-dialog')).toBe(true);
		expect(dialog?.classList.contains('custom-modal')).toBe(true);
		expect(dialog?.getAttribute('aria-label')).toBe('Dialog');
		expect(dialog?.textContent).toContain('Modal action');
		expect(dialog?.style.maxWidth).toBe('var(--spacing-12)');
		expect(dialog?.style.zIndex).toBe('73');
	});

	it('preserves a consumer-provided accessible name', async () => {
		await renderModal({ 'aria-label': 'Translator settings', visible: true });

		expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe(
			'Translator settings',
		);
	});

	it('preserves a consumer-provided accessible label relationship', async () => {
		const label = document.createElement('h2');
		label.id = 'translator-settings-title';
		label.textContent = 'Translator settings';
		shadowRoot.prepend(label);

		await renderModal({
			'aria-labelledby': 'translator-settings-title',
			visible: true,
		});

		const dialog = getDialog(container);
		expect(dialog.getAttribute('aria-labelledby')).toBe('translator-settings-title');
		expect(dialog.hasAttribute('aria-label')).toBe(false);

		label.remove();
	});

	it('reports Escape and backdrop dismissals with legacy close sources', async () => {
		const onClose = vi.fn();
		await renderModal({ onClose, visible: true });

		const dialog = getDialog(container);
		const content = getModalContent(dialog);

		const escapeEvent = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			code: 'Escape',
			key: 'Escape',
		});
		dialog.dispatchEvent(escapeEvent);
		expect(onClose).toHaveBeenCalledWith(escapeEvent, 'esc');

		onClose.mockClear();
		click(content);
		expect(onClose).not.toHaveBeenCalled();

		click(dialog);
		expect(onClose).toHaveBeenCalledWith(expect.any(MouseEvent), 'click');
	});

	it('does not dismiss a drag that starts in content and ends on the backdrop', async () => {
		const onClose = vi.fn();
		await renderModal({ onClose, visible: true });

		const dialog = getDialog(container);
		const content = getModalContent(dialog);
		click(dialog, content);

		expect(onClose).not.toHaveBeenCalled();
	});

	it('portals into a scope inside a closed shadow root', async () => {
		const scopeElement = document.createElement('section');
		shadowRoot.append(scopeElement);
		const scope = { current: scopeElement };

		await renderModal({ scope, visible: true });

		expect(container.querySelector('dialog')).toBeNull();
		expect(scopeElement.querySelector('dialog')).not.toBeNull();
	});

	it('keeps hidden content only when keepMounted is enabled', async () => {
		await renderModal({ keepMounted: true, visible: false });
		const hiddenDialog = container.querySelector<HTMLDialogElement>('dialog');
		expect(hiddenDialog).not.toBeNull();
		expect(hiddenDialog?.open).toBe(false);

		await renderModal({ keepMounted: false, visible: false });
		expect(container.querySelector('dialog')).toBeNull();
	});

	it('restores focus to the real trigger inside a closed shadow root', async () => {
		const trigger = document.createElement('button');
		trigger.type = 'button';
		shadowRoot.prepend(trigger);
		trigger.focus();
		expect(shadowRoot.activeElement).toBe(trigger);

		await renderModal({ keepMounted: true, visible: true });
		expect(shadowRoot.activeElement?.textContent).toContain('Modal action');

		await renderModal({ keepMounted: true, visible: false });
		expect(shadowRoot.activeElement).toBe(trigger);

		trigger.remove();
	});

	it('retains backdrop, motion, and alignment compatibility switches', async () => {
		await renderModal({ visible: true });
		const defaultClassName = getDialog(container).className;

		await renderModal({
			contentVerticalAlign: 'top',
			hasAnimation: false,
			hideBackdrop: true,
			visible: true,
		});

		const dialog = getDialog(container);
		expect(dialog.className).not.toBe(defaultClassName);
		expect(dialog.style.marginBlockStart).toBe('var(--spacing-1-5)');
		expect(dialog.style.marginBlockEnd).toBe('auto');
	});
});
