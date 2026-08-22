import { loadTranslator } from './loadTranslator';

type TranslatorSourceParts = {
  checkLimitExceeding?: string;
  getRequestsTimeout?: string;
  translatorName?: string;
  isRequiredKey?: string;
};

const createTranslatorCode = ({
  checkLimitExceeding = 'checkLimitExceeding() { return 0; }',
  getRequestsTimeout = 'getRequestsTimeout() { return 100; }',
  translatorName = "static translatorName = 'CompleteTranslator';",
  isRequiredKey = 'static isRequiredKey = () => false;',
}: TranslatorSourceParts = {}) => `
  class CompleteTranslator {
    ${translatorName}
    ${isRequiredKey}
    static isSupportedAutoFrom() { return true; }
    static getSupportedLanguages() { return ['en']; }
    translate() { return Promise.resolve(''); }
    translateBatch() { return Promise.resolve([]); }
    getLengthLimit() { return 5000; }
    ${checkLimitExceeding}
    ${getRequestsTimeout}
  }
  CompleteTranslator;
`;

describe('loadTranslator', () => {
  test('accepts a complete TranslatorConstructor-compatible class', () => {
    expect(loadTranslator(createTranslatorCode())).toBeInstanceOf(Function);
  });

  test.each([
    [
      'missing checkLimitExceeding',
      { checkLimitExceeding: '' },
      'Translator method "checkLimitExceeding" is not defined',
    ],
    [
      'malformed checkLimitExceeding',
      { checkLimitExceeding: 'checkLimitExceeding = 0;' },
      'Translator instance member "checkLimitExceeding" is not a function',
    ],
    [
      'missing getRequestsTimeout',
      { getRequestsTimeout: '' },
      'Translator method "getRequestsTimeout" is not defined',
    ],
    [
      'malformed getRequestsTimeout',
      { getRequestsTimeout: 'getRequestsTimeout = 0;' },
      'Translator instance member "getRequestsTimeout" is not a function',
    ],
    [
      'missing translatorName',
      { translatorName: '' },
      'Translator static member "translatorName" is not defined',
    ],
    [
      'malformed translatorName',
      { translatorName: 'static translatorName = 0;' },
      'Translator static member "translatorName" is not a string',
    ],
    [
      'missing isRequiredKey',
      { isRequiredKey: '' },
      'Translator static method "isRequiredKey" is not defined',
    ],
    [
      'malformed isRequiredKey',
      { isRequiredKey: 'static isRequiredKey = false;' },
      'Translator static member "isRequiredKey" is not a function',
    ],
  ] as const)('rejects %s', (_case, overrides, message) => {
    expect(() => loadTranslator(createTranslatorCode(overrides))).toThrow(
      new TypeError(message),
    );
  });
});
