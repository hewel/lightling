import { encode as encodeO200k } from 'gpt-tokenizer-v4/encoding/o200k_base';

import {
  getRegisteredTranslationModelPatch,
  type ConfiguredLLMProfile,
  type TranslationModelMetadata,
} from './modelProfile';

export interface TranslationTokenCounter {
  id: string;
  accuracy: 'exact' | 'compatible' | 'estimate';
  count(text: string): number;
}

const exactCounters: Record<string, TranslationTokenCounter> = {
  o200k_base: {
    id: 'o200k_base',
    accuracy: 'exact',
    count: (text) => encodeO200k(text).length,
  },
};

const utf8ByteLength = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes++;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

export const conservativeTokenCounter: TranslationTokenCounter = {
  id: 'conservative-utf8-estimator-v1',
  accuracy: 'estimate',
  count: (text) => Math.max(1, Math.ceil(utf8ByteLength(text) / 2)),
};

const knownTokenizerId = (profile: ConfiguredLLMProfile): string | null =>
  getRegisteredTranslationModelPatch(profile.model)?.tokenizerId ?? null;

const getExactCounter = (id: string | null): TranslationTokenCounter | null => {
  if (id === null) return null;
  return exactCounters[id] ?? null;
};

export interface TokenizerResolution {
  counter: TranslationTokenCounter;
  source: 'override' | 'provider' | 'registered-model' | 'fallback';
  warning?: string;
}

export const resolveTranslationTokenizer = (
  profile: ConfiguredLLMProfile,
  metadata: TranslationModelMetadata | null,
): TokenizerResolution => {
  const overrideId = profile.translationProfile?.tokenizerId ?? null;
  const override = getExactCounter(overrideId);
  if (override !== null) return { counter: override, source: 'override' };
  if (overrideId !== null) {
    return {
      counter: conservativeTokenCounter,
      source: 'fallback',
      warning: `Tokenizer ${overrideId} is unavailable; using conservative estimation`,
    };
  }

  const provider = getExactCounter(metadata?.tokenizerId ?? null);
  if (provider !== null) return { counter: provider, source: 'provider' };
  if (metadata?.tokenizerId !== null && metadata?.tokenizerId !== undefined) {
    return {
      counter: conservativeTokenCounter,
      source: 'fallback',
      warning: `Provider tokenizer ${metadata.tokenizerId} is unavailable locally; using conservative estimation`,
    };
  }

  const registered = getExactCounter(knownTokenizerId(profile));
  if (registered !== null) return { counter: registered, source: 'registered-model' };

  return {
    counter: conservativeTokenCounter,
    source: 'fallback',
    warning: 'No exact tokenizer is available; using conservative estimation',
  };
};

export const countStructuredChatTokens = (
  counter: TranslationTokenCounter,
  messages: readonly { role: string; content: string }[],
): number =>
  messages.reduce(
    (total, message) =>
      total + counter.count(message.role) + counter.count(message.content) + 6,
    3,
  );
