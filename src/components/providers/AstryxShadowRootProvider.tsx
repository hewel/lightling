import { type FC, type ReactNode, useCallback, useMemo } from 'react';
import { LayerProvider } from '@astryxdesign/core/Layer';
import { Stack } from '@astryxdesign/core/Stack';
import { ThemeContext, type ThemeMode } from '@astryxdesign/core/theme';

import { shadowRootTokens, vividTheme } from './AstryxTheme';

type AstryxShadowRootProviderProps = {
  children: ReactNode;
  mode?: ThemeMode;
};

/**
 * Applies Astryx to an isolated content-script root without synchronizing
 * theme state or reset styles onto the host document.
 */
export const AstryxShadowRootProvider: FC<AstryxShadowRootProviderProps> = ({
  children,
  mode = 'system',
}) => {
  const themeContext = useMemo(() => ({ mode, theme: vividTheme }), [mode]);
  const applyThemeTokens = useCallback((element: HTMLElement | null) => {
    if (element === null) return;

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
