-- CASALOOM Phase 2B: admin photo preparation workspace.
--
-- STATUS: CREATED, NOT APPLIED. Review, then apply to a staging project before production.
--
-- Why a new table (and not custom_requests.preferences):
--   * custom_requests is readable by the owning customer (policy custom_requests_read_owner_or_super_admin) and the
--     customer "My requests" screen selects `preferences`. Anything stored there is customer-visible.
--   * custom_requests has no UPDATE grant; the customer-submission RPC signature must not change.
--   * Admin preparation data (prepared file path, preparation metadata, internal production notes) must stay admin-only.
--
-- Storage: NO storage policy change. Admin-prepared files go to the existing private `customization-uploads` bucket under
--   <admin user id>/admin-prepared/<request id>/<uuid>.<ext>
-- which is already permitted by the existing owner-folder policy (owner_manage_private_uploads) and is readable by super
-- admins through super_admin_read_private_uploads. Customers cannot read another user's folder, and the path is only ever
-- recorded in the admin-only table below, so a customer never receives it.
--
-- Originals and customer-edited files are never touched: this migration adds objects only; it alters nothing existing.

create table if not exists public.custom_request_photo_preparations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  -- Identifies the photo: the customer's original attachment path (must be one of custom_requests.attachment_paths).
  original_path text not null,
  -- Append-only history: every save creates a new version, older prepared files are kept. The highest version is current.
  version integer not null,
  prepared_path text not null unique,
  preparation_meta jsonb not null default '{}'::jsonb,
  production_notes text,
  is_ready_for_quotation boolean not null default false,
  ready_marked_at timestamptz,
  ready_marked_by uuid references auth.users(id) on delete set null,
  prepared_by uuid references auth.users(id) on delete set null,
  prepared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_prep_version_positive check (version >= 1),
  constraint photo_prep_original_path_format check (original_path ~* '^[0-9a-f-]{36}/[A-Za-z0-9._/-]+\.(jpg|jpeg|png|webp)$' and position('..' in original_path) = 0),
  constraint photo_prep_prepared_path_format check (prepared_path ~ '^[0-9a-f-]{36}/admin-prepared/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  constraint photo_prep_meta_object check (jsonb_typeof(preparation_meta) = 'object'),
  constraint photo_prep_notes_length check (production_notes is null or length(production_notes) <= 5000),
  constraint photo_prep_ready_consistent check (is_ready_for_quotation = (ready_marked_at is not null)),
  constraint photo_prep_unique_version unique (request_id, original_path, version)
);

create index if not exists photo_prep_request_idx on public.custom_request_photo_preparations (request_id, original_path, version desc);

drop trigger if exists photo_prep_set_updated_at on public.custom_request_photo_preparations;
create trigger photo_prep_set_updated_at before update on public.custom_request_photo_preparations
  for each row execute function public.set_updated_at();

alter table public.custom_request_photo_preparations enable row level security;

-- Super admin only. No policy exists for customers or staff, so they receive no rows. Writes go through the RPCs below.
drop policy if exists "photo_prep_super_admin_read" on public.custom_request_photo_preparations;
create policy "photo_prep_super_admin_read" on public.custom_request_photo_preparations for select to authenticated
  using (public.has_role('super_admin'));

revoke all on public.custom_request_photo_preparations from public, anon, authenticated;
grant select on public.custom_request_photo_preparations to authenticated;

