-- CASALOOM Phase 3: personalised product quotation management.
--
-- STATUS: CREATED, NOT APPLIED. Review, then apply to a staging project before production.
--
-- Additive only. No existing table, column, enum value, policy, function or storage rule is altered.
-- custom_requests, orders, order_items, payment_records and every checkout/payment RPC are untouched.
--
-- Design
--   * custom_request_quotations      one row per quotation VERSION of a custom request (history is kept; a sent
--                                    quotation is never edited, deleted or overwritten - a revision is a new row).
--   * custom_request_quotation_items itemised lines. line_total_inr is a GENERATED column (quantity x unit price).
--   * All money totals (subtotal, printing, final total) are computed by the database inside the RPCs. No RPC accepts
--     a total, and a CHECK constraint re-asserts final = subtotal - discount + shipping.
--   * Super admin only: create / edit draft / send / discard draft (RPCs) and direct table reads (RLS).
--   * Customers have NO direct table access. They read and respond through SECURITY DEFINER RPCs that filter on
--     custom_requests.customer_id = auth.uid(), never return drafts and never return internal_notes, created_by or
--     sent_by. This is why customer-visible notes and internal notes can safely sit in the same row.
--   * Accepting a quotation only records the acceptance and sets payment_eligible_at. It does NOT create an order,
--     does NOT touch payment_records and does NOT change the custom request status, so nothing is paid and no
--     production starts. Payment against an accepted quotation, and production tracking, are later phases.
--   * Expiry is evaluated lazily (no scheduler is assumed): every RPC first persists sent -> expired for due rows,
--     and acceptance re-checks valid_until under a row lock.

do $$ begin
  create type public.quotation_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded');
exception when duplicate_object then null;
end $$;

create table if not exists public.custom_request_quotations (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  request_id uuid not null references public.custom_requests(id) on delete restrict,
  version integer not null,
  status public.quotation_status not null default 'draft',
  currency text not null default 'INR',
  subtotal_inr numeric(14,2) not null default 0,
  printing_charges_inr numeric(14,2) not null default 0,
  discount_inr numeric(14,2) not null default 0,
  shipping_charge_inr numeric(14,2) not null default 0,
  final_total_inr numeric(14,2) not null default 0,
  customer_notes text,
  internal_notes text,
  validity_days integer not null default 14,
  valid_until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  expired_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid references public.custom_request_quotations(id) on delete set null,
  payment_eligible_at timestamptz,
  constraint quotations_version_positive check (version >= 1),
  constraint quotations_request_version_unique unique (request_id, version),
  constraint quotations_currency_inr check (currency = 'INR'),
  constraint quotations_amounts_nonnegative check (
    subtotal_inr >= 0 and printing_charges_inr >= 0 and discount_inr >= 0 and shipping_charge_inr >= 0 and final_total_inr >= 0
  ),
  constraint quotations_discount_within_subtotal check (discount_inr <= subtotal_inr),
  constraint quotations_printing_within_subtotal check (printing_charges_inr <= subtotal_inr),
  constraint quotations_total_consistent check (final_total_inr = subtotal_inr - discount_inr + shipping_charge_inr),
  constraint quotations_validity_range check (validity_days between 1 and 90),
  constraint quotations_customer_notes_length check (customer_notes is null or length(customer_notes) <= 2000),
  constraint quotations_internal_notes_length check (internal_notes is null or length(internal_notes) <= 5000),
  constraint quotations_decline_reason_length check (decline_reason is null or length(decline_reason) <= 1000),
  constraint quotations_sent_fields check (status = 'draft' or (sent_at is not null and valid_until is not null)),
  constraint quotations_accepted_fields check ((status = 'accepted') = (accepted_at is not null and payment_eligible_at is not null)),
  constraint quotations_declined_fields check ((status = 'declined') = (declined_at is not null))
);

