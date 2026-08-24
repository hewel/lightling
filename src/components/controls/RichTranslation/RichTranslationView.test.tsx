import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { RichNodeInfo } from '@/lib/richTranslation/model';

import { RichTranslationView } from './RichTranslationView';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('RichTranslationView', () => {
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

  async function renderView(
    markup: string,
    nodes: Readonly<Record<string, RichNodeInfo>>,
  ) {
    await act(async () => {
      root.render(<RichTranslationView markup={markup} nodes={nodes} />);
    });
  }

  test('renders nested inline and block nodes as semantic elements', async () => {
    await renderView(
      '<g id="heading">Title</g><g id="paragraph">A <g id="strong">bold <g id="em">thought</g></g> with <g id="code">code()</g>.</g><g id="list"><g id="item">Entry</g></g><g id="quote">Quote</g><g id="pre">line 1\nline 2</g>',
      {
        heading: { tag: 'h2' },
        paragraph: { tag: 'p' },
        strong: { tag: 'strong' },
        em: { tag: 'em' },
        code: { tag: 'code' },
        list: { tag: 'ul' },
        item: { tag: 'li' },
        quote: { tag: 'blockquote' },
        pre: { tag: 'pre' },
      },
    );

    expect(container.querySelector('h2')?.textContent).toBe('Title');
    expect(container.querySelector('p > strong > em')?.textContent).toBe('thought');
    expect(container.querySelector('p > code')?.textContent).toBe('code()');
    expect(container.querySelector('ul > li')?.textContent).toBe('Entry');
    expect(container.querySelector('blockquote')?.textContent).toBe('Quote');
    expect(container.querySelector('pre')?.textContent).toBe('line 1\nline 2');
  });

  test('unwraps containers whose id is unknown while retaining descendants', async () => {
    await renderView('<g id="unknown">kept <g id="known">child</g></g>', {
      known: { tag: 'strong' },
    });

    expect(container.textContent).toBe('kept child');
    expect(container.querySelector('g')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('child');
  });

  test('renders javascript links as plain text', async () => {
    await renderView('<g id="link">unsafe</g>', {
      link: { tag: 'a', href: 'javascript:alert(1)' },
    });

    expect(container.textContent).toBe('unsafe');
    expect(container.querySelector('a')).toBeNull();
  });

  test('preserves https links with safe external-link attributes', async () => {
    await renderView('<g id="link">Example</g>', {
      link: { tag: 'a', href: '  https://example.com/docs  ' },
    });

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
  });

  test.each(['data:text/html,unsafe', 'vbscript:msgbox(1)'])(
    'renders %s links without an anchor',
    async (href) => {
      await renderView('<g id="link">unsafe</g>', {
        link: { tag: 'a', href },
      });

      expect(container.textContent).toBe('unsafe');
      expect(container.querySelector('a')).toBeNull();
    },
  );

  test('falls back to stripped plain text when markup parsing fails', async () => {
    await renderView('<g id="r1">unclosed', {
      r1: { tag: 'strong' },
    });

    expect(container.textContent).toBe('unclosed');
    expect(container.children).toHaveLength(0);
  });

  test('preserves mailto links', async () => {
    await renderView('<g id="link">Email</g>', {
      link: { tag: 'a', href: 'mailto:hello@example.com' },
    });

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('mailto:hello@example.com');
    expect(link?.textContent).toBe('Email');
  });
});
