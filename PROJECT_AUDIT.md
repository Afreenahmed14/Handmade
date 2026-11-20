# PROJECT_AUDIT.md — Vintage Home, Phase 0

Audit date: 14 Nov 2026 · Scope: `vintage-home.zip` (complete project). `src.zip` and `supabase.zip` were also received; both are **byte-identical** to `src/` and `supabase/` inside the full archive (verified with `diff -r`), so the full archive is the single source of truth.

## 1. Verdict

| Question | Answer |
| --- | --- |
| Can it be installed? | **Yes.** `npm ci` succeeds from the committed lockfile (150 packages, lockfile unchanged afterwards). |
| Does it type-check? | **Yes.** `tsc -b` reports 0 errors under `strict: true`. |
| Does it build? | **Yes.** `npm run build` succeeds (`✓ built in 6.6s`), 1 entry chunk of 484 kB (136 kB gzip) plus lazy chunks. |
| Does it start? | **Yes.** `vite` dev server returns HTTP 200 for `/`, `/src/main.tsx`, `/shop` and `/src/routes/index.tsx`. |
| Startup blockers found | **None.** No configuration or code change was necessary. |
| Is it proven against a live backend? | **No.** Nothing here has been run against Supabase. Everything that touches the database is "Requires live integration testing". |

Nothing in the project was modified. The only additions are these six audit documents.

## 2. What was inspected

| Area | Result |
| --- | --- |
| Root config | `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `.env.example`, `.gitignore`, `README.md`, `docs/*.md` — all present and consistent with the code. |
| `src/` | 71 TS/TSX files, 8,066 lines: 10 admin modules (+ layout and a shipment sub-panel), 16 customer page files, 13 components, 3 contexts, 16 service files, utilities, types. |
| `supabase/migrations` | 12 SQL files, about 3,000 lines. |
| `supabase/functions` | 7 directories, **all empty** (no `index.ts` in any). |
| `dist/` and `.env` in the archive | Stale build output (11 Nov) and a real `.env`. Neither was used (see §6). |

## 3. Frontend architecture (verified)

- **Stack:** React 18.3, React Router 6.30, Vite 5.4, TypeScript 5.9 (strict), Tailwind 3.4, `@supabase/supabase-js` 2.119, `lucide-react`. Matches your brief.
- **Shape:** single-page app, no separate API server. Browser → one typed Supabase client (`src/lib/supabase.ts`) → Postgres RLS and `SECURITY DEFINER` RPCs. All privileged writes go through RPCs.
- **Provider order** (`main.tsx`): `BrowserRouter › StoreSettingsProvider › AuthProvider › CartProvider › App`.
- **Routing** (`routes/index.tsx`): `/admin/*` guarded by `ProtectedRoute roles=["super_admin"]`; customer routes under `CustomerLayout`; account/checkout/orders routes guarded by `ProtectedRoute`. Admin and checkout/order pages are lazy-loaded.
- **Services:** nearly all data access goes through `src/services/*`. The exceptions that import the client directly are `AuthContext.tsx` (role lookup), `pages/Profile/Profile.tsx` (profile read/update) and `admin/Coupons/Coupons.tsx`. Cart and wishlist live in `services/shopStore.ts` (a `useSyncExternalStore` store over `localStorage`, per-owner, guest lists merge on sign-in). Prices are always re-resolved from the live catalog, never trusted from storage.
- **Maintenance mode** is enforced in `CustomerLayout`, with `/login` and `/verify-otp` left open so an admin can still sign in.
- **Theme:** brass/walnut/cream/espresso/olive/rose palette, Cormorant Garamond / Playfair Display / Lato, `animate-glow`. Every custom token used in the code is defined in `tailwind.config.js` (checked).

## 4. Integrity checks run

| Check | Result |
| --- | --- |
| Relative imports resolving | 0 unresolved. |
| External packages imported vs declared | `react`, `react-dom`, `react-router-dom`, `lucide-react`, `@supabase/supabase-js` — all declared. |
| Declared but never imported | `zod`, `react-hook-form`, `@hookform/resolvers` (see TECHNICAL_DEBT). |
| Tables / views the frontend reads | 21 names, all exist in migrations. |
| RPCs the frontend calls | 21, all exist; argument names match the SQL signatures (script check; the two order-creation RPCs build their args from a shared object, `create_customer_order` was confirmed by reading it, the coupon variant by name only). |
| Storage buckets used by the frontend | 5 of 5 defined in migration `…0001` with matching public/private flags. |
| Environment variables | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, read in one place. The client refuses `sb_secret_*` and `service_role` keys. |
| Secrets in source | None. (The only `service_role` strings in `src/` are the guard that rejects it.) |
| Duplicate implementations | None of consequence. `formatINR` is imported from `data/mock.ts` in 17 files (misplaced, not duplicated). `data/mock.ts`'s `categories`/`products` arrays are dead code. |
| Placeholder screens | One route stub (`/customize/:slug`) and a "Page not found" that reuses the same stub component. |

## 5. Existing features that must not be rewritten

Cart/wishlist store and pricing (`shopStore.ts`, `cartPricing.ts`, `CartContext.tsx`); checkout including idempotency keys, address/region validation and coupon revalidation (`checkout.ts`, `Checkout.tsx`); UPI payment-proof flow (`paymentProof.ts`, `UpiPaymentPanel.tsx`, `PaymentProofPreview.tsx`); customer order list/detail/tracking; storefront settings context and maintenance mode; the supabase client guardrails; every admin module; and all 12 migrations (additive, with RLS and `search_path` set). Details are in EXISTING_FEATURES.md.

## 6. Security findings (act on these)

1. **A real `.env` is inside the zip you uploaded.** It contains a project URL and a publishable key (not a secret/service-role key, which I checked by prefix without printing it). A publishable key is designed to be public, so this is not a breach, but do not share archives containing `.env`, and confirm RLS is complete, because RLS is the only protection that key has. `.env` is correctly gitignored. The working copy I used and the zip I return **exclude it**.
2. **Known exposure, documented by you in `docs/SECURITY.md`:** a customer calling the API directly can read `payment_records.verification_note` and `verified_by` for their own payments. Fix later with a customer-safe view.
3. `public_store_settings` is a view readable by anonymous users; UPI details are deliberately kept out of it (good), but the UPI QR image lives in a public bucket by design.
4. `npm audit --omit=dev`: 3 findings (see TECHNICAL_DEBT). None is exploitable from the current code paths; the high one is in `zod`, which the code does not use.

## 7. What I could not verify

No Supabase project, database or Auth provider was available. Therefore unverified: migration application state (only `…0001` is reported applied, by `docs/DEPLOYMENT.md`), RLS behaviour, RPC runtime behaviour, storage policies, email/SMS Auth providers, and anything rendered in a real browser (I did not run a browser; I verified compile, bundle and HTTP serving only).

## 8. Environment notes

Node 22.23.4, npm 10.9.9. Commands are listed in the final report. No Windows-specific issue found (the project mixes CRLF and LF line endings across files; harmless, see TECHNICAL_DEBT).
