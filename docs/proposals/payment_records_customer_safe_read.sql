-- PROPOSAL ONLY. NOT in supabase/migrations/, NOT applied, and NOT run by `supabase db push`.
-- Review, rename to a timestamped migration (for example 202611130001_customer_safe_payment_records.sql) and test
-- on a staging copy before applying. See docs/SECURITY.md, "Payment record exposure".
--
-- Problem
--   The policy "payment_records_read_owner_or_super_admin" lets the owning customer SELECT whole payment_records rows,
--   so a customer calling the API directly can read admin-only columns: verification_note, verified_by, provider,
--   provider_event_id (and payment_proof_path, which is the customer's own file).
--
-- Why a column-level GRANT is not enough
--   Customers and administrators both connect as the Postgres role `authenticated`; only row-level security can tell
--   them apart. Revoking columns from `authenticated` would also break the admin Orders and Payments screens.
--
-- Fix
--   1. Restrict direct table reads to super admins (admin screens keep working: they already pass has_role('super_admin')).
--   2. Give customers a SECURITY DEFINER function that returns only customer-safe columns for their own order,
--      the same pattern as get_customer_order_tracking and get_customer_upi_payment_details.
--   3. Point src/services/customerOrders.ts (getMyOrderDetail) and nothing else at the function.
--
-- Not affected: every function that already reads payment_records is SECURITY DEFINER
--   (admin_verify_order_payment, get_admin_payment_summary, get_admin_dashboard_analytics, customer_submit_payment_proof,
--   get_customer_upi_payment_details, get_customer_order_tracking), and no other table's policy references payment_records.

begin;

drop policy if exists "payment_records_read_owner_or_super_admin" on public.payment_records;
drop policy if exists "payment_records_read_super_admin" on public.payment_records;
create policy "payment_records_read_super_admin" on public.payment_records for select to authenticated
  using (public.has_role('super_admin'));

create or replace function public.get_customer_payment_records(p_order_id uuid)
returns table (
  id uuid,
  payment_method text,
  payment_status public.order_payment_status,
  amount_inr numeric,
  transaction_reference text,
  verified_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view payment details' using errcode = '42501';
  end if;
  return query
  select pr.id, pr.payment_method, pr.payment_status, pr.amount_inr, pr.transaction_reference, pr.verified_at, pr.created_at
  from public.payment_records pr
  join public.orders o on o.id = pr.order_id
  where pr.order_id = p_order_id and o.customer_id = auth.uid()
  order by pr.created_at desc;
end;
$$;

revoke all on function public.get_customer_payment_records(uuid) from public, anon;
grant execute on function public.get_customer_payment_records(uuid) to authenticated;

commit;

-- Application change that goes with it (src/services/customerOrders.ts, getMyOrderDetail):
--   replace  supabase.from("payment_records").select("id,payment_method,...").eq("order_id", order.id).order(...)
--   with     supabase.rpc("get_customer_payment_records", { p_order_id: order.id })
--   and add the function to the Database["public"]["Functions"] types.
--
-- Verify after applying (staging first):
--   * As a customer: select * from payment_records -> 0 rows; rpc get_customer_payment_records(own order) -> rows
--     without verification_note/verified_by/provider; rpc for someone else's order -> 0 rows.
--   * As a super admin: Admin > Orders detail and Admin > Payments list/detail/verify still work unchanged.
--   * As a customer: My Orders > order detail still shows the payment line.
-- Rollback: drop the new policy and function, re-create the old policy from 202611110003_order_management.sql.
