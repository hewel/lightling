import { FC, useContext, useEffect, useState } from 'react';
import * as stylex from '@stylexjs/stylex';

import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { IModalProps, Modal } from '@/components/primitives/Modal/Modal.bundle/desktop';
import { Textarea } from '@/components/primitives/Textarea/Textarea.bundle/desktop';
import { Textinput } from '@/components/primitives/Textinput/Textinput.bundle/desktop';
import { useImmutableCallback } from '@/lib/hooks/useImmutableCallback';
import { getMessage } from '@/lib/language';

import { OptionsModalsContext } from '../../OptionsPage';

const styles = stylex.create({
  modalContent: {
    display: 'flex',
    minHeight: 'calc(100vh - var(--modal-size-m-content-indent) * 2)',
    boxSizing: 'border-box',
    padding: '1rem',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: {
      default: '56.25rem',
      '@media (width <= 950px)': '95vw',
    },
    gap: '0.5rem',
    minHeight: '18.75rem',
  },
  controls: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'right',
  },
  editorContainer: {
    display: 'flex',
    flexGrow: 5,
  },
  editor: {
    flexGrow: 1,
    fontFamily: 'var(--font-family-code)',
  },
  error: {
    borderRadius: 'var(--typography-layout-border-radius)',
    padding: '0.6rem',
    background: 'var(--color-error)',
    color: 'var(--color-on-error)',
  },
});

export type EditorEntry = {
  readonly name: string;
  readonly code: string;
};

interface EditorProps extends Pick<IModalProps, 'onClose'> {
  /**
   * When property is not `null`, will used values from object, otherwise empty values
   */
  data: EditorEntry | null;
  /**
   * Call when user save changes
   * Provide new object with changes
   */
  onSave: (value: EditorEntry) => void;
  error: null | string;
}

export const Editor: FC<EditorProps> = ({ data, onClose, onSave, error }) => {
  const scope = useContext(OptionsModalsContext);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Local error are reset while update outer error
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    setLocalError(null);
  }, [error]);

  // Init
  useEffect(() => {
    if (data === null) return;
    setName(data.name);
    setCode(data.code);
  }, [data]);

  const onSavePress = useImmutableCallback(() => {
    if (name.trim().length < 1) {
      setLocalError(getMessage('editorWindow_message_invalidTitle'));
      return;
    }

    onSave({
      name,
      code,
    });
  }, [code, name, onSave]);

  const actualError = localError || error;

  return (
    <Modal
      contentXstyle={styles.modalContent}
      visible={true}
      onClose={onClose}
      scope={scope}
      preventBodyScroll
    >
      <div {...stylex.props(styles.container)}>
        <div>
          <Textinput
            value={name}
            onInputText={setName}
            placeholder={getMessage('editorWindow_data_title')}
            width="100%"
          />
        </div>

        <div {...stylex.props(styles.editorContainer)}>
          <Textarea
            label={getMessage('editorWindow_data_title')}
            isLabelHidden
            value={code}
            onInputText={setCode}
            spellCheck={false}
            rows={20}
            width="100%"
            controlProps={{ fieldXstyle: styles.editor }}
          />
        </div>

        {actualError && <div {...stylex.props(styles.error)}>{actualError}</div>}

        <div {...stylex.props(styles.controls)}>
          <Button key="save" view="action" onPress={onSavePress}>
            {getMessage('editorWindow_save')}
          </Button>
          <Button key="close" onPress={(event) => onClose?.(event.nativeEvent, 'click')}>
            {getMessage('editorWindow_close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
