import { createElement } from 'react';
import * as AstryxIconModule from '@astryxdesign/core/Icon';

import { IconGlyphAutoFix } from '../_glyph/Icon_glyph_autofix';
import { IconGlyphBookmark } from '../_glyph/Icon_glyph_bookmark';
import { IconGlyphBookmarkBorder } from '../_glyph/Icon_glyph_bookmark-border';
import { IconGlyphDelete } from '../_glyph/Icon_glyph_delete';
import { IconGlyphDictionary } from '../_glyph/Icon_glyph_dictionary';
import { IconGlyphHistory } from '../_glyph/Icon_glyph_history';
import { IconGlyphSettings } from '../_glyph/Icon_glyph_settings';
import { IconGlyphSwapHoriz } from '../_glyph/Icon_glyph_swap-horiz';
import { IconGlyphVolumeUp } from '../_glyph/Icon_glyph_volume-up';

const AstryxIcon = AstryxIconModule.Icon;
type AstryxIconProps = AstryxIconModule.IconProps;
type IconType = AstryxIconModule.IconType;

export type LegacyIconGlyph =
	| 'autoFix'
	| 'bookmark'
	| 'bookmark-border'
	| 'cancel'
	| 'check'
	| 'close'
	| 'delete'
	| 'dictionary'
	| 'expand-more'
	| 'history'
	| 'settings'
	| 'swap-horiz'
	| 'unfold-more'
	| 'volume-up';

type LegacyIconSize = 's' | 'm' | 'l';

export interface IIconProps extends Omit<AstryxIconProps, 'icon' | 'ref' | 'size'> {
	glyph?: LegacyIconGlyph;
	icon?: AstryxIconProps['icon'];
	scalable?: boolean;
	size?: LegacyIconSize;
}

const iconGlyphs: Record<LegacyIconGlyph, AstryxIconProps['icon']> = {
	autoFix: IconGlyphAutoFix,
	bookmark: IconGlyphBookmark,
	'bookmark-border': IconGlyphBookmarkBorder,
	cancel: 'close',
	check: 'check',
	close: 'close',
	delete: IconGlyphDelete,
	dictionary: IconGlyphDictionary,
	'expand-more': 'chevronDown',
	history: IconGlyphHistory,
	settings: IconGlyphSettings,
	'swap-horiz': IconGlyphSwapHoriz,
	'unfold-more': 'arrowsUpDown',
	'volume-up': IconGlyphVolumeUp,
};

const sizes: Record<LegacyIconSize, NonNullable<AstryxIconProps['size']>> = {
	s: 'sm',
	m: 'md',
	l: 'lg',
};

/**
 * Compatibility adapter for the extension's legacy glyph names. New callers
 * should pass Astryx semantic icon names or typed SVG components via `icon`.
 */
export function Icon({
	glyph,
	icon,
	scalable: _scalable,
	size = 'm',
	...props
}: IIconProps) {
	const resolvedIcon = icon ?? (glyph === undefined ? undefined : iconGlyphs[glyph]);

	if (resolvedIcon === undefined) return null;

	return createElement(AstryxIcon, {
		...props,
		icon: resolvedIcon,
		size: sizes[size],
	});
}

export type { IconType };
