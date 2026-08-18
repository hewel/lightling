// Resources
import '../polyfills/scrollfix';

import { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

import { AstryxProvider } from '../components/providers/AstryxProvider';

type Options = {
  title?: string;
  styles?: string[];
  scripts?: string[];
  rootNode?: Element | null;
  PageComponent: ComponentType;
};

/**
 * Helper for render page
 */
export const renderPage = ({
  title,
  PageComponent,
  rootNode = document.body.querySelector('#root'),
}: Options) => {
  if (title !== undefined) {
    document.title = title;
  }

  function render() {
    if (rootNode !== null && rootNode instanceof HTMLElement) {
      createRoot(rootNode).render(
        <AstryxProvider>
          <PageComponent />
        </AstryxProvider>,
      );
    }
  }

  // Render as fast as possible
  if (document.readyState == 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
};
