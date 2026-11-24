import type { ClipRecord } from "@gta6-clipper/shared";
import { qaFailureSummary, runQaGate, statusFromQa, type QaClipInput } from "./gate";

export type QaGateFn = typeof runQaGate;

/**
 * Called by the clip job after a successful render instead of marking the
 * clip "ready": runs the gate, stores the result on the record, and sets
 * status to "ready" (all checks passed) or "review" (any check failed).
 */
export async function applyQaGate(
  record: ClipRecord,
  input: QaClipInput,
  gate: QaGateFn = runQaGate,
): Promise<ClipRecord> {
  const qa = await gate(input);
  record.qa = qa;
  record.status = statusFromQa(qa);
  if (record.status === "review") {
    record.errorMessage = `QA review: ${qaFailureSummary(qa, 480)}`;
  }
  return record;
}
