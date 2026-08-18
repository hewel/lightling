import { FC, ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';

import { isMobileBrowser } from '@/lib/browser';
import { getLanguageNameByCode } from '@/lib/language';
import { ITranslation } from '@/types/translation/Translation';

import { Button } from '../../primitives/Button/Button.bundle/desktop';
import { Icon } from '../../primitives/Icon/Icon.bundle/desktop';

export type TranslationCardProps = {
	translation: ITranslation;
	timestamp?: number;
	onPressTTS: (target: 'original' | 'translation') => void;
	controlPanelSlot?: ReactNode | ReactNode[];
	headStartSlot?: ReactNode | ReactNode[];
};

// TODO: implement text highlighting for search results
/**
 * Represent translation data
 */
export const TranslationCard: FC<TranslationCardProps> = ({
	translation,
	timestamp,
	onPressTTS,
	controlPanelSlot,
	headStartSlot,
}) => {
	const ContentStack = isMobileBrowser() ? VStack : HStack;

	return (
		<Card width="100%">
			<VStack gap={3}>
				<HStack justify="between" align="center">
					<HStack gap={2} align="center">
						{headStartSlot}
						{timestamp !== undefined ? (
							<Text type="supporting" color="secondary" hasTabularNumbers>
								{new Date(timestamp).toLocaleDateString()}
							</Text>
						) : null}
					</HStack>
					<HStack gap={2}>{controlPanelSlot}</HStack>
				</HStack>

				<ContentStack gap={3}>
					<VStack gap={2} width="100%">
						<HStack gap={2} align="center">
							<Button
								onPress={() => {
									onPressTTS('original');
								}}
								view="clear"
								size="s"
							>
								<Icon glyph="volume-up" scalable={false} />
							</Button>
							<Badge
								label={getLanguageNameByCode(translation.from)}
								variant="neutral"
							/>
						</HStack>
						<VStack isScrollable>
							<Text as="div" type="body" textWrap="pretty">
								{translation.originalText}
							</Text>
						</VStack>
					</VStack>

					<VStack gap={2} width="100%">
						<HStack gap={2} align="center">
							<Button
								onPress={() => {
									onPressTTS('translation');
								}}
								view="clear"
								size="s"
							>
								<Icon glyph="volume-up" scalable={false} />
							</Button>
							<Badge
								label={getLanguageNameByCode(translation.to)}
								variant="neutral"
							/>
						</HStack>
						<VStack isScrollable>
							<Text as="div" type="body" textWrap="pretty">
								{translation.translatedText}
							</Text>
						</VStack>
					</VStack>
				</ContentStack>
			</VStack>
		</Card>
	);
};
