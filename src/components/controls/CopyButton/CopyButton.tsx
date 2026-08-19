import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { IconCheck, IconCopy } from '@tabler/icons-react';

import { getMessage } from '@/lib/language';

const COPIED_FEEDBACK_MS = 1500;

const copyWithExecCommand = (text: string): boolean => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.insetInlineStart = '-9999px';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
};

export const CopyButton: FC<{ text: string | null }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const feedbackTimeout = useRef<number | null>(null);

  useEffect(() => () => clearTimeout(feedbackTimeout.current ?? undefined), []);

  const onClick = useCallback(async () => {
    if (text === null) return;

    let success = false;

    if (navigator.clipboard?.writeText !== undefined) {
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch {
        success = copyWithExecCommand(text);
      }
    } else {
      success = copyWithExecCommand(text);
    }

    if (!success) return;

    setCopied(true);

    clearTimeout(feedbackTimeout.current ?? undefined);

    feedbackTimeout.current = window.setTimeout(() => {
      setCopied(false);
      feedbackTimeout.current = null;
    }, COPIED_FEEDBACK_MS);
  }, [text]);

  const label = getMessage('common_copy');

  return (
    <IconButton
      label={label}
      tooltip={label}
      icon={copied ? <IconCheck /> : <IconCopy />}
      variant="ghost"
      size="sm"
      onClick={onClick}
      isDisabled={text === null}
    />
  );
};
