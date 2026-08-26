import type { OptionsGroup } from '../OptionsTree/OptionsTree';
import { filterOptionsTree } from './searchOptions';

const tree: OptionsGroup[] = [
  {
    id: 'general',
    title: 'General',
    groupContent: [
      {
        title: 'Interface language',
        description: 'Language of the settings UI',
        path: 'language',
        optionContent: { type: 'SelectList', options: [] },
      },
    ],
  },
  {
    id: 'cache',
    title: 'Cache',
    groupContent: [
      {
        description: 'Reuse translation results',
        path: 'scheduler.useCache',
        optionContent: { type: 'Checkbox', text: 'Enable cache' },
      },
      {
        description: 'Treat texts with different case as equal',
        path: 'cache.ignoreCase',
        optionContent: { type: 'Checkbox', text: 'Ignore case' },
      },
      {
        description: 'Drop all cached translations',
        optionContent: { type: 'Button', text: 'Clear cache', action: () => {} },
      },
    ],
  },
  {
    id: 'select-translation',
    title: 'Select translation',
    groupContent: [
      {
        title: 'Popup button',
        groupContent: [
          {
            description: 'Delay before the button disappears',
            path: 'selectTranslator.timeoutForHideButton',
            optionContent: { type: 'InputNumber' },
          },
        ],
      },
    ],
  },
];

describe('filterOptionsTree', () => {
  it('returns nothing for a blank query', () => {
    expect(filterOptionsTree(tree, '')).toEqual([]);
    expect(filterOptionsTree(tree, '   ')).toEqual([]);
  });

  it('matches options by control text and keeps only matched items', () => {
    const result = filterOptionsTree(tree, 'ignore case');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cache');
    expect(result[0].groupContent).toHaveLength(1);
    expect(result[0].groupContent[0]).toMatchObject({ path: 'cache.ignoreCase' });
  });

  it('matches options by plain-text description', () => {
    const result = filterOptionsTree(tree, 'settings ui');

    expect(result.map(({ id }) => id)).toEqual(['general']);
  });

  it('matches case-insensitively', () => {
    const result = filterOptionsTree(tree, 'ENABLE CACHE');

    expect(result.map(({ id }) => id)).toEqual(['cache']);
  });

  it('surfaces every option of a section whose title matches', () => {
    const result = filterOptionsTree(tree, 'cache');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cache');
    expect(result[0].groupContent).toHaveLength(3);
  });

  it('uses nested group titles as search context', () => {
    const result = filterOptionsTree(tree, 'popup');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('select-translation');
    expect(result[0].groupContent).toHaveLength(1);
    expect(result[0].groupContent[0]).toMatchObject({
      path: 'selectTranslator.timeoutForHideButton',
    });
  });

  it('returns nothing when no option matches', () => {
    expect(filterOptionsTree(tree, 'nonexistent option')).toEqual([]);
  });
});
