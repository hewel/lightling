import { type FC, type ReactNode, useCallback, useMemo } from 'react';
import { LayerProvider } from '@astryxdesign/core/Layer';
import { Stack } from '@astryxdesign/core/Stack';
import {
	borderDefaults,
	colorDefaults,
	durationDefaults,
	easeDefaults,
	focusDefaults,
	fontWeightDefaults,
	radiusDefaults,
	registerTheme,
	shadowDefaults,
	sizeDefaults,
	spacingDefaults,
	textSizeDefaults,
	Theme,
	ThemeContext,
	typeScaleDefaults,
	type ThemeMode,
	typographyDefaults,
} from '@astryxdesign/core/theme';
import { vividTheme } from '../../themes/vivid/vivid.js';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../../themes/astryx-vivid.css';
import '../../themes/legacy-compat.css';
import '../../themes/stylex.css';

interface AstryxProviderProps {
	children: ReactNode;
	mode?: ThemeMode;
}

const shadowRootTokens = {
	...borderDefaults,
	...colorDefaults,
	...durationDefaults,
	...easeDefaults,
	...focusDefaults,
	...fontWeightDefaults,
	...radiusDefaults,
	...shadowDefaults,
	...sizeDefaults,
	...spacingDefaults,
	...textSizeDefaults,
	...typeScaleDefaults,
	...typographyDefaults,
	...vividTheme.tokens,
};

registerTheme(vividTheme);

export const AstryxProvider: FC<AstryxProviderProps> = ({
	children,
	mode = 'system',
}) => (
	<Theme mode={mode} theme={vividTheme}>
		<LayerProvider>{children}</LayerProvider>
	</Theme>
);

/**
 * Applies ASTRYX to an isolated content-script root without allowing the
 * upstream Theme component to synchronize state onto the host page's html.
 */
export const AstryxShadowRootProvider: FC<AstryxProviderProps> = ({
	children,
	mode = 'system',
}) => {
	const themeContext = useMemo(() => ({ mode, theme: vividTheme }), [mode]);
	const applyThemeTokens = useCallback((element: HTMLElement | null) => {
		if (element === null) return;

		// Astryx defines foundational defaults on :root, which does not cross into
		// a shadow tree. Materialize them on this scope before theme overrides.
		for (const [token, value] of Object.entries(shadowRootTokens)) {
			element.style.setProperty(token, value);
		}
	}, []);

	return (
		<ThemeContext value={themeContext}>
			{/* Infrastructure exception: this display-only scope replaces Theme's
			wrapper without invoking its document.documentElement synchronization. */}
			<Stack
				ref={applyThemeTokens}
				data-astryx-theme={vividTheme.name}
				data-theme={mode === 'system' ? undefined : mode}
				style={{
					color: 'var(--color-text-primary)',
					colorScheme: mode === 'system' ? 'light dark' : mode,
					display: 'contents',
					fontFamily: 'var(--font-family-body)',
				}}
			>
				<LayerProvider>{children}</LayerProvider>
			</Stack>
		</ThemeContext>
	);
};
