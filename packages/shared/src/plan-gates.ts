import { PlanLimitError } from "./errors";
import { captionStylesFor, getPlan, type CaptionStyleId, type Plan, type PlanId } from "./plans";

export type PlanUsage = {
  concurrentStreams: number;
  clipsThisMonth: number;
};

export function assertConcurrentStreams(planId: PlanId, currentCount: number): void {
  const plan = getPlan(planId);
  if (currentCount > plan.streamsAtOnce) {
    throw new PlanLimitError(
      `${plan.name} allows ${plan.streamsAtOnce} concurrent streams; ${currentCount} were requested.`,
      { planId, limit: "streamsAtOnce" },
    );
  }
}

export function capConcurrentStreams<T>(planId: PlanId, items: T[]): T[] {
  const plan = getPlan(planId);
  return items.slice(0, plan.streamsAtOnce);
}

export function assertClipsThisMonth(planId: PlanId, clipsThisMonth: number): void {
  const plan = getPlan(planId);
  if (clipsThisMonth >= plan.clipsPerMonth) {
    throw new PlanLimitError(
      `${plan.name} includes ${plan.clipsPerMonth} clips per month; this workspace has already used ${clipsThisMonth}.`,
      { planId, limit: "clipsPerMonth" },
    );
  }
}

export function assertCaptionStyle(planId: PlanId, style: CaptionStyleId): void {
  const plan = getPlan(planId);
  const allowed = captionStylesFor(plan);
  if (!allowed.includes(style)) {
    throw new PlanLimitError(
      `${plan.name} includes ${plan.captionStyles} caption styles and does not include "${style}".`,
      { planId, limit: "captionStyles" },
    );
  }
}

export function assertAiTitles(planId: PlanId): void {
  const plan = getPlan(planId);
  if (!plan.aiTitles) {
    throw new PlanLimitError(`${plan.name} does not include AI titles and hashtags.`, {
      planId,
      limit: "aiTitles",
    });
  }
}

export function canUseAiTitles(planId: PlanId): boolean {
  return getPlan(planId).aiTitles;
}

export function evaluatePlanGate(
  planId: PlanId,
  action: "concurrent_streams" | "clip" | "caption_style" | "ai_titles",
  input: {
    currentConcurrentStreams?: number;
    clipsThisMonth?: number;
    captionStyle?: CaptionStyleId;
  },
): { allowed: true; plan: Plan } | { allowed: false; plan: Plan; error: PlanLimitError } {
  const plan = getPlan(planId);
  try {
    if (action === "concurrent_streams") {
      assertConcurrentStreams(planId, input.currentConcurrentStreams ?? 0);
    } else if (action === "clip") {
      assertClipsThisMonth(planId, input.clipsThisMonth ?? 0);
    } else if (action === "caption_style") {
      if (!input.captionStyle) {
        throw new PlanLimitError("A caption style is required.", {
          planId,
          limit: "captionStyles",
        });
      }
      assertCaptionStyle(planId, input.captionStyle);
    } else {
      assertAiTitles(planId);
    }
    return { allowed: true, plan };
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return { allowed: false, plan, error };
    }
    throw error;
  }
}
