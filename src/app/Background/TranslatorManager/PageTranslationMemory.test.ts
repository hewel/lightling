import type { TranslationMemoryEntry } from '@/lib/pageTranslation/protocol';

import { PageTranslationMemory } from './PageTranslationMemory';

const entry = (key: string, model = 'small-model'): TranslationMemoryEntry => ({
  key,
  sourceLanguage: 'en',
  targetLanguage: 'de',
  sourceText: 'Save',
  translatedText: 'Speichern',
  kind: 'button',
  slot: 'visible-text',
  contextClass: 'settings:button',
  provider: 'openai',
  model,
  glossaryVersion: 'none',
  promptVersion: 'page-v1',
  profileVersion: 'profile-v1',
  normalizationVersion: 'nfc-whitespace-v1',
  createdAt: 1,
  lastUsedAt: 1,
});

describe('PageTranslationMemory', () => {
  test('layers session LRU over persistent IndexedDB entries', async () => {
    await PageTranslationMemory.clearPersistent();
    const first = new PageTranslationMemory(2);
    await first.set(entry('model-a'));

    expect((await first.get('model-a'))?.translatedText).toBe('Speichern');
    const second = new PageTranslationMemory(2);
    expect((await second.get('model-a'))?.translatedText).toBe('Speichern');
    await Promise.all([first.close(), second.close()]);
  });

  test('does not reuse a result under an invalidated model key', async () => {
    const memory = new PageTranslationMemory();
    await memory.set(entry('model-v1', 'v1'));
    expect(await memory.get('model-v2')).toBeNull();
    await memory.close();
  });
});
