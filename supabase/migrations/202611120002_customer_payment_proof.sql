-- Customer UPI payment instructions and payment proof submission (additive).
--
-- What this migration does
--   1. Lets the store owner configure the UPI payee details customers pay to: UPI ID, payee name and an optional
--      QR image URL (stored in the existing store_settings.configuration JSON, written only through
--      admin_update_store_settings, which is replaced below with the same signature and grants and three extra
--      validated keys). The keys are NOT added to public.public_store_settings, so anonymous visitors cannot read
--      them. Customers read them only through get_customer_upi_payment_details for an order they own.
--   2. get_admin_store_settings is replaced (same signature) so the admin Settings screen can read the three keys.
--   3. get_customer_upi_payment_details(order_id): the amount, order reference, payment status and UPI payee details
--      for ONE order the caller owns. The amount always comes from the database.
--   4. customer_submit_payment_proof(order_id, reference, proof_path): records the customer's transaction
--      reference and private proof file and moves the payment to the EXISTING 'verification_pending' status.
--      It never marks anything paid. Only the existing admin_verify_order_payment can do that.
--
-- Not changed
--   * No table is altered and no enum value is added. Statuses used: pending, verification_pending, failed (all
--     already in public.order_payment_status).
--   * admin_verify_order_payment is untouched. It already accepts 'pending' and 'verification_pending'.
--   * Storage policies are untouched: customers already have owner-folder access and super admins read access to the
--     private payment-proofs bucket.
--   * No existing rows are modified. One additive expression index is created for duplicate-reference lookups.
--
-- Resubmission rules (there is no admin "reject" function in the current schema, and nothing sets 'failed' today)
--   * pending               -> first submission                                    -> verification_pending
--   * verification_pending  -> customer corrects the reference or replaces proof   -> verification_pending
--                              (re-sending identical details is a harmless no-op)
--   * failed                -> customer resubmits                                  -> verification_pending
--   * paid / refunded / cod_due, or a cancelled / returned order                   -> rejected

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Store settings: UPI payee details
-- ---------------------------------------------------------------------------------------------------------------

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
    'supported_regions', 'cod_enabled', 'upi_enabled', 'payment_instructions',
    'upi_id', 'upi_payee_name', 'upi_qr_url'
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
  foreach email_value in array array['upi_id', 'upi_payee_name', 'upi_qr_url'] loop
    if p_configuration ? email_value and jsonb_typeof(p_configuration -> email_value) not in ('string', 'null') then
      raise exception 'UPI settings must be text values' using errcode = '22023';
    end if;
  end loop;
  if coalesce(p_configuration ->> 'upi_id', '') <> '' and (
       length(p_configuration ->> 'upi_id') > 100
       or (p_configuration ->> 'upi_id') !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,48}$'
     ) then
    raise exception 'Enter a valid UPI ID such as name@bank' using errcode = '22023';
  end if;
  if coalesce(length(p_configuration ->> 'upi_payee_name'), 0) > 120 or coalesce(p_configuration ->> 'upi_payee_name', '') ~ '[[:cntrl:]]' then
    raise exception 'UPI payee name must be 120 characters or fewer without control characters' using errcode = '22023';
  end if;
  if coalesce(p_configuration ->> 'upi_qr_url', '') <> '' and (
       length(p_configuration ->> 'upi_qr_url') > 2000 or p_configuration ->> 'upi_qr_url' !~ '^https://[^[:space:]]+$'
     ) then
    raise exception 'UPI QR image URL must be a secure HTTPS URL' using errcode = '22023';
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

revoke all on function public.admin_update_store_settings(text, text, text, text, jsonb) from public, anon;
grant execute on function public.admin_update_store_settings(text, text, text, text, jsonb) to authenticated;

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
  return (
    select to_jsonb(p) || jsonb_build_object(
      'upi_id', coalesce(s.configuration ->> 'upi_id', ''),
      'upi_payee_name', coalesce(s.configuration ->> 'upi_payee_name', ''),
      'upi_qr_url', nullif(s.configuration ->> 'upi_qr_url', '')
    )
    from public.store_settings s
    join public.public_store_settings p on p.id = s.id
    limit 1
  );
