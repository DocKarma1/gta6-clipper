import { normalizeLogin, type AutoSettings, type LiveStream } from "@gta6-clipper/shared";

export function selectStreams(
  streams: readonly LiveStream[],
  settings: AutoSettings,
): LiveStream[] {
  const deny = new Set(settings.denyList.map(normalizeLogin));
  const allow = new Set(settings.allowList.map(normalizeLogin));
  const permitted = new Set(settings.permittedChannels.map(normalizeLogin));
  const languages = new Set(settings.languages.map((code) => code.toLowerCase()));

  const selected = streams.filter((stream) => {
    const login = normalizeLogin(stream.streamerLogin);
    if (deny.has(login)) return false;
    if (languages.size > 0 && !languages.has(stream.language.toLowerCase())) return false;
    if (settings.requirePermission) {
      return permitted.has(login);
    }
    if (allow.size > 0 && !allow.has(login)) return false;
    return true;
  });

  return selected.sort((a, b) => b.viewerCount - a.viewerCount).slice(0, settings.topK);
}
