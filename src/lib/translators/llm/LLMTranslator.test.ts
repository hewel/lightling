import { LLMTranslator } from './LLMTranslator';

const chatCompletionResponse = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model: 'test-model',
      created: 0,
      choices: [{ index: 0, message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const decodeBody = (body: BodyInit | null | undefined): string =>
  typeof body === 'string'
    ? body
    : new TextDecoder().decode(body as ArrayBufferView | ArrayBuffer);

describe('LLMTranslator', () => {
  // Effect's `FetchHttpClient.Fetch` reference memoizes its default (`globalThis.fetch`)
  // on first access, so a single delegating mock is installed once per test file
  let responseContent = '';
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    chatCompletionResponse(responseContent),
  );

  beforeAll(() => {
    // The webextension setup stubs `location` with a moz-extension URL whose opaque
    // origin makes effect's `baseUrl()` produce an invalid base for `new URL()`
    vi.stubGlobal(
      'location',
      new URL('https://localhost/_generated_background_page.html'),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  beforeEach(() => {
    fetchMock.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  test('translates via OpenAI-compatible endpoint', async () => {
    responseContent = JSON.stringify(['Hola mundo']);

    const translator = new LLMTranslator({
      apiUrl: 'https://llm.example/v1',
      apiKey: 'secret-key',
      model: 'test-model',
    });

    await expect(translator.translate('Hello world', 'en', 'es')).resolves.toBe(
      'Hola mundo',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://llm.example/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-key');
    const body = JSON.parse(decodeBody(init?.body));
    expect(body.model).toBe('test-model');
    expect(body.messages[0].content).toContain('Hello world');
  });

  test('omits Authorization header when API key is empty', async () => {
    responseContent = JSON.stringify(['Hola']);

    const translator = new LLMTranslator({
      apiUrl: 'https://llm.example/v1',
      apiKey: '',
      model: 'test-model',
    });

    await expect(translator.translate('Hello', 'en', 'es')).resolves.toBe('Hola');
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });
});
