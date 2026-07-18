/**
 * AI SDK 7 model boundary. Groq (primary) and DGrid (fallback) are both OpenAI-compatible,
 * so one provider adapter covers both — try Groq first, and on error / 429 / timeout retry via DGrid.
 * Which provider actually answered each call is logged and returned (demo-honest: a fallback
 * firing is visible, never hidden). Injectable so the agent can be tested without a network.
 *
 * GROQ_MODEL should be Groq's current recommended tool-use model (console.groq.com/docs) —
 * we default to `llama-3.3-70b-versatile` (strong function-calling) but never hardcode it as
 * the source of truth; env wins. (We avoid `groq/compound`: its built-in tools conflict with
 * our custom function-calling.)
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";

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

async function limitedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const response = await fetch(input, init);
  const body = await readLimitedResponse(response);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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
  const provider = createOpenAICompatible({
    name: cfg.name,
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    fetch: limitedFetch,
  });
  const sdkTools: ToolSet = Object.fromEntries(tools.map((spec) => [
    spec.function.name,
    tool({
      description: spec.function.description,
      inputSchema: jsonSchema(spec.function.parameters as Parameters<typeof jsonSchema>[0]),
    }),
  ]));
  const system = messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n\n");
  const result = await generateText({
    model: provider(cfg.model),
    ...(Object.keys(sdkTools).length ? { tools: sdkTools, toolChoice: "auto" as const } : {}),
    ...(system ? { instructions: system } : {}),
    messages: toModelMessages(messages.filter((message) => message.role !== "system")),
    temperature: 0.2,
    maxRetries: 0,
    timeout: { totalMs: timeoutMs, stepMs: timeoutMs },
  });
  const toolCalls: ToolCall[] = result.toolCalls.map((call) => ({
    id: call.toolCallId,
    type: "function",
    function: { name: call.toolName, arguments: JSON.stringify(call.input) },
  }));
  return {
    message: {
      role: "assistant",
      content: result.text || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    provider: cfg.name,
    model: cfg.model,
    fellBack: false,
  };
}

function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "user") return { role: "user", content: message.content ?? "" };
    if (message.role === "assistant") {
      if (!message.tool_calls?.length) return { role: "assistant", content: message.content ?? "" };
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.tool_calls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.function.name,
            input: parseToolArguments(call.function.arguments),
          })),
        ],
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: message.tool_call_id ?? "missing-tool-call-id",
          toolName: message.name ?? "unknown-tool",
          output: { type: "text", value: message.content ?? "" },
        }],
      };
    }
    throw new Error("system messages must be supplied through AI SDK instructions");
  });
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
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
