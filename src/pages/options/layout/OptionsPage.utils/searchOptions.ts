import type { OptionItem, OptionsGroup } from '../OptionsTree/OptionsTree';

interface FlattenedOption {
  item: OptionItem;
  searchText: string;
}

/**
 * Collect searchable text of a single option: its title, control label
 * (checkbox/button text) and plain-text description
 */
const getOptionItemSearchText = (item: OptionItem): string => {
  const parts: string[] = [];
  if (item.title !== undefined) parts.push(item.title);

  const { optionContent } = item;
  if ('text' in optionContent && typeof optionContent.text === 'string') {
    parts.push(optionContent.text);
  }

  if (typeof item.description === 'string') parts.push(item.description);

  return parts.join(' ');
};

/**
 * Flatten a section tree to its option items, giving every item the titles of
 * its ancestor groups as search context, so a query matching a (sub)section
 * name surfaces all options it contains
 */
const flattenGroupOptions = (
  group: OptionsGroup,
  ancestorTitles: readonly string[],
  output: FlattenedOption[],
): void => {
  const context =
    group.title === undefined ? ancestorTitles : [...ancestorTitles, group.title];

  for (const entry of group.groupContent) {
    if (entry === undefined) continue;

    if ('optionContent' in entry) {
      output.push({
        item: entry,
        searchText: [...context, getOptionItemSearchText(entry)].join(' '),
      });
    } else {
      flattenGroupOptions(entry, context, output);
    }
  }
};

/**
 * Filter an options tree by a free-text query.
 * Returns one group per top-level section that has matches, containing only
 * the matched option items. Blank queries and total misses return an empty list.
 */
export const filterOptionsTree = (
  tree: OptionsGroup[],
  query: string,
): OptionsGroup[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') return [];

  const result: OptionsGroup[] = [];
  for (const section of tree) {
    const flattened: FlattenedOption[] = [];
    flattenGroupOptions(section, [], flattened);

    const groupContent = flattened
      .filter(({ searchText }) => searchText.toLowerCase().includes(normalizedQuery))
      .map(({ item }) => item);

    if (groupContent.length > 0) {
      result.push({ id: section.id, title: section.title, groupContent });
    }
  }

  return result;
};
