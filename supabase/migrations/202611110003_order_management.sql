do $$ begin
  create type public.order_status as enum (
    'pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_payment_status as enum (
    'pending', 'verification_pending', 'paid', 'failed', 'cod_due', 'refunded'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default (
    'VH-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  customer_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  shipping_address jsonb not null,
  order_status public.order_status not null default 'pending',
  payment_method text not null check (payment_method in ('upi', 'cod')),
  payment_status public.order_payment_status not null default 'pending',
  subtotal_inr numeric(12,2) not null,
  discount_inr numeric(12,2) not null default 0,
  delivery_charge_inr numeric(12,2) not null default 0,
  total_inr numeric(12,2) not null,
  customer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_idempotency_not_blank check (length(trim(idempotency_key)) between 1 and 200),
  constraint orders_customer_name_not_blank check (length(trim(customer_name)) > 0),
  constraint orders_customer_email_not_blank check (length(trim(customer_email)) > 0),
  constraint orders_shipping_address_object check (jsonb_typeof(shipping_address) = 'object'),
  constraint orders_amounts_nonnegative check (subtotal_inr >= 0 and discount_inr >= 0 and delivery_charge_inr >= 0 and total_inr >= 0),
  constraint orders_total_consistent check (total_inr = subtotal_inr - discount_inr + delivery_charge_inr),
  constraint orders_note_length check (customer_note is null or length(customer_note) <= 1000),
  constraint orders_customer_idempotency_unique unique (customer_id, idempotency_key)
);

create index if not exists orders_customer_created_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders (order_status, created_at desc);
create index if not exists orders_payment_status_created_idx on public.orders (payment_status, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_sku text not null,
  product_image_url text,
  quantity integer not null,
  returned_quantity integer not null default 0,
  unit_price_inr numeric(12,2) not null,
  list_price_inr numeric(12,2) not null,
  line_subtotal_inr numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint order_items_product_name_not_blank check (length(trim(product_name)) > 0),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_return_range check (returned_quantity between 0 and quantity),
  constraint order_items_prices_nonnegative check (unit_price_inr >= 0 and list_price_inr >= unit_price_inr and line_subtotal_inr >= 0),
  constraint order_items_subtotal_consistent check (line_subtotal_inr = quantity * unit_price_inr),
  constraint order_items_order_product_unique unique (order_id, product_id)
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_method text not null check (payment_method in ('upi', 'cod')),
  payment_status public.order_payment_status not null default 'pending',
  amount_inr numeric(12,2) not null check (amount_inr >= 0),
  transaction_reference text,
  payment_proof_path text,
  provider text,
  provider_event_id text unique,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_records_reference_length check (transaction_reference is null or length(transaction_reference) <= 200),
  constraint payment_records_note_length check (verification_note is null or length(verification_note) <= 1000),
  constraint payment_records_verification_pair check ((verified_by is null) = (verified_at is null))
);

create index if not exists payment_records_order_created_idx on public.payment_records (order_id, created_at desc);
create index if not exists payment_records_status_created_idx on public.payment_records (payment_status, created_at desc);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  previous_status public.order_status,
  new_status public.order_status not null,
  reason text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_status_history_reason_not_blank check (length(trim(reason)) > 0),
  constraint order_status_history_reason_length check (length(reason) <= 1000)
);

create index if not exists order_status_history_order_created_idx on public.order_status_history (order_id, created_at desc);

create table if not exists public.order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  tracking_url text,
  shipment_status text not null default 'pending' check (shipment_status in ('pending', 'shipped', 'out_for_delivery', 'delivered', 'returned')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_shipments_order_unique unique (order_id)
);

create index if not exists order_shipments_tracking_idx on public.order_shipments (tracking_number) where tracking_number is not null;

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_order_updated_at();
drop trigger if exists payment_records_set_updated_at on public.payment_records;
create trigger payment_records_set_updated_at before update on public.payment_records for each row execute function public.set_order_updated_at();
drop trigger if exists order_shipments_set_updated_at on public.order_shipments;
create trigger order_shipments_set_updated_at before update on public.order_shipments for each row execute function public.set_order_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_records enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_shipments enable row level security;

drop policy if exists "orders_read_owner_or_super_admin" on public.orders;
create policy "orders_read_owner_or_super_admin" on public.orders for select to authenticated
  using (customer_id = auth.uid() or public.has_role('super_admin'));
