import {
  createSemanticKey,
  isPlausibleTargetLanguage,
  normalizeTranslationText,
  parsePageTranslationResponse,
  repairPlaceholderIntegrity,
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
      profileVersion: 'profile-v1',
    };
    expect(createSemanticKey(base)).not.toBe(
      createSemanticKey({ ...base, contextClass: 'store:status', kind: 'status' }),
    );
    expect(createSemanticKey(base)).not.toBe(
      createSemanticKey({ ...base, model: 'other-model' }),
    );
    expect(createSemanticKey(base)).not.toBe(
      createSemanticKey({ ...base, profileVersion: 'profile-v2' }),
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
  test('checks target scripts without rejecting invariant technical names', () => {
    expect(isPlausibleTargetLanguage('保存设置', 'zh-CN')).toBe(true);
    expect(isPlausibleTargetLanguage('Save settings', 'zh-CN', 'Save settings')).toBe(
      false,
    );
    expect(isPlausibleTargetLanguage('GitHub', 'zh-CN', 'GitHub')).toBe(true);
    expect(isPlausibleTargetLanguage('Noctalia', 'zh-CN', 'Noctalia', ['Noctalia'])).toBe(
      true,
    );
    expect(
      isPlausibleTargetLanguage(
        'Link to "How can I make the UI bigger or smaller?"',
        'zh-CN',
        'Link to "How can I make the UI bigger or smaller?"',
      ),
    ).toBe(false);
    expect(isPlausibleTargetLanguage('Speichern', 'de')).toBe(true);
  });

  test('repairs renamed placeholder ids when structure is preserved', () => {
    expect(
      repairPlaceholderIntegrity('Use <x id="code-1"/>.', 'Verwende <x id="wrong"/>.'),
    ).toBe('Verwende <x id="code-1"/>.');
    expect(
      repairPlaceholderIntegrity(
        'Click <g id="inline-1">Save</g> or <g id="inline-2">Cancel</g>.',
        'Klicken Sie auf <g id="1">Speichern</g> oder <g id="2">Abbrechen</g>.',
      ),
    ).toBe(
      'Klicken Sie auf <g id="inline-1">Speichern</g> oder <g id="inline-2">Abbrechen</g>.',
    );
  });

  test('canonicalizes lenient tag formatting during repair', () => {
    expect(
      repairPlaceholderIntegrity('Use <x id="code-1"/>.', "Verwende <x id='code-1'>."),
    ).toBe('Verwende <x id="code-1"/>.');
    expect(
      repairPlaceholderIntegrity(
        '<g id="inline-1">Save</g> now',
        '<g id=inline-1>Speichern</g> jetzt',
      ),
    ).toBe('<g id="inline-1">Speichern</g> jetzt');
  });

  test('appends missing trailing closes only when the source ends with them', () => {
    expect(
      repairPlaceholderIntegrity(
        '<g id="inline-1"><g id="inline-2">Noctalia</g> quiet by design</g>',
        '<g id="inline-1"><g id="inline-2">Noctalia</g> 安静的设计',
      ),
    ).toBe('<g id="inline-1"><g id="inline-2">Noctalia</g> 安静的设计</g>');
    // Source has text after the final close: appending at the end would
    // misplace the trailing text inside the group, so repair must refuse.
    expect(
      repairPlaceholderIntegrity(
        '<g id="inline-1">Save</g> to continue.',
        '<g id="inline-1">Speichern um fortzufahren.',
      ),
    ).toBeNull();
  });

  test('refuses repair when tokens are dropped or added', () => {
    expect(
      repairPlaceholderIntegrity('Use <x id="code-1"/>.', 'Verwende den Code.'),
    ).toBeNull();
    expect(
      repairPlaceholderIntegrity(
        '<g id="inline-1">Save</g>',
        '<g id="inline-1">Speichern</g> <g id="inline-1">Speichern</g>',
      ),
    ).toBeNull();
  });

  test('parse accepts repaired placeholders only when repair is enabled', () => {
    const second = {
      ...target,
      id: 'u2',
      sourceText: 'Use <x id="code-1"/>.',
    };
    const raw = JSON.stringify({
      translations: [{ id: 'u2', target: 'Verwenden Sie <x id="wrong"/>.' }],
    });
    const strict = parsePageTranslationResponse(raw, [second]);
    expect(strict.translations).toEqual([]);
    expect(strict.issues).toContainEqual({ id: 'u2', failure: 'placeholder-corruption' });

    const repaired = parsePageTranslationResponse(raw, [second], () => true, {
      repairPlaceholders: true,
    });
    expect(repaired).toEqual({
      translations: [{ id: 'u2', target: 'Verwenden Sie <x id="code-1"/>.' }],
      issues: [],
    });
  });

  test('parses JSON wrapped in a Markdown code fence', () => {
    const fenced =
      '```json\n' +
      JSON.stringify({
        translations: [{ id: 'u1', target: target.sourceText }],
      }) +
      '\n```';
    const result = parsePageTranslationResponse(fenced, [target]);
    expect(result).toEqual({
      translations: [{ id: 'u1', target: target.sourceText }],
      issues: [],
    });
  });

  test('maps bare string arrays positionally and validates each item', () => {
    const second = {
      ...target,
      id: 'u2',
      sourceText: 'Use <x id="code-1"/>.',
    };
    const result = parsePageTranslationResponse(
      JSON.stringify({
        translations: [
          'Klicken Sie zum Fortfahren auf <g id="inline-1">Speichern</g>.',
          'Verwenden Sie <x id="code-1"/>.',
        ],
      }),
      [target, second],
    );
    expect(result).toEqual({
      translations: [
        {
          id: 'u1',
          target: 'Klicken Sie zum Fortfahren auf <g id="inline-1">Speichern</g>.',
        },
        { id: 'u2', target: 'Verwenden Sie <x id="code-1"/>.' },
      ],
      issues: [],
    });
  });

  test('rejects a positional response whose count does not match the targets', () => {
    const second = { ...target, id: 'u2' };
    const result = parsePageTranslationResponse(
      JSON.stringify({ translations: ['only one'] }),
      [target, second],
    );
    expect(result).toEqual({
      translations: [],
      issues: [{ failure: 'count-mismatch' }],
    });
  });

  test('still validates placeholder integrity per item in positional mode', () => {
    const second = {
      ...target,
      id: 'u2',
      sourceText: 'Use <x id="code-1"/>.',
    };
    const result = parsePageTranslationResponse(
      JSON.stringify({
        translations: [
          'Klicken Sie zum Fortfahren auf <g id="inline-1">Speichern</g>.',
          'Verwenden Sie den Code.',
        ],
      }),
      [target, second],
    );
    expect(result.translations).toHaveLength(1);
    expect(result.issues).toContainEqual({ id: 'u2', failure: 'placeholder-corruption' });
  });
});
