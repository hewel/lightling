import { parseRichMarkup } from './parseMarkup';

describe('rich translation markup parsing', () => {
  test('parses nested containers and preserves text segments', () => {
    expect(
      parseRichMarkup('Before <g id="r1">outer <g id="r2">inner</g></g> after'),
    ).toEqual([
      { type: 'text', text: 'Before ' },
      {
        type: 'container',
        id: 'r1',
        children: [
          { type: 'text', text: 'outer ' },
          {
            type: 'container',
            id: 'r2',
            children: [{ type: 'text', text: 'inner' }],
          },
        ],
      },
      { type: 'text', text: ' after' },
    ]);
  });

  test('keeps ampersands and angle brackets in text literal', () => {
    expect(parseRichMarkup('5 < 7 & 9 > 3')).toEqual([
      { type: 'text', text: '5 < 7 & 9 > 3' },
    ]);
  });

  test('rejects unclosed and isolated closing containers', () => {
    expect(parseRichMarkup('<g id="r1">missing close')).toBeNull();
    expect(parseRichMarkup('orphan</g>')).toBeNull();
  });

  test('rejects invalid ids and residual placeholder-like markup', () => {
    expect(parseRichMarkup('<g id="r!">invalid</g>')).toBeNull();
    expect(parseRichMarkup('before <x id="r1"/> after')).toBeNull();
    expect(parseRichMarkup('before <g id="r1">valid</g> <x')).toBeNull();
  });

  test('accepts the full placeholder id character set', () => {
    expect(parseRichMarkup('<g id="A_9-z">value</g>')).toEqual([
      {
        type: 'container',
        id: 'A_9-z',
        children: [{ type: 'text', text: 'value' }],
      },
    ]);
  });
});
