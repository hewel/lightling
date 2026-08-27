import type { AppConfigType } from '@/types/runtime';

export const OBFUSCATED_PREFIX = 'enc:v1:';

const OBFUSCATION_SALT = 'linguist-config-obfuscation-v1';
const OBFUSCATION_SALT_BYTES = new TextEncoder().encode(OBFUSCATION_SALT);
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const ARRAY_ITEMS = Symbol('arrayItems');

type SecretPathSegment = string | typeof ARRAY_ITEMS;
type SecretTransform = (value: string) => string;

const SECRET_PATHS: readonly (readonly SecretPathSegment[])[] = [
  ['llmTranslator', 'profiles', ARRAY_ITEMS, 'apiKey'],
];

const xorWithSalt = (bytes: Uint8Array): Uint8Array => {
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] =
      // oxlint-disable-next-line no-bitwise -- XOR is the obfuscation mechanism
      bytes[index] ^ OBFUSCATION_SALT_BYTES[index % OBFUSCATION_SALT_BYTES.length];
  }

  return bytes;
};

const bytesToBinaryString = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
};

const binaryStringToBytes = (binary: string): Uint8Array => {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const obfuscateSecret = (value: string): string => {
  if (value === '') return value;

  const obfuscatedBytes = xorWithSalt(UTF8_ENCODER.encode(value));
  return `${OBFUSCATED_PREFIX}${btoa(bytesToBinaryString(obfuscatedBytes))}`;
};

const revealSecret = (value: string): string => {
  if (!value.startsWith(OBFUSCATED_PREFIX)) return value;

  try {
    const payload = value.slice(OBFUSCATED_PREFIX.length);
    if (payload === '') throw new Error('Missing obfuscated config secret payload');
    const obfuscatedBytes = binaryStringToBytes(atob(payload));
    return UTF8_DECODER.decode(xorWithSalt(obfuscatedBytes));
  } catch {
    throw new Error('Invalid obfuscated config secret');
  }
};

const transformSecretAtPath = (
  value: unknown,
  path: readonly SecretPathSegment[],
  pathIndex: number,
  transform: SecretTransform,
): void => {
  const segment = path[pathIndex];
  if (segment === undefined) return;

  if (segment === ARRAY_ITEMS) {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      transformSecretAtPath(item, path, pathIndex + 1, transform);
    }
    return;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;

  const child: unknown = Reflect.get(value, segment);
  if (pathIndex === path.length - 1) {
    if (typeof child === 'string') Reflect.set(value, segment, transform(child));
    return;
  }

  transformSecretAtPath(child, path, pathIndex + 1, transform);
};

const transformConfigSecrets = (
  config: AppConfigType,
  transform: SecretTransform,
): AppConfigType => {
  const transformedConfig = structuredClone(config);
  for (const path of SECRET_PATHS) {
    transformSecretAtPath(transformedConfig, path, 0, transform);
  }
  return transformedConfig;
};

export const obfuscateConfigSecrets = (config: AppConfigType): AppConfigType =>
  transformConfigSecrets(config, obfuscateSecret);

export const revealConfigSecrets = (config: AppConfigType): AppConfigType =>
  transformConfigSecrets(config, revealSecret);
