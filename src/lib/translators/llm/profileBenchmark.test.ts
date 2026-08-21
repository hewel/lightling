import {
  measureTranslationProfileObservation,
  translationProfileBenchmarkFixtures,
} from './profileBenchmark';

describe('translation profile benchmark utility', () => {
  test('contains structural, contextual, adversarial, and mixed-language fixtures', () => {
    expect(translationProfileBenchmarkFixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        'repeated-ui',
        'polysemous-actions',
        'inline-placeholders',
        'technical-terminology',
        'connected-prose',
        'adversarial-page-content',
        'mixed-language-content',
      ]),
    );
  });

  test('measures structural correctness without inventing a universal semantic score', () => {
    const measurement = measureTranslationProfileObservation({
      fixtureId: 'inline-placeholders',
      rawResponse: JSON.stringify({
        translations: [
          ['inline-1', '单击 <g id="1">保存</g> 以继续。'],
          ['protected-1', '在终端中运行 <x id="command-1"/>。'],
        ],
      }),
      sourceTokens: 24,
      completionTokens: 28,
      latencyMs: 1000,
      firstVisibleLatencyMs: 400,
      retries: 0,
      requestCount: 1,
      uniqueSourceCount: 2,
    });

    expect(measurement).toMatchObject({
      validStructuredResponse: true,
      completeIdRate: 1,
      placeholderPreservationRate: 1,
      retryRate: 0,
      throughputTokensPerSecond: 52,
    });
    expect(measurement).not.toHaveProperty('translationQualityScore');
  });
});
