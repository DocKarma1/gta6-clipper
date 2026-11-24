-- QA review gate (worker/src/qa). Additive: widens clips.status with 'review',
-- adds clips.qa (gate result), and refuses queued/posted posts for clips that
-- are not 'ready' with a passed QA result. Existing rows are unchanged.

alter table public.clips
  add column if not exists qa jsonb;

comment on column public.clips.qa is
  'QA gate result: {version, enabled, passed, checkedAt, checks[{id, passed, reasons[], metrics}], failed[]}';

-- Same values as before plus 'review' (rendered, held back by the QA gate).
alter table public.clips drop constraint if exists clips_status_check;
alter table public.clips
  add constraint clips_status_check
    check (status in ('rendering', 'ready', 'review', 'failed'));

create index if not exists clips_status_created_idx on public.clips (status, created_at desc);

-- Publish guard in the database as well as in the worker.
create or replace function private.assert_clip_publishable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clip_status text;
  clip_qa jsonb;
begin
  if new.status not in ('queued', 'posted') then
    return new;
  end if;
  select c.status, c.qa into clip_status, clip_qa from public.clips c where c.id = new.clip_id;
  if clip_status is distinct from 'ready'
     or clip_qa is null
     or coalesce((clip_qa ->> 'enabled')::boolean, false) is not true
     or coalesce((clip_qa ->> 'passed')::boolean, false) is not true then
    raise exception 'Clip % is not publishable (status %, QA not passed)', new.clip_id, coalesce(clip_status, 'missing')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_require_qa_passed on public.posts;
create trigger posts_require_qa_passed
  before insert or update of status on public.posts
  for each row execute function private.assert_clip_publishable();
