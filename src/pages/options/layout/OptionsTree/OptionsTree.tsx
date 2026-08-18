import { FC, ReactNode, useCallback } from 'react';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Selector } from '@astryxdesign/core/Selector';
import { VStack } from '@astryxdesign/core/Stack';
import * as stylex from '@stylexjs/stylex';

import { Hotkey } from '@/components/controls/Hotkey';
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { Textarea } from '@/components/primitives/Textarea/Textarea.bundle/desktop';
import { Textinput } from '@/components/primitives/Textinput/Textinput.bundle/desktop';
import { getValueAtPath, isDeepEqual } from '@/lib/utils';
import { AppConfigType } from '@/types/runtime';

import { OptionSection } from '../OptionSection/OptionSection';
import { optionsPageStyles } from '../OptionsPage.stylex';
import { PageSection } from '../PageSection/PageSection';

export interface OptionSelectList {
  type: 'SelectList';
  options: {
    id: string;
    content: string;
  }[];
}

export interface OptionInputNumber {
  type: 'InputNumber';
}

export interface OptionInputMultilineFromArray {
  type: 'InputMultilineFromArray';
}

export interface OptionCheckbox {
  type: 'Checkbox';
  reverse?: boolean;
  text?: string;
}

export interface OptionCheckboxGroup {
  type: 'CheckboxGroup';
  valueMap: string[];
  options: OptionCheckbox[];
}

export interface OptionButton {
  type: 'Button';
  text: string;
  view?: 'default' | 'action';
  disabled?: boolean;
  action: () => void;
}

export interface OptionHotkey {
  type: 'Hotkey';
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type OptionValue = boolean | null | number | string | string[] | undefined;
const getOptionValue = (config: AppConfigType, path: string): OptionValue => {
  const value = getValueAtPath(config, path);
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  ) {
    return value;
  }

  throw new TypeError(`Invalid option value at "${path}"`);
};

export interface OptionItem {
  title?: string;
  description?: ReactNode;
  /**
   * Path to option property in object
   */
  path?: string;
  optionContent:
    | OptionSelectList
    | OptionInputNumber
    | OptionInputMultilineFromArray
    | OptionCheckbox
    | OptionCheckboxGroup
    | OptionButton
    | OptionHotkey;
}

export interface OptionsGroup {
  title: string;
  titleSize?: HeadingLevel;
  groupContent: (OptionsGroup | OptionItem | undefined)[];
}

interface OptionsTreeProps {
  tree: OptionsGroup[];
  config: AppConfigType;
  modifiedConfig: null | Record<string, OptionValue>;
  errors?: Record<string, string>;
  setOptionValue: (name: string, value: OptionValue) => void;
}

const normalizeHeadingLevel = (level: number): HeadingLevel => {
  if (level <= 1) return 1;
  if (level === 2) return 2;
  if (level === 3) return 3;
  if (level === 4) return 4;
  if (level === 5) return 5;
  return 6;
};

