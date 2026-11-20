-- Customer checkout support (additive).
--
-- Replaces public.create_customer_order (same signature, same return type, same grants) so that:
--   1. The delivery charge honours the store's free-shipping threshold. The threshold is compared with the
--      product subtotal BEFORE any coupon discount, exactly like the storefront cart estimate.
--      (Previously the function always charged the flat shipping charge and ignored the threshold.)
--   2. A payment method that the store has switched off (cod_enabled / upi_enabled in store settings)
--      is rejected on the server instead of only being hidden in the storefront.
--
-- public.create_customer_order_with_coupon is intentionally NOT redefined: it calls create_customer_order and
-- then reads the delivery charge from the order row, so it inherits both changes. The coupon discount never
-- affects the delivery charge.
--
-- No tables are altered and no existing rows are modified. Replaying an existing idempotency key still returns
-- the existing order unchanged, even if the payment method has been switched off since.

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
  base_delivery_value numeric(12,2) := 0;
  delivery_value numeric(12,2) := 0;
  free_threshold_value numeric(12,2);
  settings_configuration jsonb;
  method_enabled boolean;
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

  select s.configuration into settings_configuration from public.store_settings s limit 1;
  settings_configuration := coalesce(settings_configuration, '{}'::jsonb);

  -- A missing or malformed flag keeps the previous behaviour: the method is available.
  method_enabled := case
    when p_payment_method = 'cod' then
      case when settings_configuration ->> 'cod_enabled' in ('true', 'false') then (settings_configuration ->> 'cod_enabled')::boolean else true end
    else
      case when settings_configuration ->> 'upi_enabled' in ('true', 'false') then (settings_configuration ->> 'upi_enabled')::boolean else true end
  end;
  if not method_enabled then
    raise exception '% is not available right now', case when p_payment_method = 'cod' then 'Cash on delivery' else 'UPI payment' end
      using errcode = '22023';
  end if;

  -- Flat charge: shipping_charge_inr, falling back to the delivery_charge_inr mirror written by admin_update_store_settings.
  base_delivery_value := case
    when coalesce(settings_configuration ->> 'shipping_charge_inr', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
      then (settings_configuration ->> 'shipping_charge_inr')::numeric
    when coalesce(settings_configuration ->> 'delivery_charge_inr', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
      then (settings_configuration ->> 'delivery_charge_inr')::numeric
    else 0
  end;
  free_threshold_value := case
    when coalesce(settings_configuration ->> 'free_shipping_threshold_inr', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
      then (settings_configuration ->> 'free_shipping_threshold_inr')::numeric
    else null
  end;

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
    0, 0, base_delivery_value, base_delivery_value, nullif(trim(p_customer_note), '')
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

  -- Free shipping is judged on the product subtotal before any coupon discount.
  if free_threshold_value is not null and subtotal_value >= free_threshold_value then
    delivery_value := 0;
  else
    delivery_value := base_delivery_value;
  end if;

  update public.orders o
  set subtotal_inr = subtotal_value,
      delivery_charge_inr = delivery_value,
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

revoke all on function public.create_customer_order(jsonb, jsonb, text, text, text) from public, anon;
grant execute on function public.create_customer_order(jsonb, jsonb, text, text, text) to authenticated;
