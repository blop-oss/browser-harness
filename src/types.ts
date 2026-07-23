/** Framework-agnostic types for the browser harness. Hosts (e.g. Blop) map these
 * onto their own result/report models via structural typing. */

export type TestStatus = "passed" | "failed" | "error";

export type HarnessAction = {
  name: string;
  input: Record<string, unknown>;
  output: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
};

export type HarnessScreenshot = {
  path: string;
  name: string;
  checkpoint?: string;
  reason?: string;
  target?: string;
  focused: boolean;
  fullPage: boolean;
  timestamp: string;
};

export type HarnessCriticalPoint = {
  id: string;
  description: string;
  status: "pending" | "passed" | "failed";
  evidence?: string;
  screenshot?: string;
  timestamp: string;
};

export type HarnessBrowserLog = {
  type: "console" | "pageerror" | "requestfailed";
  level?: string;
  message: string;
  url?: string;
  timestamp: string;
};
