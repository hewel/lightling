import { Schema } from 'effect';
import browser from 'webextension-polyfill';

import {
	createMigrationTask,
	Migration,
} from '../../../../../lib/migrations/createMigrationTask';
import { decodeStruct } from '../../../../../lib/types';

const dataStructureVersions = {
	0: Schema.Union([
		Schema.Struct({
			from: Schema.String,
			to: Schema.String,
			translate: Schema.Union([
				Schema.Struct({
					text: Schema.String,
					translate: Schema.Union([Schema.String, Schema.Null]),
				}),
				Schema.Null,
			]),
		}),
		Schema.Null,
	]),
};

const migrations: Migration[] = [
	{
		version: 2,
		async migrate() {
			const localStorageName = 'TextTranslator.lastState';
			const textTranslatorData = localStorage.getItem(localStorageName);

			// Skip
			if (textTranslatorData === null) return;

			// Try decode and write data to a new storage
			try {
				const parsedData = JSON.parse(textTranslatorData);
				const codec = decodeStruct(dataStructureVersions[0], parsedData);

				if (codec.errors === null && codec.data !== null) {
					await browser.storage.local.set({
						TextTranslatorStorage: codec.data,
					});
				}
			} catch (error) {
				// Ignore JSON parsing errors
				if (!(error instanceof SyntaxError)) {
					throw error;
				}
			}

			// Clear data
			localStorage.removeItem(localStorageName);
		},
	},
	{
		version: 3,
		async migrate() {
			const browserStorageName = 'TextTranslatorStorage';
			const { [browserStorageName]: tabData } =
				await browser.storage.local.get(browserStorageName);

			const codec = decodeStruct(dataStructureVersions[0], tabData);

			// Skip invalid data
			if (codec.errors !== null || codec.data === null) return;

			const { from, to, translate } = codec.data;
			await browser.storage.local.set({
				[browserStorageName]: {
					from,
					to,
					translate: translate
						? {
								originalText: translate.text,
								translatedText: translate.translate,
							}
						: null,
				},
			});
		},
	},
];

export const TextTranslatorStorageMigration = createMigrationTask(migrations);
