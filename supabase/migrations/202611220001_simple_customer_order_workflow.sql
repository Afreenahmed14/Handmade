-- CasaLoom Simple Order Workflow v1
-- Additive migration. Does not delete existing tables, functions, orders, or legacy modules.
-- Apply after the existing CasaLoom order-management and payment migrations.

begin;

-- Payment choice is intentionally made only after the admin accepts the order.
alter table public.orders alter column payment_method drop not null;

alter table public.orders
  add column if not exists customization_photo_path text,
  add column if not exists customization_note text,
  add column if not exists expected_delivery_date date,
  add column if not exists admin_decision_note text;

alter table public.orders
  drop constraint if exists orders_customization_note_length,
  add constraint orders_customization_note_length
    check (customization_note is null or length(customization_note) <= 1000),
  add constraint orders_admin_decision_note_length
    check (admin_decision_note is null or length(admin_decision_note) <= 1000);

-- In-app notifications for customers and admins.
create table if not exists public.order_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  title text not null,
  message text not null,
  notification_type text not null check (notification_type in
    ('new_order', 'order_accepted', 'order_declined', 'payment_available', 'order_status', 'delivered')),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists order_notifications_recipient_created_idx
  on public.order_notifications(recipient_id, created_at desc);
alter table public.order_notifications enable row level security;
revoke all on public.order_notifications from anon, authenticated;
grant select on public.order_notifications to authenticated;
grant update (is_read) on public.order_notifications to authenticated;
drop policy if exists order_notifications_read_own on public.order_notifications;
create policy order_notifications_read_own on public.order_notifications
  for select to authenticated using (recipient_id = auth.uid());
drop policy if exists order_notifications_mark_own_read on public.order_notifications;
create policy order_notifications_mark_own_read on public.order_notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Customer feedback is available only after delivery.
create table if not exists public.order_feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  constraint order_feedback_comment_length check (comment is null or length(comment) <= 1000)
);
alter table public.order_feedback enable row level security;
revoke all on public.order_feedback from anon, authenticated;
grant select on public.order_feedback to authenticated;
drop policy if exists order_feedback_read_owner_or_admin on public.order_feedback;
create policy order_feedback_read_owner_or_admin on public.order_feedback
  for select to authenticated using (customer_id = auth.uid() or public.has_role('super_admin'));

-- A new order alerts all super admins. Order status/date/payment changes alert its customer.
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
      values (admin_user.user_id, new.id, 'New order received',
        'Order ' || new.order_number || ' is waiting for your review.', 'new_order');
    end loop;
    return new;
  end if;

  if new.order_status is distinct from old.order_status then
    insert into public.order_notifications(recipient_id, order_id, title, message, notification_type)
    values (
      new.customer_id, new.id,
      case when new.order_status = 'delivered' then 'Order delivered'
           when new.order_status = 'cancelled' then 'Order declined or cancelled'
           else 'Order status updated' end,
      case when new.order_status = 'confirmed' then
             'Your order ' || new.order_number || ' has been accepted.'
           when new.order_status = 'cancelled' then
             'Your order ' || new.order_number || ' was declined or cancelled.'
           when new.order_status = 'delivered' then
             'Your order ' || new.order_number || ' has been delivered. You can now leave feedback.'
           else 'Your order ' || new.order_number || ' is now ' || replace(new.order_status::text, '_', ' ') || '.' end,
      case when new.order_status = 'delivered' then 'delivered'
           when new.order_status = 'confirmed' then 'order_accepted'
           when new.order_status = 'cancelled' then 'order_declined'
           else 'order_status' end
    );
  end if;

  if new.expected_delivery_date is distinct from old.expected_delivery_date
     and new.expected_delivery_date is not null then
    insert into public.order_notifications(recipient_id, order_id, title, message, notification_type)
    values (new.customer_id, new.id, 'Delivery date confirmed',
      'Your order ' || new.order_number || ' is expected on ' ||
      to_char(new.expected_delivery_date, 'DD Mon YYYY') || '.', 'order_accepted');
  end if;

  if old.payment_method is null and new.payment_method is not null then
    insert into public.order_notifications(recipient_id, order_id, title, message, notification_type)
    values (new.customer_id, new.id, 'Payment option selected',
      'Your payment option is ready for order ' || new.order_number || '.', 'payment_available');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_simple_notifications on public.orders;
