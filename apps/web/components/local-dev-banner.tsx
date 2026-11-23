import { isSupabaseAuthConfigured, LOCAL_DEV_AUTH_MESSAGE } from "../lib/auth-mode";

export function LocalDevBanner() {
  if (isSupabaseAuthConfigured()) return null;
  return (
    <div className="local-dev-banner" role="status">
      {LOCAL_DEV_AUTH_MESSAGE}
    </div>
  );
}
