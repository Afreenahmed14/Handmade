create or replace function public.get_admin_payment_summary(
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  summary jsonb,
  status_distribution jsonb,
  method_distribution jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may read payment analytics' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'Start date must be on or before end date' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select pr.*
    from public.payment_records pr
    where (p_from_date is null or pr.created_at >= p_from_date::timestamptz)
      and (p_to_date is null or pr.created_at < (p_to_date + 1)::timestamptz)
  ), all_statuses as (
    select status_key, status_order
    from (values
      ('pending'::public.order_payment_status, 1),
      ('verification_pending'::public.order_payment_status, 2),
      ('paid'::public.order_payment_status, 3),
      ('failed'::public.order_payment_status, 4),
      ('cod_due'::public.order_payment_status, 5),
      ('refunded'::public.order_payment_status, 6)
    ) as statuses(status_key, status_order)
  ), all_methods as (
    select method_key, method_order
    from (values ('upi'::text, 1), ('cod'::text, 2)) as methods(method_key, method_order)
  )
  select
    jsonb_build_object(
      'total_records', (select count(*) from filtered),
      'verified_amount_inr', coalesce((
        select sum(f.amount_inr) from filtered f
        where f.payment_status = 'paid' and f.verified_at is not null
      ), 0),
      'pending_count', (select count(*) from filtered where payment_status in ('pending', 'verification_pending', 'cod_due')),
      'failed_count', (select count(*) from filtered where payment_status = 'failed'),
      'refunded_count', (select count(*) from filtered where payment_status = 'refunded')
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status_key, 'count', coalesce(counts.status_count, 0)) order by s.status_order)
      from all_statuses s
      left join (
        select f.payment_status, count(*)::bigint as status_count from filtered f group by f.payment_status
      ) counts on counts.payment_status = s.status_key
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('method', m.method_key, 'count', coalesce(counts.method_count, 0)) order by m.method_order)
      from all_methods m
      left join (
        select f.payment_method, count(*)::bigint as method_count from filtered f group by f.payment_method
      ) counts on counts.payment_method = m.method_key
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_admin_payment_summary(date, date) from public, anon;
grant execute on function public.get_admin_payment_summary(date, date) to authenticated;
