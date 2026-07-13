import type { DashboardData } from "./types";
import { HttpDashboardData } from "./live/httpData";

export const dashboardData: DashboardData = new HttpDashboardData();
