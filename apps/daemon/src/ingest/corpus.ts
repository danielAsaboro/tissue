import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeedMessage } from "@tissue/shared";

/**
 * Corpus = the flight recorder's tape: `corpus/{fixtureId}.jsonl`, one normalized
 * FeedMessage per line, in feed order. It is the single input to replay and to the
 * pricing property tests, and the reason `replay(corpus) === ledger` can be asserted.
 */

export const CORPUS_DIR = fileURLToPath(new URL("../../../../corpus/", import.meta.url));

export function corpusPath(fixtureId: string): string {
  return join(CORPUS_DIR, `${fixtureId}.jsonl`);
}

export function ensureCorpusDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function appendToCorpus(fixtureId: string, msg: FeedMessage): void {
  const path = corpusPath(fixtureId);
  ensureCorpusDir(path);
  appendFileSync(path, JSON.stringify(msg) + "\n", "utf8");
}

export function writeCorpus(fixtureId: string, msgs: readonly FeedMessage[]): string {
  const path = corpusPath(fixtureId);
  ensureCorpusDir(path);
  writeFileSync(path, msgs.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  return path;
}

export function readCorpus(fixtureId: string): FeedMessage[] {
  return readCorpusFile(corpusPath(fixtureId));
}

export function readCorpusFile(path: string): FeedMessage[] {
  if (!existsSync(path)) throw new Error(`corpus not found: ${path}`);
  return readCorpusString(readFileSync(path, "utf8"));
}

export function readCorpusString(contents: string): FeedMessage[] {
  return contents
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as FeedMessage);
}
