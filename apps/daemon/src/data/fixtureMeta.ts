import type { FixtureMeta } from "@tissue/shared";
import fixtureMetaJson from "./fixtureMeta.json" with { type: "json" };

const FIXTURE_META = fixtureMetaJson as Record<string, FixtureMeta>;

export function getFixtureMeta(fixtureId: string): FixtureMeta | null {
  return FIXTURE_META[fixtureId] ?? null;
}
