import { getLogger, TwitchApiError } from "@gta6-clipper/shared";
import { helixGet } from "./client";
import { parseHelix } from "./parse";
import {
  helixGamesResponseSchema,
  helixSearchCategoriesResponseSchema,
  type HelixCategory,
  type HelixGame,
} from "./schemas";

const PRIMARY_GAME_NAME = "Grand Theft Auto VI";
const log = getLogger("twitch.games");

export type ResolvedGame = {
  id: string;
  name: string;
  source: "games" | "search";
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[:]/g, "").replace(/\s+/g, " ").trim();
}

export function isGta6CategoryName(name: string): boolean {
  const normalized = normalizeName(name);
  if (
    normalized === "grand theft auto v" ||
    normalized === "grand theft auto 5" ||
    normalized === "gta v" ||
    normalized === "gta 5"
  ) {
    return false;
  }
  return (
    normalized === "grand theft auto vi" ||
    normalized === "grand theft auto 6" ||
    normalized === "gta vi" ||
    normalized === "gta 6" ||
    normalized.includes("grand theft auto vi") ||
    normalized.includes("grand theft auto 6")
  );
}

export async function getGamesByName(name: string): Promise<HelixGame[]> {
  const payload = await helixGet("/games", { name });
  return parseHelix(helixGamesResponseSchema, payload, "games").data;
}

export async function searchCategories(query: string): Promise<HelixCategory[]> {
  const payload = await helixGet("/search/categories", { query, first: 20 });
  return parseHelix(helixSearchCategoriesResponseSchema, payload, "search/categories").data;
}

function pickCategory(
  categories: readonly { id: string; name: string }[],
): ResolvedGame | undefined {
  const exact = categories.find((item) => item.name === PRIMARY_GAME_NAME);
  if (exact) return { id: exact.id, name: exact.name, source: "search" };
  const gta6 = categories.find((item) => isGta6CategoryName(item.name));
  if (gta6) return { id: gta6.id, name: gta6.name, source: "search" };
  return undefined;
}

export async function resolveGta6Game(): Promise<ResolvedGame> {
  const games = await getGamesByName(PRIMARY_GAME_NAME);
  const exactGame =
    games.find((game) => game.name === PRIMARY_GAME_NAME) ??
    games.find((game) => isGta6CategoryName(game.name));
  if (exactGame) {
    log.info(
      { gameId: exactGame.id, gameName: exactGame.name, source: "games" },
      "Resolved GTA 6 category",
    );
    return { id: exactGame.id, name: exactGame.name, source: "games" };
  }

  const searchQueries = [PRIMARY_GAME_NAME, "Grand Theft Auto 6"];
  for (const query of searchQueries) {
    const categories = await searchCategories(query);
    const match = pickCategory(categories);
    if (match) {
      log.info(
        { gameId: match.id, gameName: match.name, source: "search", query },
        "Resolved GTA 6 category via search",
      );
      return match;
    }
  }

  throw new TwitchApiError("The GTA 6 category was not found on Twitch.", {
    statusCode: 404,
    code: "TWITCH_CATEGORY_NOT_FOUND",
  });
}
