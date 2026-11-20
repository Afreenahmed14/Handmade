create or replace view public.admin_customer_directory
with (security_invoker = true)
as
select
  p.id,
  p.full_name,
  p.email,
  p.mobile_number,
  p.address_line1,
  p.address_line2,
  p.city,
  p.state,
  p.postal_code,
  p.country,
  p.created_at,
  p.updated_at
from public.profiles p
join public.user_roles r on r.user_id = p.id
where r.role = 'customer';

revoke all on public.admin_customer_directory from public, anon;
grant select on public.admin_customer_directory to authenticated;

create or replace function public.get_customer_registration_analytics(p_months integer default 6)
returns table (month_start date, registration_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_role('super_admin') then
    raise exception 'Only an authorized administrator may read customer analytics' using errcode = '42501';
  end if;
  if p_months < 1 or p_months > 24 then
    raise exception 'Month range must be between 1 and 24' using errcode = '22023';
  end if;

  return query
  with periods as (
    select generate_series(
      date_trunc('month', current_date)::date - ((p_months - 1) * interval '1 month'),
      date_trunc('month', current_date)::date,
      interval '1 month'
    )::date as month_start
  ), customer_profiles as (
    select p.id, p.created_at
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where r.role = 'customer'
  )
  select
    periods.month_start,
    count(customer_profiles.id)::bigint
  from periods
  left join customer_profiles
    on customer_profiles.created_at >= periods.month_start::timestamptz
    and customer_profiles.created_at < (periods.month_start + interval '1 month')::timestamptz
  group by periods.month_start
  order by periods.month_start;
end;
$$;

revoke all on function public.get_customer_registration_analytics(integer) from public, anon;
grant execute on function public.get_customer_registration_analytics(integer) to authenticated, service_role;
