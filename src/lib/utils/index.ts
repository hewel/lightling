const isNonNullObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

/**
 * Compare JSON-like extension state without serializing it.
 */
export const isDeepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (
    typeof left === 'number' &&
    typeof right === 'number' &&
    Number.isNaN(left) &&
    Number.isNaN(right)
  ) {
    return true;
  }
  if (!isNonNullObject(left) || !isNonNullObject(right)) return false;

  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      isDeepEqual(Reflect.get(left, key), Reflect.get(right, key)),
  );
};

export const getValueAtPath = (value: unknown, path: string): unknown => {
  if (isNonNullObject(value) && Object.prototype.hasOwnProperty.call(value, path)) {
    return Reflect.get(value, path);
  }

  let currentValue = value;
  for (const key of path.split('.')) {
    if (!isNonNullObject(currentValue)) return undefined;
    currentValue = Reflect.get(currentValue, key);
  }
  return currentValue;
};

export const setValueAtPath = (
  value: object,
  path: readonly string[],
  nextValue: unknown,
): void => {
  const property = path.at(-1);
  if (property === undefined) throw new TypeError('Cannot set an empty path');

  let currentValue = value;
  for (const key of path.slice(0, -1)) {
    const nestedValue = Reflect.get(currentValue, key);
    if (!isNonNullObject(nestedValue)) {
      throw new TypeError(`Cannot set path through "${key}"`);
    }
    currentValue = nestedValue;
  }

  if (!Reflect.set(currentValue, property, nextValue)) {
    throw new TypeError(`Cannot set property "${property}"`);
  }
};

export const isTextsContainsSubstring = (
  substring: string,
  texts: string[],
  ignoreCase = true,
) => {
  const textToSearch = ignoreCase ? substring.toLowerCase() : substring;

  const isSomeTextMatch = texts.some((text) => {
    const transformedText = ignoreCase ? text.toLowerCase() : text;
    return transformedText.includes(textToSearch);
  });

  return isSomeTextMatch;
};

/**
 * Return the same string but first letter in uppercase
 */
export const capitalizeString = (string: string) =>
  string[0].toUpperCase() + string.slice(1);

/**
 * Check second object contains all properties of first object with equal values
 */
export const isEqualIntersection = (obj1: unknown, obj2: unknown): boolean => {
  if (!isNonNullObject(obj1) || !isNonNullObject(obj2)) {
    return isDeepEqual(obj1, obj2);
  }

  const obj1IsArray = Array.isArray(obj1);
  const obj2IsArray = Array.isArray(obj2);
  if (obj1IsArray || obj2IsArray) {
    return obj1IsArray && obj2IsArray && isDeepEqual(obj1, obj2);
  }

  return Object.keys(obj1).every((key) =>
    isEqualIntersection(Reflect.get(obj1, key), Reflect.get(obj2, key)),
  );
};
