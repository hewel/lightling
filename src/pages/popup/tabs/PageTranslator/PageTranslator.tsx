import { FC, useCallback, useMemo } from 'react';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Selector } from '@astryxdesign/core/Selector';
import { cn } from '@bem-react/classname';

import { PageTranslatorStats } from '@/app/ContentScript/PageTranslator/PageTranslator';
import { LanguagePanel } from '@/components/controls/LanguagePanel/LanguagePanel';
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { getLanguageNameByCode, getMessage } from '@/lib/language';
import { MutableValue } from '@/types/utils';

import { TabData } from '../../layout/PopupWindow';

import './PageTranslator.css';

export const cnPageTranslator = cn('PageTranslator');

export const languagePreferenceOptions = {
	ENABLE: 'enable',
	DISABLE: 'disable',
	DISABLE_FOR_ALL: 'disableForAll',
} as const;

export const sitePreferenceOptions = {
	DEFAULT: 'default',
	ALWAYS: 'always',
	NEVER: 'never',
	DEFAULT_FOR_THIS_LANGUAGE: 'defaultForThisLang',
	ALWAYS_FOR_THIS_LANGUAGE: 'alwaysForThisLang',
	NEVER_FOR_THIS_LANGUAGE: 'neverForThisLang',
} as const;

export interface PageTranslatorProps
	extends
		MutableValue<'from', string | undefined>,
		MutableValue<'to', string | undefined>,
		MutableValue<'isShowOptions', boolean>,
		// TODO: use literals
		MutableValue<'sitePreferences', string>,
		MutableValue<'languagePreferences', string> {
	/**
	 * Features of translator module
	 */
	translatorFeatures: TabData['translatorFeatures'];

	hostname: string;

	showCounters?: boolean;

	isTranslated: boolean;

	toggleTranslate: () => void;

	counters: PageTranslatorStats;

	isMobile?: boolean;
}

/**
 * Component represent UI for translate current page
 */
