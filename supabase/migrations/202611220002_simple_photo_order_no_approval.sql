-- CasaLoom simple photo-order workflow.
-- Customers select a product, upload one image, choose UPI/COD and place the order.
-- Admins only update order status and expected delivery. No accept/reject stage is used.
-- Additive: existing orders, payments, products, customers and historical quotation records are preserved.

begin;

alter table public.orders
  add column if not exists customization_photo_path text,
  add column if not exists expected_delivery_date date;

-- Create a standard order using the existing server-side price, stock, shipping and payment checks,
-- then attach the private customer photo to that order.
create or replace function public.create_customer_photo_order(
  p_product_id uuid,
  p_quantity integer,
  p_shipping_address jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_customization_photo_path text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_id_value uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'customer'
  ) then
    raise exception 'Sign in with a customer account to place an order' using errcode = '42501';
  end if;
  if p_customization_photo_path is null
     or p_customization_photo_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._/-]+$')
     or p_customization_photo_path like '%..%' then
    raise exception 'Upload one valid photo before placing the order' using errcode = '22023';
  end if;

  order_id_value := public.create_customer_order(
    jsonb_build_array(jsonb_build_object('product_id', p_product_id, 'quantity', p_quantity)),
    p_shipping_address,
    p_payment_method,
    p_idempotency_key,
    null
  );

  update public.orders
  set customization_photo_path = p_customization_photo_path
  where id = order_id_value and customer_id = auth.uid();

  if not found then
    raise exception 'The order could not be linked to your photo' using errcode = 'P0002';
  end if;
  return order_id_value;
end;
$$;
revoke all on function public.create_customer_photo_order(uuid, integer, jsonb, text, text, text) from public, anon;
grant execute on function public.create_customer_photo_order(uuid, integer, jsonb, text, text, text) to authenticated;

