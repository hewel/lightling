import { FC } from 'react';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import {
  IconChartBar,
  IconClockHour4,
  IconDatabase,
  IconHighlight,
  IconHistory,
  IconKeyboard,
  IconLanguage,
  IconSettings,
  IconVolume,
  IconWorld,
  type TablerIcon,
} from '@tabler/icons-react';

/**
 * Icons for top-level option groups, keyed by the section ids defined in
 * `generateTree`. Groups without an entry render with no icon.
 */
export const SECTION_ICONS: Record<string, TablerIcon> = {
  general: IconSettings,
  translator: IconLanguage,
  scheduler: IconClockHour4,
  cache: IconDatabase,
  tts: IconVolume,
  'page-translation': IconWorld,
  'select-translation': IconHighlight,
  'text-translation': IconKeyboard,
  'popup-history': IconHistory,
  statistics: IconChartBar,
};

interface OptionsNavProps {
  sections: { id: string; title: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Sidebar navigation that switches between options page sections
 */
export const OptionsNav: FC<OptionsNavProps> = ({ sections, activeId, onSelect }) => {
  return (
    <SideNav>
      {sections.map(({ id, title }) => (
        <SideNavItem
          key={id}
          label={title}
          icon={SECTION_ICONS[id]}
          isSelected={id === activeId}
          onClick={() => onSelect(id)}
        />
      ))}
    </SideNav>
  );
};
