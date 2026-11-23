-- Product change: the auto worker clips without a per-streamer approval step.
-- Undo the permission additions made in 20261123181000:
--   * drop workspace_settings (created there) and its require_permission toggle
--   * return permission_receipts to its original columns and source check
--   * provision new users without a workspace_settings row
-- permission_receipts itself comes from the initial schema and is kept, with
-- the hardened member policies, so no existing table is removed.

drop table if exists public.workspace_settings;

alter table public.permission_receipts
  drop constraint if exists permission_receipts_status_check,
  drop constraint if exists permission_receipts_source_check,
  drop constraint if exists permission_receipts_granted_needs_source,
  drop constraint if exists permission_receipts_login_format,
  drop constraint if exists permission_receipts_evidence_url_format;

drop index if exists public.permission_receipts_workspace_status_idx;
drop index if exists public.permission_receipts_revoked_by_idx;
drop index if exists public.permission_receipts_updated_by_idx;

alter table public.permission_receipts
  drop column if exists status,
  drop column if exists evidence_url,
  drop column if exists granted_on,
  drop column if exists requested_at,
  drop column if exists revoked_at,
  drop column if exists revoked_by,
  drop column if exists revoke_reason,
  drop column if exists updated_by,
  drop column if exists updated_at;

alter table public.permission_receipts alter column source set not null;
alter table public.permission_receipts
  add constraint permission_receipts_source_check
    check (source in ('own_channel', 'written', 'campaign'));

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

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public;
