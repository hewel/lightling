import {
  createDedupKey,
  createSemanticKey,
  deriveAttemptMetrics,
  isInvariantTranslationSource,
  isPlausibleTargetLanguage,
  normalizeTranslationText,
  parsePageTranslationResponse,
  repairPlaceholderIntegrity,
  stripSpuriousAngleBrackets,
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

  test('classifies protected invariant targets without swallowing UI vocabulary', () => {
    expect(isInvariantTranslationSource('Discord', ['Discord'])).toBe(true);
    expect(isInvariantTranslationSource('Figtree', ['Figtree'])).toBe(true);
    expect(isInvariantTranslationSource('©2026 Meta Platforms, Inc.')).toBe(true);
    expect(isInvariantTranslationSource('tsx')).toBe(true);
    expect(isInvariantTranslationSource('bash')).toBe(true);
    expect(isInvariantTranslationSource('@imdreamrunner')).toBe(true);
    expect(isInvariantTranslationSource('cool.person@example.com')).toBe(true);
    expect(
      isInvariantTranslationSource('<x id="x-1"/> — XDSCollapse → XDSCollapsible'),
    ).toBe(true);
    // Person-name shapes stay invariant so unchanged model echoes are accepted
    // instead of retried into a storm.
    expect(isInvariantTranslationSource('Jonas E. P')).toBe(true);
    expect(isInvariantTranslationSource('Christopher Keele')).toBe(true);
    expect(isInvariantTranslationSource('Krzysztof Gasienica-Bednarz')).toBe(true);

    for (const text of [
      'Save',
      'Close',
      'Templates',
      'Docs',
      'Community',
      'Changelog',
      'This is a normal sentence.',
      '<x id="x-1"/> — Rename <x id="x-2"/> status to <x id="x-3"/>',
      '<x id="x-1"/> — TopNav title → heading',
    ]) {
      expect(isInvariantTranslationSource(text)).toBe(false);
    }
    expect(isInvariantTranslationSource('Discord')).toBe(false);
    expect(isInvariantTranslationSource('Figtree')).toBe(false);
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

  test('dedup keys separate local occurrences by text, kind, slot, and context', () => {
    const base = {
      normalizedText: 'Open',
      kind: 'button' as const,
      slot: 'visible-text' as const,
      contextClass: 'file-dialog:button',
    };
    const withIdentityFields = {
      ...base,
      provider: 'openai',
      model: 'small-model',
      glossaryVersion: 'glossary-v1',
      promptVersion: 'prompt-v1',
      profileVersion: 'profile-v1',
    };

    expect(createDedupKey(base)).not.toBe(
      createDedupKey({ ...base, normalizedText: 'Close' }),
    );
    expect(createDedupKey(base)).not.toBe(createDedupKey({ ...base, kind: 'status' }));
    expect(createDedupKey(base)).not.toBe(createDedupKey({ ...base, slot: 'title' }));
    expect(createDedupKey(base)).not.toBe(
      createDedupKey({ ...base, contextClass: 'store:status' }),
    );
    expect(createDedupKey(base)).toBe(createDedupKey(withIdentityFields));
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

  test('rejects hallucinated angle-bracket wrappers when the source has none', () => {
    expect(
      validatePlaceholderIntegrity(
        'Gleam is a friendly language for building type-safe systems that scale!',
        '<Gleam 是一种友好的语言，用于构建类型安全且能扩展的系统>!',
      ),
    ).toBe(false);
    expect(
      validatePlaceholderIntegrity(
        'Click <g id="inline-1">Save</g> to continue.',
        'Klicken Sie auf <g id="inline-1">Speichern</g>, <um fortzufahren>.',
      ),
    ).toBe(false);
  });

  test('accepts angle brackets in the target when the source uses them', () => {
    expect(validatePlaceholderIntegrity('5 < 7 > 3', '5 < 7 > 3')).toBe(true);
    expect(validatePlaceholderIntegrity('I <3 you', 'Je t’aime <3')).toBe(true);
  });

  test('accepts spaced comparisons even when the source has no brackets', () => {
    expect(validatePlaceholderIntegrity('5 less than 7', '5 < 7 > 3')).toBe(true);
    expect(stripSpuriousAngleBrackets('5 less than 7', '5 < 7 > 3')).toBe('5 < 7 > 3');
  });

  test('rejects and strips unclosed hallucinated brackets', () => {
    const source =
      'Multilingual Gleam makes it easy to use code written in other BEAM languages.';
    const broken = '<多语言 Gleam 使使用其他 BEAM 语言编写的代码变得容易。';
    expect(validatePlaceholderIntegrity(source, broken)).toBe(false);
    expect(stripSpuriousAngleBrackets(source, broken)).toBe(
      '多语言 Gleam 使使用其他 BEAM 语言编写的代码变得容易。',
    );
    expect(repairPlaceholderIntegrity(source, broken)).toBe(
      '多语言 Gleam 使使用其他 BEAM 语言编写的代码变得容易。',
    );
  });

  test('strips hallucinated wrappers but keeps the wrapped text', () => {
    expect(
      stripSpuriousAngleBrackets(
        'Gleam is a friendly language for building type-safe systems that scale!',
        '<Gleam 是一种友好的语言，用于构建类型安全且能扩展的系统>!',
      ),
    ).toBe('Gleam 是一种友好的语言，用于构建类型安全且能扩展的系统!');
    // Known artifact tags are dropped whole; unknown wrapped words keep
    // their text so translated content is never deleted.
    expect(
      stripSpuriousAngleBrackets(
        'Hello world',
        '<translation>Hallo <Welt></translation>',
      ),
    ).toBe('Hallo Welt');
    // Placeholders are preserved while wrappers around them are stripped.
    expect(
      stripSpuriousAngleBrackets(
        'Click <g id="inline-1">Save</g> now',
        'Klicken Sie <g id="inline-1">Speichern</g> <jetzt>',
      ),
    ).toBe('Klicken Sie <g id="inline-1">Speichern</g> jetzt');
  });

  test('leaves targets untouched when the source contains angle brackets', () => {
    expect(stripSpuriousAngleBrackets('5 < 7 > 3', '5 < 7 > 3')).toBe('5 < 7 > 3');
  });

  test('repairs hallucinated wrappers for placeholder-free sources', () => {
    expect(
      repairPlaceholderIntegrity(
        'Gleam is a friendly language for building type-safe systems that scale!',
        '<Gleam 是一种友好的语言，用于构建类型安全且能扩展的系统>!',
      ),
    ).toBe('Gleam 是一种友好的语言，用于构建类型安全且能扩展的系统!');
    expect(repairPlaceholderIntegrity('Hello', 'Hallo')).toBeNull();
  });

  test('repairs hallucinated wrappers alongside valid placeholders', () => {
    expect(
      repairPlaceholderIntegrity(
        'Click <g id="inline-1">Save</g> to continue.',
        'Klicken Sie auf <g id="inline-1">Speichern</g>, <um fortzufahren>.',
      ),
    ).toBe('Klicken Sie auf <g id="inline-1">Speichern</g>, um fortzufahren.');
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

  test('derives transport retries without counting the initial parse attempt', () => {
    expect(
      deriveAttemptMetrics([
        {
          kind: 'parse',
          stage: 'initial',
          profileId: 'profile',
          targetIds: ['u1'],
          issues: [],
        },
        {
          kind: 'transport-retry',
          stage: 'initial',
          profileId: 'profile',
          targetIds: ['u1'],
          attemptNumber: 2,
          error: 'temporary failure',
        },
        {
          kind: 'parse',
          stage: 'initial',
          profileId: 'profile',
          targetIds: ['u1'],
          issues: [],
        },
      ]),
    ).toEqual({ retryCount: 1, validationFailures: 0 });
  });

  test('derives ladder retries and validation issues from a mixed journal', () => {
    expect(
      deriveAttemptMetrics([
        {
          kind: 'parse',
          stage: 'initial',
          profileId: 'profile',
          targetIds: ['u1', 'u2'],
          issues: [{ id: 'u2', failure: 'placeholder-corruption' }],
        },
        {
          kind: 'parse',
          stage: 'isolated',
          profileId: 'profile',
          targetIds: ['u2'],
          issues: [{ id: 'u2', failure: 'language-mismatch' }],
        },
        {
          kind: 'transport-retry',
          stage: 'isolated',
          profileId: 'profile',
          targetIds: ['u2'],
          attemptNumber: 2,
          error: 'temporary failure',
        },
        {
          kind: 'parse',
          stage: 'isolated',
          profileId: 'profile',
          targetIds: ['u2'],
          issues: [],
        },
      ]),
    ).toEqual({ retryCount: 3, validationFailures: 2 });
  });
});
