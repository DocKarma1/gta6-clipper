/**
 * Until migration 20261124010000_clip_qa_review.sql is applied, Supabase
 * rejects status "review" (check constraint) and the qa column (unknown
 * column). The repository then retries with a pre-migration row: "review"
 * is stored as "failed" with the QA reasons in error_message, so the clip is
 * still never "ready" and never publishable.
 */
export function isQaMigrationMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703")
    return /\bqa\b/u.test(error.message ?? "");
  if (error.code === "23514") return /status/u.test(error.message ?? "");
  return false;
}

export function legacyClipRow<T extends { status: string; error_message: string | null }>(
  row: T & { qa?: unknown },
): Omit<T, "qa"> {
  const { qa: _qa, ...rest } = row;
  if (rest.status !== "review") return rest;
  const message = rest.error_message ?? "QA review";
  return {
    ...rest,
    status: "failed",
    error_message: message.startsWith("QA review") ? message : `QA review: ${message}`,
  };
}
