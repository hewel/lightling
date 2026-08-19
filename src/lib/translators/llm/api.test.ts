import { DEFAULT_LLM_API_URL, fetchLLMModels } from './api';

const modelsResponse = (ids: string[], status = 200) =>
  new Response(
    JSON.stringify({
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'test' })),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

describe('fetchLLMModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('requests models endpoint with bearer key and returns sorted ids', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      modelsResponse(['b-model', 'a-model']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchLLMModels({
      apiUrl: 'https://llm.example/v1/',
      apiKey: 'secret-key',
    });

    expect(models).toEqual(['a-model', 'b-model']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://llm.example/v1/models');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
  });

  test('uses OpenAI default URL and no auth header for empty config', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      modelsResponse(['gpt-4o-mini']),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchLLMModels({ apiUrl: '', apiKey: '' });

    expect(models).toEqual(['gpt-4o-mini']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${DEFAULT_LLM_API_URL}/models`);
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  test('rejects on non-OK status', async () => {
    const fetchMock = vi.fn(async () => modelsResponse([], 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchLLMModels({ apiUrl: 'https://llm.example/v1', apiKey: '' }),
    ).rejects.toThrow('HTTP 500');
  });

  test('rejects on malformed payload', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchLLMModels({ apiUrl: 'https://llm.example/v1', apiKey: '' }),
    ).rejects.toThrow('Invalid model list response');
  });
});
