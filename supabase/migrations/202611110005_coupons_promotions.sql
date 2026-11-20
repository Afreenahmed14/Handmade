do $$ begin
  create type public.coupon_discount_type as enum ('percentage', 'fixed');
exception when duplicate_object then null;
end $$;

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  discount_type public.coupon_discount_type not null,
  discount_value numeric(12,2) not null,
  minimum_order_amount_inr numeric(12,2) not null default 0,
  maximum_discount_amount_inr numeric(12,2),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_total_uses integer,
  max_uses_per_customer integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_code_format check (code = upper(trim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  constraint coupons_description_length check (description is null or length(description) <= 500),
  constraint coupons_discount_valid check (
    (discount_type = 'percentage' and discount_value > 0 and discount_value <= 100)
    or (discount_type = 'fixed' and discount_value > 0)
  ),
  constraint coupons_minimum_nonnegative check (minimum_order_amount_inr >= 0),
  constraint coupons_max_discount_valid check (
    maximum_discount_amount_inr is null
    or (discount_type = 'percentage' and maximum_discount_amount_inr > 0)
  ),
  constraint coupons_valid_date_range check (expires_at > starts_at),
  constraint coupons_usage_limits_valid check (
    (max_total_uses is null or max_total_uses > 0) and max_uses_per_customer > 0
  )
);

create unique index if not exists coupons_code_upper_unique on public.coupons (upper(code));
create index if not exists coupons_active_dates_idx on public.coupons (is_active, starts_at, expires_at);

create table if not exists public.coupon_products (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (coupon_id, product_id)
);

create table if not exists public.coupon_categories (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (coupon_id, category_id)
);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  coupon_code text not null,
  discount_amount_inr numeric(12,2) not null check (discount_amount_inr > 0),
  redeemed_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  constraint coupon_redemptions_code_upper check (coupon_code = upper(trim(coupon_code))),
  constraint coupon_redemptions_release_pair check ((released_at is null) = (release_reason is null))
);

create index if not exists coupon_redemptions_coupon_active_idx on public.coupon_redemptions (coupon_id, redeemed_at desc) where released_at is null;
create index if not exists coupon_redemptions_customer_active_idx on public.coupon_redemptions (coupon_id, customer_id) where released_at is null;

alter table public.orders
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null,
  add column if not exists coupon_code text;

create or replace function public.set_coupon_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at before update on public.coupons for each row execute function public.set_coupon_updated_at();

alter table public.coupons enable row level security;
alter table public.coupon_products enable row level security;
alter table public.coupon_categories enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists "coupons_super_admin_manage" on public.coupons;
create policy "coupons_super_admin_manage" on public.coupons for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));
drop policy if exists "coupon_products_super_admin_read" on public.coupon_products;
create policy "coupon_products_super_admin_read" on public.coupon_products for select to authenticated using (public.has_role('super_admin'));
drop policy if exists "coupon_categories_super_admin_read" on public.coupon_categories;
create policy "coupon_categories_super_admin_read" on public.coupon_categories for select to authenticated using (public.has_role('super_admin'));
drop policy if exists "coupon_redemptions_super_admin_read" on public.coupon_redemptions;
create policy "coupon_redemptions_super_admin_read" on public.coupon_redemptions for select to authenticated using (public.has_role('super_admin'));

revoke all on public.coupons, public.coupon_products, public.coupon_categories, public.coupon_redemptions from anon, authenticated;
grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_products, public.coupon_categories, public.coupon_redemptions to authenticated;

create or replace view public.admin_coupon_directory
with (security_invoker = true)
as
select
  c.*,
  count(r.id) filter (where r.released_at is null)::bigint as active_usage_count,
  count(r.id)::bigint as total_redemption_count,
  case when c.max_total_uses is null then null
    else greatest(c.max_total_uses - count(r.id) filter (where r.released_at is null), 0)
  end::integer as remaining_uses
from public.coupons c
left join public.coupon_redemptions r on r.coupon_id = c.id
group by c.id;

revoke all on public.admin_coupon_directory from public, anon;
grant select on public.admin_coupon_directory to authenticated;

