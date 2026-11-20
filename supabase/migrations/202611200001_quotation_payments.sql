-- CASALOOM Phase 4: create a normal UPI order/payment record from an accepted quotation.
-- Additive only. Existing checkout and payment RPCs remain unchanged.
-- Apply to staging and verify before production.

alter table public.orders
  add column if not exists quotation_id uuid references public.custom_request_quotations(id) on delete restrict;

create unique index if not exists orders_one_per_quotation
  on public.orders (quotation_id) where quotation_id is not null;

create or replace function public.customer_create_quotation_payment_order(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  quote_row public.custom_request_quotations%rowtype;
  request_row public.custom_requests%rowtype;
  profile_row public.profiles%rowtype;
  existing_order_id uuid;
  new_order_id uuid;
  new_order_number text;
  address_value jsonb;
  item_row record;
  position_value integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue to payment' using errcode = '42501';
  end if;

  -- Lock the request first, matching the quotation acceptance lock order, then lock the accepted quote.
  select r.* into request_row
  from public.custom_requests r
  join public.custom_request_quotations q on q.request_id = r.id
  where q.id = p_quotation_id and r.customer_id = auth.uid()
  for update of r;
  if not found then raise exception 'Accepted quotation not found' using errcode = 'P0002'; end if;

  select q.* into quote_row
  from public.custom_request_quotations q
  where q.id = p_quotation_id and q.request_id = request_row.id
  for update;

  if quote_row.status <> 'accepted' or quote_row.accepted_at is null or quote_row.payment_eligible_at is null then
    raise exception 'Only an accepted quotation can be paid' using errcode = '22023';
  end if;
  if quote_row.currency <> 'INR' or quote_row.final_total_inr <= 0 then
    raise exception 'This quotation cannot be paid online. Please contact our team.' using errcode = '22023';
  end if;

  select o.id into existing_order_id from public.orders o where o.quotation_id = quote_row.id;
  if existing_order_id is not null then return existing_order_id; end if;

  select p.* into profile_row from public.profiles p where p.id = auth.uid();
  if not found or nullif(trim(profile_row.full_name), '') is null
     or nullif(trim(profile_row.mobile_number), '') is null
     or nullif(trim(profile_row.address_line1), '') is null
     or nullif(trim(profile_row.city), '') is null
     or nullif(trim(profile_row.state), '') is null
     or nullif(trim(profile_row.postal_code), '') is null then
    raise exception 'Complete your name, mobile number and delivery address in your profile before payment.' using errcode = '22023';
  end if;

  address_value := jsonb_strip_nulls(jsonb_build_object(
    'full_name', profile_row.full_name,
    'phone', profile_row.mobile_number,
    'address_line1', profile_row.address_line1,
    'address_line2', nullif(profile_row.address_line2, ''),
    'city', profile_row.city,
    'state', profile_row.state,
    'postal_code', profile_row.postal_code,
    'country', coalesce(nullif(profile_row.country, ''), 'India')
  ));

  insert into public.orders (
    customer_id, idempotency_key, customer_name, customer_email, customer_phone,
    shipping_address, order_status, payment_method, payment_status,
    subtotal_inr, discount_inr, delivery_charge_inr, total_inr, customer_note, quotation_id
  ) values (
    auth.uid(), 'quotation:' || quote_row.id::text, profile_row.full_name,
    coalesce(nullif(profile_row.email, ''), (select u.email from auth.users u where u.id = auth.uid()), ''),
    profile_row.mobile_number, address_value, 'pending', 'upi', 'pending',
    quote_row.subtotal_inr, quote_row.discount_inr, quote_row.shipping_charge_inr,
    quote_row.final_total_inr,
    'Personalised quotation ' || quote_row.quote_number || ' for request ' || request_row.request_number,
    quote_row.id
  ) returning id, order_number into new_order_id, new_order_number;

  for item_row in
    select qi.* from public.custom_request_quotation_items qi
    where qi.quotation_id = quote_row.id order by qi.position
  loop
    position_value := position_value + 1;
    insert into public.order_items (
      order_id, product_id, product_name, product_sku, product_image_url,
      quantity, returned_quantity, unit_price_inr, list_price_inr, line_subtotal_inr
    ) values (
      new_order_id, null,
      item_row.description,
      left('CUSTOM-' || quote_row.quote_number || '-' || position_value::text, 100),
      null, item_row.quantity, 0, item_row.unit_price_inr, item_row.unit_price_inr, item_row.line_total_inr
    );
  end loop;

  if position_value = 0 then
    raise exception 'This quotation has no payable line items' using errcode = '22023';
  end if;

  insert into public.payment_records (order_id, payment_method, payment_status, amount_inr)
  values (new_order_id, 'upi', 'pending', quote_row.final_total_inr);

  insert into public.order_status_history (order_id, previous_status, new_status, reason, changed_by)
  values (new_order_id, null, 'pending', 'Created from accepted quotation ' || quote_row.quote_number, auth.uid());

  return new_order_id;
end;
$$;

revoke all on function public.customer_create_quotation_payment_order(uuid) from public, anon;
grant execute on function public.customer_create_quotation_payment_order(uuid) to authenticated;
