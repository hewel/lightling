import {
  createContext,
  FC,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack } from '@astryxdesign/core/Stack';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import * as stylex from '@stylexjs/stylex';
import { IconBook2, IconHistory, IconSettings } from '@tabler/icons-react';

import { getOptionsPageUrl, isMobileBrowser } from '@/lib/browser';
import { getMessage } from '@/lib/language';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { XResizeObserver } from '@/lib/XResizeObserver';
import LogoElement from '@/res/logo-base.svg';
import { AppConfigType } from '@/types/runtime';

const styles = stylex.create({
  root: {
    minWidth: 'max-content',
    width: '100%',
  },
  mobile: {
    maxWidth: '100vw',
  },
  header: {
    background: 'var(--color-background-muted)',
  },
  logoIcon: {
    display: 'inline-block',
    width: '5rem',
    height: 'auto',
  },
  tabs: {
    padding: 'var(--spacing-2) var(--spacing-3) 0',
    overflowX: 'auto',
  },
  tabsMenu: {
    display: 'flex',
    minWidth: 'max-content',
  },
  content: {
    padding: 'var(--spacing-3)',
  },
  errorMessage: {
    minWidth: '100%',
  },
  plainText: {
    padding: 'var(--spacing-8) 0',
    fontSize: 'var(--text-large-size)',
    textAlign: 'center',
  },
});

export type TranslatorFeatures = {
  supportedLanguages: string[];
  isSupportAutodetect: boolean;
};

export interface TabData {
  id: string;
  config: AppConfigType;
  translatorFeatures: TranslatorFeatures;
  isMobile: boolean;
}

export type InitFn<T extends object> = (props: TabData) => Promise<T>;

type PopupTabInitData = object;
type TabInitFunction = InitFn<PopupTabInitData>;
type TabInitData<I extends TabInitFunction> = I extends InitFn<infer Data> ? Data : never;
type TabRenderer<I extends TabInitFunction> = {
  bivarianceHack(props: TabData & { initData: TabInitData<I> }): ReactNode;
}['bivarianceHack'];

export type TabComponent<I extends TabInitFunction> = TabRenderer<I> & { init: I };

export interface IPopupWindowTab {
  id: string;
  component: TabComponent<TabInitFunction>;
}

interface PaneItem {
  id: string;
  content: ReactNode;
}

export interface PopupWindowProps {
  /**
   * Root element for detect decreasing size
   */
  rootElement: HTMLElement;

  /**
   * Error message which show instead tabs
   */
  error?: ReactNode;

  /**
   * Tabs list
   */
  tabs?: IPopupWindowTab[];

  // Knobs to control it outside and be able keep and restore last state
  activeTab?: string;
  setActiveTab?: (id: string) => void;

  /**
   * Set min width of window
   */
  minWidth?: number;

  // NOTE: it not used here, only forward, maybe should move it to components init hook
  config?: AppConfigType;
  translatorFeatures?: TranslatorFeatures;
}

export type PopupWindowContextProps = { activeTab?: string };
export const PopupWindowContext = createContext<PopupWindowContextProps>({});

/**
 * Component which represent popup window.
 *
 * It's contain tabs with some content and API for async preload tabs data
 * While tabs load data, component will render spinner
 */