create or replace function public.admin_save_coupon(
  p_coupon_id uuid,
  p_code text,
  p_description text,
  p_discount_type public.coupon_discount_type,
  p_discount_value numeric,
  p_minimum_order_amount_inr numeric,
  p_maximum_discount_amount_inr numeric,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_max_total_uses integer,
  p_max_uses_per_customer integer,
  p_is_active boolean,
  p_product_ids uuid[],
  p_category_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  coupon_id_value uuid;
  normalized_code text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may manage coupons' using errcode = '42501';
  end if;
  normalized_code := upper(trim(coalesce(p_code, '')));
  if normalized_code !~ '^[A-Z0-9][A-Z0-9_-]{0,39}$' then
    raise exception 'Coupon code must use 1 to 40 uppercase letters, digits, underscores, or hyphens' using errcode = '22023';
  end if;
  if p_discount_type is null or p_discount_value is null or p_discount_value <= 0 then
    raise exception 'A valid discount type and positive value are required' using errcode = '22023';
  end if;
  if p_discount_type = 'percentage' and p_discount_value > 100 then
    raise exception 'Percentage discount cannot exceed 100' using errcode = '22023';
  end if;
  if p_discount_type = 'fixed' and p_maximum_discount_amount_inr is not null then
    raise exception 'Maximum discount amount only applies to percentage coupons' using errcode = '22023';
  end if;
  if p_discount_type = 'percentage' and p_maximum_discount_amount_inr is not null and p_maximum_discount_amount_inr <= 0 then
    raise exception 'Maximum discount amount must be positive' using errcode = '22023';
  end if;
  if p_minimum_order_amount_inr is null or p_minimum_order_amount_inr < 0 then
    raise exception 'Minimum order amount must be non-negative' using errcode = '22023';
  end if;
  if p_starts_at is null or p_expires_at is null or p_expires_at <= p_starts_at then
    raise exception 'Expiry must be later than the start date' using errcode = '22023';
  end if;
  if p_max_total_uses is not null and p_max_total_uses <= 0 then
    raise exception 'Maximum total usage must be positive or unlimited' using errcode = '22023';
  end if;
  if p_max_uses_per_customer is null or p_max_uses_per_customer <= 0 then
    raise exception 'Maximum customer usage must be positive' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_product_ids), 0) > 200 or coalesce(cardinality(p_category_ids), 0) > 100 then
    raise exception 'Coupon applicability selection exceeds the supported limit' using errcode = '22023';
  end if;

  if p_coupon_id is null then
    insert into public.coupons (
      code, description, discount_type, discount_value, minimum_order_amount_inr,
      maximum_discount_amount_inr, starts_at, expires_at, max_total_uses,
      max_uses_per_customer, is_active
    ) values (
      normalized_code, nullif(trim(p_description), ''), p_discount_type, p_discount_value,
      p_minimum_order_amount_inr, p_maximum_discount_amount_inr, p_starts_at, p_expires_at,
      p_max_total_uses, p_max_uses_per_customer, p_is_active
    ) returning id into coupon_id_value;
  else
    update public.coupons c set
      code = normalized_code,
      description = nullif(trim(p_description), ''),
      discount_type = p_discount_type,
      discount_value = p_discount_value,
      minimum_order_amount_inr = p_minimum_order_amount_inr,
      maximum_discount_amount_inr = p_maximum_discount_amount_inr,
      starts_at = p_starts_at,
      expires_at = p_expires_at,
      max_total_uses = p_max_total_uses,
      max_uses_per_customer = p_max_uses_per_customer,
      is_active = p_is_active
    where c.id = p_coupon_id
    returning c.id into coupon_id_value;
    if coupon_id_value is null then raise exception 'Coupon not found' using errcode = 'P0002'; end if;
  end if;

  delete from public.coupon_products where coupon_id = coupon_id_value;
  delete from public.coupon_categories where coupon_id = coupon_id_value;
  insert into public.coupon_products (coupon_id, product_id)
    select coupon_id_value, selected.product_id from (select distinct unnest(coalesce(p_product_ids, '{}'::uuid[])) as product_id) selected;
  insert into public.coupon_categories (coupon_id, category_id)
    select coupon_id_value, selected.category_id from (select distinct unnest(coalesce(p_category_ids, '{}'::uuid[])) as category_id) selected;

  return coupon_id_value;
