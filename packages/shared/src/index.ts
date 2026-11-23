export {
  getConfig,
  getTwitchCredentials,
  loadRepoEnv,
  findRepoRoot,
  resetConfigCache,
  type AppConfig,
  type TwitchCredentials,
} from "./config";
export {
  AppError,
  ConfigError,
  TwitchApiError,
  TwitchAuthError,
  TwitchRateLimitError,
  RenderError,
  PlanLimitError,
  isAppError,
  toUserMessage,
  type ErrorCode,
} from "./errors";
export { getLogger } from "./logger";
export type { GameCategory, LiveRadarResult, LiveStream } from "./types";
export {
  BLUR,
  FACECAM_BAND,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SAFE_ZONE,
  TEXT,
  anchorBounds,
  clamp,
  even,
  facecamBandHeight,
  formatStreamerCredit,
  gameplayCenterCrop,
  getBlurredBackgroundGeometry,
  getSafeZone,
  getStackedSplitGeometry,
  getTextPlacement,
  isInsideSafeZone,
  resolveFacecamBandFraction,
  sixteenNineHeight,
  type BlurredBackgroundGeometry,
  type BlurredBackgroundLayout,
  type CreditFormat,
  type CropRect,
  type FrameSize,
  type SafeZone,
  type SourceSize,
  type StackedSplitGeometry,
  type StackedSplitLayout,
  type StreamerCredit,
  type TextAlign,
  type TextAnchor,
  type TextPlacement,
  type TimedWord,
  type VerticalLayout,
  type VerticalLayoutId,
} from "./video";

export {
  getAutoSettings,
  resetAutoSettingsCache,
  normalizeLogin,
  type AutoSettings,
} from "./auto-settings";
export type { CandidateMoment, ChatEvent, ClipRecord, WatchedStream } from "./moments";

export {
  CAPTION_STYLE_IDS,
  PLAN_BY_ID,
  PLANS,
  captionStylesFor,
  getPlan,
  isPlanId,
  startOfUtcMonth,
  type CaptionStyleId,
  type Plan,
  type PlanId,
} from "./plans";
export {
  assertAiTitles,
  assertCaptionStyle,
  assertClipsThisMonth,
  assertConcurrentStreams,
  canUseAiTitles,
  capConcurrentStreams,
  evaluatePlanGate,
  type PlanUsage,
} from "./plan-gates";

export {
  PERMISSION_METHODS,
  PERMISSION_METHOD_LABELS,
  PERMISSION_STATUSES,
  REQUIRE_PERMISSION_WARNING,
  TWITCH_LOGIN_PATTERN,
  channelLoginSchema,
  grantPermissionInputSchema,
  grantedLogins,
  hasEvidence,
  isChannelAllowed,
  resolvePermissionPolicy,
  revokePermissionInputSchema,
  statusFor,
  type EffectivePermissionPolicy,
  type GrantPermissionInput,
  type PermissionMethod,
  type PermissionReceipt,
  type PermissionStatus,
  type RevokePermissionInput,
  type StoredPermissionStatus,
} from "./permissions";
export { LocalPermissionStore } from "./permission-store-local";
export type { Database, Json } from "./database.types";
export { receiptFromRow, type PermissionReceiptRow } from "./permission-rows";