export const OptionsTree: FC<OptionsTreeProps> = ({
  tree,
  config,
  modifiedConfig,
  errors = {},
  setOptionValue,
}) => {
  const setOptionValueProxy = useCallback(
    (name: string | undefined, value: OptionValue) => {
      if (name === undefined) return;
      setOptionValue(name, value);
    },
    [setOptionValue],
  );

  const renderOption = useCallback(
    (
      { title, path, optionContent: option }: OptionItem,
      value: OptionValue,
      error?: string,
    ) => {
      switch (option.type) {
        case 'Checkbox': {
          const reverse = option.reverse ?? false;
          const checked = value === undefined ? undefined : reverse != !!value;
          const label = option.text || title || path || 'Option';
          return (
            <CheckboxInput
              label={label}
              isLabelHidden={!option.text}
              className={stylex.props(optionsPageStyles.checkbox).className}
              value={checked ?? false}
              onChange={(checked) => {
                setOptionValueProxy(path, reverse != checked);
              }}
            />
          );
        }
        case 'Hotkey': {
          const hotkeyValue = typeof value === 'string' || value === null ? value : null;
          return (
            <Hotkey
              value={hotkeyValue}
              onChange={(value) => {
                setOptionValueProxy(path, value);
              }}
            />
          );
        }
        case 'CheckboxGroup': {
          if (!Array.isArray(value)) {
            throw new TypeError('value is not array');
          }

          return (
            <div {...stylex.props(optionsPageStyles.indentHorizontal)}>
              {option.options.map((checkbox, index) => {
                const optionName = option.valueMap[index];
                const valueIndex = value.indexOf(optionName);
                const isExistValue = valueIndex !== -1;
                const checked = (checkbox.reverse ?? false) !== isExistValue;
                return (
                  <CheckboxInput
                    key={index}
                    label={checkbox.text || `${title ?? path ?? 'Option'} ${index + 1}`}
                    isLabelHidden={!checkbox.text}
                    className={stylex.props(optionsPageStyles.checkbox).className}
                    value={checked}
                    onChange={(checked) => {
                      setOptionValueProxy(
                        path,
                        value
                          .filter((val) => val !== optionName)
                          .concat(
                            (checkbox.reverse ?? false) !== checked ? [optionName] : [],
                          ),
                      );
                    }}
                  />
                );
              })}
            </div>
          );
        }
        case 'Button':
          return (
            <Button
              view={option.view ?? 'default'}
              onPress={option.action}
              disabled={option.disabled}
            >
              {option.text}
            </Button>
          );
        case 'InputMultilineFromArray':
          return (
            <Textarea
              autoResize
              label={title ?? path ?? 'Option value'}
              isLabelHidden
              xstyle={optionsPageStyles.textarea}
              status={error !== undefined ? { type: 'error', message: error } : undefined}
              value={Array.isArray(value) ? value.join('\n') : undefined}
              spellCheck={false}
              onInputText={(value) => {
                const parsedArray = value.split('\n');
                setOptionValueProxy(
                  path,
                  parsedArray.length === 1 && parsedArray[0] === '' ? [] : parsedArray,
                );
              }}
            />
          );
        case 'InputNumber': {
          const inputValue =
            typeof value === 'string' || typeof value === 'number' ? value : undefined;
          return (
            <Textinput
              label={title ?? path ?? 'Option value'}
              isLabelHidden
              status={error !== undefined ? { type: 'error', message: error } : undefined}
              value={inputValue}
              spellCheck={false}
              onInputText={(value) => {
                const parsedNumber = +value;
                setOptionValueProxy(path, isNaN(parsedNumber) ? value : parsedNumber);
              }}
            />
          );
        }
        case 'SelectList': {
          const selectValue =
            typeof value === 'string'
              ? value
              : Array.isArray(value)
                ? value[0]
                : undefined;
          return (
            <Selector
              label={title ?? path ?? 'Option value'}
              isLabelHidden
              options={option.options.map(({ id, content }) => ({
                value: id,
                label: content,
              }))}
              value={selectValue}
              onChange={(newValue) => {
                setOptionValueProxy(path, newValue);
              }}
            />
          );
        }
      }
    },
    [setOptionValueProxy],
  );

  const renderTree = useCallback(
    (tree: OptionsGroup['groupContent'], globalLevel = 1) => {
      const modifiedConfigStorage: Readonly<Record<string, OptionValue>> =
        modifiedConfig ?? {};

      return tree.map((item, index) => {
        if (item === undefined) return undefined;

        if ('optionContent' in item) {
          const { title, description, path } = item;

          let configValue: OptionValue;
          let changed = false;

          if (path !== undefined) {
            if (path in modifiedConfigStorage) {
              configValue = modifiedConfigStorage[path];
              if (!isDeepEqual(configValue, getOptionValue(config, path))) {
                changed = true;
              }
            } else {
              configValue = getOptionValue(config, path);
            }
          }

          const error = path !== undefined && path in errors ? errors[path] : undefined;
          return (
            <OptionSection {...{ title, description, changed, error }} key={index}>
              {renderOption(item, configValue, error)}
            </OptionSection>
          );
        } else {
          const localLevel = item.titleSize ?? normalizeHeadingLevel(globalLevel);

          return (
            <PageSection title={item.title} level={localLevel} key={index}>
              <div
                {...stylex.props(
                  globalLevel > 2
                    ? optionsPageStyles.indentVertical
                    : optionsPageStyles.subgroups,
                )}
              >
                {renderTree(
                  item.groupContent,
                  item.title !== undefined ? localLevel + 1 : localLevel,
                )}
              </div>
            </PageSection>
          );
        }
      });
    },
    [config, errors, modifiedConfig, renderOption],
  );

  return (
    <VStack gap={0} xstyle={optionsPageStyles.mainGroups}>
      {renderTree(tree, 2)}
    </VStack>
  );
};