export const PageTranslator: FC<PageTranslatorProps> = ({
	translatorFeatures,
	from,
	setFrom,
	to,
	setTo,
	hostname,
	sitePreferences,
	setSitePreferences,
	languagePreferences,
	setLanguagePreferences,
	showCounters,
	toggleTranslate,
	isTranslated,
	counters,

	isShowOptions,
	setIsShowOptions,

	isMobile,
}) => {
	const actionBtnText = getMessage(
		isTranslated ? 'pageTranslator_showOriginal' : 'pageTranslator_translatePage',
	);

	const escapedHostname = useMemo(
		() => (hostname.length <= 50 ? hostname : hostname.slice(0, 80) + '...'),
		[hostname],
	);
	const localizedLang = useMemo(
		() => (from ? getLanguageNameByCode(from) : null),
		[from],
	);

	// TODO: #important fix types in library to allow set types strict
	const setTranslateLangAdaptor = useCallback(
		(value: string[] | string | undefined) => {
			// TODO: check that it is const value
			if (typeof value === 'string') {
				setLanguagePreferences(value);
			}
		},
		[setLanguagePreferences],
	);

	const setTranslateStateAdaptor = useCallback(
		(value: string[] | string | undefined) => {
			if (typeof value === 'string') {
				setSitePreferences(value);
			}
		},
		[setSitePreferences],
	);

	const translateLanguageOptions = useMemo(
		() =>
			[
				languagePreferenceOptions.ENABLE,
				languagePreferenceOptions.DISABLE,
				languagePreferenceOptions.DISABLE_FOR_ALL,
			].map((key) => ({
				value: key,
				label: getMessage(
					'pageTranslator_commonPreferences_autoTranslate_' + key,
				),
			})),
		[],
	);

	const translateSiteOptions = useMemo(
		() =>
			[
				sitePreferenceOptions.DEFAULT,
				sitePreferenceOptions.NEVER,
				sitePreferenceOptions.ALWAYS,
				sitePreferenceOptions.DEFAULT_FOR_THIS_LANGUAGE,
				sitePreferenceOptions.ALWAYS_FOR_THIS_LANGUAGE,
				sitePreferenceOptions.NEVER_FOR_THIS_LANGUAGE,
			].map((key) => ({
				value: key,
				label: getMessage('pageTranslator_sitePreferences_autoTranslate_' + key),
			})),
		[],
	);

	return (
		<div
			className={cnPageTranslator({ view: isMobile ? 'mobile' : undefined }, [
				cnPageTranslator('Container', { indent: 'vertical' }),
			])}
		>
			<div
				className={cnPageTranslator(
					'PageTranslation',
					{
						view: isMobile ? 'mobile' : undefined,
					},
					[
						cnPageTranslator('Container', {
							indent: isMobile ? 'vertical' : 'horizontal',
						}),
					],
				)}
			>
				<Button
					view="action"
					onPress={toggleTranslate}
					size={isMobile ? 'l' : 'm'}
					className={cnPageTranslator('TranslateButton', { fill: isMobile })}
				>
					{actionBtnText}
				</Button>
				<div className={cnPageTranslator('LangPanel')}>
					<LanguagePanel
						auto={translatorFeatures.isSupportAutodetect}
						languages={translatorFeatures.supportedLanguages}
						from={from}
						to={to}
						setFrom={setFrom}
						setTo={setTo}
						mobile={isMobile}
					/>
				</div>
			</div>

			{/* Options */}
			<Collapsible
				trigger={getMessage('pageTranslator_showTranslationPreferences')}
				isOpen={isShowOptions}
				onOpenChange={setIsShowOptions}
			>
				<div
					className={cnPageTranslator('OptionContainer', { mobile: isMobile }, [
						cnPageTranslator('Container', { indent: 'vertical' }),
					])}
				>
					<div className={cnPageTranslator('Option')}>
						<h4 className={cnPageTranslator('Header')}>
							{getMessage('pageTranslator_commonPreferences_title') +
								(localizedLang && ` (${localizedLang})`)}
						</h4>
						<div className={cnPageTranslator('OptionBody')}>
							<span className={cnPageTranslator('OptionTitle')}>
								{getMessage('pageTranslator_option_autoTranslate')}
							</span>
							<span className={cnPageTranslator('OptionValue')}>
								<Selector
									label={getMessage(
										'pageTranslator_commonPreferences_title',
									)}
									isLabelHidden
									options={translateLanguageOptions}
									value={languagePreferences}
									onChange={setTranslateLangAdaptor}
								/>
							</span>
						</div>
					</div>

					<div className={cnPageTranslator('Option')}>
						<h4 className={cnPageTranslator('Header')}>
							{getMessage('pageTranslator_sitePreferences_title')}{' '}
							{escapedHostname}
						</h4>
						<div className={cnPageTranslator('OptionBody')}>
							<span className={cnPageTranslator('OptionTitle')}>
								{getMessage('pageTranslator_option_autoTranslate')}
							</span>
							<span className={cnPageTranslator('OptionValue')}>
								<Selector
									label={getMessage(
										'pageTranslator_sitePreferences_title',
									)}
									isLabelHidden
									options={translateSiteOptions}
									value={sitePreferences}
									onChange={setTranslateStateAdaptor}
								/>
							</span>
						</div>
					</div>
				</div>
			</Collapsible>

			{showCounters ? (
				<>
					<h4 className={cnPageTranslator('Header')}>
						{getMessage('pageTranslator_translationReport')}
					</h4>
					<div className={cnPageTranslator('CounterContainer')}>
						<span className={cnPageTranslator('Counter')}>
							{getMessage('pageTranslator_translationReport_resolve')}
							<span className={cnPageTranslator('CounterContent')}>
								{counters !== undefined ? counters.resolved : 0}
							</span>
						</span>
						<span className={cnPageTranslator('Counter')}>
							{getMessage('pageTranslator_translationReport_reject')}
							<span className={cnPageTranslator('CounterContent')}>
								{counters !== undefined ? counters.rejected : 0}
							</span>
						</span>
						<span className={cnPageTranslator('Counter')}>
							{getMessage('pageTranslator_translationReport_queue')}
							<span className={cnPageTranslator('CounterContent')}>
								{counters !== undefined ? counters.pending : 0}
							</span>
						</span>
					</div>
				</>
			) : (
				// Placeholder
				<div className={cnPageTranslator('Placeholder')} />
			)}
		</div>
	);
};
