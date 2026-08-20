import { type FC, useCallback, useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';

import { Button } from '@/components/primitives/Button/Button.bundle/universal';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { getMessage, getUserLanguage } from '@/lib/language';
import { TranslationStats } from '@/requests/backend/translationStats/data';
import { getTranslationStats } from '@/requests/backend/translationStats/getTranslationStats';
import { resetTranslationStats } from '@/requests/backend/translationStats/resetTranslationStats';

const statsStorageKey = 'TranslationStatsStorage';

/**
 * Cumulative usage statistics: translations count and LLM token consumption.
 * Reloads on every stats storage write, so values update live while translating
 */
export const StatisticsField: FC = () => {
  const [stats, setStats] = useState<TranslationStats | null>(null);
  const confirm = useConfirm();

  const refetch = useCallback(() => {
    getTranslationStats()
      .then(setStats)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refetch();

    const onStorageChanged = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName === 'local' && statsStorageKey in changes) refetch();
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => {
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [refetch]);

  if (stats === null) return <VStack gap={2} width="100%" />;

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(getUserLanguage()).format(value);

  const rows: { label: string; value: number }[] = [
    { label: getMessage('statistics_translations'), value: stats.translationsCount },
    { label: getMessage('statistics_llmInputTokens'), value: stats.llmInputTokens },
    { label: getMessage('statistics_llmOutputTokens'), value: stats.llmOutputTokens },
  ];

  return (
    <VStack gap={2} width="100%">
      {rows.map(({ label, value }) => (
        <HStack key={label} justify="between" align="center" gap={3} width="100%">
          <Text type="supporting">{label}</Text>
          <Text>{formatNumber(value)}</Text>
        </HStack>
      ))}
      <HStack justify="end" width="100%">
        <Button
          onPress={() => {
            confirm({
              message: getMessage('statistics_resetConfirm'),
              onAccept: () => {
                void resetTranslationStats().then(refetch);
              },
            });
          }}
        >
          {getMessage('statistics_reset')}
        </Button>
      </HStack>
    </VStack>
  );
};
