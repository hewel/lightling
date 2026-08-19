import * as stylex from '@stylexjs/stylex';

export const optionsPageStyles = stylex.create({
  page: {
    padding: {
      default:
        'var(--typography-layout-indent-l-all) var(--typography-layout-indent-m-all) 0',
      '@media (width <= 600px)': 'var(--typography-layout-indent-l-all)',
    },
    maxWidth: '100%',
  },
  optionsTree: {
    margin: '4rem 0',
  },
  confirmMenu: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 'var(--spacing-3) var(--spacing-6)',
    background: 'var(--options-page-dialog-fill-color)',
    borderTop: '1px solid var(--color-border)',
    zIndex: 999,
  },
  navColumn: {
    width: 'calc(var(--spacing-10) * 6)',
    flexShrink: 0,
    position: 'sticky',
    top: 'var(--spacing-6)',
    alignSelf: 'flex-start',
    display: {
      default: 'flex',
      '@media (width <= 768px)': 'none',
    },
  },
  contentColumn: {
    flexGrow: 1,
    minWidth: 0,
    paddingBlockEnd: 'calc(var(--spacing-10) * 2)',
  },
  headerSubtitle: {
    marginBlockEnd: 'var(--typography-layout-indent-m-all)',
  },
  indentVertical: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--typography-layout-indent-l-all) * 1.5)',
  },
  relaxedFieldSpacing: {
    gap: 'var(--spacing-10)',
  },
  pageSectionTitle: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginBlockEnd: '1rem',
  },
  mainGroups: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4rem',
  },
  subgroups: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2.5rem',
  },
  optionDescription: {
    whiteSpace: 'pre-wrap',
  },
  textarea: {
    width: 'min(100%, calc(var(--spacing-10) * 15))',
  },
  checkbox: {
    whiteSpace: 'break-spaces',
  },
});