end;
$$;

create or replace function public.validate_customer_coupon(p_code text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  coupon_row public.coupons%rowtype;
  requested record;
  product_row public.products%rowtype;
  subtotal_value numeric(12,2) := 0;
  eligible_subtotal_value numeric(12,2) := 0;
  discount_value numeric(12,2) := 0;
  total_uses bigint;
  customer_uses bigint;
  normalized_code text := upper(trim(coalesce(p_code, '')));
begin
  if auth.uid() is null or not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'customer') then
    raise exception 'An authenticated customer account is required' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    return jsonb_build_object('valid', false, 'message', 'Your cart is empty or too large.');
  end if;
  select c.* into coupon_row from public.coupons c where c.code = normalized_code;
  if not found then return jsonb_build_object('valid', false, 'message', 'Coupon code was not found.'); end if;
  if not coupon_row.is_active then return jsonb_build_object('valid', false, 'message', 'This coupon is inactive.'); end if;
  if now() < coupon_row.starts_at then return jsonb_build_object('valid', false, 'message', 'This coupon is not active yet.'); end if;
  if now() >= coupon_row.expires_at then return jsonb_build_object('valid', false, 'message', 'This coupon has expired.'); end if;

  select count(*) into total_uses from public.coupon_redemptions r where r.coupon_id = coupon_row.id and r.released_at is null;
  select count(*) into customer_uses from public.coupon_redemptions r where r.coupon_id = coupon_row.id and r.customer_id = auth.uid() and r.released_at is null;
  if coupon_row.max_total_uses is not null and total_uses >= coupon_row.max_total_uses then
    return jsonb_build_object('valid', false, 'message', 'This coupon has reached its usage limit.');
  end if;
  if customer_uses >= coupon_row.max_uses_per_customer then
    return jsonb_build_object('valid', false, 'message', 'You have already used this coupon the maximum number of times.');
  end if;

  for requested in
    select (entry.value ->> 'product_id')::uuid as product_id, sum((entry.value ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    group by (entry.value ->> 'product_id')::uuid
  loop
    if requested.quantity is null or requested.quantity <= 0 then
      return jsonb_build_object('valid', false, 'message', 'Cart quantities must be positive whole numbers.');
    end if;
    select p.* into product_row from public.products p where p.id = requested.product_id and p.is_published;
    if not found then return jsonb_build_object('valid', false, 'message', 'A cart product is no longer available.'); end if;
    subtotal_value := subtotal_value + coalesce(product_row.discount_price_inr, product_row.price_inr) * requested.quantity;
    if (not exists (select 1 from public.coupon_products cp where cp.coupon_id = coupon_row.id)
        and not exists (select 1 from public.coupon_categories cc where cc.coupon_id = coupon_row.id))
      or exists (select 1 from public.coupon_products cp where cp.coupon_id = coupon_row.id and cp.product_id = product_row.id)
      or exists (select 1 from public.coupon_categories cc where cc.coupon_id = coupon_row.id and cc.category_id = product_row.category_id) then
      eligible_subtotal_value := eligible_subtotal_value + coalesce(product_row.discount_price_inr, product_row.price_inr) * requested.quantity;
    end if;
  end loop;

  if subtotal_value < coupon_row.minimum_order_amount_inr then
    return jsonb_build_object('valid', false, 'message', 'The cart does not meet the minimum order amount.');
  end if;
  if eligible_subtotal_value <= 0 then
    return jsonb_build_object('valid', false, 'message', 'No products in your cart are eligible for this coupon.');
  end if;
  if coupon_row.discount_type = 'percentage' then
    discount_value := eligible_subtotal_value * coupon_row.discount_value / 100;
    if coupon_row.maximum_discount_amount_inr is not null then discount_value := least(discount_value, coupon_row.maximum_discount_amount_inr); end if;
  else
    discount_value := least(coupon_row.discount_value, eligible_subtotal_value);
  end if;
  discount_value := least(round(discount_value, 2), eligible_subtotal_value);

  return jsonb_build_object(
    'valid', true, 'code', coupon_row.code, 'discount_type', coupon_row.discount_type,
    'subtotal_inr', subtotal_value, 'eligible_subtotal_inr', eligible_subtotal_value,
    'discount_inr', discount_value, 'final_subtotal_inr', subtotal_value - discount_value,
    'message', 'Coupon applied.'
  );
end;
$$;

create or replace function public.create_customer_order_with_coupon(
  p_items jsonb,
  p_shipping_address jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_coupon_code text,
  p_customer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_code text := upper(trim(coalesce(p_coupon_code, '')));
  coupon_row public.coupons%rowtype;
  existing_order_id uuid;
  existing_coupon_code text;
  validation_result jsonb;
  order_id_value uuid;
  coupon_discount numeric(12,2);
  order_subtotal numeric(12,2);
  order_delivery numeric(12,2);
begin
  if auth.uid() is null or not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'customer') then
    raise exception 'An authenticated customer account is required' using errcode = '42501';
  end if;
  if normalized_code = '' then raise exception 'A coupon code is required' using errcode = '22023'; end if;

  select o.id, o.coupon_code into existing_order_id, existing_coupon_code
  from public.orders o where o.customer_id = auth.uid() and o.idempotency_key = trim(p_idempotency_key);
  if existing_order_id is not null then
    if existing_coupon_code = normalized_code then return existing_order_id; end if;
    raise exception 'This idempotency key is already associated with another order or coupon' using errcode = '23505';
  end if;

  select c.* into coupon_row from public.coupons c where c.code = normalized_code for update;
  if not found then raise exception 'Coupon code was not found' using errcode = 'P0002'; end if;
  validation_result := public.validate_customer_coupon(normalized_code, p_items);
  if not coalesce((validation_result ->> 'valid')::boolean, false) then
    raise exception '%', coalesce(validation_result ->> 'message', 'Coupon is not valid') using errcode = '22023';
  end if;
  coupon_discount := (validation_result ->> 'discount_inr')::numeric;

  order_id_value := public.create_customer_order(p_items, p_shipping_address, p_payment_method, p_idempotency_key, p_customer_note);
  select o.subtotal_inr, o.delivery_charge_inr into order_subtotal, order_delivery from public.orders o where o.id = order_id_value for update;
  if coupon_discount > order_subtotal then raise exception 'Coupon discount exceeds order subtotal' using errcode = '23514'; end if;

  update public.orders o set coupon_id = coupon_row.id, coupon_code = coupon_row.code,
    discount_inr = coupon_discount, total_inr = order_subtotal - coupon_discount + order_delivery
  where o.id = order_id_value;
  update public.payment_records p set amount_inr = order_subtotal - coupon_discount + order_delivery where p.order_id = order_id_value;
  insert into public.coupon_redemptions (coupon_id, customer_id, order_id, coupon_code, discount_amount_inr)
  values (coupon_row.id, auth.uid(), order_id_value, coupon_row.code, coupon_discount);
  return order_id_value;
end;
$$;

create or replace function public.release_coupon_redemption_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.order_status = 'cancelled' and old.order_status is distinct from new.order_status then
    update public.coupon_redemptions r set released_at = now(), release_reason = 'Order cancelled'
    where r.order_id = new.id and r.released_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_release_coupon_on_cancel on public.orders;
create trigger orders_release_coupon_on_cancel after update of order_status on public.orders
  for each row execute function public.release_coupon_redemption_on_cancel();

revoke all on function public.admin_save_coupon(uuid, text, text, public.coupon_discount_type, numeric, numeric, numeric, timestamptz, timestamptz, integer, integer, boolean, uuid[], uuid[]) from public, anon;
grant execute on function public.admin_save_coupon(uuid, text, text, public.coupon_discount_type, numeric, numeric, numeric, timestamptz, timestamptz, integer, integer, boolean, uuid[], uuid[]) to authenticated;
revoke all on function public.validate_customer_coupon(text, jsonb) from public, anon;
grant execute on function public.validate_customer_coupon(text, jsonb) to authenticated;
revoke all on function public.create_customer_order_with_coupon(jsonb, jsonb, text, text, text, text) from public, anon;
grant execute on function public.create_customer_order_with_coupon(jsonb, jsonb, text, text, text, text) to authenticated;
