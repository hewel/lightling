import { richMarkupToPlainText } from './plainText';

describe('rich translation plain text conversion', () => {
  test('adds line breaks after known block containers', () => {
    expect(
      richMarkupToPlainText('<g id="r1">First</g><g id="r2">Second</g>', {
        r1: { tag: 'p' },
        r2: { tag: 'blockquote' },
      }),
    ).toBe('First\nSecond');
  });

  test('keeps only child text for unknown container ids', () => {
    expect(
      richMarkupToPlainText('A <g id="missing">nested <g id="r1">text</g></g> B', {
        r1: { tag: 'strong' },
      }),
    ).toBe('A nested text B');
  });

  test('strips container tags when parsing fails', () => {
    expect(richMarkupToPlainText('  <g id="r1">broken <g id="r2">text', {})).toBe(
      'broken text',
    );
  });

  test('trims output and folds three or more consecutive newlines', () => {
    expect(
      richMarkupToPlainText('\n<g id="r1">one\n\n\n</g>\n\n<g id="r2">two</g>\n', {
        r1: { tag: 'p' },
        r2: { tag: 'strong' },
      }),
    ).toBe('one\n\ntwo');
  });

  test('preserves literal text and br newlines', () => {
    expect(richMarkupToPlainText('A <  B\nC >', {})).toBe('A <  B\nC >');
  });
});
