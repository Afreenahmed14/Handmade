create table if not exists public.private_store_configuration (
  id uuid primary key default gen_random_uuid(),
  store_settings_id uuid not null unique references public.store_settings(id) on delete cascade,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_store_configuration_object check (jsonb_typeof(configuration) = 'object')
);

alter table public.private_store_configuration enable row level security;
revoke all on public.private_store_configuration from public, anon, authenticated;

create or replace view public.public_store_settings
with (security_barrier = true)
as
select
  s.id,
  s.store_name,
  s.contact_email,
  s.contact_phone,
  s.currency,
  coalesce(s.configuration ->> 'store_description', '') as store_description,
  s.configuration ->> 'logo_url' as logo_url,
  s.configuration ->> 'business_address' as business_address,
  s.configuration ->> 'support_email' as support_email,
  s.configuration ->> 'support_phone' as support_phone,
  coalesce(s.configuration ->> 'time_zone', 'Asia/Kolkata') as time_zone,
  coalesce(s.configuration ->> 'date_format', 'DD/MM/YYYY') as date_format,
  case when s.configuration ->> 'maintenance_mode' in ('true', 'false') then (s.configuration ->> 'maintenance_mode')::boolean else false end as maintenance_mode,
  coalesce(s.configuration ->> 'maintenance_message', '') as maintenance_message,
  case when coalesce(s.configuration ->> 'shipping_charge_inr', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' then (s.configuration ->> 'shipping_charge_inr')::numeric else 0::numeric end as shipping_charge_inr,
  case when coalesce(s.configuration ->> 'free_shipping_threshold_inr', '') ~ '^[0-9]+(\.[0-9]{1,2})?$' then (s.configuration ->> 'free_shipping_threshold_inr')::numeric else null::numeric end as free_shipping_threshold_inr,
  coalesce(s.configuration ->> 'estimated_delivery_text', '') as estimated_delivery_text,
  case when jsonb_typeof(s.configuration -> 'supported_regions') = 'array' then s.configuration -> 'supported_regions' else '[]'::jsonb end as supported_regions,
  case when s.configuration ->> 'cod_enabled' in ('true', 'false') then (s.configuration ->> 'cod_enabled')::boolean else true end as cod_enabled,
  case when s.configuration ->> 'upi_enabled' in ('true', 'false') then (s.configuration ->> 'upi_enabled')::boolean else true end as upi_enabled,
  coalesce(s.configuration ->> 'payment_instructions', '') as payment_instructions,
  s.updated_at
from public.store_settings s;

revoke all on public.public_store_settings from public;
grant select on public.public_store_settings to anon, authenticated;

create or replace function public.get_admin_store_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may read store settings' using errcode = '42501';
  end if;
  return (select to_jsonb(s) from public.public_store_settings s limit 1);
end;
$$;

create or replace function public.admin_update_store_settings(
  p_store_name text,
  p_contact_email text,
  p_contact_phone text,
  p_currency text,
  p_configuration jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  settings_id uuid;
  previous_configuration jsonb;
  private_configuration jsonb;
  public_configuration jsonb;
  allowed_keys text[] := array[
    'store_description', 'logo_url', 'business_address', 'support_email', 'support_phone',
    'time_zone', 'date_format', 'maintenance_mode', 'maintenance_message',
    'shipping_charge_inr', 'free_shipping_threshold_inr', 'estimated_delivery_text',
    'supported_regions', 'cod_enabled', 'upi_enabled', 'payment_instructions'
  ];
  numeric_value numeric;
  email_value text;
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a super admin may update store settings' using errcode = '42501';
  end if;
  if p_store_name is null or length(trim(p_store_name)) not between 1 and 160 then
    raise exception 'Store name must be 1 to 160 characters' using errcode = '22023';
  end if;
  if p_currency is distinct from 'INR' then
    raise exception 'Only INR is supported by current order pricing' using errcode = '22023';
  end if;
  if p_contact_email is not null and length(trim(p_contact_email)) > 254 then
    raise exception 'Contact email is too long' using errcode = '22023';
  end if;
  if p_contact_phone is not null and length(trim(p_contact_phone)) > 40 then
    raise exception 'Contact phone is too long' using errcode = '22023';
  end if;
  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object' then
    raise exception 'Store configuration must be a JSON object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_configuration) as keys(setting_key)
    where not setting_key = any(allowed_keys)
  ) then
    raise exception 'Store configuration contains unsupported or private keys' using errcode = '22023';
  end if;

  foreach email_value in array array[
    p_configuration ->> 'support_email', p_contact_email
  ] loop
    if email_value is not null and (length(email_value) > 254 or email_value !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
      raise exception 'Enter a valid contact/support email address' using errcode = '22023';
    end if;
  end loop;
  if coalesce(length(p_configuration ->> 'support_phone'), 0) > 40 or
     coalesce(length(p_configuration ->> 'store_description'), 0) > 2000 or
     coalesce(length(p_configuration ->> 'business_address'), 0) > 1000 or
     coalesce(length(p_configuration ->> 'maintenance_message'), 0) > 500 or
     coalesce(length(p_configuration ->> 'estimated_delivery_text'), 0) > 500 or
     coalesce(length(p_configuration ->> 'payment_instructions'), 0) > 2000 then
    raise exception 'A store setting exceeds its maximum length' using errcode = '22023';
  end if;
  if coalesce(p_configuration ->> 'logo_url', '') <> '' and p_configuration ->> 'logo_url' !~ '^https://[^[:space:]]+$' then
    raise exception 'Store logo URL must be a secure HTTPS URL' using errcode = '22023';
  end if;
  if p_configuration ? 'time_zone' and not exists (select 1 from pg_timezone_names where name = p_configuration ->> 'time_zone') then
    raise exception 'Select a valid time zone' using errcode = '22023';
  end if;
  if p_configuration ? 'date_format' and p_configuration ->> 'date_format' not in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD') then
    raise exception 'Unsupported date format' using errcode = '22023';
  end if;
  foreach email_value in array array['maintenance_mode', 'cod_enabled', 'upi_enabled'] loop
    if p_configuration ? email_value and jsonb_typeof(p_configuration -> email_value) <> 'boolean' then
      raise exception 'Availability/payment settings must be boolean values' using errcode = '22023';
    end if;
  end loop;
  foreach email_value in array array['shipping_charge_inr', 'free_shipping_threshold_inr'] loop
    if p_configuration ? email_value and p_configuration -> email_value <> 'null'::jsonb then
      if jsonb_typeof(p_configuration -> email_value) <> 'number' then
        raise exception 'Shipping amounts must be numeric' using errcode = '22023';
      end if;
      numeric_value := (p_configuration ->> email_value)::numeric;
      if numeric_value < 0 or numeric_value > 10000000 then
        raise exception 'Shipping amounts must be between zero and ten million INR' using errcode = '22023';
      end if;
    end if;
  end loop;
  if p_configuration ? 'supported_regions' and
     (jsonb_typeof(p_configuration -> 'supported_regions') <> 'array' or jsonb_array_length(p_configuration -> 'supported_regions') > 100) then
    raise exception 'Supported regions must be an array of at most 100 entries' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_configuration -> 'supported_regions', '[]'::jsonb)) as regions(value)
    where jsonb_typeof(regions.value) <> 'string' or length(trim(regions.value #>> '{}')) = 0 or length(regions.value #>> '{}') > 120
  ) then
    raise exception 'Each supported region must be a non-empty string of at most 120 characters' using errcode = '22023';
  end if;

  public_configuration := p_configuration || jsonb_build_object('delivery_charge_inr', coalesce(p_configuration -> 'shipping_charge_inr', '0'::jsonb));
  select s.id, s.configuration into settings_id, previous_configuration
  from public.store_settings s limit 1 for update;
  if settings_id is null then
    insert into public.store_settings (store_name, contact_email, contact_phone, currency, configuration)
    values (trim(p_store_name), nullif(trim(p_contact_email), ''), nullif(trim(p_contact_phone), ''), p_currency, public_configuration)
    returning id into settings_id;
  else
    private_configuration := coalesce(previous_configuration, '{}'::jsonb) - allowed_keys - 'delivery_charge_inr';
    if private_configuration <> '{}'::jsonb then
      insert into public.private_store_configuration (store_settings_id, configuration)
      values (settings_id, private_configuration)
      on conflict (store_settings_id) do update
        set configuration = public.private_store_configuration.configuration || excluded.configuration,
            updated_at = now();
    end if;
    update public.store_settings s set
      store_name = trim(p_store_name),
      contact_email = nullif(trim(p_contact_email), ''),
      contact_phone = nullif(trim(p_contact_phone), ''),
      currency = p_currency,
      configuration = public_configuration
    where s.id = settings_id;
  end if;
  return settings_id;
end;
$$;

revoke all on public.store_settings from anon, authenticated;
revoke all on function public.get_admin_store_settings() from public, anon;
grant execute on function public.get_admin_store_settings() to authenticated;
revoke all on function public.admin_update_store_settings(text, text, text, text, jsonb) from public, anon;
grant execute on function public.admin_update_store_settings(text, text, text, text, jsonb) to authenticated;
