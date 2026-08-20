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
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    modelsResponse(['b-model', 'a-model']),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('requests models endpoint with bearer key and returns sorted ids', async () => {
    const models = await fetchLLMModels({
      provider: 'openai-compatible',
      apiUrl: 'https://llm.example/v1/',
      apiKey: 'secret-key',
    });

    expect(models.map((model) => model.id)).toEqual(['a-model', 'b-model']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://llm.example/v1/models');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
  });

  test('uses OpenAI default URL and no auth header for empty config', async () => {
    const models = await fetchLLMModels({
      provider: 'openai-compatible',
      apiUrl: '',
      apiKey: '',
    });

    expect(models.map((model) => model.id)).toEqual(['a-model', 'b-model']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${DEFAULT_LLM_API_URL}/models`);
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  test('uses x-api-key and anthropic-version headers for the anthropic provider', async () => {
    await fetchLLMModels({ provider: 'anthropic', apiUrl: '', apiKey: 'anthropic-key' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/models');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe('anthropic-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
  });

  test('uses the OpenRouter default URL for the openrouter provider', async () => {
    await fetchLLMModels({ provider: 'openrouter', apiUrl: '', apiKey: 'or-key' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://openrouter.ai/api/v1/models');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer or-key');
  });

  test('rejects on non-OK status', async () => {
    fetchMock.mockImplementationOnce(async () => modelsResponse([], 500));

    await expect(
      fetchLLMModels({
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: '',
      }),
    ).rejects.toThrow('HTTP 500');
  });

  test('rejects on malformed payload', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      fetchLLMModels({
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: '',
      }),
    ).rejects.toThrow('Invalid model list response');
  });
});
