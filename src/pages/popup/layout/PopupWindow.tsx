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
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import * as stylex from '@stylexjs/stylex';
import { IconBook2, IconHistory, IconSettings } from '@tabler/icons-react';

import { Button } from '@/components/primitives/Button/Button.bundle/desktop';
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
    display: 'flex',
    background: 'var(--popup-window-header-fill-color)',
    lineHeight: '4rem',
    padding: '0 var(--typography-layout-indent-l-all)',
    gap: 'var(--typography-layout-indent-l-all)',
  },
  logo: {
    display: 'inline-block',
  },
  logoIcon: {
    display: 'inline-block',
    verticalAlign: 'middle',
    width: '5rem',
    height: 'auto',
  },
  headerMenu: {
    display: 'block',
    fontFamily: 'var(--typography-font-family)',
    textAlign: 'right',
    width: '100%',
    float: 'right',
    lineHeight: 'inherit',
  },
  headerIcon: {
    // Astryx Button's icon wrapper is a 16px flex box; without flexShrink the
    // svg is compressed to it. 24px stays inside the 32px icon-only button.
    flexShrink: 0,
    width: 'var(--spacing-6)',
    height: 'var(--spacing-6)',
    margin: '0 0.2rem',
  },
  tabs: {
    padding: '0.5rem',
    overflowX: 'auto',
  },
  tabsMenu: {
    display: 'flex',
    minWidth: 'max-content',
  },
  content: {
    padding: '0.5rem',
  },
  errorMessage: {
    minWidth: '100%',
  },
  plainText: {
    padding: '2rem 0',
    fontFamily: 'var(--typography-font-family)',
    fontSize: 'var(--typography-layout-size-l-font-size)',
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
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.logo)}>
          <LogoElement {...stylex.props(styles.logoIcon)} />
        </div>
        <div {...stylex.props(styles.headerMenu)}>
          <Button
            as="a"
            type="link"
            url="/pages/history/history.html"
            target="_blank"
            title={getMessage('history_pageTitle')}
            iconRight={<IconHistory {...stylex.props(styles.headerIcon)} />}
            view="clear"
          />
          <Button
            as="a"
            type="link"
            url="/pages/dictionary/dictionary.html"
            target="_blank"
            title={getMessage('dictionary_pageTitle')}
            iconRight={<IconBook2 {...stylex.props(styles.headerIcon)} />}
            view="clear"
          />
          <Button
            as="a"
            type="link"
            url={getOptionsPageUrl()}
            target="_blank"
            title={getMessage('settings_pageTitle')}
            iconRight={<IconSettings {...stylex.props(styles.headerIcon)} />}
            view="clear"
          />
        </div>
      </div>
      <div style={contentStyle}>{content}</div>
    </div>
  );
};