create index if not exists quotations_request_version_idx on public.custom_request_quotations (request_id, version desc);
create index if not exists quotations_status_valid_idx on public.custom_request_quotations (status, valid_until) where status = 'sent';
-- At most one draft, one live (sent) and one accepted quotation per request. These make races impossible even if an RPC is bypassed.
create unique index if not exists quotations_one_draft_per_request on public.custom_request_quotations (request_id) where status = 'draft';
create unique index if not exists quotations_one_sent_per_request on public.custom_request_quotations (request_id) where status = 'sent';
create unique index if not exists quotations_one_accepted_per_request on public.custom_request_quotations (request_id) where status = 'accepted';

create table if not exists public.custom_request_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.custom_request_quotations(id) on delete cascade,
  position integer not null,
  kind text not null,
  description text not null,
  quantity integer not null,
  unit_price_inr numeric(12,2) not null,
  line_total_inr numeric(14,2) generated always as (quantity * unit_price_inr) stored,
  created_at timestamptz not null default now(),
  constraint quotation_items_kind_valid check (kind in ('product', 'printing', 'additional')),
  constraint quotation_items_description_length check (length(trim(description)) between 1 and 200),
  constraint quotation_items_quantity_range check (quantity between 1 and 1000),
  constraint quotation_items_price_range check (unit_price_inr between 0 and 1000000),
  constraint quotation_items_position_positive check (position >= 1),
  constraint quotation_items_position_unique unique (quotation_id, position)
);

create index if not exists quotation_items_quotation_idx on public.custom_request_quotation_items (quotation_id, position);

drop trigger if exists quotations_set_updated_at on public.custom_request_quotations;
create trigger quotations_set_updated_at before update on public.custom_request_quotations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- Defence in depth: a quotation that has been sent can never change its content, and its status can only move
-- forward (draft -> sent -> accepted | declined | expired | superseded). The RPCs already behave this way; the
-- triggers make it true for any other writer too.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.guard_quotation_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A sent quotation is part of the permanent history and cannot be deleted' using errcode = '22023';
    end if;
    return old;
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'sent') or
    (old.status = 'sent' and new.status in ('accepted', 'declined', 'expired', 'superseded'))
  ) then
    raise exception 'Invalid quotation status change from % to %', old.status, new.status using errcode = '22023';
  end if;

  if old.status <> 'draft' and (
    new.quote_number, new.request_id, new.version, new.currency, new.subtotal_inr, new.printing_charges_inr,
    new.discount_inr, new.shipping_charge_inr, new.final_total_inr, new.customer_notes, new.internal_notes,
    new.validity_days, new.valid_until, new.created_by, new.created_at, new.sent_at, new.sent_by
  ) is distinct from (
    old.quote_number, old.request_id, old.version, old.currency, old.subtotal_inr, old.printing_charges_inr,
    old.discount_inr, old.shipping_charge_inr, old.final_total_inr, old.customer_notes, old.internal_notes,
    old.validity_days, old.valid_until, old.created_by, old.created_at, old.sent_at, old.sent_by
  ) then
    raise exception 'A sent quotation cannot be edited; create a revised quotation instead' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists quotations_guard_immutable on public.custom_request_quotations;
create trigger quotations_guard_immutable before update or delete on public.custom_request_quotations
  for each row execute function public.guard_quotation_immutable();

create or replace function public.guard_quotation_item_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_status public.quotation_status;
  parent_id uuid;
begin
  if tg_op = 'DELETE' then parent_id := old.quotation_id; else parent_id := new.quotation_id; end if;
  select q.status into parent_status from public.custom_request_quotations q where q.id = parent_id;
  -- A missing parent means the item is being removed by the cascade of a deleted draft.
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'Items of a sent quotation cannot be changed' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists quotation_items_guard on public.custom_request_quotation_items;
create trigger quotation_items_guard before insert or update or delete on public.custom_request_quotation_items
  for each row execute function public.guard_quotation_item_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security: super admin read only. Customers get no policy and therefore no rows; they use the RPCs below.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.custom_request_quotations enable row level security;
alter table public.custom_request_quotation_items enable row level security;

drop policy if exists "quotations_super_admin_read" on public.custom_request_quotations;
create policy "quotations_super_admin_read" on public.custom_request_quotations for select to authenticated
  using (public.has_role('super_admin'));
