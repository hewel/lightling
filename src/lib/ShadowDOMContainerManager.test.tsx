import { act } from 'react';

import { ShadowDOMContainerManager } from './ShadowDOMContainerManager';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

describe('ShadowDOMContainerManager', () => {
	let manager: ShadowDOMContainerManager | undefined;
	afterEach(async () => {
		await act(async () => manager?.unmountComponent());
		manager?.removeRootNode();
		manager = undefined;
		vi.restoreAllMocks();
	});

	it('mounts extension stylesheets inside the closed shadow root', async () => {
		// oxlint-disable-next-line typescript/unbound-method
		const originalAttachShadow = Element.prototype.attachShadow;
		let mountedShadowRoot: ShadowRoot | undefined;
		vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
			this: Element,
			init: ShadowRootInit,
		) {
			mountedShadowRoot = originalAttachShadow.call(this, init);
			return mountedShadowRoot;
		});

		manager = new ShadowDOMContainerManager({
			styles: ['content_scripts/content-0.css'],
		});
		manager.createRootNode();

		await act(async () => {
			manager?.mountComponent('Content');
			await Promise.resolve();
		});

		const stylesheet = mountedShadowRoot?.querySelector<HTMLLinkElement>(
			'link[rel="stylesheet"]',
		);
		expect(stylesheet?.href).toContain('content_scripts/content-0.css');
		expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull();
	});
});
