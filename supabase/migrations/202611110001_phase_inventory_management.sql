alter table public.products
  add column if not exists low_stock_threshold integer not null default 5;

do $$ begin
  alter table public.products
    add constraint products_low_stock_threshold_nonnegative check (low_stock_threshold >= 0);
exception when duplicate_object then null;
end $$;

alter table public.inventory_movements
  add column if not exists movement_action text not null default 'adjustment',
  add column if not exists previous_quantity integer,
  add column if not exists new_quantity integer,
  add column if not exists reference text;

do $$ begin
  alter table public.inventory_movements
    add constraint inventory_movements_action_valid check (
      movement_action in ('received', 'sold', 'adjustment', 'returned', 'damaged', 'order_cancelled')
    );
exception when duplicate_object then null;
end $$;

create index if not exists inventory_movements_action_created_idx
  on public.inventory_movements (movement_action, created_at desc);

create unique index if not exists inventory_movements_order_action_unique
  on public.inventory_movements (product_id, reference, movement_action)
  where reference is not null and movement_action in ('sold', 'order_cancelled');

create or replace function public.record_inventory_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stock_delta integer;
  action_value text;
  reason_value text;
  reference_value text;
  movement_type_value public.inventory_movement_type;
begin
  if tg_op = 'INSERT' then
    if new.stock_quantity > 0 then
      insert into public.inventory_movements (
        product_id, movement_type, movement_action, quantity, previous_quantity,
        new_quantity, reason, created_by
      ) values (
        new.id, 'in', 'received', new.stock_quantity, 0,
        new.stock_quantity, 'Initial stock', auth.uid()
      );
    end if;
    return new;
  end if;

  if new.stock_quantity = old.stock_quantity then
    return new;
  end if;

  stock_delta := new.stock_quantity - old.stock_quantity;
  action_value := nullif(current_setting('vintage.inventory_action', true), '');
  if action_value is null or action_value not in ('received', 'sold', 'adjustment', 'returned', 'damaged', 'order_cancelled') then
    action_value := 'adjustment';
  end if;
  reason_value := coalesce(nullif(current_setting('vintage.inventory_reason', true), ''), 'Product stock updated');
  reference_value := nullif(current_setting('vintage.inventory_reference', true), '');

  movement_type_value := case
    when stock_delta > 0 then 'in'::public.inventory_movement_type
    when stock_delta < 0 then 'out'::public.inventory_movement_type
    else 'adjustment'::public.inventory_movement_type
  end;

  insert into public.inventory_movements (
    product_id, movement_type, movement_action, quantity, previous_quantity,
    new_quantity, reason, reference, created_by
  ) values (
    new.id, movement_type_value, action_value, abs(stock_delta), old.stock_quantity,
    new.stock_quantity, reason_value, reference_value, auth.uid()
  );
  return new;
end;
$$;

create or replace function public.adjust_inventory_stock(
  p_product_id uuid,
  p_action text,
  p_reason text,
  p_quantity integer default null,
  p_new_quantity integer default null,
  p_reference text default null
)
returns table (previous_quantity integer, new_quantity integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stock_before integer;
  stock_after integer;
  is_service_role boolean := coalesce(auth.role() = 'service_role', false);
begin
  if not is_service_role and not public.has_role('super_admin') then
    raise exception 'Only an authorized inventory operator may adjust stock' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('received', 'sold', 'adjustment', 'returned', 'damaged', 'order_cancelled') then
    raise exception 'Invalid inventory action' using errcode = '22023';
  end if;
  if is_service_role and p_action not in ('sold', 'order_cancelled') then
    raise exception 'Service-role inventory calls are limited to order stock operations' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'A reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  if p_reference is not null and length(p_reference) > 200 then
    raise exception 'Reference must be 200 characters or fewer' using errcode = '22023';
  end if;
  if p_action in ('sold', 'order_cancelled') and nullif(trim(p_reference), '') is null then
    raise exception 'Order stock operations require an order reference' using errcode = '22023';
  end if;

  select p.stock_quantity into stock_before
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  if p_action = 'adjustment' then
    if p_new_quantity is null or p_new_quantity < 0 then
      raise exception 'Adjustment requires a non-negative target quantity' using errcode = '22023';
    end if;
    stock_after := p_new_quantity;
  else
    if p_quantity is null or p_quantity <= 0 then
      raise exception 'Stock movement quantity must be a positive whole number' using errcode = '22023';
    end if;
    stock_after := case
      when p_action in ('received', 'returned', 'order_cancelled') then stock_before + p_quantity
      else stock_before - p_quantity
    end;
  end if;

  if stock_after < 0 then
    raise exception 'Insufficient stock: available %, requested %', stock_before, p_quantity using errcode = '23514';
  end if;
  if stock_after = stock_before then
    raise exception 'Stock quantity is unchanged' using errcode = '22023';
  end if;

  perform set_config('vintage.inventory_action', p_action, true);
  perform set_config('vintage.inventory_reason', trim(p_reason), true);
  perform set_config('vintage.inventory_reference', coalesce(nullif(trim(p_reference), ''), ''), true);

  update public.products p
  set stock_quantity = stock_after
  where p.id = p_product_id;

  perform set_config('vintage.inventory_action', '', true);
  perform set_config('vintage.inventory_reason', '', true);
  perform set_config('vintage.inventory_reference', '', true);

  return query select stock_before, stock_after;
end;
$$;

create or replace function public.get_inventory_snapshot()
returns table (
  products_in_stock bigint,
  stock_units bigint,
  low_stock_products bigint,
  out_of_stock_products bigint,
  inventory_value numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_role('super_admin') then
    raise exception 'Only an authorized inventory operator may read inventory totals' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where p.stock_quantity > 0),
    coalesce(sum(p.stock_quantity), 0)::bigint,
    count(*) filter (where p.stock_quantity > 0 and p.stock_quantity <= p.low_stock_threshold),
    count(*) filter (where p.stock_quantity = 0),
    coalesce(sum(p.stock_quantity * p.price_inr), 0)::numeric
  from public.products p;
end;
$$;

revoke update on public.products from authenticated;
grant update (
  name, slug, sku, description, category_id, price_inr, discount_price_inr,
  material, colour, low_stock_threshold, is_customizable, is_published, is_featured
) on public.products to authenticated;

revoke all on function public.adjust_inventory_stock(uuid, text, text, integer, integer, text) from public;
grant execute on function public.adjust_inventory_stock(uuid, text, text, integer, integer, text) to authenticated, service_role;
revoke all on function public.get_inventory_snapshot() from public;
grant execute on function public.get_inventory_snapshot() to authenticated, service_role;
