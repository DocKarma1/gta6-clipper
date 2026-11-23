-- GTA 6 Clipper initial schema
-- Apply with the Supabase CLI or the SQL editor. Local development uses a
-- SQLite file that follows the same table names through ClipperRepository.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  twitch_user_id text unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  plan_id text not null check (plan_id in ('starter', 'pro', 'studio')),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'trialing')),
  current_period_end timestamptz,
  provider text,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permission_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_login text not null,
  channel_id text,
  source text not null check (source in ('own_channel', 'written', 'campaign')),
  confirmed_by uuid references public.users (id),
  confirmed_at timestamptz not null default now(),
  notes text,
  unique (workspace_id, channel_login)
);

create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  channel_login text not null,
  channel_id text,
  title text not null default '',
  language text not null default '',
  viewer_count integer not null default 0,
  thumbnail_url text not null default '',
  url text not null default '',
  updated_at timestamptz not null default now(),
  unique (channel_login)
);

create table if not exists public.moments (
  id uuid primary key,
  workspace_id uuid references public.workspaces (id) on delete set null,
  stream_id uuid references public.streams (id) on delete set null,
  channel_login text not null,
  channel_id text,
  started_at timestamptz not null,
  peak_at timestamptz not null,
  hype_score integer not null check (hype_score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  message_rate double precision not null default 0,
  baseline_rate double precision not null default 0,
  z_score double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key,
  workspace_id uuid references public.workspaces (id) on delete set null,
  moment_id uuid references public.moments (id) on delete set null,
  channel_login text not null,
  layout text not null check (layout in ('stacked-split', 'blurred-background')),
  source_path text not null,
  output_path text not null,
  poster_path text,
  started_at timestamptz not null,
  duration_seconds double precision not null,
  hook_title text not null default '',
  status text not null check (status in ('rendering', 'ready', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram', 'facebook')),
  account_ref text,
  status text not null default 'stub' check (status in ('stub', 'queued', 'posted', 'failed')),
  error_message text,
  external_id text,
  url text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create index if not exists moments_channel_peak_idx on public.moments (channel_login, peak_at desc);
create index if not exists clips_created_idx on public.clips (created_at desc);
create index if not exists posts_clip_idx on public.posts (clip_id);

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.permission_receipts enable row level security;
alter table public.streams enable row level security;
alter table public.moments enable row level security;
alter table public.clips enable row level security;
alter table public.posts enable row level security;

-- Members can read their workspaces and related rows. Writes go through
-- the service role or later API routes that enforce plan and permission gates.
create policy users_self on public.users
  for select using (id = auth.uid() or id in (
    select m.user_id from public.workspace_members m
    where m.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  ));

create policy workspaces_member_select on public.workspaces
  for select using (
    id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy workspace_members_select on public.workspace_members
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy subscriptions_member_select on public.subscriptions
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy permission_receipts_member_all on public.permission_receipts
  for all using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  )
  with check (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy streams_member_select on public.streams
  for select using (
    workspace_id is null or workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy moments_member_select on public.moments
  for select using (
    workspace_id is null or workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy clips_member_select on public.clips
  for select using (
    workspace_id is null or workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy posts_member_select on public.posts
  for select using (
    workspace_id is null or workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );
