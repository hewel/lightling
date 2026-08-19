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
  typeScaleDefaults,
  typographyDefaults,
} from '@astryxdesign/core/theme';

import { vividTheme } from '../../themes/vivid/vivid.js';

registerTheme(vividTheme);

export { vividTheme };

// rem inside a shadow tree resolves against the host page's root font size, which
// arbitrary pages override. These tokens are applied as inline styles on the shadow
// wrapper (see `AstryxShadowRootProvider`), so they bypass the build-time
// `postcss-rem-to-pixel` pass and are converted here instead.
const REM_ROOT_PX = 16;
const remToPx = (value: string): string =>
  value.replace(
    /(-?\d*\.?\d+)rem\b/g,
    (_match, size: string) =>
      String(Number((Number.parseFloat(size) * REM_ROOT_PX).toFixed(5))) + 'px',
  );

export const shadowRootTokens = Object.fromEntries(
  Object.entries({
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
  }).map(([token, value]) => [token, typeof value === 'string' ? remToPx(value) : value]),
);
