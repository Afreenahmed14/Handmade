
-- ============================================================
-- CASALOOM: PAYMENT OPERATIONS HARDENING
-- Safe customer payment reads, UPI rejection, refunds,
-- and auditable payment operation history.
-- ============================================================

-- 1. PAYMENT OPERATION HISTORY TABLE

create table if not exists public.payment_operation_history (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payment_records(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  action text not null check (
    action in (
      'proof_submitted',
      'verified',
      'rejected',
      'refund_recorded'
    )
  ),
  previous_status public.order_payment_status,
  new_status public.order_payment_status not null,
  amount_inr numeric(12,2) not null check (amount_inr >= 0),
  note text,
  external_reference text,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint payment_operation_note_length
    check (note is null or length(note) <= 1000),

  constraint payment_operation_reference_length
    check (external_reference is null or length(external_reference) <= 200)
);

create index if not exists payment_operation_history_payment_created_idx
on public.payment_operation_history(payment_id, created_at desc);

-- 2. PAYMENT HISTORY SECURITY

alter table public.payment_operation_history
enable row level security;

revoke all on public.payment_operation_history
from anon, authenticated;

drop policy if exists payment_operation_history_admin_read
on public.payment_operation_history;

create policy payment_operation_history_admin_read
on public.payment_operation_history
for select to authenticated
using (public.has_role('super_admin'));

grant select on public.payment_operation_history to authenticated;

-- 3. PAYMENT RECORD ACCESS SECURITY

drop policy if exists payment_records_read_owner_or_super_admin
on public.payment_records;

drop policy if exists "payment_records_read_owner_or_super_admin"
on public.payment_records;

drop policy if exists payment_records_super_admin_read
on public.payment_records;

create policy payment_records_super_admin_read
on public.payment_records
for select to authenticated
using (public.has_role('super_admin'));

-- 4. CUSTOMER PAYMENT READ FUNCTION

create or replace function public.get_customer_order_payments(
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view payment details'
      using errcode = '42501';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
    and customer_id = auth.uid();

  if not found then
    raise exception 'Order not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', pr.id,
        'payment_method', pr.payment_method,
        'payment_status', pr.payment_status,
        'amount_inr', pr.amount_inr,
        'transaction_reference', pr.transaction_reference,
        'verified_at', pr.verified_at,
        'created_at', pr.created_at
      )
      order by pr.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.payment_records pr
  where pr.order_id = order_row.id;

  return result;
end;
$$;

revoke all on function public.get_customer_order_payments(uuid)
from public, anon;

grant execute on function public.get_customer_order_payments(uuid)
to authenticated;

-- 5. ADMIN REJECT UPI PAYMENT FUNCTION

create or replace function public.admin_reject_order_payment(
  p_payment_id uuid,
  p_rejection_reason text
)
returns public.payment_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_row public.payment_records%rowtype;
  previous_value public.order_payment_status;
  reason_value text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may reject payment'
      using errcode = '42501';
  end if;

  reason_value := nullif(trim(coalesce(p_rejection_reason, '')), '');

  if reason_value is null or length(reason_value) > 1000 then
    raise exception 'Provide a rejection reason of 1 to 1000 characters'
      using errcode = '22023';
  end if;

  select *
  into payment_row
  from public.payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment record not found'
      using errcode = 'P0002';
  end if;

  if payment_row.payment_method <> 'upi'
     or payment_row.payment_status not in ('pending', 'verification_pending') then
    raise exception 'Only an unverified UPI payment can be rejected'
      using errcode = '22023';
  end if;

  previous_value := payment_row.payment_status;

  update public.payment_records
  set
    payment_status = 'failed',
    verified_by = null,
    verified_at = null,
    verification_note = reason_value
  where id = p_payment_id
  returning * into payment_row;

  update public.orders
  set payment_status = 'failed'
  where id = payment_row.order_id;

  return payment_row;
end;
$$;

revoke all on function public.admin_reject_order_payment(uuid, text)
from public, anon;

grant execute on function public.admin_reject_order_payment(uuid, text)
to authenticated;

-- 6. ADMIN RECORD PAYMENT REFUND FUNCTION

create or replace function public.admin_record_payment_refund(
  p_payment_id uuid,
  p_refund_amount_inr numeric,
  p_external_reference text,
  p_note text default null
)
returns public.payment_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_row public.payment_records%rowtype;
  note_value text;
  reference_value text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may record a refund'
      using errcode = '42501';
  end if;

  if p_refund_amount_inr is null or p_refund_amount_inr <= 0 then
    raise exception 'Refund amount must be greater than zero'
      using errcode = '22023';
  end if;

  reference_value := nullif(trim(coalesce(p_external_reference, '')), '');
  note_value := nullif(trim(coalesce(p_note, '')), '');

  if reference_value is null or length(reference_value) > 200 then
    raise exception 'Enter the bank or UPI refund reference'
      using errcode = '22023';
  end if;

  if note_value is not null and length(note_value) > 1000 then
    raise exception 'Refund note is too long'
      using errcode = '22023';
  end if;

  select *
  into payment_row
  from public.payment_records
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment record not found'
      using errcode = 'P0002';
  end if;

  if payment_row.payment_status <> 'paid'
     or payment_row.verified_at is null then
    raise exception 'Only a verified payment can be refunded'
      using errcode = '22023';
  end if;

  if p_refund_amount_inr <> payment_row.amount_inr then
    raise exception 'Partial refunds are not supported in this version. Refund the full recorded amount.'
      using errcode = '22023';
  end if;

  update public.payment_records
  set payment_status = 'refunded'
  where id = p_payment_id
  returning * into payment_row;

  update public.orders
  set payment_status = 'refunded'
  where id = payment_row.order_id;

  return payment_row;
end;
$$;

revoke all on function public.admin_record_payment_refund(uuid, numeric, text, text)
from public, anon;

grant execute on function public.admin_record_payment_refund(uuid, numeric, text, text)
to authenticated;

-- 7. ADMIN PAYMENT HISTORY FUNCTION

create or replace function public.get_admin_payment_operation_history(
  p_payment_id uuid
)
returns setof public.payment_operation_history
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may read payment history'
      using errcode = '42501';
  end if;

  return query
  select *
  from public.payment_operation_history
  where payment_id = p_payment_id
  order by created_at desc;
end;
$$;

revoke all on function public.get_admin_payment_operation_history(uuid)
from public, anon;

grant execute on function public.get_admin_payment_operation_history(uuid)
to authenticated;

-- 8. PAYMENT OPERATION HISTORY TRIGGER FUNCTION

create or replace function public.capture_payment_operation_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  action_value text;
begin
  if new.payment_status is distinct from old.payment_status then

    action_value := case
      when new.payment_status = 'paid' then 'verified'
      when new.payment_status = 'failed' then 'rejected'
      when new.payment_status = 'refunded' then 'refund_recorded'
      when new.payment_status = 'verification_pending' then 'proof_submitted'
      else null
    end;

    if action_value is not null then
      insert into public.payment_operation_history (
        payment_id,
        order_id,
        action,
        previous_status,
        new_status,
        amount_inr,
        note,
        external_reference,
        performed_by
      )
      values (
        new.id,
        new.order_id,
        action_value,
        old.payment_status,
        new.payment_status,
        new.amount_inr,
        new.verification_note,
        new.transaction_reference,
        auth.uid()
      );
    end if;

  end if;

  return new;
end;
$$;

-- 9. PAYMENT HISTORY TRIGGER

drop trigger if exists payment_records_capture_operation_history
on public.payment_records;

create trigger payment_records_capture_operation_history
after update of payment_status
on public.payment_records
for each row
execute function public.capture_payment_operation_history();

-- ============================================================
-- END OF CASALOOM PAYMENT OPERATIONS HARDENING
-- ============================================================
