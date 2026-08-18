import stylexPlugin from '@stylexjs/babel-plugin';

export default {
  plugins: {
    '@stylexjs/postcss-plugin': {
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      babelConfig: {
        babelrc: false,
        parserOpts: {
          plugins: ['typescript', 'jsx'],
        },
        plugins: [
          [
            stylexPlugin,
            {
              dev: false,
              runtimeInjection: false,
              unstable_moduleResolution: {
                type: 'commonJS',
                rootDir: process.cwd(),
              },
            },
          ],
        ],
      },
      useCSSLayers: false,
    },
    'postcss-rem-to-pixel': {
      rootValue: 16,
      unitPrecision: 5,
      propList: ['*'],
      selectorBlackList: [],
      replace: true,
      mediaQuery: false,
      minUnitValue: 0,
    },
  },
};
