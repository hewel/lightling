import { SelectTranslatorManager } from './SelectTranslatorManager';

export class SelectTranslatorController {
  private readonly manager: SelectTranslatorManager;
  constructor(manager: SelectTranslatorManager) {
    this.manager = manager;
  }

  public translateSelectedText() {
    this.manager.translateSelectedText();
  }
}
