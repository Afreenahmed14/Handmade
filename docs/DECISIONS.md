# Phase 7 cleanup: decisions and findings

Date: 2026-11-14. Scope: final development cleanup. No migration was applied and no production data was touched.

## Code cleanup
| Item | Decision |
| --- | --- |
| `formatINR` | Moved to `src/utils/currency.ts`; all 19 imports updated. Output unchanged (`₹` + `en-IN` grouping). |
| `src/data/mock.ts` | Deleted. Before deleting, every import of it was checked: all 19 imported only `formatINR`; the sample `categories` and `products` arrays were not used anywhere. The empty `src/data` and `src/pages/CustomizeProduct` folders were removed too. |
| Fake reviews on Home | Removed (they were labelled "Sample review"). There is no reviews feature or table; do not re-add until one exists. |
| Newsletter form | **Removed.** It never sent anything (`preventDefault` only). There is no subscribers table, Edge Function or email provider, so a working form would need a new backend and a privacy decision. Honest removal chosen over a fake or disabled form. |
| Header category links | Now built from active categories (`useActiveCategories`, same `getCategories()` source and cache as the rest of the storefront): Shop, the first six categories, and "More" when there are more. Nothing is shown for categories until they load. The old hardcoded Lighting / Wall Decor / Paintings / Furniture links could 404 if an admin renamed or deactivated those categories. |
| Home hero "See lighting" button | Hardcoded `/category/lighting`; now links to the first active category, or is hidden when there are none. |
| Category matching | `/category/:slug` matched products by category **name**; now by `categoryId`. (Shop already used ids from Phase 6.) Renaming a category can no longer break its page. |
| `Stub` page | Removed. The only remaining use was the 404 route, which said "This page is built in no phase". Replaced by `NotFound`. There are no placeholder routes left: `customize/:slug` was the last stub and was built in Phase 5A. |
| Edge Function folders | See `supabase/functions/README.md`. Seven empty folders removed; decisions documented there. |
| Error boundary | `src/components/common/ErrorBoundary.tsx`, wrapped around the whole app in `main.tsx`. Limits: it catches rendering errors only (not event handlers or async code), and it cannot catch the start-up error thrown by `src/lib/supabase.ts` when `.env` is missing or wrong, because that happens before React renders. |
| Customer order confirmation | `CheckoutSuccess` used the admin-shaped `getOrderDetail` (which selects `orders.*`, status-history reasons and payment verification fields). It now uses the customer-safe `getMyOrderDetail`. See SECURITY.md. |
| Login redirect | Also rejects destinations containing a backslash (hardening related to the react-router advisory below). |

## Dependencies
| Package | Decision |
| --- | --- |
| `zod`, `react-hook-form`, `@hookform/resolvers` | **Removed**: no imports anywhere in `src/`. This also removes the `zod` high-severity advisory (memory exhaustion on oversized collections). |
| `postcss`, `autoprefixer`, `tailwindcss` | Kept: used through `postcss.config.js` / `tailwind.config.js`. |
| `@types/react`, `@types/react-dom` | Kept: needed by the TypeScript build. |
| `vite` (high, 8 advisories) and `esbuild` (moderate) | **Not changed.** All advisories affect the development server only (path traversal / file serving / cross-origin requests while `npm run dev` is running, and Windows-only `launch-editor` issues). They do not affect the built `dist/` site. The only fix is Vite 8, a major upgrade of the toolchain (and `@vitejs/plugin-react`) that cannot be verified from a build alone. Until upgraded: run the dev server only on a trusted network and don't browse untrusted sites while it runs. |
| `react-router` / `react-router-dom` (moderate) | **Not changed.** The fix is v7 (major). The open-redirect advisory concerns navigating to attacker-controlled URLs; this app only links and navigates to paths it builds itself, and the one user-influenced destination (login `from`) is validated and now also rejects backslashes. The other advisory is for server-side-rendering hydration, which this app does not use. Schedule the v7 upgrade as its own tested change. |

Result of `npm audit` after cleanup: 4 findings (3 moderate, 1 high), all in the dev toolchain or in an unused router code path; previously 5 (including `zod` high).

## Site metadata
| Item | Decision |
| --- | --- |
| `index.html` | Added meta description, theme colour, Open Graph/Twitter basics, favicon link and a `<noscript>` message. No `og:image` because no real brand image exists; do not add a stand-in. |
| Favicon | `public/favicon.svg`, a simple original brass-lamp mark in the site colours. Replace with the real logo when available. |
| `robots.txt` | Added; blocks account, checkout, order, request and admin paths. |
| Sitemap | **Not generated.** A valid sitemap needs the production domain (unknown here) and the live product list, so a static file would be wrong or stale. Generate it at deploy time from public Supabase data, or add a small build script once the domain is fixed (optional work, below). Then add a `Sitemap:` line to `robots.txt`. |
| SPA fallback | `public/.htaccess` (Apache, as used by Hostinger) rewrites unknown paths to `index.html`; Vite copies it into `dist/`. For Nginx: `try_files $uri /index.html;`. For Vercel/Netlify: a catch-all rewrite to `/index.html`. |
| Per-page titles | Not added (all pages share one title). Optional improvement. |

## Repository hygiene
`.gitattributes` added (LF normalisation, binary types). `.gitignore` now ignores `.env.*` (except `.env.example`) and `*.tsbuildinfo`; the stray `tsconfig.tsbuildinfo` was deleted.

## Remaining optional features (not built, not needed for the current scope)
Newsletter/mailing list; product reviews; order/request email or SMS notifications; carrier tracking integration; admin reject-payment action; customer replies on custom requests; server-side product search for very large catalogs; sitemap generation; per-page titles; mobile category navigation (the header category links are hidden on small screens, as before; categories are reachable through Shop filters); Vite 8 and React Router 7 upgrades; the payment-records hardening in `docs/proposals/`.
