-- Highlight timestamps on clips and moments, plus the priority watchlist.

alter table public.moments
  add column if not exists kind text not null default 'chat_spike'
    check (kind in ('chat_spike', 'question_reply')),
  add column if not exists burst_start_at timestamptz,
  add column if not exists burst_end_at timestamptz,
  add column if not exists question_text text;

alter table public.clips
  add column if not exists clip_type text not null default 'chat_spike'
    check (clip_type in ('chat_spike', 'question_reply')),
  add column if not exists event_at timestamptz,
  add column if not exists peak_at timestamptz,
  add column if not exists highlight_start_at timestamptz,
  add column if not exists highlight_end_at timestamptz,
  add column if not exists peak_offset_seconds double precision,
  add column if not exists hype_score integer check (hype_score is null or hype_score between 0 and 100);

-- Streamers the auto worker picks first when they are live in GTA VI.
-- workspace_id null = the shared default list (seeded below, read-only for users).
create table if not exists public.watchlist_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  display_name text not null,
  login text not null check (login ~ '^[a-z0-9_]{1,25}$'),
  platform text not null check (platform in ('twitch', 'youtube', 'kick')),
  priority integer not null check (priority between 1 and 1000),
  twitch_login text check (twitch_login is null or twitch_login ~ '^[a-z0-9_]{1,25}$'),
  twitch_verified boolean not null default false,
  capture_supported boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (workspace_id, platform, login)
);

create index if not exists watchlist_channels_workspace_priority_idx
  on public.watchlist_channels (workspace_id, priority);

alter table public.watchlist_channels enable row level security;

create policy watchlist_channels_select on public.watchlist_channels
  for select to authenticated
  using (workspace_id is null or workspace_id in (select private.member_workspace_ids()));

create policy watchlist_channels_insert_admin on public.watchlist_channels
  for insert to authenticated
  with check (workspace_id is not null and (select private.is_workspace_admin(workspace_id)));

create policy watchlist_channels_update_admin on public.watchlist_channels
  for update to authenticated
  using (workspace_id is not null and (select private.is_workspace_admin(workspace_id)))
  with check (workspace_id is not null and (select private.is_workspace_admin(workspace_id)));

create policy watchlist_channels_delete_admin on public.watchlist_channels
  for delete to authenticated
  using (workspace_id is not null and (select private.is_workspace_admin(workspace_id)));

-- Default list (mirrors packages/shared/src/watchlist.ts; Twitch logins verified via Helix /users).
insert into public.watchlist_channels
  (display_name, login, platform, priority, twitch_login, twitch_verified, capture_supported, note)
values
  ('IShowSpeed', 'ishowspeed', 'youtube', 1, 'ishowspeed', true, true, 'Streams mainly on YouTube; only his Twitch broadcasts are captured.'),
  ('Kai Cenat', 'kaicenat', 'twitch', 2, 'kaicenat', true, true, null),
  ('ohnePixel', 'ohnepixel', 'twitch', 3, 'ohnepixel', true, true, null),
  ('Lacy', 'lacy', 'twitch', 4, 'lacy', true, true, null),
  ('DjMaRiiO', 'djmariio', 'twitch', 5, 'djmariio', true, true, null),
  ('CaseOh', 'caseoh_', 'twitch', 6, 'caseoh_', true, true, null),
  ('xQc', 'xqc', 'twitch', 7, 'xqc', true, true, null),
  ('IlloJuan', 'illojuan', 'twitch', 8, 'illojuan', true, true, null),
  ('alanzoka', 'alanzoka', 'twitch', 9, 'alanzoka', true, true, null),
  ('Tminnzy', 'tminnzy', 'twitch', 10, 'tminnzy', true, true, null),
  ('stableronaldo', 'stableronaldo', 'twitch', 11, 'stableronaldo', true, true, null),
  ('evelone2004', 'evelone2004', 'twitch', 12, 'evelone2004', true, true, null),
  ('TheBurntPeanut', 'theburntpeanut', 'twitch', 13, 'theburntpeanut', true, true, null),
  ('Jynxzi', 'jynxzi', 'twitch', 14, 'jynxzi', true, true, null),
  ('Dinah', 'dinah', 'twitch', 15, 'dinah', true, true, null),
  ('ZLOYn', 'zloyn', 'twitch', 16, 'zloyn', true, true, null),
  ('buster', 'buster', 'twitch', 17, 'buster', true, true, null),
  ('Fanum', 'fanum', 'twitch', 18, 'fanum', true, true, 'Low clip demand, so low priority.'),
  ('N3on', 'n3on', 'kick', 19, null, false, false, 'Streams on Kick. Not captured: liveness and chat spikes are Twitch-only for now. (twitch.tv/neon is an unrelated channel and is not listed.)')
on conflict (workspace_id, platform, login) do nothing;
