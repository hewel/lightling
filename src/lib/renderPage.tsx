// Resources
import '../polyfills/scrollfix';

import { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { configureRootTheme, ThemeWhitepaper } from 'react-elegant-ui/esm/theme';

type Options = {
	title?: string;
	styles?: string[];
	scripts?: string[];
	theme?: ThemeWhitepaper;
	rootNode?: Element | null;
	PageComponent: ComponentType;
};

/**
 * Helper for render page
 */
export const renderPage = ({
	title,
	theme,
	PageComponent,
	rootNode = document.body.querySelector('#root'),
}: Options) => {
	if (title !== undefined) {
		document.title = title;
	}

	if (theme !== undefined) {
		configureRootTheme({ theme, root: document.documentElement });
	}

	function render() {
		if (rootNode !== null && rootNode instanceof HTMLElement) {
			createRoot(rootNode).render(<PageComponent />);
		}
	}

	// Render as fast as possible
	if (document.readyState == 'loading') {
		document.addEventListener('DOMContentLoaded', render);
	} else {
		render();
	}
};
