import {
  createSemanticKey,
  isPlausibleTargetLanguage,
  normalizeTranslationText,
  parsePageTranslationResponse,
  validatePlaceholderIntegrity,
  WEBPAGE_TRANSLATION_PROMPT_VERSION,
} from './protocol';

const target = {
  id: 'u1',
  sourceText: 'Click <g id="inline-1">Save</g> to continue.',
  normalizedText: 'Click <g id="inline-1">Save</g> to continue.',
  kind: 'body' as const,
  slot: 'visible-text' as const,
  contextClass: 'main:body',
  semanticKey: 'key',
  priority: 4,
};

describe('page translation protocol', () => {
  test('normalizes only Unicode and whitespace', () => {
    expect(normalizeTranslationText('  Cafe\u0301   42!  ')).toBe('Café 42!');
    expect(normalizeTranslationText('Save')).not.toBe(normalizeTranslationText('save'));
  });

  test('semantic keys separate the same text in different contexts', () => {
    const base = {
      sourceLanguage: 'en',
      targetLanguage: 'de',
      normalizedText: 'Open',
      kind: 'button' as const,
      slot: 'visible-text' as const,
      contextClass: 'file-dialog:button',
      provider: 'openai',
      model: 'small-model',
      glossaryVersion: 'none',
      promptVersion: WEBPAGE_TRANSLATION_PROMPT_VERSION,
    };
    expect(createSemanticKey(base)).not.toBe(
      createSemanticKey({ ...base, contextClass: 'store:status', kind: 'status' }),
    );
    expect(createSemanticKey(base)).not.toBe(
      createSemanticKey({ ...base, model: 'other-model' }),
    );
  });

  test('validates balanced placeholder identity while allowing reordering', () => {
    expect(
      validatePlaceholderIntegrity(
        '<g id="first">One</g> then <g id="second">Two</g>',
        '<g id="second">Zwei</g>, dann <g id="first">Eins</g>',
      ),
    ).toBe(true);
    expect(
      validatePlaceholderIntegrity(
        'Use <x id="code-1"/>.',
        'Verwende <x id="renamed"/>.',
      ),
    ).toBe(false);
  });

  test('accepts valid IDs by identity and isolates a corrupted item', () => {
    const second = {
      ...target,
      id: 'u2',
      sourceText: 'Use <x id="code-1"/>.',
    };
    const result = parsePageTranslationResponse(
      JSON.stringify({
        translations: [
          {
            id: 'u1',
            target: 'Klicken Sie zum Fortfahren auf <g id="inline-1">Speichern</g>.',
          },
          { id: 'u2', target: 'Verwenden Sie <x id="wrong"/>.' },
        ],
      }),
      [target, second],
    );
    expect(result.translations).toEqual([
      {
        id: 'u1',
        target: 'Klicken Sie zum Fortfahren auf <g id="inline-1">Speichern</g>.',
      },
    ]);
    expect(result.issues).toContainEqual({
      id: 'u2',
      failure: 'placeholder-corruption',
    });
  });

  test('rejects duplicate, unknown, and missing IDs before DOM application', () => {
    const result = parsePageTranslationResponse(
      JSON.stringify({
        translations: [
          { id: 'u1', target: target.sourceText },
          { id: 'u1', target: target.sourceText },
          { id: 'unknown', target: 'extra' },
        ],
      }),
      [target, { ...target, id: 'u2' }],
    );
    expect(result.issues.map((issue) => issue.failure)).toEqual([
      'duplicate-item',
      'extra-item',
      'missing-item',
    ]);
  });
  test('checks target scripts when the language has a deterministic signal', () => {
    expect(isPlausibleTargetLanguage('保存设置', 'zh-CN')).toBe(true);
    expect(isPlausibleTargetLanguage('Save settings', 'zh-CN')).toBe(false);
    expect(isPlausibleTargetLanguage('Speichern', 'de')).toBe(true);
  });
});
