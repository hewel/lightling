import { Schema } from 'effect';

import { getDBInstance } from '../utils';

export const dataSignature = Schema.Boolean;

export type LanguageInfo = Schema.Schema.Type<typeof dataSignature>;

export const addLanguage = async (language: string, status: LanguageInfo) => {
	const db = await getDBInstance();
	await db.put('autoTranslatedLanguages', status, language);
};

export const deleteLanguage = async (language: string) => {
	const db = await getDBInstance();
	await db.delete('autoTranslatedLanguages', language);
};

export const getLanguage = async (language: string) => {
	const db = await getDBInstance();
	const result = await db.get('autoTranslatedLanguages', language);
	return result ?? null;
};

// export const getLanguages = async () => {
// 	const db = await getDBInstance();
// 	const languages = await db.getAll('autoTranslatedLanguages');

// 	return languages;
// };
