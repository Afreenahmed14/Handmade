do $$ begin
  create type public.custom_request_status as enum ('new', 'pending', 'in_progress', 'completed', 'rejected');
exception when duplicate_object then null;
end $$;

create table if not exists public.custom_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default (
    'CR-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  customer_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  requested_product text not null,
  title text not null,
  description text not null,
  requirements jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  budget_min_inr numeric(12,2),
  budget_max_inr numeric(12,2),
  attachment_paths text[] not null default '{}',
  status public.custom_request_status not null default 'new',
  customer_response text,
  response_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_requests_title_length check (length(trim(title)) between 1 and 200),
  constraint custom_requests_product_length check (length(trim(requested_product)) between 1 and 200),
  constraint custom_requests_description_length check (length(trim(description)) between 1 and 5000),
  constraint custom_requests_budget_nonnegative check (
    (budget_min_inr is null or budget_min_inr >= 0) and
    (budget_max_inr is null or budget_max_inr >= 0) and
    (budget_min_inr is null or budget_max_inr is null or budget_max_inr >= budget_min_inr)
  ),
  constraint custom_requests_requirements_object check (jsonb_typeof(requirements) = 'object'),
  constraint custom_requests_preferences_object check (jsonb_typeof(preferences) = 'object'),
  constraint custom_requests_attachment_limit check (cardinality(attachment_paths) <= 10),
  constraint custom_requests_response_length check (customer_response is null or length(customer_response) <= 5000)
);

create index if not exists custom_requests_customer_created_idx on public.custom_requests (customer_id, created_at desc);
create index if not exists custom_requests_status_created_idx on public.custom_requests (status, created_at desc);
create index if not exists custom_requests_created_idx on public.custom_requests (created_at desc);

create table if not exists public.custom_request_status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  previous_status public.custom_request_status,
  new_status public.custom_request_status not null,
  reason text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint custom_request_history_reason_length check (length(trim(reason)) between 1 and 1000)
);

create index if not exists custom_request_status_history_request_created_idx on public.custom_request_status_history (request_id, created_at desc);

create table if not exists public.custom_request_internal_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  note text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint custom_request_internal_note_length check (length(trim(note)) between 1 and 5000)
);

create index if not exists custom_request_internal_notes_request_created_idx on public.custom_request_internal_notes (request_id, created_at desc);

create table if not exists public.custom_request_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  response text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint custom_request_response_length check (length(trim(response)) between 1 and 5000)
);

create index if not exists custom_request_responses_request_created_idx on public.custom_request_responses (request_id, created_at desc);

create or replace function public.set_custom_request_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_requests_set_updated_at on public.custom_requests;
create trigger custom_requests_set_updated_at before update on public.custom_requests for each row execute function public.set_custom_request_updated_at();

alter table public.custom_requests enable row level security;
alter table public.custom_request_status_history enable row level security;
alter table public.custom_request_internal_notes enable row level security;
alter table public.custom_request_responses enable row level security;

drop policy if exists "custom_requests_read_owner_or_super_admin" on public.custom_requests;
create policy "custom_requests_read_owner_or_super_admin" on public.custom_requests for select to authenticated
  using (customer_id = auth.uid() or public.has_role('super_admin'));
drop policy if exists "custom_request_history_admin_read" on public.custom_request_status_history;
create policy "custom_request_history_admin_read" on public.custom_request_status_history for select to authenticated
  using (public.has_role('super_admin'));
drop policy if exists "custom_request_notes_admin_read" on public.custom_request_internal_notes;
create policy "custom_request_notes_admin_read" on public.custom_request_internal_notes for select to authenticated
  using (public.has_role('super_admin'));
drop policy if exists "custom_request_responses_read_owner_or_admin" on public.custom_request_responses;
create policy "custom_request_responses_read_owner_or_admin" on public.custom_request_responses for select to authenticated
  using (exists (
    select 1 from public.custom_requests r
    where r.id = request_id and (r.customer_id = auth.uid() or public.has_role('super_admin'))
  ));

revoke all on public.custom_requests, public.custom_request_status_history, public.custom_request_internal_notes, public.custom_request_responses from anon, authenticated;
grant select on public.custom_requests, public.custom_request_status_history, public.custom_request_internal_notes, public.custom_request_responses to authenticated;

create or replace view public.admin_custom_request_directory
with (security_invoker = true)
as
select
  r.id, r.request_number, r.customer_id, p.full_name as customer_name, p.email as customer_email,
  p.mobile_number as customer_phone, r.product_id, r.requested_product, r.title, r.description,
  r.requirements, r.preferences, r.budget_min_inr, r.budget_max_inr, r.attachment_paths,
  r.status, r.customer_response, r.response_updated_at, r.created_at, r.updated_at
from public.custom_requests r
join public.profiles p on p.id = r.customer_id;

revoke all on public.admin_custom_request_directory from public, anon;
grant select on public.admin_custom_request_directory to authenticated;

