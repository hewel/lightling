import { serializeSelectionFragment } from './serializeFragment';

describe('rich translation fragment serialization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('serializes nested inline containers with stable ids', () => {
    document.body.innerHTML = '<p>Hello <strong><em>world</em></strong>!</p>';

    expect(serializeSelectionFragment(document.body)).toEqual({
      markup: '<g id="r1">Hello <g id="r2"><g id="r3">world</g></g>!</g>',
      nodes: {
        r1: { tag: 'p' },
        r2: { tag: 'strong' },
        r3: { tag: 'em' },
      },
    });
  });

  test('normalizes supported aliases and transparently unwraps other elements', () => {
    document.body.innerHTML =
      '<span>before <b>bold</b> <i>italic</i> <strike>old</strike> <del>removed</del></span>';

    expect(serializeSelectionFragment(document.body)).toEqual({
      markup:
        'before <g id="r1">bold</g> <g id="r2">italic</g> <g id="r3">old</g> <g id="r4">removed</g>',
      nodes: {
        r1: { tag: 'strong' },
        r2: { tag: 'em' },
        r3: { tag: 's' },
        r4: { tag: 's' },
      },
    });
  });

  test('skips script, style, noscript, and template subtrees', () => {
    document.body.innerHTML =
      '<strong>keep</strong><script><strong>drop</strong></script><style><strong>drop</strong></style><noscript><strong>drop</strong></noscript><template><strong>drop</strong></template>';

    expect(serializeSelectionFragment(document.body)).toEqual({
      markup: '<g id="r1">keep</g>',
      nodes: { r1: { tag: 'strong' } },
    });
  });

  test('serializes br as a newline and captures anchor href values', () => {
    document.body.innerHTML = '<a href="/docs?a=1&b=2">read<br>more</a><a>plain</a>';

    expect(serializeSelectionFragment(document.body)).toEqual({
      markup: '<g id="r1">read\nmore</g><g id="r2">plain</g>',
      nodes: {
        r1: { tag: 'a', href: '/docs?a=1&b=2' },
        r2: { tag: 'a' },
      },
    });
  });

  test('trims surrounding whitespace while preserving block containers', () => {
    document.body.innerHTML = '  <h1>Title</h1>  <blockquote>Quote</blockquote>  ';

    expect(serializeSelectionFragment(document.body)).toEqual({
      markup: '<g id="r1">Title</g>  <g id="r2">Quote</g>',
      nodes: { r1: { tag: 'h1' }, r2: { tag: 'blockquote' } },
    });
  });

  test('returns null for a fragment without containers', () => {
    document.body.textContent = 'plain text only';

    expect(serializeSelectionFragment(document.body)).toBeNull();
  });

  test('returns null when serialized markup exceeds the length limit', () => {
    document.body.innerHTML = `<strong>${'x'.repeat(10_001)}</strong>`;

    expect(serializeSelectionFragment(document.body)).toBeNull();
  });

  test('returns null when the node count exceeds the limit', () => {
    document.body.innerHTML = Array.from(
      { length: 501 },
      () => '<strong>x</strong>',
    ).join('');

    expect(serializeSelectionFragment(document.body)).toBeNull();
  });
});
