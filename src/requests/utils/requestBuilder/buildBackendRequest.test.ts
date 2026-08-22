import { Schema } from 'effect';

import { buildBackendRequest } from './buildBackendRequest';

type Request = {
  value: string;
};

const RequestSchema = Schema.Struct({
  value: Schema.String,
});

describe('buildBackendRequest local dispatch validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rejects malformed requests before invoking the local handler', async () => {
    const handler = vi.fn(async ({ value }: Request) => value.toUpperCase());
    const [factory, request] = buildBackendRequest<Request, string>('test', {
      requestValidator: RequestSchema,
      responseValidator: Schema.String,
      factoryHandler: () => handler,
    });
    const cleanup = factory({} as never);

    try {
      await expect(request({ value: 123 } as never)).rejects.toThrow('Invalid type');
      expect(handler).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  test('rejects malformed local handler responses', async () => {
    const handler = vi.fn(async () => 123 as never);
    const [factory, request] = buildBackendRequest<Request, string>('test', {
      requestValidator: RequestSchema,
      responseValidator: Schema.String,
      factoryHandler: () => handler,
    });
    const cleanup = factory({} as never);

    try {
      await expect(request({ value: 'valid' })).rejects.toThrow('Invalid type');
      expect(handler).toHaveBeenCalledWith({ value: 'valid' });
    } finally {
      cleanup();
    }
  });

  test('passes valid requests and responses through local dispatch', async () => {
    const handler = vi.fn(async ({ value }: Request) => value.toUpperCase());
    const [factory, request] = buildBackendRequest<Request, string>('test', {
      requestValidator: RequestSchema,
      responseValidator: Schema.String,
      factoryHandler: () => handler,
    });
    const cleanup = factory({} as never);

    try {
      await expect(request({ value: 'valid' })).resolves.toBe('VALID');
      expect(handler).toHaveBeenCalledWith({ value: 'valid' });
    } finally {
      cleanup();
    }
  });
});
