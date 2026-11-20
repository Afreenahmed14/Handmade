# TECHNICAL_DEBT.md

Severity: **H** fix before launch · **M** fix soon · **L** tidy when convenient. Nothing below blocks install, build or start.

| # | Sev | Item | Detail / suggested fix |
| --- | --- | --- | --- |
| 1 | H | **No tests** | No unit, integration or E2E tests, no test runner. The highest-value pure modules to cover first: `cartPricing.ts`, `shopStore.ts`, `checkout.ts` (`computeTotals`, `validateAddress`, `normalizePhone`), `orderStatus.ts`. |
| 2 | H | **Auth loading flicker risk** | `AuthContext` sets `loading = true` on every auth event; `ProtectedRoute` then unmounts its children. Could drop in-progress checkout input. Fix: only re-enter loading when the user id changes. Needs browser confirmation. |
| 3 | H | **`.env` was inside the supplied zip** | Not a secret-key leak (publishable key), but stop shipping it. Add a release script that zips from git, not from the working folder. |
| 4 | M | **Placeholder content on Home** | Three fake "Sample review" quotes and a non-functional mailing-list form. Conflicts with the "no mock/fake data" rule. Hide or wire up. |
| 5 | M | **Hand-written DB types** | `types/database.ts` is maintained by hand and can drift. Generate with `supabase gen types` after migrations are applied. |
| 6 | M | **Unused dependencies** | `zod`, `react-hook-form`, `@hookform/resolvers` are declared but never imported. They carry the only **high** `npm audit` finding (zod < 4.6.6). Either use them (Phase 1 forms) or remove them. Not removed here because they may be intended for upcoming work. |
| 7 | M | **`react-router-dom` advisory** | `npm audit`: moderate (react-router). Fix available within v6 range is worth checking; do not jump to v7 without a migration pass. |
| 8 | M | **Categories matched by name** | `Shop.tsx` / `Category.tsx` compare `product.category === category.name`. Renaming a category or two categories with similar names will mis-filter. Use `categoryId` (already mapped). |
| 9 | M | **Hard-coded nav categories** | `Header.tsx` links to four fixed slugs. If an admin renames or deletes them the links show "Category not found". Drive nav from the catalog. |
| 10 | M | **No pagination on catalog reads** | `getProducts` loads all published products and all their images. Supabase also caps rows per request (default 1,000). Add range queries when the catalog grows. |
| 11 | M | **No error boundary** | A render error in a lazy admin chunk or page white-screens the app. Add a top-level error boundary and `Suspense` error handling for chunk-load failures after a deploy. |
| 12 | M | **Dead/misplaced mock module** | `src/data/mock.ts` still exports sample `categories` and `products` (unused) and also `formatINR`, which 17 files import. Move `formatINR` to `utils/format.ts`; later remove the mock arrays. (Left untouched: you asked not to delete existing code.) |
| 13 | M | **Stale docs** | `docs/PRD.md` says "Phase 1b … mock data"; `DEPLOYMENT.md` says no admin UI exists; `README.md` is five lines; `DATABASE.md` omits migration `202611120001`. |
| 14 | M | **Empty Edge Function folders** | Seven placeholder dirs with no code or `config.toml`. Decide function by function: implement, or delete the folder, because the RPCs already cover stock, order creation and approval. |
| 15 | L | **Deployment gaps** | No SPA fallback (`public/.htaccess` or equivalent) though the README calls for it; no favicon, meta description or Open Graph tags; `public/` is empty. |
| 16 | L | **Tooling** | No ESLint, Prettier, `.editorconfig`, pre-commit or CI. No `typecheck`/`lint` scripts (build already runs `tsc -b`). |
| 17 | L | **Build artefacts in the archive** | `dist/` and `tsconfig.tsbuildinfo` are shipped; add `*.tsbuildinfo` to `.gitignore`. |
| 18 | L | **Mixed line endings** | Some files are CRLF (admin, services, auth) and others LF. Add `.gitattributes` (`* text=auto`) to stop noisy diffs. |
| 19 | L | **Accessibility** | Good baseline (roles, `aria-live`, focus ring, reduced motion). Not audited: colour contrast of `text-walnut/60` on cream, keyboard flow in admin tables, image alt text for uploaded product images. |
| 20 | L | **Bundle size** | Main chunk 484 kB (136 kB gzip), mostly React + Supabase client; acceptable. Admin is already code-split. |
| 21 | L | **Unused type members** | `Product.tag` allows `"new" | "best"` but the catalog mapper only ever produces `"featured"`. |

## `npm audit --omit=dev` (as of 14 Nov 2026)

| Package | Severity | Direct? | Note |
| --- | --- | --- | --- |
| zod | high | yes | Memory exhaustion on oversized collections. **Unused by the code.** `audit fix --force` would jump to zod 4 (breaking), not needed if removed. |
| react-router / react-router-dom | moderate | yes (v6.30.6) | Review the advisory text before upgrading. |

No change was made to dependencies.
