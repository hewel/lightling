import type { PageTranslationOptions } from '../PageTranslationContext';
import type { PageTranslatorConfig } from './PageTranslator';
import {
  PageTranslatorLifecycle,
  type PageTranslatorLifecycleTarget,
} from './PageTranslatorLifecycle';

type PageTranslationDirection = { from: string; to: string };

class FakePageTranslator implements PageTranslatorLifecycleTarget {
  public calls: string[] = [];
  public nullDirection = false;
  public rejectRun = false;
  public deferredRun = false;
  public pendingRuns: Array<{
    from: string;
    to: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  private running = false;
  private pendingRunCount = 0;
  private direction: PageTranslationDirection | null = null;
  public isRun() {
    return this.running || this.pendingRunCount > 0;
  }
  public getTranslateDirection() {
    return this.nullDirection ? null : this.direction;
  }

  public updateConfig(_config: PageTranslatorConfig) {
    this.calls.push('updateConfig');
  }

  public async run(from: string, to: string) {
    this.calls.push(`run:${from}->${to}`);
    if (this.rejectRun) {
      this.rejectRun = false;
      throw new Error('prepare failed');
    }
    if (this.deferredRun) {
      this.pendingRunCount++;
      try {
        await new Promise<void>((resolve, reject) => {
          this.pendingRuns.push({
            from,
            to,
            resolve,
            reject: (error: Error) => reject(error),
          });
        });
      } finally {
        this.pendingRunCount--;
      }
    }
    this.running = true;
    this.direction = { from, to };
  }

  public stop() {
    this.calls.push('stop');
    this.running = false;
    this.direction = null;
  }
}

const translationOptions: PageTranslationOptions = { from: 'en', to: 'de' };

describe('PageTranslatorLifecycle', () => {
  test('updates config without restarting while stopped', () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);

    lifecycle.updateConfig({ lazyTranslate: true });

    expect(pageTranslator.calls).toEqual(['updateConfig']);
  });

  test('restarts with the existing direction when config changes while running', () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);
    lifecycle.updateState(translationOptions);
    pageTranslator.calls = [];

    lifecycle.updateConfig({ lazyTranslate: true });

    expect(pageTranslator.calls).toEqual(['stop', 'updateConfig', 'run:en->de']);
  });

  test('starts and stops from state changes', () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);

    lifecycle.updateState(translationOptions);
    lifecycle.updateState(null);

    expect(pageTranslator.calls).toEqual(['run:en->de', 'stop']);
  });

  test('skips duplicate state changes', () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);

    lifecycle.updateState(translationOptions);
    pageTranslator.calls = [];
    lifecycle.updateState(translationOptions);
    lifecycle.updateState(null);
    pageTranslator.calls = [];
    lifecycle.updateState(null);

    expect(pageTranslator.calls).toEqual([]);
  });

  test('rolls back requested state after startup failure and allows retry', async () => {
    const pageTranslator = new FakePageTranslator();
    const rollback = vi.fn();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator, rollback);
    pageTranslator.rejectRun = true;

    await lifecycle.updateState(translationOptions);

    expect(rollback).toHaveBeenCalledOnce();
    expect(pageTranslator.isRun()).toBe(false);

    await lifecycle.updateState(translationOptions);

    expect(pageTranslator.isRun()).toBe(true);
    expect(pageTranslator.calls).toEqual(['run:en->de', 'run:en->de']);
  });

  test('restarts with a new direction when the translator is running', async () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);
    await lifecycle.updateState({ from: 'en', to: 'de' });
    pageTranslator.calls = [];

    await lifecycle.updateState({ from: 'fr', to: 'es' });

    expect(pageTranslator.calls).toEqual(['stop', 'run:fr->es']);
  });

  test.each(['resolve', 'reject'] as const)(
    'supersedes a deferred startup when the requested direction changes (%s)',
    async (staleOutcome) => {
      const pageTranslator = new FakePageTranslator();
      pageTranslator.deferredRun = true;
      const rollback = vi.fn();
      const lifecycle = new PageTranslatorLifecycle(pageTranslator, rollback);
      const first = lifecycle.updateState({ from: 'en', to: 'de' });
      const second = lifecycle.updateState({ from: 'fr', to: 'es' });

      expect(pageTranslator.calls).toEqual(['run:en->de', 'stop', 'run:fr->es']);
      expect(pageTranslator.pendingRuns).toHaveLength(2);

      const staleRun = pageTranslator.pendingRuns.shift();
      expect(staleRun).toBeDefined();
      if (staleRun === undefined) return;
      if (staleOutcome === 'resolve') staleRun.resolve();
      else staleRun.reject(new Error('stale prepare failed'));
      await first;

      expect(rollback).not.toHaveBeenCalled();
      expect(pageTranslator.calls).toEqual(['run:en->de', 'stop', 'run:fr->es']);

      const currentRun = pageTranslator.pendingRuns.shift();
      expect(currentRun).toBeDefined();
      if (currentRun === undefined) return;
      currentRun.resolve();
      await second;

      expect(pageTranslator.calls).toEqual(['run:en->de', 'stop', 'run:fr->es']);

      await lifecycle.updateState({ from: 'fr', to: 'es' });
      expect(pageTranslator.calls).toEqual(['run:en->de', 'stop', 'run:fr->es']);
    },
  );

  test('throws when a running translator has no direction', async () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);
    await lifecycle.updateState(translationOptions);
    pageTranslator.calls = [];
    pageTranslator.nullDirection = true;

    await expect(lifecycle.updateConfig({ lazyTranslate: true })).rejects.toThrow(
      TypeError,
    );
    expect(pageTranslator.calls).toEqual([]);
  });
});
