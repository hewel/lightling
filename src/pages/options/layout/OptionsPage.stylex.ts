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
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--spacing-3)',
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
  indentHorizontal: {
    display: 'flex',
    gap: 'var(--typography-layout-indent-m-all)',
  },
  indentVertical: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--typography-layout-indent-l-all) * 1.5)',
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
  optionSection: {
    position: 'relative',
    display: {
      default: 'grid',
      '@media (width <= 600px)': 'block',
    },
    gridTemplateColumns: '12.5rem auto',
    gap: '1em',
  },
  changedOptionSection: {
    '::before': {
      backgroundColor: '#f2f5ff',
      display: {
        default: 'block',
        '@media (width <= 600px)': 'none',
      },
      content: '""',
      width: '100%',
      height: '100%',
      position: 'absolute',
      zIndex: -1,
      padding: '0.5em 0',
      marginTop: '-0.5em',
    },
  },
  optionTitle: {
    textAlign: {
      default: 'right',
      '@media (width <= 600px)': 'left',
    },
    lineHeight: '140%',
    fontWeight: {
      default: 'normal',
      '@media (width <= 600px)': 'bold',
    },
    marginBlockEnd: {
      default: 0,
      '@media (width <= 600px)': '0.5rem',
    },
    marginInlineStart: {
      default: '1rem',
      '@media (width <= 600px)': 0,
    },
    ':empty': {
      display: {
        default: 'initial',
        '@media (width <= 600px)': 'none',
      },
    },
  },
  optionContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--typography-layout-indent-m-all)',
    position: {
      default: 'static',
      '@media (width <= 600px)': 'relative',
    },
    marginInlineEnd: {
      default: '1rem',
      '@media (width <= 600px)': 0,
    },
  },
  changedOptionContainer: {
    '::before': {
      backgroundColor: '#f2f5ff',
      display: {
        default: 'none',
        '@media (width <= 600px)': 'block',
      },
      content: '""',
      width: '100%',
      height: '100%',
      position: 'absolute',
      zIndex: -1,
      padding: '0.5em',
      margin: '-0.5em',
    },
  },
  optionDescription: {
    color: 'var(--color-typo-secondary)',
    fontSize: '1rem',
    whiteSpace: 'break-spaces',
    lineHeight: '140%',
  },
  optionErrorMessage: {
    color: 'var(--color-typo-alert)',
    fontSize: 'var(--typography-layout-size-s-font-size)',
  },
  textarea: {
    width: 'min(100%, calc(var(--spacing-10) * 15))',
  },
  checkbox: {
    whiteSpace: 'break-spaces',
  },
});
