import { Schema } from 'effect';

import { defaultConfig } from '../config';
import { tryDecode } from '../lib/types';
import { AppConfig, type AppConfigType, LangCode, LangCodeWithAuto } from './runtime';

describe('runtime schemas', () => {
	test('validates language codes and the auto-detect sentinel', () => {
		expect(Schema.is(LangCode)('en')).toBe(true);
		expect(Schema.is(LangCode)('auto')).toBe(false);
		expect(Schema.is(LangCode)('not-a-language')).toBe(false);
		expect(Schema.is(LangCodeWithAuto)('auto')).toBe(true);
	});

	test('materializes omitted optional config fields as undefined', () => {
		const selectTranslator = { ...defaultConfig.selectTranslator };
		Reflect.deleteProperty(selectTranslator, 'zIndex');
		Reflect.deleteProperty(selectTranslator, 'focusOnTranslateButton');

		const config = tryDecode(AppConfig, {
			...defaultConfig,
			selectTranslator,
		});

		expect(
			Object.prototype.hasOwnProperty.call(config.selectTranslator, 'zIndex'),
		).toBe(true);
		expect(
			Object.prototype.hasOwnProperty.call(
				config.selectTranslator,
				'focusOnTranslateButton',
			),
		).toBe(true);
		expect(config.selectTranslator.zIndex).toBeUndefined();
		expect(config.selectTranslator.focusOnTranslateButton).toBeUndefined();
	});

	test('keeps the schema-derived config type mutable', () => {
		const config: AppConfigType = {
			...defaultConfig,
			pageTranslator: {
				...defaultConfig.pageTranslator,
				excludeSelectors: [...defaultConfig.pageTranslator.excludeSelectors],
				translatableAttributes: [
					...defaultConfig.pageTranslator.translatableAttributes,
				],
			},
			selectTranslator: {
				...defaultConfig.selectTranslator,
				modifiers: [...defaultConfig.selectTranslator.modifiers],
			},
		};

		config.language = 'fr';
		config.selectTranslator.modifiers.push('ctrlKey');

		expect(config.language).toBe('fr');
		expect(config.selectTranslator.modifiers).toContain('ctrlKey');
	});
});
