import type { ChatMessage, LlmClient, ToolCall } from "./llm.js";
import type { McpBridge } from "./mcpBridge.js";

/**
 * The analyst agent: an LLM + MCP tool loop over READ-ONLY ledger tools. It narrates
 * already-decided, already-hash-chained data and cites the exact ledger rows it pulled. It
 * has NO decision surface — there is no tool that posts, prices, or executes, so no answer
 * it produces can ever create a trade. Presentation only.
 */

const SYSTEM_PROMPT = `You are the TISSUE desk analyst. You NARRATE the desk's already-decided,
hash-chained decision ledger. You do NOT decide, recommend, price, or place trades — you have
no ability to, and must never imply otherwise.

Rules:
- Ground EVERY factual claim in a tool call. Never invent decisions, numbers, or signal classes.
- Prefer citing specific ledger decisions by their seq and short hash.
- If the tools don't contain the answer, say so plainly. Do not speculate.
- Keep answers tight and instrument-calm. This is a flight recorder read-out, not advice.`;

export interface AnalystAnswer {
  readonly answer: string;
  readonly citations: { seq: number; hash: string; fixtureId: string }[];
  readonly toolCalls: { name: string; args: unknown }[];
  readonly providers: { provider: string; fellBack: boolean }[];
  readonly fallbackFired: boolean;
}

export async function runAnalystQuery(
  question: string,
  llm: LlmClient,
  bridge: McpBridge,
  maxRounds = 5,
): Promise<AnalystAnswer> {
  const tools = bridge.toolSpecs();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];
  const citations: AnalystAnswer["citations"] = [];
  const toolCalls: AnalystAnswer["toolCalls"] = [];
  const providers: AnalystAnswer["providers"] = [];

  for (let round = 0; round < maxRounds; round++) {
    const result = await llm.chat(messages, tools);
    providers.push({ provider: result.provider, fellBack: result.fellBack });
    const msg = result.message;
    messages.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        answer: msg.content ?? "",
        citations,
        toolCalls,
        providers,
        fallbackFired: providers.some((p) => p.fellBack),
      };
    }

    for (const call of msg.tool_calls) {
      const { name, args } = parseToolCall(call);
      toolCalls.push({ name, args });
      let content: string;
      try {
        content = await bridge.callTool(name, args);
        collectCitations(content, citations);
      } catch (err) {
        content = JSON.stringify({ error: (err as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, name, content });
    }
  }

  // Ran out of rounds — return the last assistant text if any.
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  return {
    answer: last?.content ?? "(analyst reached the tool-loop limit without a final answer)",
    citations,
    toolCalls,
    providers,
    fallbackFired: providers.some((p) => p.fellBack),
  };
}

function parseToolCall(call: ToolCall): { name: string; args: Record<string, unknown> } {
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  return { name: call.function.name, args };
}

function collectCitations(toolResultText: string, into: AnalystAnswer["citations"]): void {
  try {
    const parsed = JSON.parse(toolResultText) as { citations?: { seq: number; hash: string; fixtureId: string }[] };
    for (const c of parsed.citations ?? []) into.push(c);
  } catch {
    // non-JSON tool output — no citations to collect
  }
}
