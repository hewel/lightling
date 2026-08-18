import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * Vivid theme — neutral's grayscale spine with a chromatic blue-violet
 * accent family (seed oklch(0.479 0.23 264.019)). Only the five accent
 * tokens neutral defines are overridden; everything else is inherited.
 */
export const vividTheme = defineTheme({
  name: 'vivid',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ['oklch(0.479 0.23 264.019)', 'oklch(0.74 0.13 264.019)'],
    '--color-accent-muted': ['oklch(0.93 0.03 264.019)', 'oklch(0.27 0.05 264.019)'],
    '--color-text-accent': ['oklch(0.42 0.20 264.019)', 'oklch(0.78 0.11 264.019)'],
    '--color-icon-accent': ['oklch(0.479 0.23 264.019)', 'oklch(0.74 0.13 264.019)'],
    '--color-on-accent': ['#ffffff', '#171717'],
  },
});