create trigger orders_simple_notifications
after insert or update of order_status, expected_delivery_date, payment_method
on public.orders for each row execute function public.notify_simple_order_events();

-- Customer places a product order request and uploads one customization photo.
-- The order stays pending and no payment method is selected until admin acceptance.
create or replace function public.create_customer_order_request(
  p_product_id uuid,
  p_quantity integer,
  p_shipping_address jsonb,
  p_idempotency_key text,
  p_customization_photo_path text default null,
  p_customization_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  product_row public.products%rowtype;
  order_id_value uuid;
  order_number_value text;
  delivery_value numeric(12,2) := 0;
  unit_price_value numeric(12,2);
  image_url_value text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'customer'
  ) then
    raise exception 'Sign in with a customer account to place an order' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20' using errcode = '22023';
  end if;
  if p_shipping_address is null or jsonb_typeof(p_shipping_address) <> 'object' then
    raise exception 'A delivery address is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'A valid order request key is required' using errcode = '22023';
  end if;
  if p_customization_note is not null and length(p_customization_note) > 1000 then
    raise exception 'Customization note must be 1000 characters or fewer' using errcode = '22023';
  end if;
  if p_customization_photo_path is not null and
     (p_customization_photo_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._/-]+$')
      or p_customization_photo_path like '%..%') then
    raise exception 'Invalid customization photo path' using errcode = '22023';
  end if;

  select id into order_id_value from public.orders
  where customer_id = auth.uid() and idempotency_key = trim(p_idempotency_key);
  if order_id_value is not null then return order_id_value; end if;

  select * into profile_row from public.profiles where id = auth.uid();
  if not found or coalesce(trim(profile_row.email), '') = '' then
    raise exception 'Complete your customer profile before ordering' using errcode = '23514';
  end if;

  select * into product_row from public.products
  where id = p_product_id and is_published = true
  for share;
  if not found then raise exception 'This product is not available' using errcode = 'P0002'; end if;
  if product_row.stock_quantity < p_quantity then
    raise exception 'Not enough stock is available' using errcode = '23514';
  end if;

  select coalesce(nullif(configuration ->> 'delivery_charge_inr', '')::numeric, 0)
    into delivery_value from public.store_settings limit 1;
  delivery_value := coalesce(delivery_value, 0);
  unit_price_value := coalesce(product_row.discount_price_inr, product_row.price_inr);

  select image_url into image_url_value from public.product_images
  where product_id = product_row.id order by is_primary desc, display_order limit 1;

  order_number_value := 'CL-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders(
    order_number, customer_id, idempotency_key, customer_name, customer_email, customer_phone,
    shipping_address, order_status, payment_method, payment_status,
    subtotal_inr, discount_inr, delivery_charge_inr, total_inr, customer_note,
    customization_photo_path, customization_note
  ) values (
    order_number_value, auth.uid(), trim(p_idempotency_key),
    coalesce(nullif(trim(profile_row.full_name), ''), profile_row.email),
    profile_row.email, profile_row.mobile_number, p_shipping_address,
    'pending', null, 'pending',
    unit_price_value * p_quantity, 0, delivery_value,
    unit_price_value * p_quantity + delivery_value, null,
    p_customization_photo_path, nullif(trim(p_customization_note), '')
  ) returning id into order_id_value;

  insert into public.order_items(
    order_id, product_id, product_name, product_sku, product_image_url,
    quantity, unit_price_inr, list_price_inr, line_subtotal_inr
  ) values (
    order_id_value, product_row.id, product_row.name, product_row.sku, image_url_value,
    p_quantity, unit_price_value, product_row.price_inr, unit_price_value * p_quantity
  );

  insert into public.order_status_history(order_id, previous_status, new_status, reason, changed_by)
  values (order_id_value, null, 'pending', 'Order request submitted', auth.uid());

  return order_id_value;
