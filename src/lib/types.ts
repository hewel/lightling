import { Result, Schema, SchemaAST, SchemaIssue } from 'effect';

export type SyncSchema<T> = Schema.ConstraintDecoder<T>;

const decodeOptions = {
  errors: 'all',
  onExcessProperty: 'preserve',
  propertyOrder: 'original',
  reportInput: true,
} satisfies SchemaAST.ParseOptions;

export const NonNaNNumber = Schema.Number.check(
  Schema.makeFilter((input: number) => !Number.isNaN(input), {
    identifier: 'NonNaNNumber',
    expected: 'a number other than NaN',
  }),
);

export type DecodeStructError = {
  key: string;
  value: unknown;
  type: Schema.Constraint;
  message?: string;
};

type IssuePath = readonly (PropertyKey | { readonly key: PropertyKey })[];

type FlattenedIssue = {
  issue: SchemaIssue.Issue;
  path: IssuePath;
};

const getPathKey = (segment: IssuePath[number]): PropertyKey =>
  typeof segment === 'object' ? segment.key : segment;

const getValueAtPath = (input: unknown, path: IssuePath): unknown => {
  let value = input;

  for (const segment of path) {
    if (value === null || value === undefined) return undefined;
    value = Reflect.get(Object(value), getPathKey(segment));
  }

  return value;
};

const flattenIssue = (
  issue: SchemaIssue.Issue,
  path: IssuePath = [],
): FlattenedIssue[] => {
  switch (issue._tag) {
    case 'Pointer':
      return flattenIssue(issue.issue, [...path, ...issue.path]);
    case 'Composite':
      return issue.issues.flatMap((nestedIssue) => flattenIssue(nestedIssue, path));
    case 'AnyOf':
      return issue.issues.length === 0
        ? [{ issue, path }]
        : issue.issues.flatMap((nestedIssue) => flattenIssue(nestedIssue, path));
    default:
      return [{ issue, path }];
  }
};

const getChildAST = (ast: SchemaAST.AST, key: PropertyKey): SchemaAST.AST | undefined => {
  if (SchemaAST.isObjects(ast)) {
    const property = ast.propertySignatures.find(({ name }) => name === key);
    if (property !== undefined) return property.type;

    return ast.indexSignatures[0]?.type;
  }

  if (SchemaAST.isArrays(ast) && typeof key === 'number') {
    return ast.elements[key] ?? ast.rest.at(-1);
  }

  if (SchemaAST.isUnion(ast)) {
    for (const member of ast.types) {
      const child = getChildAST(member, key);
      if (child !== undefined) return child;
    }
  }

  return undefined;
};

const getASTAtPath = (root: SchemaAST.AST, path: IssuePath): SchemaAST.AST => {
  let ast = root;

  for (const segment of path) {
    const child = getChildAST(ast, getPathKey(segment));
    if (child === undefined) return ast;
    ast = child;
  }

  return ast;
};

const getIssueAST = (
  issue: SchemaIssue.Issue,
  fallback: SchemaAST.AST,
): SchemaAST.AST => {
  switch (issue._tag) {
    case 'InvalidType':
    case 'UnexpectedKey':
    case 'Encoding':
    case 'Composite':
    case 'AnyOf':
    case 'OneOf':
      return issue.ast;
    default:
      return fallback;
  }
};

/**
 * Decode an object and return either its decoded data or structured errors.
 */
export function decodeStruct<S extends SyncSchema<unknown>>(
  schema: S,
  data: unknown,
): { data: S['Type']; errors: null } | { data: null; errors: DecodeStructError[] } {
  const result = Schema.decodeUnknownResult(schema, decodeOptions)(data);

  if (Result.isSuccess(result)) {
    return {
      data: result.success,
      errors: null,
    };
  }

  const formatIssue = SchemaIssue.makeFormatterDefault();

  return {
    data: null,
    errors: flattenIssue(result.failure.issue).map(({ issue, path }) => {
      const fallbackAST = getASTAtPath(schema.ast, path);

      return {
        key: path.map(getPathKey).map(String).join('.'),
        value: getValueAtPath(data, path),
        type: Schema.make(getIssueAST(issue, fallbackAST)),
        message: formatIssue(issue),
      };
    }),
  };
}

/**
 * Decode data synchronously, optionally returning a fallback for invalid input.
 */
export function tryDecode<S extends SyncSchema<unknown>>(
  schema: S,
  data: unknown,
): S['Type'];
export function tryDecode<S extends SyncSchema<unknown>>(
  schema: S,
  data: unknown,
  defaultData: S['Type'],
): S['Type'];
export function tryDecode<S extends SyncSchema<unknown>>(
  schema: S,
  data: unknown,
  defaultData?: S['Type'],
) {
  const result = Schema.decodeUnknownResult(schema, decodeOptions)(data);
  if (Result.isSuccess(result)) return result.success;

  if (arguments.length >= 3) return defaultData;

  console.error('Data for the error below', data);
  throw new TypeError('Invalid type');
}

const isStructSchema = (
  schema: Schema.Constraint,
): schema is Schema.Struct<Schema.Struct.Fields> => 'fields' in schema;

/**
 * Validate a value against the schema field at the provided object path.
 */
export const checkTypeByPath = <S extends Schema.Struct<Schema.Struct.Fields>>(
  schema: S,
  path: readonly string[],
  value: unknown,
): boolean => {
  let current: Schema.Constraint = schema;

  for (const segment of path) {
    if (!isStructSchema(current)) return false;

    const next = current.fields[segment];
    if (next === undefined) return false;
    current = next;
  }

  return Schema.is(current)(value);
};