-- Admin-managed expected delivery date. A date can be changed or cleared without an approval workflow.
create or replace function public.admin_set_order_expected_delivery_date(
  p_order_id uuid,
  p_expected_delivery_date date
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result_row public.orders%rowtype;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin can update expected delivery' using errcode = '42501';
  end if;
  if p_expected_delivery_date is not null and p_expected_delivery_date < current_date then
    raise exception 'Expected delivery date cannot be in the past' using errcode = '22023';
  end if;
  update public.orders
  set expected_delivery_date = p_expected_delivery_date
  where id = p_order_id
    and order_status not in ('cancelled', 'returned')
  returning * into result_row;
  if not found then raise exception 'Order not found or no longer active' using errcode = 'P0002'; end if;
  return result_row;
end;
$$;
revoke all on function public.admin_set_order_expected_delivery_date(uuid, date) from public, anon;
grant execute on function public.admin_set_order_expected_delivery_date(uuid, date) to authenticated;

-- Notifications describe a placed order or a real status/date change, not an approval request.
create or replace function public.notify_simple_order_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare admin_user record;
begin
  if tg_op = 'INSERT' then
    for admin_user in
      select distinct user_id from public.user_roles where role = 'super_admin'
    loop
      insert into public.order_notifications(recipient_id, order_id, title, message, notification_type)
      values (admin_user.user_id, new.id, 'New order placed',
        'Order ' || new.order_number || ' has been placed and is ready to process.', 'new_order');
    end loop;
    return new;
  end if;

  if new.order_status is distinct from old.order_status then
    insert into public.order_notifications(recipient_id, order_id, title, message, notification_type)
    values (
      new.customer_id, new.id,
      case when new.order_status = 'delivered' then 'Order delivered' else 'Order status updated' end,
      'Your order ' || new.order_number || ' is now ' || replace(new.order_status::text, '_', ' ') || '.',
      case when new.order_status = 'delivered' then 'delivered' else 'order_status' end
    );
  end if;

  if new.expected_delivery_date is distinct from old.expected_delivery_date
     and new.expected_delivery_date is not null then
    insert into public.order_notifications(recipient_id, order_id, title, message, notification_type)
    values (new.customer_id, new.id, 'Expected delivery updated',
      'Your order ' || new.order_number || ' is expected on ' ||
      to_char(new.expected_delivery_date, 'DD Mon YYYY') || '.', 'order_status');
  end if;
  return new;
end;
$$;


-- Tracking exposes the expected delivery date to the order owner without exposing admin-only fields.
create or replace function public.get_customer_order_tracking(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  shipment_row public.order_shipments%rowtype;
  shipment_json jsonb := null;
  timeline_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to track an order' using errcode = '42501';
  end if;
  select o.* into order_row from public.orders o where o.id = p_order_id and o.customer_id = auth.uid();
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;

  select s.* into shipment_row from public.order_shipments s where s.order_id = order_row.id;
  if found then
    shipment_json := jsonb_build_object(
      'carrier', shipment_row.carrier,
      'tracking_number', shipment_row.tracking_number,
      'tracking_url', case when shipment_row.tracking_url ~ '^https://[^[:space:]]+$' then shipment_row.tracking_url else null end,
      'shipment_status', shipment_row.shipment_status,
      'shipped_at', shipment_row.shipped_at,
      'delivered_at', shipment_row.delivered_at
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('status', h.new_status, 'at', h.created_at) order by h.created_at, h.id), '[]'::jsonb)
    into timeline_json
  from public.order_status_history h where h.order_id = order_row.id;

  return jsonb_build_object(
    'order_id', order_row.id,
    'order_number', order_row.order_number,
    'order_status', order_row.order_status,
    'payment_method', order_row.payment_method,
    'payment_status', order_row.payment_status,
    'created_at', order_row.created_at,
    'updated_at', order_row.updated_at,
    'expected_delivery_date', order_row.expected_delivery_date,
    'shipment', shipment_json,
    'timeline', timeline_json
  );
end;
$$;
revoke all on function public.get_customer_order_tracking(uuid) from public, anon;
grant execute on function public.get_customer_order_tracking(uuid) to authenticated;

-- Retire the approval/payment-after-approval RPCs from the previous draft.
-- Historical rows remain untouched.
revoke all on function public.create_customer_order_request(uuid, integer, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_review_customer_order(uuid, boolean, date, text) from public, anon, authenticated;
revoke all on function public.customer_select_order_payment(uuid, text) from public, anon, authenticated;
revoke all on function public.customer_submit_order_feedback(uuid, integer, text) from public, anon, authenticated;

drop function if exists public.create_customer_order_request(uuid, integer, jsonb, text, text, text);
drop function if exists public.admin_review_customer_order(uuid, boolean, date, text);
drop function if exists public.customer_select_order_payment(uuid, text);
drop function if exists public.customer_submit_order_feedback(uuid, integer, text);

-- Retire the old custom-request / quotation workflow RPCs as well. Their tables and records are kept for history.
revoke all on function public.create_customer_custom_request(uuid, text, text, text, jsonb, jsonb, numeric, numeric, text[]) from public, anon, authenticated;
revoke all on function public.admin_update_custom_request(uuid, public.custom_request_status, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_save_photo_preparation(uuid, text, text, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_update_photo_preparation(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.expire_due_quotations(uuid) from public, anon, authenticated;
revoke all on function public.admin_save_quotation_draft(uuid, jsonb, numeric, numeric, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.admin_send_quotation(uuid) from public, anon, authenticated;
revoke all on function public.admin_discard_quotation_draft(uuid) from public, anon, authenticated;
revoke all on function public.get_my_quotations(uuid) from public, anon, authenticated;
revoke all on function public.get_my_quotation_overview(uuid[]) from public, anon, authenticated;
revoke all on function public.customer_respond_to_quotation(uuid, text, text) from public, anon, authenticated;
revoke all on function public.customer_create_quotation_payment_order(uuid) from public, anon, authenticated;

drop function if exists public.create_customer_custom_request(uuid, text, text, text, jsonb, jsonb, numeric, numeric, text[]);
drop function if exists public.admin_update_custom_request(uuid, public.custom_request_status, text, text, text);
drop function if exists public.admin_save_photo_preparation(uuid, text, text, jsonb, text, boolean);
drop function if exists public.admin_update_photo_preparation(uuid, text, boolean);
drop function if exists public.expire_due_quotations(uuid);
drop function if exists public.admin_save_quotation_draft(uuid, jsonb, numeric, numeric, text, text, integer, uuid);
drop function if exists public.admin_send_quotation(uuid);
drop function if exists public.admin_discard_quotation_draft(uuid);
drop function if exists public.get_my_quotations(uuid);
drop function if exists public.get_my_quotation_overview(uuid[]);
drop function if exists public.customer_respond_to_quotation(uuid, text, text);
drop function if exists public.customer_create_quotation_payment_order(uuid);

commit;