drop policy if exists "quotation_items_super_admin_read" on public.custom_request_quotation_items;
create policy "quotation_items_super_admin_read" on public.custom_request_quotation_items for select to authenticated
  using (public.has_role('super_admin'));

revoke all on public.custom_request_quotations, public.custom_request_quotation_items from public, anon, authenticated;
grant select on public.custom_request_quotations, public.custom_request_quotation_items to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Internal: persist sent -> expired for quotations whose validity has ended. Not callable by clients.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.expire_due_quotations(p_request_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  update public.custom_request_quotations
  set status = 'expired', expired_at = now()
  where status = 'sent' and valid_until <= now() and (p_request_id is null or request_id = p_request_id);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_due_quotations(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin: create a new draft version, or replace the contents of an existing draft. Totals are computed here.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_quotation_draft(
  p_request_id uuid,
  p_items jsonb,
  p_discount_inr numeric default 0,
  p_shipping_charge_inr numeric default 0,
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_validity_days integer default 14,
  p_quotation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.custom_requests%rowtype;
  quote_row public.custom_request_quotations%rowtype;
  quote_id uuid;
  item_value jsonb;
  item_position bigint;
  item_kind text;
  item_quantity numeric;
  item_price numeric;
  new_subtotal numeric(14,2);
  new_printing numeric(14,2);
  discount_value numeric := coalesce(p_discount_inr, 0);
  shipping_value numeric := coalesce(p_shipping_charge_inr, 0);
  customer_notes_value text := nullif(trim(coalesce(p_customer_notes, '')), '');
  internal_notes_value text := nullif(trim(coalesce(p_internal_notes, '')), '');
  has_product boolean := false;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may create quotations' using errcode = '42501';
  end if;

  select r.* into request_row from public.custom_requests r where r.id = p_request_id for update;
  if not found then raise exception 'Custom request not found' using errcode = 'P0002'; end if;
  if request_row.status in ('completed', 'rejected') then
    raise exception 'A quotation cannot be created for a completed or rejected request' using errcode = '22023';
  end if;

  perform public.expire_due_quotations(p_request_id);
  if exists (select 1 from public.custom_request_quotations q where q.request_id = p_request_id and q.status = 'accepted') then
    raise exception 'This request already has an accepted quotation' using errcode = '22023';
  end if;

  -- Input validation. Nothing the browser computed is trusted: only quantities and unit prices are read.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'A quotation needs between 1 and 30 line items' using errcode = '22023';
  end if;
  for item_value, item_position in
    select e.value, e.ordinality from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(item_value) <> 'object' then
      raise exception 'Line item % is not valid', item_position using errcode = '22023';
    end if;
    item_kind := item_value ->> 'kind';
    if item_kind is null or item_kind not in ('product', 'printing', 'additional') then
      raise exception 'Line item % has an invalid type', item_position using errcode = '22023';
    end if;
    if item_kind = 'product' then has_product := true; end if;
    if jsonb_typeof(item_value -> 'description') is distinct from 'string'
       or length(trim(item_value ->> 'description')) not between 1 and 200 then
      raise exception 'Line item % needs a description of 1 to 200 characters', item_position using errcode = '22023';
    end if;
    if jsonb_typeof(item_value -> 'quantity') is distinct from 'number' or jsonb_typeof(item_value -> 'unit_price_inr') is distinct from 'number' then
      raise exception 'Line item % needs a numeric quantity and unit price', item_position using errcode = '22023';
    end if;
    item_quantity := (item_value ->> 'quantity')::numeric;
    item_price := (item_value ->> 'unit_price_inr')::numeric;
    if item_quantity <> trunc(item_quantity) or item_quantity not between 1 and 1000 then
      raise exception 'Line item % quantity must be a whole number from 1 to 1000', item_position using errcode = '22023';
    end if;
    if item_price not between 0 and 1000000 or round(item_price, 2) <> item_price then
      raise exception 'Line item % unit price must be from 0 to 1,000,000 with at most 2 decimals', item_position using errcode = '22023';
    end if;
  end loop;
  if not has_product then
    raise exception 'Add at least one product line item' using errcode = '22023';
  end if;
  if discount_value < 0 or discount_value > 100000000 or round(discount_value, 2) <> discount_value then
    raise exception 'Discount must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if shipping_value < 0 or shipping_value > 10000000 or round(shipping_value, 2) <> shipping_value then
    raise exception 'Shipping charge must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if p_validity_days is null or p_validity_days not between 1 and 90 then
    raise exception 'Validity must be between 1 and 90 days' using errcode = '22023';
  end if;
  if customer_notes_value is not null and length(customer_notes_value) > 2000 then
    raise exception 'Customer notes must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if internal_notes_value is not null and length(internal_notes_value) > 5000 then
    raise exception 'Internal notes must be 5000 characters or fewer' using errcode = '22023';
  end if;

  if p_quotation_id is not null then
    select q.* into quote_row from public.custom_request_quotations q
    where q.id = p_quotation_id and q.request_id = p_request_id for update;
    if not found then raise exception 'Quotation not found for this request' using errcode = 'P0002'; end if;
    if quote_row.status <> 'draft' then
      raise exception 'Only a draft quotation can be edited; create a revised quotation instead' using errcode = '22023';
    end if;
    quote_id := quote_row.id;
  else
    if exists (select 1 from public.custom_request_quotations q where q.request_id = p_request_id and q.status = 'draft') then
      raise exception 'A draft quotation already exists for this request; edit it instead' using errcode = '22023';
    end if;
    insert into public.custom_request_quotations (quote_number, request_id, version, created_by)
    select request_row.request_number || '-Q' || next_version.value, p_request_id, next_version.value, auth.uid()
    from (select coalesce(max(q.version), 0) + 1 as value from public.custom_request_quotations q where q.request_id = p_request_id) next_version
    returning id into quote_id;
  end if;

  delete from public.custom_request_quotation_items where quotation_id = quote_id;
  insert into public.custom_request_quotation_items (quotation_id, position, kind, description, quantity, unit_price_inr)
  select quote_id, e.ordinality::integer, e.value ->> 'kind', trim(e.value ->> 'description'),
         ((e.value ->> 'quantity')::numeric)::integer, ((e.value ->> 'unit_price_inr')::numeric)::numeric(12,2)
  from jsonb_array_elements(p_items) with ordinality as e(value, ordinality);

  select coalesce(sum(i.line_total_inr), 0), coalesce(sum(i.line_total_inr) filter (where i.kind = 'printing'), 0)
  into new_subtotal, new_printing
  from public.custom_request_quotation_items i where i.quotation_id = quote_id;

  if discount_value > new_subtotal then
    raise exception 'Discount cannot be more than the subtotal' using errcode = '22023';
  end if;

  update public.custom_request_quotations set
    subtotal_inr = new_subtotal,
    printing_charges_inr = new_printing,
    discount_inr = discount_value,
    shipping_charge_inr = shipping_value,
    final_total_inr = new_subtotal - discount_value + shipping_value,
    customer_notes = customer_notes_value,
    internal_notes = internal_notes_value,
    validity_days = p_validity_days
  where id = quote_id;

  return quote_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin: send a draft to the customer. Any earlier SENT quotation of the request becomes superseded in the same
-- transaction. Validity starts now. A brand-new request moves to 'pending' (an allowed transition) with a history row.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_send_quotation(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_request_id uuid;
  request_row public.custom_requests%rowtype;
  quote_row public.custom_request_quotations%rowtype;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may send quotations' using errcode = '42501';
  end if;

  select q.request_id into owner_request_id from public.custom_request_quotations q where q.id = p_quotation_id;
  if not found then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
  -- Same lock order as admin_save_quotation_draft: request first, then quotation.
  select r.* into request_row from public.custom_requests r where r.id = owner_request_id for update;
  select q.* into quote_row from public.custom_request_quotations q where q.id = p_quotation_id for update;

  perform public.expire_due_quotations(owner_request_id);
  if quote_row.status <> 'draft' then
    raise exception 'Only a draft quotation can be sent' using errcode = '22023';
  end if;
  if request_row.status in ('completed', 'rejected') then
    raise exception 'A quotation cannot be sent for a completed or rejected request' using errcode = '22023';
  end if;
  if exists (select 1 from public.custom_request_quotations q where q.request_id = owner_request_id and q.status = 'accepted') then
    raise exception 'This request already has an accepted quotation' using errcode = '22023';
  end if;
  if not exists (select 1 from public.custom_request_quotation_items i where i.quotation_id = p_quotation_id and i.kind = 'product') then
    raise exception 'The quotation has no product line item' using errcode = '22023';
  end if;
  if quote_row.final_total_inr <= 0 then
    raise exception 'The final total must be greater than zero before sending' using errcode = '22023';
  end if;

  update public.custom_request_quotations
  set status = 'superseded', superseded_at = now(), superseded_by = p_quotation_id
  where request_id = owner_request_id and status = 'sent';

  update public.custom_request_quotations
  set status = 'sent', sent_at = now(), sent_by = auth.uid(), valid_until = now() + make_interval(days => quote_row.validity_days)
  where id = p_quotation_id;

  if request_row.status = 'new' then
    update public.custom_requests set status = 'pending' where id = owner_request_id;
    insert into public.custom_request_status_history (request_id, previous_status, new_status, reason, changed_by)
    values (owner_request_id, 'new', 'pending', 'Quotation ' || quote_row.quote_number || ' sent to the customer', auth.uid());
  end if;

  return p_quotation_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Admin: discard a draft that was never sent. Sent quotations can never be deleted.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_discard_quotation_draft(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_request_id uuid;
  quote_status public.quotation_status;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may discard quotation drafts' using errcode = '42501';
  end if;
  select q.request_id into owner_request_id from public.custom_request_quotations q where q.id = p_quotation_id;
  if not found then raise exception 'Quotation not found' using errcode = 'P0002'; end if;
  perform 1 from public.custom_requests r where r.id = owner_request_id for update;
  select q.status into quote_status from public.custom_request_quotations q where q.id = p_quotation_id for update;
  if quote_status <> 'draft' then
    raise exception 'Only a draft quotation can be discarded' using errcode = '22023';
  end if;
  delete from public.custom_request_quotations where id = p_quotation_id;
  return p_quotation_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Customer: read the sent quotations of one of the caller's own requests (history included, drafts never).
-- Returns only customer-safe fields: no internal notes, no admin ids.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.get_my_quotations(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view quotations' using errcode = '42501';
  end if;
  if not exists (select 1 from public.custom_requests r where r.id = p_request_id and r.customer_id = auth.uid()) then
    return '[]'::jsonb;
  end if;
  perform public.expire_due_quotations(p_request_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'quote_number', q.quote_number, 'request_id', q.request_id, 'version', q.version,
    'status', q.status, 'currency', q.currency,
    'subtotal_inr', q.subtotal_inr, 'printing_charges_inr', q.printing_charges_inr, 'discount_inr', q.discount_inr,
    'shipping_charge_inr', q.shipping_charge_inr, 'final_total_inr', q.final_total_inr,
    'customer_notes', q.customer_notes, 'valid_until', q.valid_until, 'sent_at', q.sent_at,
    'accepted_at', q.accepted_at, 'declined_at', q.declined_at, 'decline_reason', q.decline_reason,
    'expired_at', q.expired_at, 'superseded_at', q.superseded_at, 'payment_eligible', (q.status = 'accepted'),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'description', i.description, 'quantity', i.quantity,
        'unit_price_inr', i.unit_price_inr, 'line_total_inr', i.line_total_inr
      ) order by i.position), '[]'::jsonb)
      from public.custom_request_quotation_items i where i.quotation_id = q.id
    )
  ) order by q.version desc), '[]'::jsonb)
  into result
  from public.custom_request_quotations q
  where q.request_id = p_request_id and q.status <> 'draft';

  return result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Customer: latest visible quotation of each of the caller's requests (for list badges). Read only.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.get_my_quotation_overview(p_request_ids uuid[])