end;
$$;

revoke all on function public.get_admin_store_settings() from public, anon;
grant execute on function public.get_admin_store_settings() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Payment proof submission
-- ---------------------------------------------------------------------------------------------------------------

-- Duplicate-reference lookups (one reference must not be attached to two payments).
create index if not exists payment_records_transaction_reference_lower_idx
  on public.payment_records (lower(transaction_reference))
  where transaction_reference is not null;

-- Single source of truth for "may the customer submit payment details right now?". It is used by both the read
-- function (so the storefront can show or hide the form) and the write function (so the server enforces it).
-- Returns NULL when a submission is allowed, otherwise a customer-safe reason.
create or replace function public.customer_payment_proof_block_reason(
  p_order_status public.order_status,
  p_payment_status public.order_payment_status
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_order_status in ('cancelled', 'returned') then 'This order is ' || p_order_status::text || ', so payment details can no longer be submitted.'
    when p_payment_status = 'paid' then 'This payment has already been verified.'
    when p_payment_status = 'refunded' then 'This payment has been refunded.'
    when p_payment_status not in ('pending', 'verification_pending', 'failed') then 'This payment is not waiting for a UPI payment submission.'
    else null
  end;
$$;

revoke all on function public.customer_payment_proof_block_reason(public.order_status, public.order_payment_status) from public, anon, authenticated;

create or replace function public.get_customer_upi_payment_details(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  payment_row public.payment_records%rowtype;
  settings_configuration jsonb;
  block_reason text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view payment details' using errcode = '42501';
  end if;

  select o.* into order_row from public.orders o where o.id = p_order_id and o.customer_id = auth.uid();
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if order_row.payment_method <> 'upi' then
    raise exception 'This order is not paid by UPI' using errcode = '22023';
  end if;

  select pr.* into payment_row
  from public.payment_records pr
  where pr.order_id = order_row.id and pr.payment_method = 'upi'
  order by pr.created_at desc
  limit 1;
  if not found then
    raise exception 'Payment record not found' using errcode = 'P0002';
  end if;

  select s.configuration into settings_configuration from public.store_settings s limit 1;
  settings_configuration := coalesce(settings_configuration, '{}'::jsonb);
  block_reason := public.customer_payment_proof_block_reason(order_row.order_status, payment_row.payment_status);

  return jsonb_build_object(
    'order_id', order_row.id,
    'order_number', order_row.order_number,
    'order_status', order_row.order_status,
    'order_total_inr', order_row.total_inr,
    'payment_id', payment_row.id,
    'payment_status', payment_row.payment_status,
    'amount_inr', payment_row.amount_inr,
    'transaction_reference', payment_row.transaction_reference,
    'payment_proof_path', payment_row.payment_proof_path,
    'submitted_at', case when payment_row.payment_status = 'verification_pending' then payment_row.updated_at else null end,
    'verified_at', payment_row.verified_at,
    'can_submit', block_reason is null,
    'block_reason', block_reason,
    'upi_enabled', case when settings_configuration ->> 'upi_enabled' in ('true', 'false') then (settings_configuration ->> 'upi_enabled')::boolean else true end,
    'upi_id', coalesce(settings_configuration ->> 'upi_id', ''),
    'upi_payee_name', coalesce(settings_configuration ->> 'upi_payee_name', ''),
    'upi_qr_url', nullif(settings_configuration ->> 'upi_qr_url', ''),
    'payment_instructions', coalesce(settings_configuration ->> 'payment_instructions', '')
  );
end;
$$;

revoke all on function public.get_customer_upi_payment_details(uuid) from public, anon;
grant execute on function public.get_customer_upi_payment_details(uuid) to authenticated;

create or replace function public.customer_submit_payment_proof(
  p_order_id uuid,
  p_reference text,
  p_proof_path text default null
)
returns public.payment_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.orders%rowtype;
  payment_row public.payment_records%rowtype;
  reference_value text;
  proof_value text;
  block_reason text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'customer'
  ) then
    raise exception 'An authenticated customer account is required' using errcode = '42501';
  end if;
  if p_order_id is null then
    raise exception 'An order is required' using errcode = '22023';
  end if;

  -- Transaction reference: required, plain text only.
  reference_value := nullif(trim(coalesce(p_reference, '')), '');
  if reference_value is null
     or length(reference_value) not between 6 and 100
     or reference_value !~ '^[A-Za-z0-9][A-Za-z0-9 _./:#-]*$' then
    raise exception 'Enter the transaction reference from your UPI app (6 to 100 letters, numbers or - _ . / : #)' using errcode = '22023';
  end if;

  -- Proof file: optional, but if given it must sit in the caller's own folder of the private payment-proofs bucket,
  -- have the exact name format the storefront generates, and actually exist in storage.
  proof_value := nullif(trim(coalesce(p_proof_path, '')), '');
  if proof_value is not null then
    if proof_value !~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$') then
      raise exception 'The payment proof must be a file you uploaded to your own payment-proofs folder' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects so where so.bucket_id = 'payment-proofs' and so.name = proof_value) then
      raise exception 'The payment proof file was not found. Please upload it again.' using errcode = 'P0002';
    end if;
  end if;

  -- Ownership is checked without a lock first, then the rows are locked in the same order the admin verification
  -- function uses (payment record, then order) so the two can never deadlock.
  select o.* into order_row from public.orders o where o.id = p_order_id and o.customer_id = auth.uid();
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select pr.* into payment_row
  from public.payment_records pr
  where pr.order_id = order_row.id and pr.payment_method = 'upi'
  order by pr.created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'This order has no UPI payment record' using errcode = '22023';
  end if;

  select o.* into order_row from public.orders o where o.id = order_row.id for update;
  if order_row.payment_method <> 'upi' then
    raise exception 'Only UPI orders accept a payment submission' using errcode = '22023';
  end if;

  block_reason := public.customer_payment_proof_block_reason(order_row.order_status, payment_row.payment_status);
  if block_reason is not null then
    raise exception '%', block_reason using errcode = '22023';
  end if;
  if payment_row.amount_inr <> order_row.total_inr then
    raise exception 'The recorded payment amount does not match the order total. Please contact support.' using errcode = '23514';
  end if;

  -- Re-sending exactly what is already recorded changes nothing (safe for retries and double clicks).
  if payment_row.payment_status = 'verification_pending'
     and payment_row.transaction_reference = reference_value
     and (proof_value is null or proof_value = payment_row.payment_proof_path) then
    return payment_row;
  end if;

  -- A bank reference identifies exactly one transaction, so it can back only one payment. The advisory lock makes two
  -- simultaneous submissions of the same reference serialise instead of both passing the check.
  perform pg_advisory_xact_lock(hashtextextended(lower(reference_value), 0));
  if exists (
    select 1 from public.payment_records pr
    where pr.id <> payment_row.id and lower(pr.transaction_reference) = lower(reference_value)
  ) then
    raise exception 'This transaction reference has already been used for another payment' using errcode = '23505';
  end if;
  if proof_value is not null and exists (
    select 1 from public.payment_records pr where pr.id <> payment_row.id and pr.payment_proof_path = proof_value
  ) then
    raise exception 'This proof file is already attached to another payment' using errcode = '23505';
  end if;

  update public.payment_records pr
  set payment_status = 'verification_pending',
      transaction_reference = reference_value,
      payment_proof_path = coalesce(proof_value, pr.payment_proof_path),
      verified_by = null,
      verified_at = null
  where pr.id = payment_row.id
  returning pr.* into payment_row;

  update public.orders o set payment_status = 'verification_pending' where o.id = order_row.id;

  return payment_row;
end;
$$;

revoke all on function public.customer_submit_payment_proof(uuid, text, text) from public, anon;
grant execute on function public.customer_submit_payment_proof(uuid, text, text) to authenticated;
