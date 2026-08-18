import { act, createRef, type FC, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Popup, type AnchoredPopupProps, type IPopupProps } from './Popup';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

function requireElement<T extends Element>(element: T | null): T {
	if (element === null) throw new Error('Expected element to be rendered');

	return element;
}

type PopupHarnessProps = Pick<IPopupProps, 'onClose' | 'visible'> & {
	updateRef?: AnchoredPopupProps['UNSTABLE_updatePosition'];
};

const PopupHarness: FC<PopupHarnessProps> = ({ onClose, updateRef, visible }) => {
	const anchorRef = useRef<HTMLButtonElement>(null);

	return (
		<div>
			<button ref={anchorRef} type="button">
				Anchor
			</button>
			<Popup
				anchor={anchorRef}
				hideWhenDetached={false}
				onClose={onClose}
				target="anchor"
				UNSTABLE_updatePosition={updateRef}
				view="default"
				visible={visible}
			>
				Popup content
			</Popup>
		</div>
	);
};

const ReplacedAnchorHarness: FC<{
	alternate: boolean;
	onClose: NonNullable<IPopupProps['onClose']>;
}> = ({ alternate, onClose }) => {
	const anchorRef = useRef<HTMLElement>(null);
	const setAnchor = (element: HTMLElement | null) => {
		anchorRef.current = element;
	};

	return (
		<div>
			{alternate ? (
				<a href="#popup" ref={setAnchor}>
					Alternate anchor
				</a>
			) : (
				<button ref={setAnchor} type="button">
					Initial anchor
				</button>
			)}
			<Popup
				anchor={anchorRef}
				hideWhenDetached={false}
				onClose={onClose}
				target="anchor"
				visible={true}
			>
				Popup content
			</Popup>
		</div>
	);
};

const EssentialRefHarness: FC<{
	onClose: NonNullable<IPopupProps['onClose']>;
}> = ({ onClose }) => {
	const essentialRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			<button ref={essentialRef} type="button">
				Essential control
			</button>
			<Popup essentialRefs={[essentialRef]} onClose={onClose} visible>
				Popup content
			</Popup>
		</>
	);
};

