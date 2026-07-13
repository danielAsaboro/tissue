"use server";

import { dashboardData } from "@/lib/data";

export async function verifyHashChainAction(): Promise<{
  ok: boolean;
  brokenAtSeq?: number;
}> {
  return dashboardData.verifyHashChain();
}
