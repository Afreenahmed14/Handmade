do $$ begin
  create type public.app_role as enum ('super_admin', 'staff', 'customer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.inventory_movement_type as enum ('in', 'out', 'adjustment');
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  mobile_number text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(trim(name)) > 0),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create unique index if not exists categories_slug_lower_unique on public.categories (lower(slug));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  sku text not null,
  description text not null default '',
  category_id uuid references public.categories(id) on delete set null,
  price_inr numeric(12,2) not null,
  discount_price_inr numeric(12,2),
  material text,
  colour text,
  stock_quantity integer not null default 0,
  is_customizable boolean not null default false,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank check (length(trim(name)) > 0),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_sku_not_blank check (length(trim(sku)) > 0),
  constraint products_price_nonnegative check (price_inr >= 0),
  constraint products_discount_valid check (discount_price_inr is null or (discount_price_inr >= 0 and discount_price_inr <= price_inr)),
  constraint products_stock_nonnegative check (stock_quantity >= 0)
);

create unique index if not exists products_slug_lower_unique on public.products (lower(slug));
create unique index if not exists products_sku_lower_unique on public.products (lower(sku));
create index if not exists products_category_id_idx on public.products (category_id);
create index if not exists products_published_created_idx on public.products (is_published, created_at desc);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  display_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint product_images_order_nonnegative check (display_order >= 0)
);

create index if not exists product_images_product_order_idx on public.product_images (product_id, display_order);
create unique index if not exists product_images_one_primary_per_product on public.product_images (product_id) where is_primary;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_type text not null,
  variant_name text not null,
  additional_price_inr numeric(12,2) not null default 0,
  stock_quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_price_nonnegative check (additional_price_inr >= 0),
  constraint product_variants_stock_nonnegative check (stock_quantity >= 0),
  constraint product_variants_name_not_blank check (length(trim(variant_name)) > 0)
);

create index if not exists product_variants_product_idx on public.product_variants (product_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint inventory_movements_quantity_positive check (quantity > 0),
  constraint inventory_movements_reason_not_blank check (length(trim(reason)) > 0)
);

create index if not exists inventory_movements_product_created_idx on public.inventory_movements (product_id, created_at desc);

create table if not exists public.store_settings (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  contact_email text,
  contact_phone text,
  currency text not null default 'INR' check (currency = 'INR'),
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_settings_name_not_blank check (length(trim(store_name)) > 0)
);

create unique index if not exists store_settings_singleton on public.store_settings ((true));

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required_role
  );
$$;

revoke all on function public.has_role(public.app_role) from public;
grant execute on function public.has_role(public.app_role) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''));
  insert into public.user_roles (user_id, role) values (new.id, 'customer')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, full_name, email)
select id, coalesce(raw_user_meta_data ->> 'full_name', ''), coalesce(email, '')
from auth.users
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select id, 'customer' from auth.users
on conflict (user_id) do nothing;

create or replace function public.record_inventory_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stock_delta integer;
begin
  if tg_op = 'INSERT' and new.stock_quantity > 0 then
    insert into public.inventory_movements (product_id, movement_type, quantity, reason, created_by)
    values (new.id, 'in', new.stock_quantity, 'Initial stock', auth.uid());
  elsif tg_op = 'UPDATE' and new.stock_quantity <> old.stock_quantity then
    stock_delta := new.stock_quantity - old.stock_quantity;
    insert into public.inventory_movements (product_id, movement_type, quantity, reason, created_by)
    values (
      new.id,
      case when stock_delta > 0 then 'in'::public.inventory_movement_type else 'out'::public.inventory_movement_type end,
      abs(stock_delta),
      'Product stock updated',
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_record_inventory_change on public.products;
create trigger products_record_inventory_change
  after insert or update of stock_quantity on public.products
  for each row execute function public.record_inventory_change();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at before update on public.store_settings for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists "profiles_read_self_or_super_admin" on public.profiles;
create policy "profiles_read_self_or_super_admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('super_admin'));
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "user_roles_read_self_or_super_admin" on public.user_roles;
create policy "user_roles_read_self_or_super_admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role('super_admin'));

drop policy if exists "categories_read_active" on public.categories;
create policy "categories_read_active" on public.categories for select to anon, authenticated using (is_active);
drop policy if exists "categories_super_admin_manage" on public.categories;
create policy "categories_super_admin_manage" on public.categories for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

drop policy if exists "products_read_published" on public.products;
create policy "products_read_published" on public.products for select to anon, authenticated using (is_published);
drop policy if exists "products_super_admin_manage" on public.products;
create policy "products_super_admin_manage" on public.products for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

drop policy if exists "product_images_read_published" on public.product_images;
create policy "product_images_read_published" on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
drop policy if exists "product_images_super_admin_manage" on public.product_images;
create policy "product_images_super_admin_manage" on public.product_images for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

drop policy if exists "product_variants_read_published" on public.product_variants;
create policy "product_variants_read_published" on public.product_variants for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
drop policy if exists "product_variants_super_admin_manage" on public.product_variants;
create policy "product_variants_super_admin_manage" on public.product_variants for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

drop policy if exists "inventory_movements_super_admin_read" on public.inventory_movements;
create policy "inventory_movements_super_admin_read" on public.inventory_movements for select to authenticated
  using (public.has_role('super_admin'));

drop policy if exists "store_settings_super_admin_manage" on public.store_settings;
create policy "store_settings_super_admin_manage" on public.store_settings for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, mobile_number, address_line1, address_line2, city, state, postal_code, country)
  on public.profiles to authenticated;
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
grant select on public.categories, public.products, public.product_images, public.product_variants to anon, authenticated;
grant insert, update, delete on public.categories, public.products, public.product_images, public.product_variants to authenticated;
grant select on public.inventory_movements to authenticated;
grant select, insert, update, delete on public.store_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('category-images', 'category-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('homepage-banners', 'homepage-banners', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('customization-uploads', 'customization-uploads', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public_read_product_category_banner_images" on storage.objects;
create policy "public_read_product_category_banner_images" on storage.objects for select to public
  using (bucket_id in ('product-images', 'category-images', 'homepage-banners'));

drop policy if exists "super_admin_manage_public_images" on storage.objects;
create policy "super_admin_manage_public_images" on storage.objects for all to authenticated
  using (bucket_id in ('product-images', 'category-images', 'homepage-banners') and public.has_role('super_admin'))
  with check (bucket_id in ('product-images', 'category-images', 'homepage-banners') and public.has_role('super_admin'));

drop policy if exists "owner_manage_private_uploads" on storage.objects;
create policy "owner_manage_private_uploads" on storage.objects for all to authenticated
  using (
    bucket_id in ('customization-uploads', 'payment-proofs')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('customization-uploads', 'payment-proofs')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "super_admin_read_private_uploads" on storage.objects;
create policy "super_admin_read_private_uploads" on storage.objects for select to authenticated
  using (bucket_id in ('customization-uploads', 'payment-proofs') and public.has_role('super_admin'));