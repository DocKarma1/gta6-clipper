import { z } from "zod";

export const helixPaginationSchema = z
  .object({
    cursor: z.string().nullish(),
  })
  .passthrough();

export const helixTokenSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    token_type: z.string().min(1),
  })
  .passthrough();

export const helixGameSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    box_art_url: z.string(),
    igdb_id: z.string().nullish(),
  })
  .passthrough();

export const helixGamesResponseSchema = z
  .object({
    data: z.array(helixGameSchema),
  })
  .passthrough();

export const helixCategorySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    box_art_url: z.string(),
  })
  .passthrough();

export const helixSearchCategoriesResponseSchema = z
  .object({
    data: z.array(helixCategorySchema),
    pagination: helixPaginationSchema.nullish(),
  })
  .passthrough();

export const helixStreamSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    user_login: z.string().min(1),
    user_name: z.string().min(1),
    game_id: z.string(),
    game_name: z.string(),
    type: z.string(),
    title: z.string(),
    viewer_count: z.number().int().nonnegative(),
    started_at: z.string().min(1),
    language: z.string(),
    thumbnail_url: z.string(),
    tag_ids: z.array(z.string()).nullish(),
    tags: z.array(z.string()).nullish(),
    is_mature: z.boolean().nullish(),
  })
  .passthrough();

export const helixStreamsResponseSchema = z
  .object({
    data: z.array(helixStreamSchema),
    pagination: helixPaginationSchema.nullish(),
  })
  .passthrough();

export type HelixToken = z.infer<typeof helixTokenSchema>;
export type HelixPagination = z.infer<typeof helixPaginationSchema>;
export type HelixGame = z.infer<typeof helixGameSchema>;
export type HelixGamesResponse = z.infer<typeof helixGamesResponseSchema>;
export type HelixCategory = z.infer<typeof helixCategorySchema>;
export type HelixSearchCategoriesResponse = z.infer<typeof helixSearchCategoriesResponseSchema>;
export type HelixStream = z.infer<typeof helixStreamSchema>;
export type HelixStreamsResponse = z.infer<typeof helixStreamsResponseSchema>;
