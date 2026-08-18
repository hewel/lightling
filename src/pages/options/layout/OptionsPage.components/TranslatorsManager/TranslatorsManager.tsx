import { FC, useCallback, useContext, useEffect, useState } from 'react';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import * as stylex from '@stylexjs/stylex';
import { IconTrash } from '@tabler/icons-react';

import { ModalLayout } from '@/components/layouts/ModalLayout/ModalLayout';
import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { Modal } from '@/components/primitives/Modal/Modal.bundle/desktop';
import { getMessage } from '@/lib/language';
import { CustomTranslator } from '@/requests/backend/translators';
import { addTranslator } from '@/requests/backend/translators/addTranslator';
import { deleteTranslator } from '@/requests/backend/translators/deleteTranslator';
import { getTranslators } from '@/requests/backend/translators/getTranslators';
import { updateTranslator } from '@/requests/backend/translators/updateTranslator';

import { OptionsModalsContext } from '../../OptionsPage';

import { Editor, EditorEntry } from '../Editor/Editor';

const styles = stylex.create({
	root: {
		maxWidth: '37.5rem',
		minWidth: {
			default: 'auto',
			'@media (width >= 600px)': '25rem',
		},
	},
	entry: {
		display: 'flex',
		flexFlow: 'row',
		lineHeight: '2em',
	},
	entryName: {
		width: '100%',
		padding: '0 0.3rem',
		whiteSpace: 'nowrap',
		textOverflow: 'ellipsis',
		overflow: 'hidden',
	},
});

export const TranslatorsManager: FC<{
	visible: boolean;
	onClose: () => void;
	updateConfig: () => void;
}> = ({ visible, onClose, updateConfig }) => {
	const scope = useContext(OptionsModalsContext);

	// Initializing
	const [isLoading, setIsLoading] = useState(true);
	const [translators, setTranslators] = useState<CustomTranslator[]>([]);

	const updateTranslatorsList = useCallback(async () => {
		updateConfig();

		await getTranslators().then(setTranslators);
	}, [updateConfig]);

	useEffect(() => {
		updateTranslatorsList().then(() => {
			setIsLoading(false);
		});
	}, [updateTranslatorsList]);

	// Editor
	const [editorError, setEditorError] = useState<string | null>(null);
	const [isEditorOpened, setIsEditorOpened] = useState(false);

	const [editedTranslator, setEditedTranslator] = useState<CustomTranslator | null>(
		null,
	);

	const addNewTranslator = useCallback(() => {
		setEditedTranslator(null);
		setIsEditorOpened(true);
	}, []);

	const editTranslator = useCallback((translator: CustomTranslator) => {
		setEditedTranslator(translator);
		setIsEditorOpened(true);
	}, []);

	const closeEditor = useCallback(() => {
		setEditorError(null);
		setEditedTranslator(null);
		setIsEditorOpened(false);
	}, []);

	const deleteTranslatorWithConfirmation = useCallback(
		(translator: CustomTranslator) => {
			const isConfirmed = confirm(
				getMessage(
					'translatorsManagerWindow_message_translatorRemovingConfirmation',
					[translator.name],
				),
			);

			if (!isConfirmed) return;

			deleteTranslator(translator.id).then(() => {
				updateTranslatorsList();
			});
		},
		[updateTranslatorsList],
	);

	const onSave = useCallback(
		async (translator: EditorEntry) => {
			const { name, code } = translator;

			setEditorError(null);
			try {
				if (editedTranslator === null) {
					await addTranslator({ name, code });
				} else {
					await updateTranslator({
						id: editedTranslator.id,
						translator: { name, code },
					});
				}
			} catch (error) {
				if (error instanceof Error) {
					setEditorError(error.message);
					console.error(error);
				}

				return;
			}

			await updateTranslatorsList();
			closeEditor();
		},
		[closeEditor, editedTranslator, updateTranslatorsList],
	);

	return (
		<Modal visible={visible} onClose={onClose} scope={scope} preventBodyScroll>
			{isLoading ? (
				<Spinner />
			) : (
				<div {...stylex.props(styles.root)}>
					<ModalLayout
						title={getMessage('translatorsManagerWindow_title')}
						footer={[
							<Button key="add" view="action" onPress={addNewTranslator}>
								{getMessage('translatorsManagerWindow_add')}
							</Button>,
							<Button key="close" onPress={onClose}>
								{getMessage('translatorsManagerWindow_close')}
							</Button>,
						]}
					>
						<VStack gap={2}>
							{translators.map((translatorInfo) => {
								const { id, name } = translatorInfo;

								return (
									<div {...stylex.props(styles.entry)} key={id}>
										<span {...stylex.props(styles.entryName)}>
											{name}
										</span>

										<HStack gap={2}>
											<Button
												onPress={() => {
													editTranslator(translatorInfo);
												}}
											>
												{getMessage(
													'translatorsManagerWindow_translator_edit',
												)}
											</Button>
											<Button
												onPress={() => {
													deleteTranslatorWithConfirmation(
														translatorInfo,
													);
												}}
												title={getMessage(
													'translatorsManagerWindow_translator_delete',
												)}
											>
												<IconTrash />
											</Button>
										</HStack>
									</div>
								);
							})}
						</VStack>

						{translators.length !== 0
							? undefined
							: getMessage(
									'translatorsManagerWindow_emptyTranslatorsListText',
								)}
					</ModalLayout>
				</div>
			)}

			{isEditorOpened && (
				<Editor
					data={editedTranslator}
					onClose={closeEditor}
					onSave={onSave}
					error={editorError}
				/>
			)}
		</Modal>
	);
};
