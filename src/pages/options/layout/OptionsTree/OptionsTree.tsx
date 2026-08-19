import { type FC, type ReactNode, useCallback, useId } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import * as stylex from '@stylexjs/stylex';

import { Hotkey } from '@/components/controls/Hotkey';
import { Textarea } from '@/components/primitives/Textarea/Textarea.bundle/desktop';
import { Textinput } from '@/components/primitives/Textinput/Textinput.bundle/desktop';
import { getValueAtPath } from '@/lib/utils';
import { AppConfigType } from '@/types/runtime';

import { LLMProfilesFieldList } from '../OptionsPage.components/LLMProfilesFieldList/LLMProfilesFieldList';
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

export interface OptionInputText {
  type: 'InputText';
  isSecret?: boolean;
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

export interface OptionLLMProfiles {
  type: 'LLMProfiles';
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type OptionValue =
  | boolean
  | null
  | number
  | string
  | string[]
  | AppConfigType['llmTranslator']
  | undefined;
const getOptionValue = (config: AppConfigType, path: string): OptionValue => {
  if (path === 'llmTranslator') return config.llmTranslator;

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
    | OptionInputText
    | OptionInputMultilineFromArray
    | OptionCheckbox
    | OptionCheckboxGroup
    | OptionButton
    | OptionHotkey
    | OptionLLMProfiles;
}

export interface OptionsGroup {
  id?: string;
  title: string;
  titleSize?: HeadingLevel;
  fieldSpacing?: 'default' | 'relaxed';
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

interface OptionFieldProps {
  item: OptionItem;
  value: OptionValue;
  error?: string;
  setOptionValue: (name: string | undefined, value: OptionValue) => void;
}

const renderWithRichDescription = (
  field: ReactNode,
  description: ReactNode | undefined,
  descriptionID: string,
) =>
  description === undefined || typeof description === 'string' ? (
    field
  ) : (
    <VStack gap={2}>
      {field}
      <Text
        id={descriptionID}
        type="supporting"
        xstyle={optionsPageStyles.optionDescription}
      >
        {description}
      </Text>
    </VStack>
  );

const OptionField: FC<OptionFieldProps> = ({ item, value, error, setOptionValue }) => {
  const { title, description, path, optionContent: option } = item;
  const controlID = useId();
  const labelID = `${controlID}-label`;
  const descriptionID = `${controlID}-description`;
  const statusID = `${controlID}-status`;
  const richDescriptionID = `${controlID}-rich-description`;
  const label =
    title ??
    (option.type === 'Checkbox' || option.type === 'Button' ? option.text : undefined) ??
    path ??
    'Option';
  const stringDescription = typeof description === 'string' ? description : undefined;
  const status =
    error === undefined ? undefined : { type: 'error' as const, message: error };
  const describedBy =
    [
      stringDescription === undefined ? undefined : descriptionID,
      status === undefined ? undefined : statusID,
      description === undefined || typeof description === 'string'
        ? undefined
        : richDescriptionID,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  switch (option.type) {
    case 'LLMProfiles': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('LLM translator config is not an object');
      }

      return (
        <LLMProfilesFieldList
          label={label}
          description={description}
          value={value}
          error={error}
          onChange={(value) => {
            setOptionValue(path, value);
          }}
        />
      );
    }
    case 'Checkbox': {
      const reverse = option.reverse ?? false;
      const checked = value === undefined ? undefined : reverse != !!value;
      return renderWithRichDescription(
        <CheckboxInput
          label={label}
          description={stringDescription}
          className={stylex.props(optionsPageStyles.checkbox).className}
          status={status}
          value={checked ?? false}
          width="100%"
          onChange={(checked) => {
            setOptionValue(path, reverse != checked);
          }}
        />,
        description,
        richDescriptionID,
      );
    }
    case 'Hotkey': {
      const hotkeyValue = typeof value === 'string' || value === null ? value : null;
      return renderWithRichDescription(
        <Hotkey
          label={label}
          description={stringDescription}
          status={status}
          value={hotkeyValue}
          onChange={(value) => {
            setOptionValue(path, value);
          }}
        />,
        description,
        richDescriptionID,
      );
    }
    case 'CheckboxGroup': {
      if (!Array.isArray(value)) {
        throw new TypeError('value is not array');
      }

      return renderWithRichDescription(
        <Field
          label={label}
          inputID={controlID}
          labelID={labelID}
          isGroupLabel
          description={stringDescription}
          descriptionID={descriptionID}
          status={status === undefined ? undefined : { ...status, messageID: statusID }}
          statusVariant="detached"
          width="100%"
        >
          <HStack
            id={controlID}
            role="group"
            aria-labelledby={labelID}
            aria-describedby={describedBy}
            gap={3}
          >
            {option.options.map((checkbox, index) => {
              const optionName = option.valueMap[index];
              const checked = (checkbox.reverse ?? false) !== value.includes(optionName);
              return (
                <CheckboxInput
                  key={optionName}
                  label={checkbox.text || `${label} ${index + 1}`}
                  className={stylex.props(optionsPageStyles.checkbox).className}
                  value={checked}
                  onChange={(checked) => {
                    setOptionValue(
                      path,
                      value
                        .filter((currentValue) => currentValue !== optionName)
                        .concat(
                          (checkbox.reverse ?? false) !== checked ? [optionName] : [],
                        ),
                    );
                  }}
                />
              );
            })}
          </HStack>
        </Field>,
        description,
        richDescriptionID,
      );
    }
    case 'Button': {
      return renderWithRichDescription(
        <Field
          label={label}
          inputID={controlID}
          description={stringDescription}
          descriptionID={descriptionID}
          status={status === undefined ? undefined : { ...status, messageID: statusID }}
          statusVariant="detached"
          width="100%"
        >
          <Button
            id={controlID}
            label={option.text}
            variant={option.view === 'action' ? 'primary' : 'secondary'}
            isDisabled={option.disabled}
            aria-describedby={describedBy}
            onClick={option.action}
          />
        </Field>,
        description,
        richDescriptionID,
      );
    }
    case 'InputMultilineFromArray':
      return renderWithRichDescription(
        <Textarea
          autoResize
          label={label}
          description={stringDescription}
          xstyle={optionsPageStyles.textarea}
          status={status}
          value={Array.isArray(value) ? value.join('\n') : undefined}
          width="100%"
          spellCheck={false}
          onInputText={(value) => {
            const parsedArray = value.split('\n');
            setOptionValue(
              path,
              parsedArray.length === 1 && parsedArray[0] === '' ? [] : parsedArray,
            );
          }}
        />,
        description,
        richDescriptionID,
      );
    case 'InputNumber': {
      const inputValue =
        typeof value === 'string' || typeof value === 'number' ? value : undefined;
      return renderWithRichDescription(
        <Textinput
          label={label}
          description={stringDescription}
          status={status}
          value={inputValue}
          width="100%"
          spellCheck={false}
          onInputText={(value) => {
            const parsedNumber = +value;
            setOptionValue(path, isNaN(parsedNumber) ? value : parsedNumber);
          }}
        />,
        description,
        richDescriptionID,
      );
    }
    case 'InputText': {
      const inputValue = typeof value === 'string' ? value : undefined;
      return renderWithRichDescription(
        <Textinput
          label={label}
          description={stringDescription}
          type={option.isSecret === true ? 'password' : undefined}
          status={status}
          value={inputValue}
          width="100%"
          spellCheck={false}
          onInputText={(value) => {
            setOptionValue(path, value);
          }}
        />,
        description,
        richDescriptionID,
      );
    }
    case 'SelectList': {
      const selectValue =
        typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
      return renderWithRichDescription(
        <Selector
          label={label}
          description={stringDescription}
          status={status}
          options={option.options.map(({ id, content }) => ({
            value: id,
            label: content,
          }))}
          value={selectValue}
          width="100%"
          onChange={(newValue) => {
            setOptionValue(path, newValue);
          }}
        />,
        description,
        richDescriptionID,
      );
    }
  }
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

