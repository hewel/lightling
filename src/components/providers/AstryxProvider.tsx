import { type FC, type ReactNode, useCallback, useMemo } from 'react';
import { LayerProvider } from '@astryxdesign/core/Layer';
import { Stack } from '@astryxdesign/core/Stack';
import {
	registerTheme,
	Theme,
	ThemeContext,
	type ThemeMode,
} from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../../themes/astryx-neutral.css';
import '../../themes/legacy-compat.css';
import '../../themes/stylex.css';

interface AstryxProviderProps {
	children: ReactNode;
	mode?: ThemeMode;
}

registerTheme(neutralTheme);

export const AstryxProvider: FC<AstryxProviderProps> = ({
	children,
	mode = 'system',
}) => (
	<Theme mode={mode} theme={neutralTheme}>
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
	const themeContext = useMemo(() => ({ mode, theme: neutralTheme }), [mode]);
	const applyThemeTokens = useCallback((element: HTMLElement | null) => {
		if (element === null) return;

		for (const [token, value] of Object.entries(neutralTheme.tokens)) {
			element.style.setProperty(token, value);
		}
	}, []);

	return (
		<ThemeContext value={themeContext}>
			{/* Infrastructure exception: this display-only scope replaces Theme's
			wrapper without invoking its document.documentElement synchronization. */}
			<Stack
				ref={applyThemeTokens}
				data-astryx-theme={neutralTheme.name}
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
