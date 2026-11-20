# The Vintage Home

Home-appliance and décor e-commerce storefront with an admin console. React 18 + Vite + TypeScript + Tailwind on the front end; Supabase (Postgres, Auth, Storage, row-level security and SQL functions) as the only back end. There is no separate server and no Edge Functions.

## Run

```
npm install
cp .env.example .env.local   # then fill in the Supabase URL and publishable key
npm run dev
npm run build                # type-check + production build into dist/
```

## What is built

- **Storefront:** home, shop with search and filters, category pages, product details, cart and wishlist, customer registration/login (email or phone OTP), profile.
- **Orders:** checkout (COD or UPI), UPI payment-proof upload, My Orders, order tracking.
- **Custom requests:** `/customize/:slug` submission with private reference images, and `/my-requests` to follow status and team replies.
- **Admin (`/admin`, super admin only):** dashboard, products, categories, inventory, customers, orders (including shipment details), coupons, payments, custom requests, settings.

## Project map

- `src/pages`, `src/components`, `src/admin`: UI. `src/services`: all Supabase access. `src/utils`: shared helpers (currency, order status, request status).
- `supabase/migrations`: the 12 SQL migrations (see `docs/DATABASE.md`).
- `docs/`: `PRD.md` (scope), `DATABASE.md`, `API.md`, `SECURITY.md`, `DEPLOYMENT.md`, `DECISIONS.md` (cleanup decisions, advisories, optional work), `proposals/` (unapplied SQL).

## Deploy

See `docs/DEPLOYMENT.md`. Short version: set the two `VITE_` variables, `npm run build`, upload `dist/`, make sure the SPA fallback (`.htaccess` is included) is active.

## Backend migration recovery

Before applying database changes, read `CASALOOM_BACKEND_RECOVERY_AND_RELEASE.md` and run the read-only `supabase/verification/backend_preflight.sql` against a staging project. The order-management migration depends on the inventory-management migration; do not apply `202611110003_order_management.sql` before `202611110001_phase_inventory_management.sql`.