  const renderTree = useCallback(
    (tree: OptionsGroup['groupContent'], globalLevel = 1) => {
      const modifiedConfigStorage: Readonly<Record<string, OptionValue>> =
        modifiedConfig ?? {};

      return tree.map((item, index) => {
        if (item === undefined) return undefined;

        if ('optionContent' in item) {
          const { path } = item;
          let configValue: OptionValue;

          if (path !== undefined) {
            configValue =
              path in modifiedConfigStorage
                ? modifiedConfigStorage[path]
                : getOptionValue(config, path);
          }

          const error = path !== undefined && path in errors ? errors[path] : undefined;
          return (
            <OptionField
              item={item}
              value={configValue}
              error={error}
              setOptionValue={setOptionValueProxy}
              key={path ?? `${globalLevel}-${index}`}
            />
          );
        }

        const localLevel = item.titleSize ?? normalizeHeadingLevel(globalLevel);
        return (
          <PageSection id={item.id} title={item.title} level={localLevel} key={index}>
            <VStack
              gap={0}
              xstyle={[
                globalLevel > 2
                  ? optionsPageStyles.indentVertical
                  : optionsPageStyles.subgroups,
                item.fieldSpacing === 'relaxed' && optionsPageStyles.relaxedFieldSpacing,
              ]}
            >
              {renderTree(
                item.groupContent,
                item.title !== undefined ? localLevel + 1 : localLevel,
              )}
            </VStack>
          </PageSection>
        );
      });
    },
    [config, errors, modifiedConfig, setOptionValueProxy],
  );

  return (
    <VStack gap={0} xstyle={optionsPageStyles.mainGroups}>
      {renderTree(tree, 2)}
    </VStack>
  );
};
