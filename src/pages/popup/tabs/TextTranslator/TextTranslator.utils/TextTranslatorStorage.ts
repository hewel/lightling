import { Schema } from 'effect';
import browser from 'webextension-polyfill';

import { tryDecode } from '@/lib/types';
import { LangCode, LangCodeWithAuto } from '@/types/runtime';
import { type DeepMutable } from '@/types/utils';

const storageSignature = Schema.Union([
	Schema.Struct({
		from: LangCodeWithAuto,
		to: LangCode,
		translate: Schema.mutableKey(
			Schema.Union([
				Schema.Struct({
					originalText: Schema.String,
					translatedText: Schema.Union([Schema.String, Schema.Null]),
				}),
				Schema.Null,
			]),
		),
	}),
	Schema.Null,
]);

export type TextTranslatorData = DeepMutable<typeof storageSignature.Type>;

export class TextTranslatorStorage {
	private readonly storeName = 'TextTranslatorStorage';

	/**
	 * Default data
	 */
	private readonly defaultData: TextTranslatorData = null;

	public getData = async (): Promise<TextTranslatorData> => {
		const storeName = this.storeName;
		const { [storeName]: tabData } = await browser.storage.local.get(storeName);

		const { defaultData } = this;
		if (tabData === undefined) return defaultData;

		return tryDecode(storageSignature, tabData, defaultData);
	};

	public setData = async (data: TextTranslatorData) => {
		// Verify data
		tryDecode(storageSignature, data);

		const storeName = this.storeName;
		await browser.storage.local.set({ [storeName]: data });
	};

	public updateData = async (data: Partial<TextTranslatorData>) => {
		const actualData = await this.getData();

		// Protect from null
		if (actualData === null) throw new TypeError('Cant merge with null');

		await this.setData({
			...actualData,
			...data,
		});
	};

	public clear = async () => {
		await this.setData(null);
	};

	public forgetText = async () => {
		const data = await this.getData();

		if (data === null) return;

		await this.setData({
			...data,
			translate: null,
		});
	};
}
