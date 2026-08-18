import { act, createRef, type FC, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Popup, type AnchoredPopupProps, type IPopupProps } from './Popup';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

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

	it('positions inline with absolute top/left styles and exposes manual updates', async () => {
		const updateRef = createRef<() => void>();

		await renderPopup({ updateRef, visible: true });

		const popup = container.querySelector<HTMLElement>('.Popup');
		expect(popup).not.toBeNull();
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

		const anchor = container.querySelector('a');
		expect(anchor).not.toBeNull();
		anchor?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onClose).not.toHaveBeenCalled();
	});

	it('preserves anchor-aware outside click and Escape dismissal', async () => {
		const onClose = vi.fn();

		await renderPopup({ onClose, visible: true });

		const anchor = container.querySelector('button');
		expect(anchor).not.toBeNull();

		anchor?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		anchor?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onClose).not.toHaveBeenCalled();

		document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onClose).toHaveBeenCalledWith(expect.any(MouseEvent), 'click');

		onClose.mockClear();
		document.dispatchEvent(
			new KeyboardEvent('keyup', { bubbles: true, code: 'Escape' }),
		);
		expect(onClose).toHaveBeenCalledWith(expect.any(KeyboardEvent), 'esc');
	});
});