end;
$$;
revoke all on function public.create_customer_order_request(uuid, integer, jsonb, text, text, text) from public, anon;
grant execute on function public.create_customer_order_request(uuid, integer, jsonb, text, text, text) to authenticated;

-- Admin accepts with a promised delivery date, or declines.
create or replace function public.admin_review_customer_order(
  p_order_id uuid,
  p_accept boolean,
  p_expected_delivery_date date default null,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result_row public.orders%rowtype;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only an admin can review orders' using errcode = '42501';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'Note must be 1000 characters or fewer' using errcode = '22023';
  end if;
  if p_accept and (p_expected_delivery_date is null or p_expected_delivery_date < current_date) then
    raise exception 'Choose a delivery date today or later before accepting' using errcode = '22023';
  end if;
  if not p_accept and p_expected_delivery_date is not null then
    raise exception 'A delivery date is only set when accepting an order' using errcode = '22023';
  end if;

  perform public.admin_update_order_status(
    p_order_id,
    case when p_accept then 'confirmed'::public.order_status else 'cancelled'::public.order_status end,
    coalesce(nullif(trim(p_note), ''), case when p_accept then 'Order accepted' else 'Order declined' end)
  );
  update public.orders set
    expected_delivery_date = case when p_accept then p_expected_delivery_date else null end,
    admin_decision_note = nullif(trim(p_note), '')
  where id = p_order_id returning * into result_row;
  return result_row;
end;
$$;
revoke all on function public.admin_review_customer_order(uuid, boolean, date, text) from public, anon;
grant execute on function public.admin_review_customer_order(uuid, boolean, date, text) to authenticated;

-- Customer chooses UPI or COD only after the order has been accepted.
create or replace function public.customer_select_order_payment(
  p_order_id uuid,
  p_payment_method text
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_row public.orders%rowtype;
  payment_state public.order_payment_status;
begin
  if auth.uid() is null then raise exception 'Sign in to choose payment' using errcode = '42501'; end if;
  if p_payment_method not in ('upi', 'cod') then raise exception 'Choose UPI or COD' using errcode = '22023'; end if;

  select * into result_row from public.orders
  where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if result_row.order_status <> 'confirmed' then
    raise exception 'Payment is available only after the order is accepted' using errcode = '22023';
  end if;
  if result_row.payment_method is not null then
    raise exception 'A payment method has already been selected' using errcode = '22023';
  end if;

  payment_state := case when p_payment_method = 'cod' then 'cod_due'::public.order_payment_status
                        else 'pending'::public.order_payment_status end;
  update public.orders set payment_method = p_payment_method, payment_status = payment_state
  where id = p_order_id returning * into result_row;

  insert into public.payment_records(order_id, payment_method, payment_status, amount_inr)
  values (p_order_id, p_payment_method, payment_state, result_row.total_inr);

  return result_row;
end;
$$;
revoke all on function public.customer_select_order_payment(uuid, text) from public, anon;
grant execute on function public.customer_select_order_payment(uuid, text) to authenticated;

-- Customer can leave one rating after delivery.
create or replace function public.customer_submit_order_feedback(
  p_order_id uuid,
  p_rating integer,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare feedback_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to leave feedback' using errcode = '42501'; end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 1000 then
    raise exception 'Feedback must be 1000 characters or fewer' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.orders where id = p_order_id
      and customer_id = auth.uid() and order_status = 'delivered'
  ) then raise exception 'Feedback is available after delivery only' using errcode = '42501'; end if;

  insert into public.order_feedback(order_id, customer_id, rating, comment)
  values (p_order_id, auth.uid(), p_rating, nullif(trim(p_comment), ''))
  returning id into feedback_id;
  return feedback_id;
end;
$$;
revoke all on function public.customer_submit_order_feedback(uuid, integer, text) from public, anon;
grant execute on function public.customer_submit_order_feedback(uuid, integer, text) to authenticated;

commit;
