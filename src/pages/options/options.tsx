import { lazy, Suspense } from 'react';
import { Spinner } from '@astryxdesign/core/Spinner';

import { getMessage } from '../../lib/language';
import { renderPage } from '../../lib/renderPage';

// Performance seam: render the page shell before loading the options route.
const OptionsPage = lazy(() =>
  import('./layout/OptionsPage').then(({ OptionsPage }) => ({
    default: OptionsPage,
  })),
);

const LazyOptionsPage = () => (
  <Suspense fallback={<Spinner />}>
    <OptionsPage />
  </Suspense>
);

renderPage({
  PageComponent: LazyOptionsPage,
  title: getMessage('settings_pageTitle'),
});
