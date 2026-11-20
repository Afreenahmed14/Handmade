create or replace function public.get_admin_dashboard_analytics(
  p_from_date date default null,
  p_to_date date default null,
  p_trend_months integer default 12
)
returns table (
  metrics jsonb,
  revenue_trend jsonb,
  order_status_distribution jsonb,
  payment_status_distribution jsonb,
  payment_method_distribution jsonb,
  best_selling_products jsonb,
  category_performance jsonb,
  customer_registration_trend jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  trend_start date;
  trend_end date;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may read dashboard analytics' using errcode = '42501';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'Start date must be on or before end date' using errcode = '22023';
  end if;
  if p_trend_months < 1 or p_trend_months > 36 then
    raise exception 'Trend range must be between 1 and 36 months' using errcode = '22023';
  end if;

  trend_start := coalesce(
    date_trunc('month', p_from_date::timestamp)::date,
    date_trunc('month', coalesce(p_to_date, current_date)::timestamp - ((p_trend_months - 1) * interval '1 month'))::date
  );
  trend_end := coalesce(date_trunc('month', p_to_date::timestamp)::date, date_trunc('month', current_date::timestamp)::date);

  return query
  with filtered_orders as (
    select o.*
    from public.orders o
    where (p_from_date is null or o.created_at >= p_from_date::timestamptz)
      and (p_to_date is null or o.created_at < (p_to_date + 1)::timestamptz)
  ), verified_payments as (
    select pr.order_id, sum(pr.amount_inr)::numeric as amount_inr
    from public.payment_records pr
    join public.orders o on o.id = pr.order_id
    where pr.payment_status = 'paid'
      and pr.verified_at is not null
      and o.order_status not in ('cancelled', 'returned')
      and (p_from_date is null or pr.verified_at >= p_from_date::timestamptz)
      and (p_to_date is null or pr.verified_at < (p_to_date + 1)::timestamptz)
    group by pr.order_id
  ), month_series as (
    select generate_series(trend_start, trend_end, interval '1 month')::date as month_start
  ), monthly_revenue as (
    select date_trunc('month', pr.verified_at)::date as month_start, sum(pr.amount_inr)::numeric as revenue
    from public.payment_records pr
    join public.orders o on o.id = pr.order_id
    where pr.payment_status = 'paid'
      and pr.verified_at is not null
      and o.order_status not in ('cancelled', 'returned')
      and pr.verified_at >= trend_start::timestamptz
      and pr.verified_at < (trend_end + interval '1 month')::timestamptz
      and (p_from_date is null or pr.verified_at >= p_from_date::timestamptz)
      and (p_to_date is null or pr.verified_at < (p_to_date + 1)::timestamptz)
    group by 1
  ), monthly_orders as (
    select date_trunc('month', fo.created_at)::date as month_start, count(*)::bigint as order_count
    from filtered_orders fo
    where fo.created_at >= trend_start::timestamptz
      and fo.created_at < (trend_end + interval '1 month')::timestamptz
    group by 1
  ), monthly_customers as (
    select date_trunc('month', p.created_at)::date as month_start, count(*)::bigint as customer_count
    from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'customer'
    where p.created_at >= trend_start::timestamptz
      and p.created_at < (trend_end + interval '1 month')::timestamptz
      and (p_from_date is null or p.created_at >= p_from_date::timestamptz)
      and (p_to_date is null or p.created_at < (p_to_date + 1)::timestamptz)
    group by 1
  ), top_products as (
    select
      oi.product_name,
      oi.product_sku,
      sum(oi.quantity - oi.returned_quantity)::bigint as units_sold,
      sum((oi.quantity - oi.returned_quantity) * oi.unit_price_inr)::numeric as sales_inr
    from public.order_items oi
    join filtered_orders fo on fo.id = oi.order_id
    where fo.order_status in ('confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered')
    group by oi.product_name, oi.product_sku
    having sum(oi.quantity - oi.returned_quantity) > 0
    order by units_sold desc, sales_inr desc, oi.product_name
    limit 10
  ), top_categories as (
    select
      coalesce(c.name, 'Uncategorized') as category_name,
      sum(oi.quantity - oi.returned_quantity)::bigint as units_sold,
      sum((oi.quantity - oi.returned_quantity) * oi.unit_price_inr)::numeric as sales_inr
    from public.order_items oi
    join filtered_orders fo on fo.id = oi.order_id
    left join public.products p on p.id = oi.product_id
    left join public.categories c on c.id = p.category_id
    where fo.order_status in ('confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered')
    group by coalesce(c.name, 'Uncategorized')
    having sum(oi.quantity - oi.returned_quantity) > 0
    order by sales_inr desc, units_sold desc, category_name
    limit 10
  )
  select
    jsonb_build_object(
      'total_orders', (select count(*) from filtered_orders),
      'pending_orders', (select count(*) from filtered_orders where order_status = 'pending'),
      'confirmed_orders', (select count(*) from filtered_orders where order_status = 'confirmed'),
      'processing_orders', (select count(*) from filtered_orders where order_status = 'processing'),
      'shipped_orders', (select count(*) from filtered_orders where order_status in ('shipped', 'out_for_delivery')),
      'delivered_orders', (select count(*) from filtered_orders where order_status = 'delivered'),
      'cancelled_orders', (select count(*) from filtered_orders where order_status = 'cancelled'),
      'returned_orders', (select count(*) from filtered_orders where order_status = 'returned'),
      'verified_revenue_inr', coalesce((select sum(amount_inr) from verified_payments), 0),
      'paid_order_count', (select count(*) from verified_payments),
      'average_order_value_inr', coalesce((select avg(amount_inr) from verified_payments), 0),
      'total_customers', (select count(*) from public.user_roles where role = 'customer'),
      'total_products', (select count(*) from public.products),
      'low_stock_products', (select count(*) from public.products where stock_quantity > 0 and stock_quantity <= low_stock_threshold),
      'out_of_stock_products', (select count(*) from public.products where stock_quantity = 0)
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'month_start', ms.month_start,
        'revenue_inr', coalesce(mr.revenue, 0),
        'order_count', coalesce(mo.order_count, 0)
      ) order by ms.month_start)
      from month_series ms
      left join monthly_revenue mr using (month_start)
      left join monthly_orders mo using (month_start)
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('status', status_key, 'count', status_count) order by status_order)
      from (
        select statuses.status_key, statuses.status_order, count(fo.id)::bigint as status_count
        from (values
          ('pending'::public.order_status, 1), ('confirmed'::public.order_status, 2),
          ('processing'::public.order_status, 3), ('shipped'::public.order_status, 4),
          ('out_for_delivery'::public.order_status, 5), ('delivered'::public.order_status, 6),
          ('cancelled'::public.order_status, 7), ('returned'::public.order_status, 8)
        ) as statuses(status_key, status_order)
        left join filtered_orders fo on fo.order_status = statuses.status_key
        group by statuses.status_key, statuses.status_order
      ) status_counts
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('status', payment_status, 'count', payment_count) order by payment_status)
      from (
        select pr.payment_status, count(*)::bigint as payment_count
        from public.payment_records pr
        join filtered_orders fo on fo.id = pr.order_id
        group by pr.payment_status
      ) payment_counts
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('method', payment_method, 'count', method_count) order by payment_method)
      from (
        select pr.payment_method, count(*)::bigint as method_count
        from public.payment_records pr
        join filtered_orders fo on fo.id = pr.order_id
        group by pr.payment_method
      ) method_counts
    ), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('product_name', product_name, 'sku', product_sku, 'units_sold', units_sold, 'sales_inr', sales_inr) order by units_sold desc, sales_inr desc) from top_products), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('category_name', category_name, 'units_sold', units_sold, 'sales_inr', sales_inr) order by sales_inr desc, units_sold desc) from top_categories), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('month_start', ms.month_start, 'registrations', coalesce(mc.customer_count, 0)) order by ms.month_start)
      from month_series ms left join monthly_customers mc using (month_start)
    ), '[]'::jsonb);
end;
$$;

create index if not exists payment_records_paid_verified_idx
  on public.payment_records (verified_at, order_id)
  where payment_status = 'paid' and verified_at is not null;

revoke all on function public.get_admin_dashboard_analytics(date, date, integer) from public, anon;
grant execute on function public.get_admin_dashboard_analytics(date, date, integer) to authenticated;
