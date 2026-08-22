import type { PageTranslationOptions } from '../PageTranslationContext';
import type { PageTranslatorConfig } from './PageTranslator';

type PageTranslationDirection = { from: string; to: string };

export interface PageTranslatorLifecycleTarget {
  isRun(): boolean;
  getTranslateDirection(): PageTranslationDirection | null;
  updateConfig(config: PageTranslatorConfig): void;
  run(from: string, to: string): void;
  stop(): void;
}

export class PageTranslatorLifecycle {
  private readonly pageTranslator: PageTranslatorLifecycleTarget;

  constructor(pageTranslator: PageTranslatorLifecycleTarget) {
    this.pageTranslator = pageTranslator;
  }

  public updateConfig(config: PageTranslatorConfig): void {
    if (!this.pageTranslator.isRun()) {
      this.pageTranslator.updateConfig(config);
      return;
    }

    const direction = this.pageTranslator.getTranslateDirection();
    if (direction === null) {
      throw new TypeError('Invalid response from getTranslateDirection method');
    }

    this.pageTranslator.stop();
    this.pageTranslator.updateConfig(config);
    this.pageTranslator.run(direction.from, direction.to);
  }

  public updateState(pageTranslation: PageTranslationOptions | null): void {
    const shouldTranslate = pageTranslation !== null;
    if (shouldTranslate === this.pageTranslator.isRun()) return;

    if (pageTranslation !== null) {
      this.pageTranslator.run(pageTranslation.from, pageTranslation.to);
    } else {
      this.pageTranslator.stop();
    }
  }
}
