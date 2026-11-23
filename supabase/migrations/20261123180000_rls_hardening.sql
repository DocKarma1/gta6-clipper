-- RLS hardening after the first advisor run.
--
-- 1. Membership checks move into SECURITY DEFINER helpers in a private schema.
--    The original workspace_members policy queried workspace_members itself,
--    which Postgres rejects as infinite recursion as soon as a signed-in user
--    reads the table. The helpers are not reachable through the Data API.
-- 2. auth.uid() is wrapped in (select ...) so it is evaluated once per query
--    (advisor: auth_rls_initplan).
-- 3. Policies are scoped to the authenticated role. anon gets nothing.
-- 4. Covering indexes for every foreign key (advisor: unindexed_foreign_keys).
-- 5. public.users rows are tied to auth.users and created by a trigger that
--    also provisions a personal workspace, so new sign-ins work without the
--    service role key.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.member_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_members m
  where m.user_id = (select auth.uid());
$$;

create or replace function private.is_workspace_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function private.member_workspace_ids() from public;
revoke all on function private.is_workspace_admin(uuid) from public;
grant execute on function private.member_workspace_ids() to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

-- Replace the original policies.
drop policy if exists users_self on public.users;
drop policy if exists workspaces_member_select on public.workspaces;
drop policy if exists workspace_members_select on public.workspace_members;
drop policy if exists subscriptions_member_select on public.subscriptions;
drop policy if exists permission_receipts_member_all on public.permission_receipts;
drop policy if exists streams_member_select on public.streams;
drop policy if exists moments_member_select on public.moments;
drop policy if exists clips_member_select on public.clips;
drop policy if exists posts_member_select on public.posts;

create policy users_select_self_or_teammate on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select m.user_id from public.workspace_members m
      where m.workspace_id in (select private.member_workspace_ids())
    )
  );

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (id in (select private.member_workspace_ids()));

create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using ((select private.is_workspace_admin(id)))
  with check ((select private.is_workspace_admin(id)));

create policy workspace_members_select_member on public.workspace_members
  for select to authenticated
  using (workspace_id in (select private.member_workspace_ids()));

create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (workspace_id in (select private.member_workspace_ids()));

create policy streams_select_member on public.streams
  for select to authenticated
  using (workspace_id is null or workspace_id in (select private.member_workspace_ids()));

create policy moments_select_member on public.moments
  for select to authenticated
  using (workspace_id is null or workspace_id in (select private.member_workspace_ids()));

create policy clips_select_member on public.clips
  for select to authenticated
  using (workspace_id is null or workspace_id in (select private.member_workspace_ids()));

create policy posts_select_member on public.posts
  for select to authenticated
  using (workspace_id is null or workspace_id in (select private.member_workspace_ids()));

-- permission_receipts policies are recreated in the next migration together
-- with the new receipt columns.

-- Covering indexes for foreign keys.
create index if not exists clips_moment_id_idx on public.clips (moment_id);
create index if not exists clips_workspace_id_idx on public.clips (workspace_id);
create index if not exists moments_stream_id_idx on public.moments (stream_id);
create index if not exists moments_workspace_id_idx on public.moments (workspace_id);
create index if not exists permission_receipts_confirmed_by_idx on public.permission_receipts (confirmed_by);
create index if not exists posts_workspace_id_idx on public.posts (workspace_id);
create index if not exists streams_workspace_id_idx on public.streams (workspace_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);
create index if not exists workspaces_owner_user_id_idx on public.workspaces (owner_user_id);

-- Tie public.users to auth.users.
alter table public.users
  add constraint users_auth_user_fkey foreign key (id) references auth.users (id) on delete cascade;