-- Records a new admin-prepared version for one photo.
create or replace function public.admin_save_photo_preparation(
  p_request_id uuid,
  p_original_path text,
  p_prepared_path text,
  p_preparation_meta jsonb,
  p_production_notes text default null,
  p_mark_ready boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.custom_requests%rowtype;
  next_version integer;
  notes_value text := nullif(trim(coalesce(p_production_notes, '')), '');
  new_id uuid;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may prepare customer photos' using errcode = '42501';
  end if;

  select r.* into request_row from public.custom_requests r where r.id = p_request_id for update;
  if not found then raise exception 'Custom request not found' using errcode = 'P0002'; end if;
  if request_row.status in ('completed', 'rejected') then
    raise exception 'Photos cannot be prepared for a completed or rejected request' using errcode = '22023';
  end if;

  if p_original_path is null or not (p_original_path = any (request_row.attachment_paths)) then
    raise exception 'The photo is not an attachment of this request' using errcode = '22023';
  end if;
  if p_original_path !~* '\.(jpg|jpeg|png|webp)$' then
    raise exception 'Only image attachments can be prepared' using errcode = '22023';
  end if;

  -- The file must sit in the calling admin's own folder, under this request, and must really exist in the private bucket.
  if p_prepared_path is null or p_prepared_path !~ ('^' || auth.uid()::text || '/admin-prepared/' || p_request_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Prepared file path is not valid for this request' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects so where so.bucket_id = 'customization-uploads' and so.name = p_prepared_path) then
    raise exception 'Prepared file was not found in storage' using errcode = 'P0002';
  end if;

  if p_preparation_meta is null or jsonb_typeof(p_preparation_meta) <> 'object' or length(p_preparation_meta::text) > 50000 then
    raise exception 'Preparation metadata must be a JSON object of at most 50000 characters' using errcode = '22023';
  end if;
  if notes_value is not null and length(notes_value) > 5000 then
    raise exception 'Production notes must be 5000 characters or fewer' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.custom_request_photo_preparations
  where request_id = p_request_id and original_path = p_original_path;

  insert into public.custom_request_photo_preparations (
    request_id, original_path, version, prepared_path, preparation_meta, production_notes,
    is_ready_for_quotation, ready_marked_at, ready_marked_by, prepared_by
  ) values (
    p_request_id, p_original_path, next_version, p_prepared_path, p_preparation_meta, notes_value,
    coalesce(p_mark_ready, false), case when coalesce(p_mark_ready, false) then now() else null end,
    case when coalesce(p_mark_ready, false) then auth.uid() else null end, auth.uid()
  ) returning id into new_id;

  return new_id;
end;
$$;

-- Edits the production notes / ready flag of the CURRENT (highest) version of a photo's preparation.
create or replace function public.admin_update_photo_preparation(
  p_preparation_id uuid,
  p_production_notes text,
  p_mark_ready boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prep_row public.custom_request_photo_preparations%rowtype;
  request_status public.custom_request_status;
  notes_value text := nullif(trim(coalesce(p_production_notes, '')), '');
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may update photo preparation' using errcode = '42501';
  end if;

  select p.* into prep_row from public.custom_request_photo_preparations p where p.id = p_preparation_id for update;
  if not found then raise exception 'Photo preparation not found' using errcode = 'P0002'; end if;

  select r.status into request_status from public.custom_requests r where r.id = prep_row.request_id;
  if request_status in ('completed', 'rejected') then
    raise exception 'Photo preparation cannot change on a completed or rejected request' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.custom_request_photo_preparations n
    where n.request_id = prep_row.request_id and n.original_path = prep_row.original_path and n.version > prep_row.version
  ) then
    raise exception 'A newer prepared version exists; update that one' using errcode = '22023';
  end if;
  if notes_value is not null and length(notes_value) > 5000 then
    raise exception 'Production notes must be 5000 characters or fewer' using errcode = '22023';
  end if;

  update public.custom_request_photo_preparations set
    production_notes = notes_value,
    is_ready_for_quotation = coalesce(p_mark_ready, false),
    ready_marked_at = case
      when not coalesce(p_mark_ready, false) then null
      when prep_row.is_ready_for_quotation then prep_row.ready_marked_at
      else now() end,
    ready_marked_by = case
      when not coalesce(p_mark_ready, false) then null
      when prep_row.is_ready_for_quotation then prep_row.ready_marked_by
      else auth.uid() end
  where id = p_preparation_id;

  return p_preparation_id;
end;
$$;

revoke all on function public.admin_save_photo_preparation(uuid, text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.admin_save_photo_preparation(uuid, text, text, jsonb, text, boolean) to authenticated;
revoke all on function public.admin_update_photo_preparation(uuid, text, boolean) from public, anon;
grant execute on function public.admin_update_photo_preparation(uuid, text, boolean) to authenticated;
