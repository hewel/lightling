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

export const shadowRootTokens = {
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
