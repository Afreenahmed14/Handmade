-- Phase 1 (personalised photo products): additive only. NOT applied to any environment.
-- Adds one 1:1 settings table beside public.products. products, custom_requests and every RPC are untouched.
-- Selected options travel to admins inside the existing custom_requests.requirements JSON (no RPC change).

create table if not exists public.product_personalization (
  product_id uuid primary key references public.products(id) on delete cascade,
  is_enabled boolean not null default false,
  product_type text not null default 'other',
  printing_area_label text,
  print_width_mm numeric(8,2),
  print_height_mm numeric(8,2),
  available_sizes text[] not null default '{}',
  available_colours text[] not null default '{}',
  available_materials text[] not null default '{}',
  allowed_image_formats text[] not null default '{jpeg,png,webp}',
  min_image_width_px integer,
  min_image_height_px integer,
  max_image_size_mb integer not null default 10,
  max_images integer not null default 5,
  image_notes text,
  quotation_required boolean not null default true,
  base_price_inr numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_personalization_type_valid check (
    product_type in ('photo_mug','water_bottle','plate','photo_frame','cushion','keychain','other')
  ),
  constraint product_personalization_area_label_length check (printing_area_label is null or length(printing_area_label) <= 200),
  constraint product_personalization_print_size_positive check (
    (print_width_mm is null or print_width_mm > 0) and (print_height_mm is null or print_height_mm > 0)
  ),
  constraint product_personalization_option_limits check (
    cardinality(available_sizes) <= 30 and cardinality(available_colours) <= 30 and cardinality(available_materials) <= 30
  ),
  constraint product_personalization_formats_valid check (
    cardinality(allowed_image_formats) >= 1 and allowed_image_formats <@ array['jpeg','png','webp']::text[]
  ),
  constraint product_personalization_min_pixels_positive check (
    (min_image_width_px is null or min_image_width_px > 0) and (min_image_height_px is null or min_image_height_px > 0)
  ),
  constraint product_personalization_max_size_range check (max_image_size_mb between 1 and 10),
  constraint product_personalization_max_images_range check (max_images between 1 and 10),
  constraint product_personalization_notes_length check (image_notes is null or length(image_notes) <= 1000),
  constraint product_personalization_price_nonnegative check (base_price_inr is null or base_price_inr >= 0),
  constraint product_personalization_price_or_quote check (quotation_required or base_price_inr is not null)
);

create index if not exists product_personalization_enabled_idx on public.product_personalization (product_type) where is_enabled;

drop trigger if exists product_personalization_set_updated_at on public.product_personalization;
create trigger product_personalization_set_updated_at
  before update on public.product_personalization for each row execute function public.set_updated_at();

-- The existing customisation form and create_customer_custom_request RPC are gated on products.is_customizable.
-- Enabling personalisation therefore keeps that flag on. Disabling never switches it off (a product may still
-- be customisable in the ordinary, non-photo sense), so the admin decides that separately.
create or replace function public.sync_personalised_product_customizable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_enabled then
    update public.products set is_customizable = true where id = new.product_id and not is_customizable;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_personalised_product_customizable() from public, anon, authenticated;

drop trigger if exists product_personalization_sync_customizable on public.product_personalization;
create trigger product_personalization_sync_customizable
  after insert or update of is_enabled on public.product_personalization
  for each row execute function public.sync_personalised_product_customizable();

alter table public.product_personalization enable row level security;

drop policy if exists "product_personalization_read_published" on public.product_personalization;
create policy "product_personalization_read_published" on public.product_personalization for select to anon, authenticated
  using (is_enabled and exists (select 1 from public.products p where p.id = product_id and p.is_published));

drop policy if exists "product_personalization_super_admin_manage" on public.product_personalization;
create policy "product_personalization_super_admin_manage" on public.product_personalization for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

revoke all on public.product_personalization from anon, authenticated;
grant select on public.product_personalization to anon, authenticated;
grant insert, update, delete on public.product_personalization to authenticated;
