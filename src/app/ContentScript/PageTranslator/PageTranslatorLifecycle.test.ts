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

  private running = false;
  private direction: PageTranslationDirection | null = null;

  public isRun() {
    return this.running;
  }

  public getTranslateDirection() {
    return this.nullDirection ? null : this.direction;
  }

  public updateConfig(_config: PageTranslatorConfig) {
    this.calls.push('updateConfig');
  }

  public run(from: string, to: string) {
    this.calls.push(`run:${from}->${to}`);
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

  test('throws when a running translator has no direction', () => {
    const pageTranslator = new FakePageTranslator();
    const lifecycle = new PageTranslatorLifecycle(pageTranslator);
    lifecycle.updateState(translationOptions);
    pageTranslator.calls = [];
    pageTranslator.nullDirection = true;

    expect(() => lifecycle.updateConfig({ lazyTranslate: true })).toThrow(TypeError);
    expect(pageTranslator.calls).toEqual([]);
  });
});