drop policy if exists "order_items_read_owner_or_super_admin" on public.order_items;
create policy "order_items_read_owner_or_super_admin" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.has_role('super_admin'))));
drop policy if exists "payment_records_read_owner_or_super_admin" on public.payment_records;
create policy "payment_records_read_owner_or_super_admin" on public.payment_records for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.has_role('super_admin'))));
drop policy if exists "order_status_history_read_owner_or_super_admin" on public.order_status_history;
create policy "order_status_history_read_owner_or_super_admin" on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.has_role('super_admin'))));
drop policy if exists "order_shipments_read_owner_or_super_admin" on public.order_shipments;
create policy "order_shipments_read_owner_or_super_admin" on public.order_shipments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.has_role('super_admin'))));

revoke all on public.orders, public.order_items, public.payment_records, public.order_status_history, public.order_shipments from anon, authenticated;
grant select on public.orders, public.order_items, public.payment_records, public.order_status_history, public.order_shipments to authenticated;

create or replace function public.create_customer_order(
  p_items jsonb,
  p_shipping_address jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_customer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_profile public.profiles%rowtype;
  order_id_value uuid;
  order_number_value text;
  subtotal_value numeric(12,2) := 0;
  delivery_value numeric(12,2) := 0;
  product_row public.products%rowtype;
  requested record;
  image_url_value text;
  unit_price_value numeric(12,2);
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'customer'
  ) then
    raise exception 'An authenticated customer account is required' using errcode = '42501';
  end if;
  if p_payment_method is null or p_payment_method not in ('upi', 'cod') then
    raise exception 'Unsupported payment method' using errcode = '22023';
  end if;
  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
    raise exception 'A shipping address is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Order must contain between 1 and 50 product entries' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;
  if p_customer_note is not null and length(p_customer_note) > 1000 then
    raise exception 'Customer note must be 1000 characters or fewer' using errcode = '22023';
  end if;

  select o.id into order_id_value
  from public.orders o
  where o.customer_id = auth.uid() and o.idempotency_key = trim(p_idempotency_key);
  if order_id_value is not null then
    return order_id_value;
  end if;

  select p.* into customer_profile from public.profiles p where p.id = auth.uid();
  if not found or length(trim(customer_profile.email)) = 0 then
    raise exception 'Customer profile is incomplete' using errcode = '23514';
  end if;

  select coalesce(nullif(s.configuration ->> 'delivery_charge_inr', '')::numeric, 0)
    into delivery_value
  from public.store_settings s
  limit 1;
  delivery_value := coalesce(delivery_value, 0);
  if delivery_value < 0 then
    raise exception 'Store delivery charge configuration is invalid' using errcode = '23514';
  end if;

  order_number_value := 'VH-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.orders (
    order_number, customer_id, idempotency_key, customer_name, customer_email, customer_phone,
    shipping_address, payment_method, payment_status, subtotal_inr, discount_inr,
    delivery_charge_inr, total_inr, customer_note
  ) values (
    order_number_value, auth.uid(), trim(p_idempotency_key),
    coalesce(nullif(trim(customer_profile.full_name), ''), customer_profile.email), customer_profile.email,
    customer_profile.mobile_number, p_shipping_address, p_payment_method,
    case when p_payment_method = 'cod' then 'cod_due'::public.order_payment_status else 'pending'::public.order_payment_status end,
    0, 0, delivery_value, delivery_value, nullif(trim(p_customer_note), '')
  ) returning id into order_id_value;

  for requested in
    select (entry.value ->> 'product_id')::uuid as product_id, sum((entry.value ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry(value)
    group by (entry.value ->> 'product_id')::uuid
  loop
    if requested.quantity is null or requested.quantity <= 0 then
      raise exception 'Product quantities must be positive whole numbers' using errcode = '22023';
    end if;
    select p.* into product_row
    from public.products p
    where p.id = requested.product_id and p.is_published
    for share;
    if not found then
      raise exception 'A requested product is unavailable' using errcode = 'P0002';
    end if;
    if requested.quantity > product_row.stock_quantity then
      raise exception 'Insufficient stock for product %', product_row.sku using errcode = '23514';
    end if;

    unit_price_value := coalesce(product_row.discount_price_inr, product_row.price_inr);
    select pi.image_url into image_url_value
    from public.product_images pi
    where pi.product_id = product_row.id
    order by pi.is_primary desc, pi.display_order
    limit 1;

    insert into public.order_items (
      order_id, product_id, product_name, product_sku, product_image_url,
      quantity, unit_price_inr, list_price_inr, line_subtotal_inr
    ) values (
      order_id_value, product_row.id, product_row.name, product_row.sku, image_url_value,
      requested.quantity, unit_price_value, product_row.price_inr, requested.quantity * unit_price_value
    );
    subtotal_value := subtotal_value + requested.quantity * unit_price_value;
  end loop;

  update public.orders o
  set subtotal_inr = subtotal_value,
      total_inr = subtotal_value + delivery_value
  where o.id = order_id_value;

  insert into public.payment_records (order_id, payment_method, payment_status, amount_inr)
  values (
    order_id_value, p_payment_method,
    case when p_payment_method = 'cod' then 'cod_due'::public.order_payment_status else 'pending'::public.order_payment_status end,
    subtotal_value + delivery_value
  );

  insert into public.order_status_history (order_id, previous_status, new_status, reason, changed_by)
  values (order_id_value, null, 'pending', 'Order placed', auth.uid());

  return order_id_value;
end;
$$;

create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  previous_status_value public.order_status;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may update order status' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 1000 then
    raise exception 'A status-change reason of 1 to 1000 characters is required' using errcode = '22023';
  end if;

  select o.* into order_row from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if order_row.order_status = p_new_status then
    raise exception 'Order is already in that status' using errcode = '22023';
  end if;
  previous_status_value := order_row.order_status;

  if not (
    (order_row.order_status = 'pending' and p_new_status in ('confirmed', 'cancelled')) or
    (order_row.order_status = 'confirmed' and p_new_status in ('processing', 'cancelled')) or
    (order_row.order_status = 'processing' and p_new_status in ('shipped', 'cancelled')) or
    (order_row.order_status = 'shipped' and p_new_status in ('out_for_delivery', 'returned')) or
    (order_row.order_status = 'out_for_delivery' and p_new_status in ('delivered', 'returned')) or
    (order_row.order_status = 'delivered' and p_new_status = 'returned')
  ) then
    raise exception 'Invalid order status transition: % to %', order_row.order_status, p_new_status using errcode = '22023';
  end if;

  if p_new_status = 'confirmed' then
    for item_row in
      select oi.* from public.order_items oi where oi.order_id = p_order_id order by oi.product_id for update
    loop
      if item_row.product_id is null then
        raise exception 'An order product is no longer available for stock deduction' using errcode = '23514';
      end if;
      perform public.adjust_inventory_stock(
        item_row.product_id, 'sold', 'Stock deducted when order was confirmed', item_row.quantity,
        null, p_order_id::text
      );
    end loop;
  elsif p_new_status = 'cancelled' and order_row.order_status in ('confirmed', 'processing') then
    for item_row in
      select oi.* from public.order_items oi where oi.order_id = p_order_id order by oi.product_id for update
    loop
      if item_row.product_id is not null then
        perform public.adjust_inventory_stock(
          item_row.product_id, 'order_cancelled', 'Stock restored when order was cancelled', item_row.quantity,
          null, p_order_id::text
        );
      end if;
    end loop;
  end if;

  update public.orders o set order_status = p_new_status where o.id = p_order_id returning o.* into order_row;
  insert into public.order_status_history (order_id, previous_status, new_status, reason, changed_by)
  values (p_order_id, previous_status_value, p_new_status, trim(p_reason), auth.uid());

  if p_new_status = 'shipped' then
    insert into public.order_shipments (order_id, shipment_status, shipped_at)
    values (p_order_id, 'shipped', now())
    on conflict (order_id) do update set shipment_status = 'shipped', shipped_at = coalesce(public.order_shipments.shipped_at, now());
  elsif p_new_status in ('out_for_delivery', 'delivered', 'returned') then
    insert into public.order_shipments (order_id, shipment_status, delivered_at)
    values (p_order_id, p_new_status::text, case when p_new_status = 'delivered' then now() else null end)
    on conflict (order_id) do update set
      shipment_status = excluded.shipment_status,
      delivered_at = case when excluded.shipment_status = 'delivered' then coalesce(public.order_shipments.delivered_at, now()) else public.order_shipments.delivered_at end;
  end if;

  return order_row;
end;
$$;

create or replace function public.admin_verify_order_payment(
  p_payment_id uuid,
  p_transaction_reference text,
  p_verification_note text default null
)
returns public.payment_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_row public.payment_records%rowtype;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may verify payment' using errcode = '42501';
  end if;
  if p_transaction_reference is null or length(trim(p_transaction_reference)) = 0 or length(p_transaction_reference) > 200 then
    raise exception 'A valid transaction reference is required' using errcode = '22023';
  end if;
  if p_verification_note is not null and length(p_verification_note) > 1000 then
    raise exception 'Verification note must be 1000 characters or fewer' using errcode = '22023';
  end if;

  select pr.* into payment_row from public.payment_records pr where pr.id = p_payment_id for update;
  if not found then
    raise exception 'Payment record not found' using errcode = 'P0002';
  end if;
  if payment_row.payment_method <> 'upi' or payment_row.payment_status not in ('pending', 'verification_pending') then
    raise exception 'This payment is not awaiting manual UPI verification' using errcode = '22023';
  end if;

  update public.payment_records pr
  set payment_status = 'paid', transaction_reference = trim(p_transaction_reference),
      verified_by = auth.uid(), verified_at = now(), verification_note = nullif(trim(p_verification_note), '')
  where pr.id = p_payment_id
  returning pr.* into payment_row;

  update public.orders o set payment_status = 'paid' where o.id = payment_row.order_id;
  return payment_row;
end;
$$;

create or replace function public.admin_receive_order_return(
  p_order_item_id uuid,
  p_quantity integer,
  p_reason text,
  p_request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.order_items%rowtype;
  order_status_value public.order_status;
  reference_value text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may receive returned stock' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Return quantity must be a positive whole number' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'A return reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'A return request id is required for idempotency' using errcode = '22023';
  end if;

  select oi.* into item_row from public.order_items oi where oi.id = p_order_item_id for update;
  if not found or item_row.product_id is null then
    raise exception 'Order item or product not found' using errcode = 'P0002';
  end if;
  select o.order_status into order_status_value from public.orders o where o.id = item_row.order_id for update;
  if order_status_value <> 'returned' then
    raise exception 'Mark the order returned before receiving inventory' using errcode = '22023';
  end if;
  if item_row.returned_quantity + p_quantity > item_row.quantity then
    raise exception 'Return quantity exceeds the unreturned order quantity' using errcode = '23514';
  end if;

  reference_value := 'return:' || item_row.id::text || ':' || p_request_id::text;
  perform public.adjust_inventory_stock(
    item_row.product_id, 'returned', trim(p_reason), p_quantity, null, reference_value
  );
  update public.order_items oi set returned_quantity = returned_quantity + p_quantity where oi.id = item_row.id;
  return item_row.returned_quantity + p_quantity;
end;
$$;

create unique index if not exists inventory_movements_order_return_reference_unique
  on public.inventory_movements (product_id, reference)
  where movement_action = 'returned' and reference like 'return:%';

create or replace function public.get_order_dashboard_summary()
returns table (
  total_orders bigint,
  pending_orders bigint,
  confirmed_orders bigint,
  processing_orders bigint,
  shipped_orders bigint,
  delivered_orders bigint,
  cancelled_orders bigint,
  returned_orders bigint,
  total_revenue_inr numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may read order analytics' using errcode = '42501';
  end if;
  return query
  select
    count(*),
    count(*) filter (where o.order_status = 'pending'),
    count(*) filter (where o.order_status = 'confirmed'),
    count(*) filter (where o.order_status = 'processing'),
    count(*) filter (where o.order_status in ('shipped', 'out_for_delivery')),
    count(*) filter (where o.order_status = 'delivered'),
    count(*) filter (where o.order_status = 'cancelled'),
    count(*) filter (where o.order_status = 'returned'),
    coalesce(sum(o.total_inr) filter (where o.payment_status = 'paid' and o.order_status not in ('cancelled', 'returned')), 0)::numeric
  from public.orders o;
end;
$$;

revoke all on function public.create_customer_order(jsonb, jsonb, text, text, text) from public, anon;
grant execute on function public.create_customer_order(jsonb, jsonb, text, text, text) to authenticated;
revoke all on function public.admin_update_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.admin_update_order_status(uuid, public.order_status, text) to authenticated;
revoke all on function public.admin_verify_order_payment(uuid, text, text) from public, anon;
grant execute on function public.admin_verify_order_payment(uuid, text, text) to authenticated;
revoke all on function public.admin_receive_order_return(uuid, integer, text, uuid) from public, anon;
grant execute on function public.admin_receive_order_return(uuid, integer, text, uuid) to authenticated;
revoke all on function public.get_order_dashboard_summary() from public, anon;
grant execute on function public.get_order_dashboard_summary() to authenticated;
