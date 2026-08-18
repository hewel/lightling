import { FC } from 'react';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';

interface OptionsNavProps {
  sections: { id: string; title: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Sidebar navigation between options page sections with scroll-spy highlight
 */
export const OptionsNav: FC<OptionsNavProps> = ({ sections, activeId, onSelect }) => {
  return (
    <SideNav>
      {sections.map(({ id, title }) => (
        <SideNavItem
          key={id}
          label={title}
          isSelected={id === activeId}
          onClick={() => onSelect(id)}
        />
      ))}
    </SideNav>
  );
};
