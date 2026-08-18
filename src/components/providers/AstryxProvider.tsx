import type { FC, ReactNode } from 'react';
import { LayerProvider } from '@astryxdesign/core/Layer';
import { Theme, type ThemeMode } from '@astryxdesign/core/theme';

import { vividTheme } from './AstryxTheme';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../../themes/astryx-vivid.css';
import '../../themes/legacy-compat.css';
import '../../themes/stylex.css';

interface AstryxProviderProps {
  children: ReactNode;
  mode?: ThemeMode;
}

export const AstryxProvider: FC<AstryxProviderProps> = ({
  children,
  mode = 'system',
}) => (
  <Theme mode={mode} theme={vividTheme}>
    <LayerProvider>{children}</LayerProvider>
  </Theme>
);