describe('Popup', () => {
	let container: HTMLDivElement;
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement('div');
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: 'closed' });
		container = document.createElement('div');
		shadowRoot.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		host.remove();
	});

	async function renderPopup(props: PopupHarnessProps) {
		await act(async () => {
			root.render(<PopupHarness {...props} />);
			await Promise.resolve();
		});
		await act(async () => Promise.resolve());
	}

	function click(target: EventTarget) {
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	}

	it('positions inline with absolute top/left styles and exposes manual updates', async () => {
		const updateRef = createRef<() => void>();

		await renderPopup({ updateRef, visible: true });

		const popup = container.querySelector<HTMLElement>('.Popup');
		expect(popup).not.toBeNull();
		expect(popup?.classList.contains('astryx-card')).toBe(true);
		expect(popup?.classList.contains('Popup_view_default')).toBe(true);
		expect(popup?.classList.contains('Popup_visible')).toBe(true);
		expect(popup?.dataset.popperPlacement).toBeTruthy();
		expect(popup?.style.position).toBe('absolute');
		expect(popup?.style.transform).toBe('');
		expect(updateRef.current).toBeTypeOf('function');

		await act(async () => {
			updateRef.current?.();
			await Promise.resolve();
		});
	});

	it('keeps hidden popups mounted', async () => {
		await renderPopup({ visible: false });

		const popup = container.querySelector<HTMLElement>('.Popup');
		expect(popup).not.toBeNull();
		expect(popup?.classList.contains('Popup_visible')).toBe(false);
		expect(popup?.style.visibility).toBe('hidden');
	});

	it('unmounts hidden popups when keepMounted is false', async () => {
		await act(async () => {
			root.render(
				<Popup keepMounted={false} view="default" visible={false}>
					Hidden popup
				</Popup>,
			);
		});

		expect(container.querySelector('.Popup')).toBeNull();
	});

	it('supports the non-anchored popup shell', async () => {
		await act(async () => {
			root.render(
				<Popup view="default" visible={true}>
					Static popup content
				</Popup>,
			);
		});

		const popup = container.querySelector<HTMLElement>('.Popup');
		expect(popup).not.toBeNull();
		expect(popup?.classList.contains('Popup_view_default')).toBe(true);
		expect(popup?.classList.contains('Popup_visible')).toBe(true);
		expect(popup?.style.position).toBe('');
	});

	it('preserves root attributes, refs, slots, z-index, and tail hooks', async () => {
		const innerRef = createRef<HTMLDivElement>();
		const tailRef = createRef<HTMLDivElement>();
		const onRenderTail = vi.fn((tail) => tail);
		const renderChildren = vi.fn(() => <span data-slot="content">Content</span>);

		await act(async () => {
			root.render(
				<Popup
					addonAfter={<span data-slot="after">After</span>}
					addonBefore={<span data-slot="before">Before</span>}
					aria-label="Compatibility popup"
					className="custom-popup"
					hasTail
					innerRef={innerRef}
					style={{ maxWidth: 'var(--spacing-10)' }}
					tailRef={tailRef}
					UNSTABLE_onRenderTail={onRenderTail}
					view="default"
					visible
					zIndex={73}
				>
					{renderChildren}
				</Popup>,
			);
		});

		const popup = requireElement(container.querySelector<HTMLElement>('.Popup'));
		expect(popup).toBe(innerRef.current);
		expect(popup.classList.contains('custom-popup')).toBe(true);
		expect(popup.getAttribute('aria-label')).toBe('Compatibility popup');
		expect(popup.style.maxWidth).toBe('var(--spacing-10)');
		expect(popup.style.zIndex).toBe('73');
		expect(
			[...popup.querySelectorAll<HTMLElement>('[data-slot]')].map(
				(element) => element.dataset.slot,
			),
		).toEqual(['before', 'content', 'after']);
		expect(renderChildren).toHaveBeenCalledWith({ tailRef });
		expect(onRenderTail).toHaveBeenCalledOnce();
		expect(tailRef.current).toBe(popup.querySelector('.Popup-Tail'));
		expect(tailRef.current?.style.width).toBe('var(--spacing-4)');
	});

	it('tracks a replacement anchor that uses the same ref object', async () => {
		const onClose = vi.fn();

		await act(async () => {
			root.render(<ReplacedAnchorHarness alternate={false} onClose={onClose} />);
			await Promise.resolve();
		});
		await act(async () => {
			root.render(<ReplacedAnchorHarness alternate={true} onClose={onClose} />);
			await Promise.resolve();
		});

		const anchor = requireElement(container.querySelector('a'));
		click(anchor);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('preserves anchor-aware outside click and Escape dismissal', async () => {
		const onClose = vi.fn();

		await renderPopup({ onClose, visible: true });

		const anchor = requireElement(container.querySelector('button'));

		click(anchor);
		expect(onClose).not.toHaveBeenCalled();

		click(document.body);
		expect(onClose).toHaveBeenCalledOnce();
		expect(onClose.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
		expect(onClose.mock.calls[0]?.[1]).toBe('click');

		onClose.mockClear();
		document.dispatchEvent(
			new KeyboardEvent('keyup', { bubbles: true, code: 'Escape' }),
		);
		expect(onClose).toHaveBeenCalledOnce();
		expect(onClose.mock.calls[0]?.[0]).toBeInstanceOf(KeyboardEvent);
		expect(onClose.mock.calls[0]?.[1]).toBe('esc');
	});

	it('reads essential refs live inside a closed shadow root', async () => {
		const onClose = vi.fn();

		await act(async () => {
			root.render(<EssentialRefHarness onClose={onClose} />);
		});

		click(requireElement(container.querySelector('button')));
		expect(onClose).not.toHaveBeenCalled();

		click(document.body);
		expect(onClose).toHaveBeenCalledOnce();
		expect(onClose.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
		expect(onClose.mock.calls[0]?.[1]).toBe('click');
	});

	it('dismisses only the topmost visible popup', async () => {
		const firstOnClose = vi.fn();
		const secondOnClose = vi.fn();

		await act(async () => {
			root.render(
				<>
					<Popup onClose={firstOnClose} visible>
						First popup
					</Popup>
					<Popup onClose={secondOnClose} visible>
						Second popup
					</Popup>
				</>,
			);
		});

		click(document.body);
		expect(secondOnClose).toHaveBeenCalledOnce();
		expect(secondOnClose.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
		expect(secondOnClose.mock.calls[0]?.[1]).toBe('click');
		expect(firstOnClose).not.toHaveBeenCalled();

		secondOnClose.mockClear();
		await act(async () => {
			root.render(
				<>
					<Popup onClose={firstOnClose} visible>
						First popup
					</Popup>
					<Popup onClose={secondOnClose} visible={false}>
						Second popup
					</Popup>
				</>,
			);
		});

		document.dispatchEvent(
			new KeyboardEvent('keyup', { bubbles: true, code: 'Escape' }),
		);
		expect(firstOnClose).toHaveBeenCalledOnce();
		expect(firstOnClose.mock.calls[0]?.[0]).toBeInstanceOf(KeyboardEvent);
		expect(firstOnClose.mock.calls[0]?.[1]).toBe('esc');
		expect(secondOnClose).not.toHaveBeenCalled();
	});

	it('portals into scope while honoring the essential host click region', async () => {
		const onClose = vi.fn();
		const scopeElement = document.createElement('section');
		document.body.append(scopeElement);
		const scopeRef = { current: scopeElement };

		await act(async () => {
			root.render(
				<Popup hostRef={scopeRef} onClose={onClose} scope={scopeRef} visible>
					Portaled popup
				</Popup>,
			);
		});

		expect(container.querySelector('.Popup')).toBeNull();
		expect(scopeElement.querySelector('.Popup')).not.toBeNull();

		click(scopeElement);
		expect(onClose).not.toHaveBeenCalled();

		click(document.body);
		expect(onClose).toHaveBeenCalledOnce();
		expect(onClose.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
		expect(onClose.mock.calls[0]?.[1]).toBe('click');

		await act(async () => root.render(null));
		scopeElement.remove();
	});
});
