import type { PageTranslationOptions } from '../PageTranslationContext';
import type { PageTranslatorConfig } from './PageTranslator';

type PageTranslationDirection = { from: string; to: string };

export interface PageTranslatorLifecycleTarget {
  isRun(): boolean;
  getTranslateDirection(): PageTranslationDirection | null;
  updateConfig(config: PageTranslatorConfig): void;
  run(from: string, to: string): Promise<void>;
  stop(): void;
}

export class PageTranslatorLifecycle {
  private readonly pageTranslator: PageTranslatorLifecycleTarget;
  private readonly onStartupFailure: () => void;
  private requestGeneration = 0;
  private requestedState: PageTranslationOptions | null = null;

  constructor(
    pageTranslator: PageTranslatorLifecycleTarget,
    onStartupFailure = () => {},
  ) {
    this.pageTranslator = pageTranslator;
    this.onStartupFailure = onStartupFailure;
  }

  private readonly start = async (
    direction: PageTranslationDirection,
    generation: number,
  ): Promise<void> => {
    try {
      await this.pageTranslator.run(direction.from, direction.to);
    } catch {
      if (
        generation === this.requestGeneration &&
        this.requestedState !== null &&
        !this.pageTranslator.isRun()
      ) {
        this.requestedState = null;
        this.onStartupFailure();
      }
    }
  };

  public async updateConfig(config: PageTranslatorConfig): Promise<void> {
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
    const generation = ++this.requestGeneration;
    await this.start(direction, generation);
  }

  public async updateState(
    pageTranslation: PageTranslationOptions | null,
  ): Promise<void> {
    const sameRequestedState =
      pageTranslation === this.requestedState ||
      (pageTranslation !== null &&
        this.requestedState !== null &&
        pageTranslation.from === this.requestedState.from &&
        pageTranslation.to === this.requestedState.to);
    if (sameRequestedState) return;

    const wasRunning = this.pageTranslator.isRun();
    this.requestedState = pageTranslation;
    const generation = ++this.requestGeneration;
    if (pageTranslation === null) {
      if (wasRunning) this.pageTranslator.stop();
      return;
    }

    if (wasRunning) this.pageTranslator.stop();
    await this.start(pageTranslation, generation);
  }
}
