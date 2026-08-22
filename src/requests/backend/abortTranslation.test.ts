import { abortTranslation, abortTranslationFactory } from './abortTranslation';

describe('abortTranslation', () => {
  test('calls translateManager.abort with context and resolves', async () => {
    const abortMock = vi.fn(async (_context: string) => {});
    const cleanup = abortTranslationFactory({
      config: {} as never,
      backgroundContext: {
        getTranslateManager: async () => ({
          abort: abortMock,
        }),
      } as never,
    });

    try {
      await abortTranslation({ context: 'test-context-uuid-1234' });
      expect(abortMock).toHaveBeenCalledTimes(1);
      expect(abortMock).toHaveBeenCalledWith('test-context-uuid-1234');
    } finally {
      cleanup();
    }
  });
});