returns table (
  request_id uuid, quotation_id uuid, version integer, status public.quotation_status,
  final_total_inr numeric, valid_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view quotations' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_request_ids), 0) > 100 then
    raise exception 'Too many requests' using errcode = '22023';
  end if;
  return query
  select distinct on (q.request_id)
    q.request_id, q.id, q.version,
    case when q.status = 'sent' and q.valid_until <= now() then 'expired'::public.quotation_status else q.status end,
    q.final_total_inr, q.valid_until
  from public.custom_request_quotations q
  join public.custom_requests r on r.id = q.request_id
  where r.customer_id = auth.uid() and q.request_id = any (coalesce(p_request_ids, '{}'::uuid[])) and q.status <> 'draft'
  order by q.request_id, q.version desc;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Customer: accept or decline the caller's own SENT quotation.
-- Returns the resulting status. Repeating the same decision is a harmless no-op, so a double click can never
-- accept twice; the opposite decision, or a decision on an expired / superseded quotation, is rejected.
-- Accepting records payment eligibility only: nothing is paid, no order is created, no production starts.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.customer_respond_to_quotation(
  p_quotation_id uuid,
  p_decision text,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_request_id uuid;
  request_row public.custom_requests%rowtype;
  quote_row public.custom_request_quotations%rowtype;
  reason_value text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Please sign in to respond to a quotation' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accept', 'decline') then
    raise exception 'Choose accept or decline' using errcode = '22023';
  end if;
  if reason_value is not null and length(reason_value) > 1000 then
    raise exception 'Please keep your reason to 1000 characters or fewer' using errcode = '22023';
  end if;

  -- Not-found is returned for missing, foreign and draft quotations alike, so nothing is revealed about them.
  select q.request_id into owner_request_id
  from public.custom_request_quotations q join public.custom_requests r on r.id = q.request_id
  where q.id = p_quotation_id and r.customer_id = auth.uid() and q.status <> 'draft';
  if not found then raise exception 'Quotation not found' using errcode = 'P0002'; end if;

  select r.* into request_row from public.custom_requests r where r.id = owner_request_id for update;
  select q.* into quote_row from public.custom_request_quotations q where q.id = p_quotation_id for update;

  if (p_decision = 'accept' and quote_row.status = 'accepted') or (p_decision = 'decline' and quote_row.status = 'declined') then
    return quote_row.status::text;
  end if;
  if quote_row.status = 'sent' and quote_row.valid_until <= now() then
    update public.custom_request_quotations set status = 'expired', expired_at = now() where id = p_quotation_id;
    return 'expired';
  end if;
  if quote_row.status <> 'sent' then
    raise exception 'This quotation can no longer be answered (it is %)', quote_row.status using errcode = '22023';
  end if;
  if request_row.status in ('completed', 'rejected') then
    raise exception 'This request is closed, so the quotation can no longer be answered' using errcode = '22023';
  end if;

  if p_decision = 'accept' then
    update public.custom_request_quotations
    set status = 'accepted', accepted_at = now(), payment_eligible_at = now()
    where id = p_quotation_id;
    return 'accepted';
  end if;

  update public.custom_request_quotations
  set status = 'declined', declined_at = now(), decline_reason = reason_value
  where id = p_quotation_id;
  return 'declined';
end;
$$;

revoke all on function public.admin_save_quotation_draft(uuid, jsonb, numeric, numeric, text, text, integer, uuid) from public, anon;
grant execute on function public.admin_save_quotation_draft(uuid, jsonb, numeric, numeric, text, text, integer, uuid) to authenticated;
revoke all on function public.admin_send_quotation(uuid) from public, anon;
grant execute on function public.admin_send_quotation(uuid) to authenticated;
revoke all on function public.admin_discard_quotation_draft(uuid) from public, anon;
grant execute on function public.admin_discard_quotation_draft(uuid) to authenticated;
revoke all on function public.get_my_quotations(uuid) from public, anon;
grant execute on function public.get_my_quotations(uuid) to authenticated;
revoke all on function public.get_my_quotation_overview(uuid[]) from public, anon;
grant execute on function public.get_my_quotation_overview(uuid[]) to authenticated;
revoke all on function public.customer_respond_to_quotation(uuid, text, text) from public, anon;
grant execute on function public.customer_respond_to_quotation(uuid, text, text) to authenticated;
