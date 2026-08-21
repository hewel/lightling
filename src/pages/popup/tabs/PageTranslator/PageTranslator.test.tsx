import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AstryxProvider } from '@/components/providers/AstryxProvider';
import { getMessage } from '@/lib/language';
vi.mock('@/requests/backend/recentUsedLanguages/getRecentUsedLanguages', () => ({
  getRecentUsedLanguages: vi.fn(async () => []),
}));
vi.mock('@/requests/backend/recentUsedLanguages/addRecentUsedLanguage', () => ({
  addRecentUsedLanguage: vi.fn(async () => {}),
}));

import { PageTranslator, type PageTranslatorProps } from './PageTranslator';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const baseProps: PageTranslatorProps = {
  translatorFeatures: {
    supportedLanguages: ['en', 'de'],
    isSupportAutodetect: true,
  },
  from: 'en',
  setFrom: vi.fn(),
  to: 'de',
  setTo: vi.fn(),
  hostname: 'example.com',
  sitePreferences: 'default',
  setSitePreferences: vi.fn(),
  languagePreferences: 'disable',
  setLanguagePreferences: vi.fn(),
  isShowOptions: true,
  setIsShowOptions: vi.fn(),
  isTranslated: true,
  toggleTranslate: vi.fn(),
  counters: { resolved: 1, rejected: 0, pending: 0 },
};

describe('PageTranslator log export action', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async (children: ReactNode) => {
    await act(async () => {
      root.render(<AstryxProvider>{children}</AstryxProvider>);
    });
  };

  const findExportButton = () => {
    const label = getMessage('pageTranslator_exportLog');
    return Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === label,
    );
  };

  test('is absent unless the enabled feature supplies an export action', async () => {
    await render(<PageTranslator {...baseProps} />);
    expect(findExportButton()).toBeUndefined();

    const exportLog = vi.fn();
    await render(<PageTranslator {...baseProps} exportLog={exportLog} />);
    const button = findExportButton();
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(exportLog).toHaveBeenCalledOnce();
  });
});
