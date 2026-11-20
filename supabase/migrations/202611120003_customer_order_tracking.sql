-- Module 4: customer order tracking and admin shipment management
--
-- ADDITIVE. Review before applying; it has NOT been applied or executed against any database.
-- Apply only after 202611110003_order_management.sql (it uses public.order_shipments, public.order_status_history
-- and public.has_role).
--
-- What this migration does
--   1. admin_update_order_shipment(order_id, carrier, tracking_number, tracking_url)
--      The first and only write path for carrier / tracking details. Before this, order_shipments could only be
--      created by admin_update_order_status with no carrier, number or link. Super admin only. It never changes
--      the order status (admin_update_order_status stays the only status path) and never touches stock/payment.
--   2. get_customer_order_tracking(order_id)
--      A customer-safe read of ONE order the caller owns: status, shipment details and a status timeline made of
--      (status, time) pairs only.
--   3. order_status_history is now readable by super admins only.
--      Reason: the reason column is free text written by the admin team ("customer unreachable", "suspected
--      fraud", ...). The original policy let the owning customer SELECT those rows directly through the API.
--      Customers now get the timeline from get_customer_order_tracking, which omits the reason and the admin id.
--      Admin behaviour is unchanged. If you prefer not to change this policy, delete section 3; nothing else in this
--      file depends on it.
--
-- Not changed
--   * No table, column, enum value or index is added or altered.
--   * admin_update_order_status, admin_verify_order_payment, customer_submit_payment_proof and every storage policy
--     are untouched.
--   * payment_records.verification_note / verified_by remain readable by the owning customer through the existing
--     payment_records policy (see docs/SECURITY.md, "Known exposure"). Customer screens never request them.
-- ---------------------------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Admin shipment details
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_update_order_shipment(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text,
  p_tracking_url text
)
returns public.order_shipments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  shipment_row public.order_shipments%rowtype;
  carrier_value text;
  number_value text;
  url_value text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may update shipment details' using errcode = '42501';
  end if;
  if p_order_id is null then
    raise exception 'An order is required' using errcode = '22023';
  end if;

  carrier_value := nullif(trim(coalesce(p_carrier, '')), '');
  number_value := nullif(trim(coalesce(p_tracking_number, '')), '');
  url_value := nullif(trim(coalesce(p_tracking_url, '')), '');

  if carrier_value is not null and (length(carrier_value) > 80 or carrier_value ~ '[[:cntrl:]]') then
    raise exception 'Carrier must be 80 characters or fewer without control characters' using errcode = '22023';
  end if;
  if number_value is not null and (length(number_value) > 100 or number_value !~ '^[A-Za-z0-9][A-Za-z0-9 ._/#-]*$') then
    raise exception 'Tracking number must be 100 characters or fewer using letters, numbers or - _ . / #' using errcode = '22023';
  end if;
  -- https only: the link is shown to customers and opened in a new tab, so javascript:, data: and http: are refused.
  if url_value is not null and (length(url_value) > 2000 or url_value !~ '^https://[^[:space:]<>"''\\]+$') then
    raise exception 'Tracking link must be a secure https:// URL' using errcode = '22023';
  end if;

  select o.* into order_row from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if order_row.order_status not in ('processing', 'shipped', 'out_for_delivery', 'delivered') then
    raise exception 'Shipment details can be saved once an order is processing (current status: %)', order_row.order_status using errcode = '22023';
  end if;

  -- Only the three descriptive columns are written. shipment_status, shipped_at and delivered_at stay owned by
  -- admin_update_order_status, so a status can never be changed or back-dated from here.
  insert into public.order_shipments (order_id, carrier, tracking_number, tracking_url, shipment_status)
  values (
    p_order_id, carrier_value, number_value, url_value,
    case order_row.order_status when 'processing' then 'pending' else order_row.order_status::text end
  )
  on conflict (order_id) do update
    set carrier = excluded.carrier,
        tracking_number = excluded.tracking_number,
        tracking_url = excluded.tracking_url
  returning * into shipment_row;

  return shipment_row;
end;
$$;

revoke all on function public.admin_update_order_shipment(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_order_shipment(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Customer-safe tracking read
-- ---------------------------------------------------------------------------------------------------------------
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
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

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

  -- Status and time only. The admin-written reason and the admin's user id are deliberately not returned.
  select coalesce(jsonb_agg(jsonb_build_object('status', h.new_status, 'at', h.created_at) order by h.created_at, h.id), '[]'::jsonb)
    into timeline_json
  from public.order_status_history h
  where h.order_id = order_row.id;

  return jsonb_build_object(
    'order_id', order_row.id,
    'order_number', order_row.order_number,
    'order_status', order_row.order_status,
    'payment_method', order_row.payment_method,
    'payment_status', order_row.payment_status,
    'created_at', order_row.created_at,
    'updated_at', order_row.updated_at,
    'shipment', shipment_json,
    'timeline', timeline_json
  );
end;
$$;

revoke all on function public.get_customer_order_tracking(uuid) from public, anon;
grant execute on function public.get_customer_order_tracking(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Keep internal status reasons away from customers
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists "order_status_history_read_owner_or_super_admin" on public.order_status_history;
drop policy if exists "order_status_history_read_super_admin" on public.order_status_history;
create policy "order_status_history_read_super_admin" on public.order_status_history for select to authenticated
  using (public.has_role('super_admin'));
