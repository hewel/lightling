import { defaultConfig } from '@/config';
import type { AppConfigType } from '@/types/runtime';

import {
  OBFUSCATED_PREFIX,
  obfuscateConfigSecrets,
  revealConfigSecrets,
} from './configObfuscation';

const createConfig = (apiKey: string): AppConfigType => {
  const config = structuredClone(defaultConfig);
  config.llmTranslator.profiles[0]!.apiKey = apiKey;
  return config;
};

describe('config secret obfuscation', () => {
  test('round-trips every configured secret', () => {
    const config = createConfig('first-secret');
    const secondProfile = structuredClone(config.llmTranslator.profiles[0]!);
    secondProfile.name = 'Second profile';
    secondProfile.apiKey = 'second-secret';
    config.llmTranslator.profiles.push(secondProfile);

    const obfuscated = obfuscateConfigSecrets(config);

    expect(obfuscated.llmTranslator.profiles[0]!.apiKey).toMatch(
      new RegExp(`^${OBFUSCATED_PREFIX}`),
    );
    expect(obfuscated.llmTranslator.profiles[1]!.apiKey).toMatch(
      new RegExp(`^${OBFUSCATED_PREFIX}`),
    );
    expect(revealConfigSecrets(obfuscated)).toEqual(config);
  });

  test('passes through plaintext secrets from old config exports', () => {
    const config = createConfig('plaintext-api-key');

    expect(revealConfigSecrets(config)).toEqual(config);
  });

  test('leaves empty secrets unchanged', () => {
    const config = createConfig('');

    expect(obfuscateConfigSecrets(config).llmTranslator.profiles[0]!.apiKey).toBe('');
    expect(revealConfigSecrets(config).llmTranslator.profiles[0]!.apiKey).toBe('');
  });

  test('rejects corrupt obfuscated secrets', () => {
    const config = createConfig(`${OBFUSCATED_PREFIX}%%%`);

    expect(() => revealConfigSecrets(config)).toThrow(
      new Error('Invalid obfuscated config secret'),
    );
  });

  test('round-trips unicode secrets', () => {
    const config = createConfig('密钥-ключ-🔑');

    expect(revealConfigSecrets(obfuscateConfigSecrets(config))).toEqual(config);
  });

  test('does not mutate the input while obfuscating', () => {
    const config = createConfig('unchanged-secret');
    const original = structuredClone(config);

    const obfuscated = obfuscateConfigSecrets(config);

    expect(config).toEqual(original);
    expect(obfuscated).not.toBe(config);
    expect(obfuscated.llmTranslator).not.toBe(config.llmTranslator);
    expect(obfuscated.llmTranslator.profiles).not.toBe(config.llmTranslator.profiles);
    expect(obfuscated.llmTranslator.profiles[0]).not.toBe(
      config.llmTranslator.profiles[0],
    );
  });
});
