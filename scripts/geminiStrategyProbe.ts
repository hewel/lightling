#!/usr/bin/env bun
// cspell:ignore aistudio generativelanguage makespan
/*
 * Real-API parallelism probe for Google AI Studio Gemini models.
 * Replays exported page-translation workloads against the OpenAI-compatible
 * endpoint across (concurrency × batch-token) grids and reports the strategy
 * with the best effective throughput. Requires GEMINI_API_KEY (env or .env).
 *
 * Run: bun scripts/geminiStrategyProbe.ts --model gemini-3.7-flash --log <log.json>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const endpoint =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const defaultLog = process.env.GEMINI_PROBE_LOG ?? '';
const retryTokenWeightMs = 0.8;
const maxAttempts = 3;
const requestTimeoutMs = 90_000;

interface CliOptions {
  models: string[];
  logPath: string;
  concurrency: number[];
  batchTokens: number[];
  maxRunSeconds: number;
  maxBatchesPerRun: number;
  reasoning: string | null;
  json: boolean;
}

interface WorkTarget {
  text: string;
  estimatedTokens: number;
}

interface AttemptResult {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  retryAfterMs: number;
  failedItems: number;
  promptTokens: number;
  completionTokens: number;
}

interface ConfigResult {
  model: string;
  concurrency: number;
  batchTokens: number;
  requests: number;
  rateLimits: number;
  transportErrors: number;
  failedBatches: number;
  failedItems: number;
  totalItems: number;
  makespanMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  effectiveTokensPerSecond: number;
  objectiveMs: number;
  skipped: string | null;
}

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    models: [],
    logPath: defaultLog,
    concurrency: [1, 2, 4, 8],
    batchTokens: [300, 600, 1200],
    maxRunSeconds: 150,
    maxBatchesPerRun: 40,
    reasoning: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--model' && next !== undefined) {
      options.models.push(next);
      index += 1;
    } else if (arg === '--log' && next !== undefined) {
      options.logPath = next;
      index += 1;
    } else if (arg === '--concurrency' && next !== undefined) {
      options.concurrency = next.split(',').map(Number);
      index += 1;
    } else if (arg === '--batch-tokens' && next !== undefined) {
      options.batchTokens = next.split(',').map(Number);
      index += 1;
    } else if (arg === '--max-run-seconds' && next !== undefined) {
      options.maxRunSeconds = Number(next);
      index += 1;
    } else if (arg === '--max-batches' && next !== undefined) {
      options.maxBatchesPerRun = Number(next);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--reasoning' && next !== undefined) {
      options.reasoning = next;
      index += 1;
    } else if (arg === '--help') {
      console.log(
        'bun scripts/geminiStrategyProbe.ts [--model id]... --log <page-log.json> ' +
          '[--concurrency 1,2,4,8] [--batch-tokens 300,600,1200] [--json]',
      );
      process.exit(0);
    }
  }
  if (options.models.length === 0) {
    options.models = ['gemini-3.7-flash', 'gemini-3.5-flash-lite'];
  }
  if (options.logPath === '') {
    throw new Error('--log is required unless GEMINI_PROBE_LOG is set');
  }
  return options;
};

const loadApiKey = async (): Promise<string> => {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const env = await readFile(resolve(process.cwd(), '.env'), 'utf8');
    const line = env.split('\n').find((row) => row.startsWith('GEMINI_API_KEY='));
    const value = line?.slice('GEMINI_API_KEY='.length).trim();
    if (value) return value;
  } catch {
    // fall through to error
  }
  throw new Error('GEMINI_API_KEY missing in environment and .env');
};

const loadWorkload = async (logPath: string): Promise<WorkTarget[]> => {
  const parsed: unknown = JSON.parse(await readFile(logPath, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('batches' in parsed) ||
    !Array.isArray(parsed.batches)
  ) {
    throw new Error(`No batches in ${logPath}`);
  }
  const targets: WorkTarget[] = [];
  for (const rawBatch of parsed.batches as unknown[]) {
    if (typeof rawBatch !== 'object' || rawBatch === null || !('targets' in rawBatch)) {
      continue;
    }
    if (!Array.isArray(rawBatch.targets)) continue;
    const batchTokens =
      'sourceTokens' in rawBatch && typeof rawBatch.sourceTokens === 'number'
        ? rawBatch.sourceTokens
        : 0;
    const texts: string[] = [];
    for (const target of rawBatch.targets as unknown[]) {
      if (typeof target !== 'object' || target === null) continue;
      if ('cacheHit' in target && target.cacheHit === true) continue;
      if ('sourceText' in target && typeof target.sourceText === 'string') {
        texts.push(target.sourceText);
      }
    }
    if (texts.length === 0 || batchTokens === 0) continue;
    const perTarget = Math.max(1, batchTokens / texts.length);
    for (const text of texts) targets.push({ text, estimatedTokens: perTarget });
  }
  if (targets.length === 0) throw new Error(`No provider targets in ${logPath}`);
  return targets;
};

const planBatches = (targets: WorkTarget[], batchTokens: number): WorkTarget[][] => {
  const batches: WorkTarget[][] = [];
  let current: WorkTarget[] = [];
  let tokens = 0;
  for (const target of targets) {
    if (current.length > 0 && tokens + target.estimatedTokens > batchTokens) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(target);
    tokens += target.estimatedTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

const extractArray = (content: string): unknown[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null) {
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) return value;
    }
  }
  return null;
};

interface CurlResponse {
  httpStatus: number;
  retryAfterMs: number;
  body: string;
}

const curlPost = async (
  url: string,
  apiKey: string,
  payload: string,
  timeoutSeconds: number,
): Promise<CurlResponse> => {
  const process_ = Bun.spawn(
    [
      'curl',
      '-sS',
      '--max-time',
      String(timeoutSeconds),
      '-i',
      '-H',
      `Authorization: Bearer ${apiKey}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      '@-',
      url,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );
  process_.stdin.write(payload);
  process_.stdin.end();
  const [body, stderrText, exitCode] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
    process_.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`curl exited ${exitCode}: ${stderrText.slice(0, 200)}`);
  }
  const separator = body.indexOf('\r\n\r\n');
  const headerText = separator === -1 ? body : body.slice(0, separator);
  const payloadText = separator === -1 ? '' : body.slice(separator + 4);
  const statusMatch = /^HTTP\/\S+ (\d+)/u.exec(headerText);
  const retryAfterMatch = /^retry-after:\s*(\d+(?:\.\d+)?)/imu.exec(headerText);
  return {
    httpStatus: statusMatch?.[1] === undefined ? 0 : Number(statusMatch[1]),
    retryAfterMs:
      retryAfterMatch?.[1] === undefined
        ? 0
        : Math.min(60_000, Number(retryAfterMatch[1]) * 1000),
    body: payloadText,
  };
};

const readResponseText = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || !('choices' in body)) return '';
  if (!Array.isArray(body.choices)) return '';
  const choice: unknown = body.choices[0];
  if (typeof choice !== 'object' || choice === null || !('message' in choice)) return '';
  const message: unknown = choice.message;
  if (typeof message !== 'object' || message === null || !('content' in message))
    return '';
  return typeof message.content === 'string' ? message.content : '';
};

const readUsageTokens = (body: unknown): { prompt: number; completion: number } => {
  const usage = { prompt: 0, completion: 0 };
  if (typeof body !== 'object' || body === null || !('usage' in body)) return usage;
  const raw: unknown = body.usage;
  if (typeof raw !== 'object' || raw === null) return usage;
  if ('prompt_tokens' in raw && typeof raw.prompt_tokens === 'number') {
    usage.prompt = raw.prompt_tokens;
  }
  if ('completion_tokens' in raw && typeof raw.completion_tokens === 'number') {
    usage.completion = raw.completion_tokens;
  }
  return usage;
};

const attempt = async (
  model: string,
  texts: string[],
  apiKey: string,
  reasoning: string | null,
): Promise<AttemptResult> => {
  const startedAt = performance.now();
  const response = await curlPost(
    endpoint,
    apiKey,
    JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a translation engine for web page text. Translate each input ' +
            'text from English to Chinese. Return ONLY a JSON array of translated ' +
            'strings in the same order and count as the input.',
        },
        { role: 'user', content: JSON.stringify(texts) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      ...(reasoning === null ? {} : { reasoning_effort: reasoning }),
    }),
    Math.ceil(requestTimeoutMs / 1000),
  );
  const latencyMs = performance.now() - startedAt;
  if (response.httpStatus !== 200) {
    return {
      ok: false,
      httpStatus: response.httpStatus,
      latencyMs,
      retryAfterMs: response.retryAfterMs,
      failedItems: texts.length,
      promptTokens: 0,
      completionTokens: 0,
    };
  }
  const body: unknown = JSON.parse(response.body);
  const usage = readUsageTokens(body);
  const translated = extractArray(readResponseText(body));
  let failedItems = texts.length;
  if (translated !== null && translated.length === texts.length) {
    failedItems = 0;
    for (let index = 0; index < translated.length; index += 1) {
      const item = translated[index];
      if (typeof item !== 'string' || item.trim() === '') {
        failedItems += 1;
        continue;
      }
      if (!/[一-鿿]/u.test(item) && item !== texts[index]) failedItems += 1;
    }
  }
  return {
    ok: failedItems === 0,
    httpStatus: 200,
    latencyMs,
    retryAfterMs: 0,
    failedItems,
    promptTokens: usage.prompt,
    completionTokens: usage.completion,
  };
};

const percentile = (values: number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

const runConfig = async (
  model: string,
  batchTokens: number,
  concurrency: number,
  workload: WorkTarget[],
  apiKey: string,
  options: CliOptions,
): Promise<ConfigResult> => {
  const batches = planBatches(workload, batchTokens).slice(0, options.maxBatchesPerRun);
  const sourceTokens = batches
    .flat()
    .reduce((sum, target) => sum + target.estimatedTokens, 0);
  const totalItems = batches.reduce((sum, batch) => sum + batch.length, 0);
  const latencies: number[] = [];
  let rateLimits = 0;
  let transportErrors = 0;
  let failedBatches = 0;
  let failedItems = 0;
  let requests = 0;
  let next = 0;
  const deadline = Date.now() + options.maxRunSeconds * 1000;
  let skipped: string | null = null;
  let firstTransportError = '';

  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      if (Date.now() > deadline) {
        skipped = 'deadline';
        return;
      }
      const batch = batches[next];
      next += 1;
      if (batch === undefined) return;
      const texts = batch.map((target) => target.text);
      let result: AttemptResult | null = null;
      for (let tryIndex = 0; tryIndex < maxAttempts; tryIndex += 1) {
        requests += 1;
        let current: AttemptResult;
        try {
          current = await attempt(model, texts, apiKey, options.reasoning);
        } catch (error) {
          if (firstTransportError === '')
            firstTransportError = String(error).slice(0, 160);
          current = {
            ok: false,
            httpStatus: 0,
            latencyMs: requestTimeoutMs,
            retryAfterMs: 0,
            failedItems: texts.length,
            promptTokens: 0,
            completionTokens: 0,
          };
        }
        result = current;
        if (current.httpStatus !== 429) break;
        rateLimits += 1;
        const { promise: retryWait, resolve: releaseRetryWait } =
          Promise.withResolvers<void>();
        setTimeout(releaseRetryWait, Math.max(1_000, current.retryAfterMs));
        await retryWait;
      }
      if (result === null) return;
      if (result.httpStatus === 0) {
        transportErrors += 1;
        continue;
      }
      latencies.push(result.latencyMs);
      failedItems += result.failedItems;
      if (!result.ok) failedBatches += 1;
    }
  };

  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()),
  );
  const makespanMs = Date.now() - startedAt;
  if (transportErrors > batches.length / 2) {
    skipped = `transport:${firstTransportError}`;
  }
  const retryTokenCost = failedItems * 40;
  return {
    model,
    concurrency,
    batchTokens,
    requests,
    rateLimits,
    transportErrors,
    failedBatches,
    failedItems,
    totalItems,
    makespanMs,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    effectiveTokensPerSecond: makespanMs === 0 ? 0 : (sourceTokens * 1000) / makespanMs,
    objectiveMs: makespanMs + retryTokenWeightMs * retryTokenCost,
    skipped,
  };
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = await loadApiKey();
  const workload = await loadWorkload(options.logPath);
  const results: ConfigResult[] = [];
  for (const model of options.models) {
    for (const batchTokens of options.batchTokens) {
      for (const concurrency of options.concurrency) {
        const result = await runConfig(
          model,
          batchTokens,
          concurrency,
          workload,
          apiKey,
          options,
        );
        results.push(result);
        if (!options.json) {
          console.log(
            `${model} c=${concurrency} b=${batchTokens}: ${Math.round(result.makespanMs)}ms ` +
              `req=${result.requests} 429=${result.rateLimits} badBatch=${result.failedBatches} ` +
              `net=${result.transportErrors} ` +
              `badItem=${result.failedItems}/${result.totalItems} ` +
              `p50=${Math.round(result.p50LatencyMs)}ms p95=${Math.round(result.p95LatencyMs)}ms ` +
              `tps=${result.effectiveTokensPerSecond.toFixed(1)}` +
              (result.skipped !== null ? ` SKIPPED:${result.skipped}` : ''),
          );
        }
      }
    }
  }
  if (options.json) {
    console.log(JSON.stringify({ workloadTargets: workload.length, results }, null, 2));
    return;
  }
  for (const model of options.models) {
    const modelResults = results
      .filter((result) => result.model === model && result.skipped === null)
      .sort((left, right) => left.objectiveMs - right.objectiveMs);
    const best = modelResults[0];
    if (best === undefined) {
      console.log(`\n[${model}] no completed configuration`);
      continue;
    }
    console.log(
      `\n[${model}] best: concurrency=${best.concurrency} batchTokens=${best.batchTokens} ` +
        `(${best.effectiveTokensPerSecond.toFixed(1)} tok/s, objective ${Math.round(best.objectiveMs)}ms)`,
    );
  }
};

await main();
