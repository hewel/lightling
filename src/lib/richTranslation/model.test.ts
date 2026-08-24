import {
  RICH_BLOCK_TAGS,
  RICH_CONTAINER_TAGS,
  RICH_INLINE_TAGS,
  RICH_MARKUP_MAX_LENGTH,
  RICH_NODES_MAX_COUNT,
} from './model';

describe('rich translation model', () => {
  test('exposes the Wave One tag vocabulary and limits', () => {
    expect(RICH_INLINE_TAGS).toEqual(['strong', 'em', 'u', 's', 'code', 'a']);
    expect(RICH_BLOCK_TAGS).toEqual([
      'p',
      'blockquote',
      'pre',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
    ]);
    expect(RICH_CONTAINER_TAGS).toEqual([...RICH_INLINE_TAGS, ...RICH_BLOCK_TAGS]);
    expect(RICH_MARKUP_MAX_LENGTH).toBe(10_000);
    expect(RICH_NODES_MAX_COUNT).toBe(500);
  });
});