create or replace function public.create_customer_custom_request(
  p_product_id uuid,
  p_requested_product text,
  p_title text,
  p_description text,
  p_requirements jsonb default '{}'::jsonb,
  p_preferences jsonb default '{}'::jsonb,
  p_budget_min_inr numeric default null,
  p_budget_max_inr numeric default null,
  p_attachment_paths text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_id_value uuid;
  product_name_value text;
  attachment_path text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'customer'
  ) then
    raise exception 'An authenticated customer account is required' using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200 then
    raise exception 'Request title must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_description is null or length(trim(p_description)) not between 1 and 5000 then
    raise exception 'Request description must be 1 to 5000 characters' using errcode = '22023';
  end if;
  if p_budget_min_inr is not null and p_budget_min_inr < 0 or p_budget_max_inr is not null and p_budget_max_inr < 0 then
    raise exception 'Budget amounts must be non-negative' using errcode = '22023';
  end if;
  if p_budget_min_inr is not null and p_budget_max_inr is not null and p_budget_max_inr < p_budget_min_inr then
    raise exception 'Maximum budget must be at least the minimum budget' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_requirements, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_preferences, '{}'::jsonb)) <> 'object' then
    raise exception 'Requirements and preferences must be JSON objects' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_attachment_paths), 0) > 10 then
    raise exception 'A maximum of 10 attachments is allowed' using errcode = '22023';
  end if;

  if p_product_id is not null then
    select p.name into product_name_value from public.products p where p.id = p_product_id and p.is_published;
    if not found then raise exception 'Selected product is not available' using errcode = 'P0002'; end if;
  end if;
  if p_product_id is null and (p_requested_product is null or length(trim(p_requested_product)) not between 1 and 200) then
    raise exception 'Requested product must be 1 to 200 characters' using errcode = '22023';
  end if;

  foreach attachment_path in array coalesce(p_attachment_paths, '{}'::text[]) loop
    if attachment_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._/-]+$') or position('..' in attachment_path) > 0 then
      raise exception 'Attachments must be private files owned by the current customer' using errcode = '42501';
    end if;
  end loop;

  insert into public.custom_requests (
    customer_id, product_id, requested_product, title, description, requirements,
    preferences, budget_min_inr, budget_max_inr, attachment_paths
  ) values (
    auth.uid(), p_product_id,
    coalesce(nullif(trim(product_name_value), ''), trim(p_requested_product)), trim(p_title), trim(p_description),
    coalesce(p_requirements, '{}'::jsonb), coalesce(p_preferences, '{}'::jsonb),
    p_budget_min_inr, p_budget_max_inr, coalesce(p_attachment_paths, '{}'::text[])
  ) returning id into request_id_value;

  insert into public.custom_request_status_history (request_id, previous_status, new_status, reason, changed_by)
  values (request_id_value, null, 'new', 'Request submitted', auth.uid());
  return request_id_value;
end;
$$;

create or replace function public.admin_update_custom_request(
  p_request_id uuid,
  p_new_status public.custom_request_status,
  p_status_reason text default null,
  p_internal_note text default null,
  p_customer_response text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.custom_requests%rowtype;
  status_reason_value text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may manage custom requests' using errcode = '42501';
  end if;

  select r.* into request_row from public.custom_requests r where r.id = p_request_id for update;
  if not found then raise exception 'Custom request not found' using errcode = 'P0002'; end if;

  if p_new_status is not null and request_row.status is distinct from p_new_status then
    if not (
      (request_row.status = 'new' and p_new_status in ('pending', 'in_progress', 'rejected')) or
      (request_row.status = 'pending' and p_new_status in ('in_progress', 'completed', 'rejected')) or
      (request_row.status = 'in_progress' and p_new_status in ('pending', 'completed', 'rejected'))
    ) then
      raise exception 'Invalid custom request status transition' using errcode = '22023';
    end if;
    status_reason_value := coalesce(nullif(trim(p_status_reason), ''), 'Status updated by administrator');
    update public.custom_requests set status = p_new_status where id = p_request_id;
    insert into public.custom_request_status_history (request_id, previous_status, new_status, reason, changed_by)
    values (p_request_id, request_row.status, p_new_status, status_reason_value, auth.uid());
  elsif p_new_status is not null and request_row.status = p_new_status and p_status_reason is not null then
    raise exception 'Request is already in that status' using errcode = '22023';
  end if;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    if length(p_internal_note) > 5000 then raise exception 'Internal note must be 5000 characters or fewer' using errcode = '22023'; end if;
    insert into public.custom_request_internal_notes (request_id, note, created_by)
    values (p_request_id, trim(p_internal_note), auth.uid());
  end if;

  if p_customer_response is not null then
    if length(trim(p_customer_response)) = 0 or length(p_customer_response) > 5000 then
      raise exception 'Customer response must be 1 to 5000 characters' using errcode = '22023';
    end if;
    insert into public.custom_request_responses (request_id, response, created_by)
    values (p_request_id, trim(p_customer_response), auth.uid());
    update public.custom_requests set customer_response = trim(p_customer_response), response_updated_at = now()
    where id = p_request_id;
  end if;

  return p_request_id;
end;
$$;

revoke all on function public.create_customer_custom_request(uuid, text, text, text, jsonb, jsonb, numeric, numeric, text[]) from public, anon;
grant execute on function public.create_customer_custom_request(uuid, text, text, text, jsonb, jsonb, numeric, numeric, text[]) to authenticated;
revoke all on function public.admin_update_custom_request(uuid, public.custom_request_status, text, text, text) from public, anon;
grant execute on function public.admin_update_custom_request(uuid, public.custom_request_status, text, text, text) to authenticated;
