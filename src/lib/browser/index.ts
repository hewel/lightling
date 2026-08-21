import browser from 'webextension-polyfill';

import { detectLanguage, isValidLanguage } from '../language';

/**
 * Helper to detect platform
 */
export const isMobileBrowser = () => {
  const UA = navigator.userAgent;
  const isMobileUserAgent =
    /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(UA) ||
    /\b(Android|Windows Phone|iPad|iPod)\b/i.test(UA);

  return isMobileUserAgent;
};

export const injectStyles = (paths: string[], parent?: Node) => {
  paths.forEach((path) => {
    const link = document.createElement('link');
    link.href = browser.runtime.getURL(path);
    link.rel = 'stylesheet';
    (parent !== undefined ? parent : document.head).appendChild(link);
  });
};

export const getContentScriptStyles = () => ['content_scripts/content-0.css'];

export const getOptionsPageUrl = () => {
  const optionsPage = browser.runtime.getManifest().options_ui?.page;
  return browser.runtime.getURL(optionsPage ?? 'options/index.html');
};

export const normalizeDetectedLanguage = (language: string | null): string | null => {
  if (language === null) return null;
  const primaryLanguage = language.trim().toLowerCase().split(/[-_]/u)[0];
  return isValidLanguage(primaryLanguage) ? primaryLanguage : null;
};

export function getPageLanguageFromMeta() {
  const html = document.documentElement;

  const langAttributes = ['lang', 'xml:lang'];
  for (const name of langAttributes) {
    const language = normalizeDetectedLanguage(html.getAttribute(name));
    if (language !== null) return language;
  }

  return null;
}

export const isFirefox = () => /firefox/i.test(navigator.userAgent);
export const isChromium = () => /chrome/i.test(navigator.userAgent);
export const isBackgroundContext = () => {
  const manifest = browser.runtime.getManifest() as ReturnType<
    typeof browser.runtime.getManifest
  > & {
    background?: {
      scripts?: string[];
      service_worker?: string;
    };
  };
  const backgroundPaths = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    '_generated_background_page.html',
  ];

  return backgroundPaths.some(
    (path) => typeof path === 'string' && location.href === browser.runtime.getURL(path),
  );
};

const extensionHostname = new URL(browser.runtime.getURL('')).host;
export const isExtensionContext = location.host === extensionHostname;

/**
 * By default detect lang by meta, but while `detectByContent` is `true` its try detect lang by content
 */
export const getPageLanguage = async (detectByContent = false, reliableOnly = false) => {
  const langFromMeta = getPageLanguageFromMeta();

  // Try detect language by content
  if (langFromMeta === null || detectByContent) {
    const contentLang = normalizeDetectedLanguage(
      await detectLanguage(document.body.innerText, reliableOnly),
    );
    if (contentLang !== null) return contentLang;
  }

  return langFromMeta;
};