export const PopupWindow: FC<PopupWindowProps> = ({
  config,
  translatorFeatures,
  error,
  tabs,
  activeTab: activeTabId,
  setActiveTab,
  rootElement,
  minWidth,
}) => {
  useLayoutEffect(() => {
    telemetry.track(TELEMETRY_EVENT_NAME.POPUP_OPENED);
  }, []);

  // Resize window
  const resizeObserver = useRef<XResizeObserver | undefined>(undefined);
  useEffect(() => {
    // Disable on mobile browsers
    if (isMobileBrowser()) return;

    resizeObserver.current = new XResizeObserver({
      sizeGetter: (node: Element) => ({
        height: node.scrollHeight,
        width: node.scrollWidth,
      }),
    });

    const doc = document.body;
    const wrap = rootElement;

    // Hack which implement resize body in firefox
    // It need when popup wrap have overflow items (like language selector)
    // Standard ResizeObserver can't track this even with option `box: 'border-box'`
    const isFirefox = /firefox/i.test(navigator.userAgent);
    if (isFirefox) {
      // TODO: fix size decreasing
      // Size decreasing is not work now. Block is hungry. Else it work, but layout always small
      // Max size remember module below is not affect on this problem

      resizeObserver.current.addHandler(wrap, () => {
        let wCounter = 0;
        while (wCounter < 2) {
          if (doc.scrollWidth > doc.clientWidth) {
            doc.style.width = doc.scrollWidth + 'px';
            break;
          } else if (wCounter < 2) {
            // Reset size for handle in next tick
            doc.style.width = '';
          }

          wCounter++;
        }

        let hCounter = 0;
        while (hCounter < 2) {
          if (doc.scrollHeight > doc.clientHeight) {
            doc.style.height = doc.scrollHeight + 'px';
            break;
          } else if (hCounter < 2) {
            // Reset size for handle in next tick
            doc.style.height = '';
          }

          hCounter++;
        }
      });
    }

    // Remember max width to prevent resize while switch between tabs
    let lastMaxWidth = 0;
    resizeObserver.current.addHandler(wrap, () => {
      const currentWidth = wrap.scrollWidth;

      doc.style.width = '';
      const resetWidth = wrap.scrollWidth;

      lastMaxWidth = Math.max(lastMaxWidth, currentWidth, resetWidth);
      doc.style.width = lastMaxWidth + 'px';
    });

    return () => {
      if (resizeObserver.current !== undefined) {
        resizeObserver.current.purgeHandlers(rootElement);
      }
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  // Render panes

  const [panes, setPanes] = useState<PaneItem[] | null>(null);
  const panesRenderContext = useRef({});

  const isMobile = useMemo(() => isMobileBrowser(), []);

  useEffect(() => {
    // Update context
    const renderContext = {};
    panesRenderContext.current = renderContext;

    // Prevent render without data
    if (tabs === undefined || translatorFeatures === undefined || config === undefined) {
      return;
    }

    // Async bootstrap wrapper
    (async () => {
      const panes = await Promise.all(
        tabs.map(async ({ id, component: Pane }) => {
          const paneProps: TabData = {
            translatorFeatures,
            config,
            id,
            isMobile,
          };

          // Call and await init function
          const initData = await Pane.init(paneProps);

          return {
            id,
            content: <Pane {...paneProps} initData={initData} />,
          };
        }),
      );

      // Check context before set data, to prevent set outdated panes
      if (panesRenderContext.current === renderContext) {
        setPanes(panes);
      }
    })();
  }, [config, isMobile, tabs, translatorFeatures]);

  // Render content

  let content: ReactNode;
  if (error !== undefined) {
    content = <div {...stylex.props(styles.errorMessage, styles.plainText)}>{error}</div>;
  } else if (tabs !== undefined && activeTabId !== undefined && panes !== null) {
    content = (
      <>
        <div {...stylex.props(styles.tabs)}>
          <TabList
            xstyle={styles.tabsMenu}
            layout="fill"
            hasDivider
            value={activeTabId}
            onChange={(id) => setActiveTab?.(id)}
            aria-label={getMessage('ext_name')}
          >
            {tabs.map(({ id }) => (
              <Tab key={id} value={id} label={getMessage(`popup_tab_${id}`)} />
            ))}
          </TabList>
        </div>

        <div {...stylex.props(styles.content)}>
          <PopupWindowContext.Provider value={{ activeTab: activeTabId }}>
            {panes.map(({ id, content }) => (
              <section
                key={id}
                aria-label={getMessage(`popup_tab_${id}`)}
                hidden={id !== activeTabId}
              >
                {content}
              </section>
            ))}
          </PopupWindowContext.Provider>
        </div>
      </>
    );
  } else {
    content = <Spinner />;
  }

  const contentStyle = useMemo(
    () => ({ minWidth: minWidth !== undefined ? minWidth + 'px' : undefined }),
    [minWidth],
  );

  return (
    <div {...stylex.props(isMobile ? styles.mobile : styles.root)}>
      <HStack
        align="center"
        justify="between"
        gap={2}
        paddingBlock={2}
        paddingInline={3}
        width="100%"
        xstyle={styles.header}
      >
        <LogoElement {...stylex.props(styles.logoIcon)} />
        <HStack gap={1} align="center">
          <IconButton
            href="/pages/history/history.html"
            target="_blank"
            label={getMessage('history_pageTitle')}
            tooltip={getMessage('history_pageTitle')}
            icon={<IconHistory />}
            variant="ghost"
          />
          <IconButton
            href="/pages/dictionary/dictionary.html"
            target="_blank"
            label={getMessage('dictionary_pageTitle')}
            tooltip={getMessage('dictionary_pageTitle')}
            icon={<IconBook2 />}
            variant="ghost"
          />
          <IconButton
            href={getOptionsPageUrl()}
            target="_blank"
            label={getMessage('settings_pageTitle')}
            tooltip={getMessage('settings_pageTitle')}
            icon={<IconSettings />}
            variant="ghost"
          />
        </HStack>
      </HStack>
      <div style={contentStyle}>{content}</div>
    </div>
  );
};
