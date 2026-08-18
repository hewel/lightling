import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { Icon } from '@/components/primitives/Icon/Icon.bundle/desktop';
import { AstryxProvider } from '@/components/providers/AstryxProvider';

import { Button } from './Button';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

describe('Button compatibility adapter', () => {
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

	it('maps an action button and invokes the legacy press callback', async () => {
		const onPress = vi.fn();

		await render(
			<Button onPress={onPress} view="action">
				Save changes
			</Button>,
		);

		const button = container.querySelector('button');
		if (button === null) throw new Error('Expected Astryx button to render');

		expect(button.dataset.variant).toBe('primary');
		await act(async () => button.click());
		expect(onPress).toHaveBeenCalledOnce();
	});

	it('maps a legacy link button to an accessible anchor', async () => {
		await render(
			<Button title="History" type="link" url="/pages/history/history.html">
				<Icon glyph="history" />
			</Button>,
		);

		const link = container.querySelector('a');
		if (link === null) throw new Error('Expected Astryx link to render');

		expect(link.getAttribute('href')).toBe('/pages/history/history.html');
		expect(link.getAttribute('aria-label')).toBe('History');
		expect(link.classList.contains('astryx-button')).toBe(true);
		expect(link.dataset.variant).toBe('secondary');
	});

	it('maps legacy icon-only buttons and glyphs to Astryx primitives', async () => {
		await render(
			<Button content="icon" title="Delete" view="clear">
				<Icon data-testid="close-icon" glyph="close" />
			</Button>,
		);

		const button = container.querySelector('button');
		if (button === null) throw new Error('Expected Astryx icon button to render');

		const icon = container.querySelector('[data-testid="close-icon"]');
		if (icon === null) throw new Error('Expected Astryx glyph to render');

		expect(button.dataset.variant).toBe('ghost');
		expect(button.getAttribute('aria-label')).toBe('Delete');
		expect(icon.classList.contains('astryx-icon')).toBe(true);
	});
});
