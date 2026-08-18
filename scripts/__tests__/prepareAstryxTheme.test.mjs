import { describe, expect, it } from 'vitest';

import { convertAstryxThemeCss } from '../prepareAstryxTheme.mjs';

describe('convertAstryxThemeCss', () => {
	it('expands neutral @scope blocks into compiler-safe descendant selectors', () => {
		const source = `@layer astryx-theme {
@scope ([data-astryx-theme="neutral"]) to ([data-astryx-theme]) {
  :scope {
    --color-accent: light-dark(#111111, #eeeeee);
  }

  .astryx-button.destructive {
    color: var(--color-error);
  }
}
}`;

		const converted = convertAstryxThemeCss(source);

		expect(converted).not.toContain('@scope');
		expect(converted).not.toContain(':scope');
		expect(converted).toContain('[data-astryx-theme="neutral"] {');
		expect(converted).toContain(
			'[data-astryx-theme="neutral"] .astryx-button.destructive {',
		);
	});
});
