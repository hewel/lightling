import { Background } from '.';

describe('Background', () => {
  test('owns one translation budget storage service', () => {
    const background = new Background({} as never);

    expect(background.getTranslationBudgetStorage()).toBe(
      background.getTranslationBudgetStorage(),
    );
  });
});
