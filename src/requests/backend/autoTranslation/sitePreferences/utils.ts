// TODO: show sites preference list on options page

import { Schema } from 'effect';

import { getDBInstance } from '../utils';

// TODO: rename fields
export const dataSignature = Schema.Struct({
	/**
	 * While `false`, auto translate will not work, while `true` will work with consider other options
	 */
	enableAutoTranslate: Schema.mutableKey(Schema.Boolean),

	/**
	 * While size greater than 0, languages from list will translate
	 */
	autoTranslateLanguages: Schema.mutableKey(
		Schema.mutable(Schema.Array(Schema.String)),
	),

	/**
	 * While size greater than 0, languages from list will not translate
	 *
	 * This list have priority over `autoTranslateLanguages`
	 */
	autoTranslateIgnoreLanguages: Schema.mutableKey(
		Schema.mutable(Schema.Array(Schema.String)),
	),
});

export type SiteData = Schema.Schema.Type<typeof dataSignature>;

export const setPreferences = async (site: string, options: SiteData) => {
	const db = await getDBInstance();
	await db.put('sitePreferences', options, site);
};

export const getPreferences = async (site: string) => {
	const db = await getDBInstance();
	const entry = await db.get('sitePreferences', site);

	return entry ?? null;
};

export const deletePreferences = async (site: string) => {
	const db = await getDBInstance();
	await db.delete('sitePreferences', site);
};
