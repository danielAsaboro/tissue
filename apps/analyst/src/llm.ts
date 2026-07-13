/**
 * Thin LLM client. Groq (primary) and DGrid (fallback) are BOTH OpenAI-compatible, so one
 * request shape covers both — try Groq first, and on error / 429 / timeout retry via DGrid.
 * Which provider actually answered each call is logged and returned (demo-honest: a fallback
 * firing is visible, never hidden). Injectable so the agent can be tested without a network.
 *
 * GROQ_MODEL should be Groq's current recommended tool-use model (console.groq.com/docs) —
 * we default to `llama-3.3-70b-versatile` (strong function-calling) but never hardcode it as
 * the source of truth; env wins. (We avoid `groq/compound`: its built-in tools conflict with
 * our custom function-calling.)
 */

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatResult {
  message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
  provider: string;
  model: string;
  fellBack: boolean;
}

export interface LlmClient {
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult>;
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const MAX_PROVIDER_RESPONSE_BYTES = 2_097_152;

async function readLimitedResponse(response: Response): Promise<string> {
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("LLM provider response exceeded the configured size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("LLM provider response exceeded the configured size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export function groqConfig(): ProviderConfig | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return {
    name: "groq",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    apiKey,
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  };
}

export function dgridConfig(): ProviderConfig | null {
  const apiKey = process.env.DGRID_API_KEY;
  const baseUrl = process.env.DGRID_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  return { name: "dgrid", baseUrl, apiKey, model: process.env.DGRID_MODEL ?? "claude-sonnet-4" };
}

async function callProvider(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolSpec[],
  timeoutMs: number,
): Promise<ChatResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        temperature: 0.2,
      }),
      signal: ac.signal,
    });
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`${cfg.name} ${res.status}`), { retryable: true, status: res.status });
    }
    const responseText = await readLimitedResponse(res);
    if (!res.ok) throw new Error(`${cfg.name} ${res.status}: ${responseText.slice(0, 1_000)}`);
    const body = JSON.parse(responseText) as { choices: { message: ChatResult["message"] }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error(`${cfg.name}: empty completion`);
    return { message, provider: cfg.name, model: cfg.model, fellBack: false };
  } finally {
    clearTimeout(timer);
  }
}

export class FallbackLlmClient implements LlmClient {
  /** Per-call log of which provider answered (demo metadata). */
  readonly providerLog: { provider: string; fellBack: boolean }[] = [];

  constructor(
    private readonly primary: ProviderConfig | null = groqConfig(),
    private readonly fallback: ProviderConfig | null = dgridConfig(),
    private readonly timeoutMs = 25_000,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult> {
    if (!this.primary && !this.fallback) {
      throw new Error("No LLM provider configured (set GROQ_API_KEY and/or DGRID_API_KEY).");
    }
    if (this.primary) {
      try {
        const r = await callProvider(this.primary, messages, tools, this.timeoutMs);
        this.providerLog.push({ provider: r.provider, fellBack: false });
        return r;
      } catch (err) {
        if (!this.fallback) throw err;
        const r = await callProvider(this.fallback, messages, tools, this.timeoutMs);
        this.providerLog.push({ provider: r.provider, fellBack: true });
        return { ...r, fellBack: true };
      }
    }
    const r = await callProvider(this.fallback!, messages, tools, this.timeoutMs);
    this.providerLog.push({ provider: r.provider, fellBack: false });
    return r;
  }

  get fallbackFired(): boolean {
    return this.providerLog.some((p) => p.fellBack);
  }
}
