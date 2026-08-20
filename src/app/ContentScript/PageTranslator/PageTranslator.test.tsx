import { PageTranslator } from './PageTranslator';

const translateCalls: {
  text: string;
  from: string;
  to: string;
  options?: { priority?: number; context?: string };
}[] = [];

vi.mock('@/requests/backend/translate', () => ({
  translate: vi.fn(
    async (
      text: string,
      from: string,
      to: string,
      options?: { priority?: number; context?: string },
    ) => {
      translateCalls.push({ text, from, to, options });
      return `tr:${text}`;
    },
  ),
}));

const abortCalls: { context: string }[] = [];

vi.mock('@/requests/backend/abortTranslation', () => ({
  abortTranslation: vi.fn(async (payload: { context: string }) => {
    abortCalls.push(payload);
  }),
}));

vi.mock('./requests/pageTranslatorStatsUpdated', () => ({
  pageTranslatorStatsUpdated: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({
  getContentScriptStyles: () => [],
}));

describe('PageTranslator lifecycle and cancellation context', () => {
  beforeEach(() => {
    translateCalls.length = 0;
    abortCalls.length = 0;
    document.body.innerHTML = '<div><p>Hello world</p><p>Testing text</p></div>';
  });

  test('run() translates nodes with UUID context, stop() aborts with same UUID, and next run() uses a new UUID', async () => {
    const pageTranslator = new PageTranslator({});

    // First run
    pageTranslator.run('en', 'de');

    await vi.waitFor(() => {
      expect(translateCalls.length).toBeGreaterThan(0);
    });

    const firstRunContexts = translateCalls.map((c) => c.options?.context);
    expect(firstRunContexts.length).toBeGreaterThan(0);
    const firstContext = firstRunContexts[0];
    expect(typeof firstContext).toBe('string');
    expect(firstContext).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    for (const ctx of firstRunContexts) {
      expect(ctx).toBe(firstContext);
    }

    // Stop first run
    pageTranslator.stop();

    expect(abortCalls.length).toBe(1);
    expect(abortCalls[0]).toEqual({ context: firstContext });

    // Second run
    translateCalls.length = 0;
    pageTranslator.run('en', 'fr');

    await vi.waitFor(() => {
      expect(translateCalls.length).toBeGreaterThan(0);
    });

    const secondRunContexts = translateCalls.map((c) => c.options?.context);
    expect(secondRunContexts.length).toBeGreaterThan(0);
    const secondContext = secondRunContexts[0];
    expect(typeof secondContext).toBe('string');
    expect(secondContext).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(secondContext).not.toBe(firstContext);

    for (const ctx of secondRunContexts) {
      expect(ctx).toBe(secondContext);
    }

    // Stop second run
    pageTranslator.stop();

    expect(abortCalls.length).toBe(2);
    expect(abortCalls[1]).toEqual({ context: secondContext });
  });
});
