import type { Config } from '@docusaurus/types';

import i18nPages from './src/plugins/i18n-pages';

const config: Config = {
  title: 'Lightling – Privacy‑First Translation Extension for Chrome and Firefox',
  tagline:
    'Browser extension that translates web pages, selected text, and subtitles. Works instantly and supports offline translation.',

  favicon: 'favicon.ico',

  plugins: [
    i18nPages([
      {
        url: '/{{locale}}',
        pageComponent: '@site/src/features/Landing',
        i18n: {
          localesDir: './src/i18n/locales',
          defaultLocale: 'en',
          namespaces: ['landing'],
        },
      },
    ]),
  ],

  // Set the production url of your site here
  url: 'https://hewel.github.io',
  // Set the /<baseUrl>/ pathname under which the site is served
  baseUrl: '/lightling/',

  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          path: '../../docs',
          include: ['{*,**/*}.md', '{*,**/*}.mdx'],
          sidebarCollapsed: false,
          sidebarPath: require.resolve('./sidebars.ts'),
        },
        blog: {
          blogTitle: 'Lightling blog',
          blogDescription:
            'A blog about Lightling, privacy-first translation in your browser',
          postsPerPage: 'ALL',
          blogSidebarCount: 0,
        },
      },
    ],
  ],

  themeConfig: {
    image: 'img/app.png',
    metadata: [{ name: 'twitter:card', content: 'summary_large_image' }],
    colorMode: {
      defaultMode: 'light',
      disableSwitch: true,
      respectPrefersColorScheme: true,
    },
    navbar: {
      logo: {
        alt: 'Lightling',
        src: 'logo.svg',
        href: '/lightling/',
        target: '_self',
        width: 100,
      },
      items: [
        {
          to: '/blog',
          label: 'Blog',
          position: 'right',
          target: '_self',
        },
        {
          to: '/docs',
          label: 'Docs',
          position: 'right',
          target: '_self',
        },
        {
          href: 'https://github.com/hewel/lightling',
          label: 'GitHub',
          position: 'right',
          target: '_blank',
        },
      ],
    },
    footer: {
      copyright: `Copyright © ${new Date().getFullYear()} PrimeBits. Built with Docusaurus.`,
    },
  },
} satisfies Config;

export default config;
