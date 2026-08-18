import { getLanguageCodesISO639 } from 'anylang/languages';
import Papa from 'papaparse';
import { FC, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import * as stylex from '@stylexjs/stylex';
import { IconTrash } from '@tabler/icons-react';

import { Page } from '@/components/layouts/Page/Page';
import { TranslationCard } from '@/components/layouts/TranslationCard/TranslationCard';
import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
import { Textinput } from '@/components/primitives/Textinput/Textinput.bundle/desktop';
import { isMobileBrowser } from '@/lib/browser';
import { saveFile } from '@/lib/files';
import { useConcurrentTTS } from '@/lib/hooks/useConcurrentTTS';
import { useImmutableCallback } from '@/lib/hooks/useImmutableCallback';
import { getLanguageNameByCode, getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { isTextsContainsSubstring } from '@/lib/utils';
import { clearTranslations } from '@/requests/backend/translations/clearTranslations';
import { ITranslationEntryWithKey } from '@/requests/backend/translations/data';
import { deleteTranslation } from '@/requests/backend/translations/deleteTranslation';
import { getTranslations } from '@/requests/backend/translations/getTranslations';
import { ITranslation } from '@/types/translation/Translation';

import { OptionsPanel } from './OptionsPanel/OptionsPanel';

const styles = stylex.create({
  root: {
    padding:
      'var(--typography-layout-indent-l-all) var(--typography-layout-indent-m-all)',
  },
  description: {
    borderRadius: 'var(--typography-controls-border-radius)',
    color: 'var(--color-typo-secondary)',
  },
  searchControl: {
    width: '100%',
  },
  notFoundMessage: {
    display: 'table',
    boxSizing: 'border-box',
    width: '100%',
    minHeight: '7.5rem',
    padding: 'var(--typography-controls-indent-l)',
    borderRadius: 'var(--typography-controls-border-radius)',
    fontSize: '1.5rem',
    background: 'var(--color-background-muted)',
    color: 'var(--color-typo-secondary)',
  },
  notFoundMessageContent: {
    display: 'table-cell',
    width: '100%',
    maxWidth: '100%',
    height: '100%',
    textAlign: 'center',
    verticalAlign: 'middle',
    overflowWrap: 'anywhere',
  },
});

const langCodes = getLanguageCodesISO639('v1');

// TODO: implement as option
export interface IDictionaryPageProps {
  confirmDelete?: boolean;
}

// TODO: improve styles

// Future
// TODO: listen updates and refresh data
// TODO: implement pagination

// Features
// TODO: implement edit entries
// TODO: add tab with translate history

/**
 * Represent favorite translates and translate history
 */
export const DictionaryPage: FC<IDictionaryPageProps> = ({ confirmDelete = true }) => {
  useLayoutEffect(() => {
    telemetry.track(TELEMETRY_EVENT_NAME.SCREEN_SHOWN, { screen: 'Dictionary' });
  }, []);

  const showToast = useToast();

  const [entries, setEntries] = useState<ITranslationEntryWithKey[] | null>(null);

  const updateData = useCallback(
    () =>
      getTranslations().then((entries) => {
        setEntries(entries);
      }),
    [],
  );

  // Init data
  useEffect(() => {
    updateData();

    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  //
  // Hooks
  //

  const remove = useImmutableCallback(
    async (idx: number) => {
      if (entries === null) return;

      const entry = entries[idx];
      if (entry === undefined) return;

      const translation = entry.data.translation;

      if (
        confirmDelete &&
        !confirm(
          getMessage('dictionary_deleteConfirmation') +
            '\n\n---\n\n' +
            translation.originalText +
            '\n\n---\n\n' +
            translation.translatedText,
        )
      )
        return;

      await deleteTranslation(entry.key);

      setEntries((state) => {
        if (state !== entries || state === null) return state;

        // Remove from entry from state
        return state.filter((_, itemIdx) => itemIdx !== idx);
      });
    },
    [confirmDelete, entries],
  );

  const exportDictionary = useCallback(() => {
    const fields: (keyof ITranslation)[] = [
      'from',
      'to',
      'originalText',
      'translatedText',
    ];
    const rows = (entries || []).map((entry) => {
      const translation = entry.data.translation;
      return fields.map((key) => translation[key]);
    });

    const csv = Papa.unparse([fields, ...rows]);

    const date = new Date().toLocaleDateString();
    saveFile(new Blob([csv], { type: 'text/csv' }), `linguist_dictionary-${date}.csv`);
  }, [entries]);

  const removeAll = useCallback(() => {
    if (!confirm(getMessage('dictionary_deleteAll'))) return;

    clearTranslations()
      .then(() => {
        setEntries(null);
        updateData();
        showToast({ body: getMessage('dictionary_message_deleteAll_success') });
      })
      .catch(() => {
        showToast({ body: getMessage('message_unknownError'), type: 'error' });
      });
  }, [showToast, updateData]);

  //
  // TTS
  //

  const { toggleTTS, ttsPlayer, ttsState } = useConcurrentTTS();

  // Stop TTS by change entries
  useEffect(() => {
    const currentPlayedTTS = ttsState.current ? ttsState.current.id : null;

    // Stop for empty entries or when current played entry removed
    if (
      entries === null ||
      (currentPlayedTTS && !entries.find(({ key }) => key === currentPlayedTTS))
    ) {
      ttsPlayer.stop();
    }
  }, [entries, ttsPlayer, ttsState]);

  //
  // Render
  //

  const isMobile = useMemo(() => isMobileBrowser(), []);

  const [search, setSearch] = useState<string>('');
  const [from, setFrom] = useState<string | string[] | undefined>('any');
  const [to, setTo] = useState<string | string[] | undefined>('any');

  const resetFilters = useCallback(() => {
    setFrom('any');
    setTo('any');
    setSearch('');
  }, []);

  const renderedEntries = useMemo(() => {
    if (entries === null) return;

    // Empty content
    if (entries.length === 0)
      return (
        <div {...stylex.props(styles.notFoundMessage)}>
          <div {...stylex.props(styles.notFoundMessageContent)}>
            {getMessage('dictionary_emptyDictionary')}
          </div>
        </div>
      );

    // Filter entries if need
    // TODO: optimize it. Filtrate it on backend, debounce search input handling
    const fromIsEmpty = from === undefined || from === 'any';
    const toIsEmpty = to === undefined || to === 'any';
    const filteredEntries =
      fromIsEmpty && toIsEmpty && search.length === 0
        ? entries
        : entries.filter((entry) => {
            const translation = entry.data.translation;

            if (!fromIsEmpty && translation.from !== from) return false;
            if (!toIsEmpty && translation.to !== to) return false;

            // Match text
            if (search.length !== 0) {
              const isTextsMatchSearch = isTextsContainsSubstring(
                search,
                [translation.originalText, translation.translatedText],
                true,
              );
              return isTextsMatchSearch;
            }

            return true;
          });

    // Empty content
    if (filteredEntries.length === 0)
      return (
        <div {...stylex.props(styles.notFoundMessage)}>
          <div {...stylex.props(styles.notFoundMessageContent)}>
            {getMessage('dictionary_notFoundEntries') + ' '}
            <Button view="action" onPress={resetFilters}>
              {getMessage('dictionary_resetFilters')}
            </Button>
          </div>
        </div>
      );

    // Render entries
    return filteredEntries.map(({ data, key }, idx) => {
      const { timestamp, translation } = data;
      return (
        <TranslationCard
          key={key}
          translation={translation}
          timestamp={timestamp}
          onPressTTS={(target) => {
            if (target === 'original') {
              toggleTTS(key, translation.from, translation.originalText);
            } else {
              toggleTTS(key, translation.to, translation.translatedText);
            }
          }}
          controlPanelSlot={
            <Button
              view="clear"
              size="s"
              onPress={() => remove(idx)}
              title={getMessage('common_action_removeFromDictionary')}
              content="icon"
            >
              <IconTrash />
            </Button>
          }
        />
      );
    });
  }, [entries, from, to, search, resetFilters, remove, toggleTTS]);

  const langsListFrom = useMemo(
    () => [
      { value: 'any', label: getMessage('lang_select') },
      { value: 'auto', label: getMessage('lang_detect') },
      ...langCodes.map((langCode) => ({
        value: langCode,
        label: getLanguageNameByCode(langCode),
      })),
    ],
    [],
  );

  const langsListTo = useMemo(
    () => [
      { value: 'any', label: getMessage('lang_select') },
      ...langCodes.map((langCode) => ({
        value: langCode,
        label: getLanguageNameByCode(langCode),
      })),
    ],
    [],
  );

  return (
    <Page loading={entries === null}>
      <div {...stylex.props(styles.root)}>
        <VStack gap={5}>
          <div {...stylex.props(styles.description)}>
            {getMessage('dictionary_description')}
          </div>

          <VStack gap={3}>
            <Textinput
              placeholder={getMessage('dictionary_searchPlaceholder')}
              value={search}
              onInputText={setSearch}
              xstyle={styles.searchControl}
              onClearClick={() => {
                setSearch('');
              }}
              hasClear
            />

            <OptionsPanel
              view={isMobile ? 'mobile' : 'full'}
              options={[
                {
                  title: getMessage('dictionary_filter_from'),
                  content: (
                    <Selector
                      label={getMessage('dictionary_filter_from')}
                      isLabelHidden
                      options={langsListFrom}
                      value={typeof from === 'string' ? from : undefined}
                      onChange={setFrom}
                    />
                  ),
                },
                {
                  title: getMessage('dictionary_filter_to'),
                  content: (
                    <Selector
                      label={getMessage('dictionary_filter_to')}
                      isLabelHidden
                      options={langsListTo}
                      value={typeof to === 'string' ? to : undefined}
                      onChange={setTo}
                    />
                  ),
                },
              ]}
            />
          </VStack>

          <VStack gap={3}>
            <HStack gap={2}>
              {!isMobile && (
                <Button view="default" onPress={exportDictionary}>
                  {getMessage('dictionary_button_export')}
                </Button>
              )}
              <Button view="default" onPress={removeAll}>
                {getMessage('dictionary_button_removeAll')}
              </Button>
            </HStack>

            <div>{renderedEntries}</div>
          </VStack>
        </VStack>
      </div>
    </Page>
  );
};
