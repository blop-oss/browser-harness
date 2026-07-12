import type { HarnessCriticalPoint } from "../types.js";
import type { BrowserToolContext, NativeToolBridge } from "./types.js";

export function createLifecycleTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "record_critical_point",
      description: "Record a critical test checkpoint, its status, and concrete evidence from a screenshot, assertion, URL, or log line.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Required stable slug identifying this checkpoint, e.g. checkout_complete." },
          description: { type: "string" },
          status: { type: "string", enum: ["pending", "passed", "failed"] },
          evidence: { type: "string" },
          screenshot: { type: "string" },
        },
        required: ["id", "description", "status"],
      },
      promptSnippet: "- record_critical_point: Track each explicit requirement/checkpoint and cite concrete evidence before finishing. id, description, and status are all required.",
      execute: (input) => context.record("record_critical_point", input, async () => {
        const id = String(input.id ?? "").trim();
        const description = String(input.description ?? "").trim();
        const status: HarnessCriticalPoint["status"] = input.status === "passed" || input.status === "failed" ? input.status : "pending";
        if (!id) throw new Error("Critical point id is required.");
        if (!description) throw new Error("Critical point description is required.");
        const point = {
          id,
          description,
          status,
          ...(typeof input.evidence === "string" && input.evidence.trim() ? { evidence: input.evidence } : {}),
          ...(typeof input.screenshot === "string" && input.screenshot.trim() ? { screenshot: input.screenshot } : {}),
          timestamp: new Date().toISOString(),
        };
        const existingIndex = context.criticalPoints.findIndex((candidate) => candidate.id === id);
        if (existingIndex >= 0) context.criticalPoints[existingIndex] = point;
        else context.criticalPoints.push(point);
        return { content: `${id} ${status}: ${description}`, metadata: point };
      }),
    },
    {
      name: "finish_test",
      description: "Finish the current test with passed or failed status and a concise reason.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["passed", "failed"] },
          reason: { type: "string" },
        },
        required: ["status", "reason"],
      },
      promptSnippet: "- finish_test: Required final call. Use passed only after deterministic assertions and/or passed critical points prove the exact requested state. Related content on a broader page is not proof when the task names a dedicated control or view: activate it and verify the resulting URL, title, heading, or value.",
      execute: (input) => context.record("finish_test", input, async () => {
        const requestedStatus = input.status === "passed" ? "passed" : "failed";
        const reason = String(input.reason ?? "No reason provided.");
        const failedCriticalPoint = context.criticalPoints.find((point) => point.status === "failed" || point.status === "pending");
        const status = requestedStatus === "passed" && failedCriticalPoint ? "failed" : requestedStatus;
        context.finishState.status = status;
        context.finishState.reason = requestedStatus === "passed" && failedCriticalPoint
          ? `Cannot pass while critical point ${failedCriticalPoint.id} is ${failedCriticalPoint.status}: ${failedCriticalPoint.description}`
          : reason;
        return { content: `${status}: ${context.finishState.reason}`, metadata: { status, reason: context.finishState.reason } };
      }),
    },
  ];
}
