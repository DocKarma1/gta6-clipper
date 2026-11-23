-- Streamer permission receipts and the per-workspace requirePermission setting.
--
-- status:  requested -> granted -> revoked (a missing row means "none").
-- source:  how permission was granted. Required once status = 'granted'.
-- Receipts are never deleted from the app; revoking keeps the audit trail.

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  require_permission boolean not null default true,
  require_permission_acknowledged_at timestamptz,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists workspace_settings_updated_by_idx on public.workspace_settings (updated_by);

alter table public.workspace_settings enable row level security;

create policy workspace_settings_select_member on public.workspace_settings
  for select to authenticated
  using (workspace_id in (select private.member_workspace_ids()));

create policy workspace_settings_insert_admin on public.workspace_settings
  for insert to authenticated
  with check ((select private.is_workspace_admin(workspace_id)));

create policy workspace_settings_update_admin on public.workspace_settings
  for update to authenticated
  using ((select private.is_workspace_admin(workspace_id)))
  with check ((select private.is_workspace_admin(workspace_id)));

-- Extend permission_receipts.
alter table public.permission_receipts drop constraint if exists permission_receipts_source_check;
alter table public.permission_receipts alter column source drop not null;

alter table public.permission_receipts
  add column if not exists status text not null default 'granted',
  add column if not exists evidence_url text,
  add column if not exists granted_on date,
  add column if not exists requested_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.users (id) on delete set null,
  add column if not exists revoke_reason text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.permission_receipts
  add constraint permission_receipts_status_check
    check (status in ('requested', 'granted', 'revoked')),
  add constraint permission_receipts_source_check
    check (source is null or source in (
      'own_channel', 'written', 'campaign', 'public_clip_policy', 'dm', 'email', 'other'
    )),
  add constraint permission_receipts_granted_needs_source
    check (status <> 'granted' or source is not null),
  add constraint permission_receipts_login_format
    check (channel_login ~ '^[a-z0-9_]{1,25}$'),
  add constraint permission_receipts_evidence_url_format
    check (evidence_url is null or evidence_url ~* '^https?://');

create index if not exists permission_receipts_workspace_status_idx
  on public.permission_receipts (workspace_id, status);
create index if not exists permission_receipts_revoked_by_idx on public.permission_receipts (revoked_by);
create index if not exists permission_receipts_updated_by_idx on public.permission_receipts (updated_by);

create policy permission_receipts_select_member on public.permission_receipts
  for select to authenticated
  using (workspace_id in (select private.member_workspace_ids()));

create policy permission_receipts_insert_member on public.permission_receipts
  for insert to authenticated
  with check (
    workspace_id in (select private.member_workspace_ids())
    and (confirmed_by is null or confirmed_by = (select auth.uid()))
  );

create policy permission_receipts_update_member on public.permission_receipts
  for update to authenticated
  using (workspace_id in (select private.member_workspace_ids()))
  with check (workspace_id in (select private.member_workspace_ids()));

-- No delete policy on purpose: revoke instead.

-- Provision a profile, personal workspace, owner membership, and default
-- settings (require_permission = true) for every new auth user.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  label text;
begin
  label := coalesce(
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'My'
  );

  insert into public.users (id, email, display_name)
  values (new.id, new.email, label)
  on conflict (id) do nothing;

  insert into public.workspaces (name, owner_user_id)
  values (label || '''s workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  insert into public.workspace_settings (workspace_id, require_permission)
  values (new_workspace_id, true);

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();
