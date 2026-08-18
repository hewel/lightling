import { FC } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { IconBookmark, IconBookmarkFilled } from '@tabler/icons-react';

import { getMessage } from '@/lib/language';
import { ITranslation } from '@/types/translation/Translation';

import { useDictionary } from './useDictionary';

export const DictionaryButton: FC<{ translation: ITranslation | null }> = ({
  translation,
}) => {
  const dictionary = useDictionary(translation);

  const label = getMessage(
    dictionary.has ? 'dictionaryButton_delete' : 'dictionaryButton_add',
  );

  return (
    <IconButton
      label={label}
      tooltip={label}
      icon={dictionary.has ? <IconBookmarkFilled /> : <IconBookmark />}
      variant="ghost"
      size="sm"
      onClick={dictionary.toggle}
      isDisabled={translation === null}
    />
  );
};
