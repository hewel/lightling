import { get, isEqual } from 'lodash';
import {
	createContext,
	FC,
	RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import * as stylex from '@stylexjs/stylex';

import { Page } from '@/components/layouts/Page/Page';
import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { isMobileBrowser } from '@/lib/browser';
import { openFileDialog, readAsText, saveFile } from '@/lib/files';
import { getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
// Requests
import { clearCache as clearCacheReq } from '@/requests/backend/clearCache';
import { getConfig } from '@/requests/backend/getConfig';
import { ping } from '@/requests/backend/ping';
import { resetConfig as resetConfigReq } from '@/requests/backend/resetConfig';
import { setConfig as setConfigReq } from '@/requests/backend/setConfig';
import { getAvailableTranslators } from '@/requests/backend/translators/getAvailableTranslators';
import { getSpeakers } from '@/requests/backend/tts/getSpeakers';
import { updateConfig as updateConfigReq } from '@/requests/backend/updateConfig';
import { AppConfigType } from '@/types/runtime';

import { TranslatorsManager } from './OptionsPage.components/TranslatorsManager/TranslatorsManager';
import { TTSList } from './OptionsPage.components/TTSList/TTSList';
import { optionsPageStyles } from './OptionsPage.stylex';
import { generateTree } from './OptionsPage.utils/generateTree';
import { OptionsGroup, OptionsTree } from './OptionsTree/OptionsTree';
import { PageSection } from './PageSection/PageSection';

export const OptionsModalsContext = createContext<
	RefObject<HTMLDivElement | null> | undefined
>(undefined);

type Errors = null | Record<string, string>;

interface OptionsPageProps {
	messageHideDelay?: number;
}

export const OptionsPage: FC<OptionsPageProps> = () => {
	useLayoutEffect(() => {
		telemetry.track(TELEMETRY_EVENT_NAME.SCREEN_SHOWN, { screen: 'Preferences' });
	}, []);

	const [loaded, setLoaded] = useState<boolean>(false);

	const [config, setConfig] = useState<AppConfigType | undefined>();
	const [errors, setErrors] = useState<Errors>(null);
	const [modifiedConfig, setModifiedConfig] = useState<null | Record<string, any>>(
		null,
	);
	const [configTree, setConfigTree] = useState<OptionsGroup[] | undefined>();

	const windowsStackRef = useRef<HTMLDivElement>(null);

	const [clearCacheProcess, setClearCacheProcess] = useState<boolean>(false);

	const [translatorModules, setTranslatorModules] = useState<Record<string, string>>(
		{},
	);
	const [isOpenCustomTranslatorsWindow, setIsOpenCustomTranslatorsWindow] =
		useState(false);

	const [ttsModules, setTTSModules] = useState<Record<string, string>>({});
	const [isTTSModulesWindowOpen, setIsTTSModulesWindowOpen] = useState(false);

	const updateConfig = useCallback(() => {
		(async () => {
			await Promise.all([
				getConfig().then(setConfig),
				getAvailableTranslators().then(setTranslatorModules),
				getSpeakers().then(setTTSModules),
			]);

			setLoaded(true);
		})();
	}, []);

	//
	// Messages broker
	//

	const showToast = useToast();

	const handleError = useCallback(
		(error: any) => {
			if (typeof error === 'string') {
				showToast({ body: error, type: 'error' });
			} else if (error instanceof Error) {
				showToast({ body: error.message, type: 'error' });
			} else {
				const unknownMessage = getMessage('message_unknownError');
				showToast({ body: unknownMessage, type: 'error' });

				console.error(error);
				console.error('Unknown error object above ^');
			}
		},
		[showToast],
	);

	//
	// Config control
	//

	const importConfig = useCallback(() => {
		openFileDialog()
			.then((files) => {
				if (files === null) return null;

				return readAsText(files[0]);
			})
			.then((rawData) => {
				if (rawData === null) return;

				try {
					const configData = JSON.parse(rawData);

					setConfigReq(configData)
						.then(updateConfig)
						.then(() => {
							showToast({
								body: getMessage('settings_message_importConfig_success'),
							});
						})
						.catch(handleError);
				} catch (_error) {
					showToast({
						body: getMessage('settings_message_importConfig_invalidFile'),
						type: 'error',
					});
				}
			});
	}, [handleError, showToast, updateConfig]);

	const exportConfig = useCallback(() => {
		const dump = JSON.stringify(config);
		const file = new Blob([dump], { type: 'application/json' });

		saveFile(file, `linguist-config_${new Date().getTime()}.json`);
	}, [config]);

	const resetConfig = useCallback(() => {
		const isConfirmed = confirm(getMessage('settings_message_resetConfig_confirm'));
		if (!isConfirmed) return;

		resetConfigReq()
			.then(updateConfig)
			.then(() => {
				showToast({ body: getMessage('settings_message_resetConfig_success') });
			})
			.catch(handleError);
	}, [handleError, showToast, updateConfig]);

	//
	// Changes control
	//

	const cancelChanges = useCallback(() => {
		setModifiedConfig(null);
		setErrors(null);
	}, []);

	const saveChanges = useCallback(() => {
		// Skip empty changes
		if (modifiedConfig === null) return;

		updateConfigReq(modifiedConfig)
			.then(async ({ success, errors }) => {
				if (!success) {
					setErrors(errors);
					return;
				}

				const config = await getConfig();

				setConfig(config);
				setModifiedConfig(null);
				setErrors(null);

				showToast({ body: getMessage('settings_message_saveChanges_success') });
			})
			.catch(handleError);
	}, [handleError, modifiedConfig, showToast]);

	//
	// Config actions
	//

	const clearCache = useCallback(() => {
		setClearCacheProcess(true);
		clearCacheReq()
			.then(() => {
				showToast({ body: getMessage('settings_message_clearCache_success') });
			})
			.catch(handleError)
			.finally(() => {
				setClearCacheProcess(false);
			});
	}, [handleError, showToast]);

	//
	// Utils
	//

	const setOptionValue = useCallback(
		(inputPath: string, value: any) => {
			// Copy current object
			let modifiedConfigLocal: Record<string, any> | null = {};
			for (const path in modifiedConfig) {
				const configItem = get(config, path);

				// Copy only if it different from config value
				if (!isEqual(configItem, modifiedConfig[path])) {
					modifiedConfigLocal[path] = modifiedConfig[path];
				}
			}

			// Set value if not exist equal
			const modConfigItem = get(modifiedConfig, inputPath);
			if (!isEqual(modConfigItem, value)) {
				const configItem = get(config, inputPath);
				if (isEqual(configItem, value)) {
					delete modifiedConfigLocal[inputPath];
				} else {
					modifiedConfigLocal[inputPath] = value;
				}
			}

			if (Object.keys(modifiedConfigLocal).length === 0) {
				modifiedConfigLocal = null;
			}

			setModifiedConfig(modifiedConfigLocal);

			// Remove error for option
			if (errors !== null && inputPath in errors) {
				let errorsLocal: Errors = { ...errors };

				delete errorsLocal[inputPath];
				if (Object.keys(errorsLocal).length === 0) {
					errorsLocal = null;
				}

				setErrors(errorsLocal);
			}
		},
		[config, errors, modifiedConfig],
	);

	// Init
	useEffect(() => {
		ping().then(updateConfig);
		// oxlint-disable-next-line react/exhaustive-deps
	}, []);

	// Update config tree
	useEffect(() => {
		const configTree = generateTree({
			clearCacheProcess,
			translatorModules,
			ttsModules,
			clearCache,
			toggleCustomTranslatorsWindow: () => {
				setIsOpenCustomTranslatorsWindow((value) => !value);
			},
			toggleTTSModulesWindow: () => {
				setIsTTSModulesWindowOpen((value) => !value);
			},
		});

		setConfigTree(configTree);
	}, [translatorModules, clearCacheProcess, clearCache, ttsModules]);

	//
	// Render
	//

	const isMobile = useMemo(() => isMobileBrowser(), []);

	if (!loaded || config === undefined || configTree === undefined) {
		return <Page loading />;
	}

	const editMode = modifiedConfig !== null;
	const ActionsStack = isMobile ? VStack : HStack;
	return (
		<Page>
			<div>
				<div {...stylex.props(optionsPageStyles.page)}>
					<PageSection title={getMessage('settings_pageTitle')} level={1}>
						<div {...stylex.props(optionsPageStyles.indentHorizontal)}>
							<ActionsStack gap={3}>
								<Button
									view="action"
									onPress={resetConfig}
									width={isMobile ? 'max' : undefined}
								>
									{getMessage('settings_button_reset')}
								</Button>
								<Button
									onPress={importConfig}
									width={isMobile ? 'max' : undefined}
								>
									{getMessage('settings_button_import')}
								</Button>
								{!isMobile && (
									<Button
										onPress={exportConfig}
										width={isMobile ? 'max' : undefined}
									>
										{getMessage('settings_button_export')}
									</Button>
								)}
							</ActionsStack>
						</div>

						<div {...stylex.props(optionsPageStyles.optionsTree)}>
							<OptionsTree
								tree={configTree}
								errors={errors ?? undefined}
								config={config}
								modifiedConfig={modifiedConfig}
								setOptionValue={setOptionValue}
							/>
						</div>
					</PageSection>
				</div>

				{editMode ? (
					<div {...stylex.props(optionsPageStyles.confirmMenu)}>
						<Button view="action" onPress={saveChanges}>
							{getMessage('settings_button_saveChanges')}
						</Button>
						<Button view="default" onPress={cancelChanges}>
							{getMessage('settings_button_cancel')}
						</Button>
					</div>
				) : undefined}

				<div ref={windowsStackRef} />

				<OptionsModalsContext.Provider value={windowsStackRef}>
					<TranslatorsManager
						visible={isOpenCustomTranslatorsWindow}
						onClose={() => {
							setIsOpenCustomTranslatorsWindow(false);
						}}
						updateConfig={updateConfig}
					/>
					<TTSList
						visible={isTTSModulesWindowOpen}
						onClose={() => {
							setIsTTSModulesWindowOpen(false);
						}}
						updateConfig={updateConfig}
					/>
				</OptionsModalsContext.Provider>
			</div>
		</Page>
	);
};
