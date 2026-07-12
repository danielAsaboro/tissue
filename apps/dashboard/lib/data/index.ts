import type { DashboardData } from "./types.js";
import { mockDashboardData } from "./mock/mockData.js";

/**
 * The single seam the UI consumes. Today it resolves to the deterministic mock; a live
 * adapter over the daemon's flight recorder drops in behind the same `DashboardData`
 * interface later. No component reaches past this export into daemon internals.
 */
export const dashboardData: DashboardData = mockDashboardData;
