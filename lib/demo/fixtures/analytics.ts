export interface DemoAnalyticsPoint {
  /** Week starting */
  weekStart: string;
  /** Number of disputes that week */
  count: number;
  /** Dollars recovered that week */
  recovered: number;
}

export const DEMO_ANALYTICS: DemoAnalyticsPoint[] = [
  { weekStart: "2025-11-03", count: 8, recovered: 1_240 },
  { weekStart: "2025-11-10", count: 6, recovered: 980 },
  { weekStart: "2025-11-17", count: 11, recovered: 1_820 },
  { weekStart: "2025-11-24", count: 9, recovered: 1_410 },
  { weekStart: "2025-12-01", count: 14, recovered: 2_180 },
  { weekStart: "2025-12-08", count: 12, recovered: 1_940 },
  { weekStart: "2025-12-15", count: 7, recovered: 1_120 },
  { weekStart: "2025-12-22", count: 5, recovered: 720 },
  { weekStart: "2025-12-29", count: 9, recovered: 1_440 },
  { weekStart: "2026-01-05", count: 13, recovered: 2_310 },
  { weekStart: "2026-01-12", count: 10, recovered: 1_780 },
];

export const DEMO_ANALYTICS_TOTALS = {
  disputesHandled90d: 104,
  amountRecovered90d: 16_940,
  winRate90d: 87,
  avgResponseTimeHours: 0.4,
};
