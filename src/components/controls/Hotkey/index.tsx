import { type FC, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Stack';
import { TextInput, type TextInputStatus } from '@astryxdesign/core/TextInput';

import { getMessage } from '@/lib/language';

import { getUnifiedKeyName } from './utils';

export type HotkeyProps = {
  label: string;
  description?: string;
  status?: TextInputStatus;
  value: string | null;
  onChange: (value: string | null) => void;
};

export const Hotkey: FC<HotkeyProps> = ({
  label,
  description,
  status,
  value,
  onChange,
}) => {
  const [isFocus, setIsFocus] = useState(false);

  useEffect(() => {
    if (!isFocus) return;

    let pressedKeys: Record<string, boolean> = {};

    const onKeyDown = (evt: KeyboardEvent) => {
      const keyName = getUnifiedKeyName(evt.code);
      if (keyName === null) return;

      // Do not record tab key, to keep keyboard navigation works
      if (keyName === 'Tab') {
        pressedKeys = {};
        return;
      }

      evt.preventDefault();
      pressedKeys[keyName] = true;
    };

    const onKeyUp = (evt: KeyboardEvent) => {
      const keyName = getUnifiedKeyName(evt.code);
      if (keyName === null) return;

      // Reset keys
      if (keyName === 'Escape' && Object.values(pressedKeys).length === 1) {
        pressedKeys = {};
        onChange(null);
        return;
      }

      evt.preventDefault();

      // Change state for recorded keys, but do not insert new keys
      if (pressedKeys[keyName]) {
        pressedKeys[keyName] = false;
      }

      // Update hotkeys
      const pressedKeysValues = Object.values(pressedKeys);
      if (
        pressedKeysValues.length > 0 &&
        pressedKeysValues.every((isPressed) => !isPressed)
      ) {
        const keys = Object.keys(pressedKeys);

        const modifierKey = keys.find((key) => key.length > 1);
        if (!modifierKey) {
          pressedKeys = {};
          onChange(null);
          return;
        }

        // Write keys
        const serializedKeys = keys.sort((a, b) => b.length - a.length).join('+');

        pressedKeys = {};
        onChange(serializedKeys);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [isFocus, onChange]);

  return (
    <HStack gap={2} align="end">
      <TextInput
        label={label}
        description={description}
        status={status}
        isReadOnly
        onFocus={() => {
          setIsFocus(true);
        }}
        onBlur={() => {
          setIsFocus(false);
        }}
        value={value ?? ''}
        placeholder={
          isFocus
            ? getMessage('component_hotkey_recordPlaceholder')
            : getMessage('component_hotkey_placeholder')
        }
      />
      <Button
        label={getMessage('component_hotkey_resetButton')}
        onClick={() => {
          onChange(null);
        }}
      />
    </HStack>
  );
};
