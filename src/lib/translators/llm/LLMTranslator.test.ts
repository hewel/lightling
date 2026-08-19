import {
  getActiveLLMProfile,
  LLMProfile,
  LLMTranslator,
  LLMTranslatorConfig,
} from './LLMTranslator';

const profileConfig = (profile: LLMProfile): LLMTranslatorConfig => ({
  activeProfile: profile.name,
  profiles: [profile],
});

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

const anthropicMessageResponse = (text: string) =>
  new Response(
    JSON.stringify({
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        inference_geo: null,
        service_tier: null,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const openAiResponse = (text: string) =>
  new Response(
    JSON.stringify({
      id: 'resp-test',
      object: 'response',
      created_at: 0,
      status: 'completed',
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      model: 'test-model',
      output: [
        {
          id: 'msg-test',
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: true,
      temperature: 1,
      text: { format: { type: 'text' } },
      tool_choice: 'auto',
      tools: [],
      top_p: 1,
      truncation: 'disabled',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      user: null,
      metadata: {},
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const openRouterResponse = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'test-model',
      created: 0,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content },
        },
      ],
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
  let currentHandler: () => Response = () => chatCompletionResponse('[]');
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    currentHandler(),
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
    currentHandler = () => chatCompletionResponse(JSON.stringify(['Hola mundo']));

    const translator = new LLMTranslator(
      profileConfig({
        name: 'Custom',
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: 'secret-key',
        model: 'test-model',
      }),
    );

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
    currentHandler = () => chatCompletionResponse(JSON.stringify(['Hola']));

    const translator = new LLMTranslator(
      profileConfig({
        name: 'Local',
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        apiKey: '',
        model: 'test-model',
      }),
    );

    await expect(translator.translate('Hello', 'en', 'es')).resolves.toBe('Hola');
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });

  test('translates via OpenAI provider with its default URL', async () => {
    currentHandler = () => openAiResponse(JSON.stringify(['Hola']));

    const translator = new LLMTranslator(
      profileConfig({
        name: 'OpenAI',
        provider: 'openai',
        apiUrl: '',
        apiKey: 'openai-key',
        model: 'gpt-4o-mini',
      }),
    );

    await expect(translator.translate('Hello', 'en', 'es')).resolves.toBe('Hola');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer openai-key');
  });

  test('translates via Anthropic provider with x-api-key auth', async () => {
    currentHandler = () => anthropicMessageResponse(JSON.stringify(['Hola']));

    const translator = new LLMTranslator(
      profileConfig({
        name: 'Anthropic',
        provider: 'anthropic',
        apiUrl: '',
        apiKey: 'anthropic-key',
        model: 'claude-test',
      }),
    );

    await expect(translator.translate('Hello', 'en', 'es')).resolves.toBe('Hola');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages?beta=true');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-api-key')).toBe('anthropic-key');
    expect(headers.get('anthropic-version')).not.toBeNull();
    const body = JSON.parse(decodeBody(init?.body));
    expect(body.model).toBe('claude-test');
  });

  test('translates via OpenRouter provider with its default URL', async () => {
    currentHandler = () => openRouterResponse(JSON.stringify(['Hola']));

    const translator = new LLMTranslator(
      profileConfig({
        name: 'OpenRouter',
        provider: 'openrouter',
        apiUrl: '',
        apiKey: 'openrouter-key',
        model: 'openai/gpt-4o-mini',
      }),
    );

    await expect(translator.translate('Hello', 'en', 'es')).resolves.toBe('Hola');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer openrouter-key');
  });
});

describe('getActiveLLMProfile', () => {
  const profileA: LLMProfile = {
    name: 'A',
    provider: 'openai',
    apiUrl: '',
    apiKey: '',
    model: 'a-model',
  };
  const profileB: LLMProfile = {
    name: 'B',
    provider: 'anthropic',
    apiUrl: '',
    apiKey: '',
    model: 'b-model',
  };

  test('resolves the profile named by activeProfile', () => {
    expect(
      getActiveLLMProfile({ activeProfile: 'B', profiles: [profileA, profileB] }),
    ).toBe(profileB);
  });

  test('falls back to the first profile when activeProfile matches nothing', () => {
    expect(
      getActiveLLMProfile({ activeProfile: 'missing', profiles: [profileA, profileB] }),
    ).toBe(profileA);
  });

  test('falls back to an empty unconfigured profile when the list is empty', () => {
    const profile = getActiveLLMProfile({ activeProfile: '', profiles: [] });
    expect(profile.model).toBe('');
  });
});
