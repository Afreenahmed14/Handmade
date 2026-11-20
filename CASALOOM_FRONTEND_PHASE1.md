# CasaLoom — Customer Storefront Phase 1

## Implemented
- Rebranded the customer-facing storefront to CasaLoom.
- Applied the approved palette: Deep Plum `#581A45`, Dusty Blue `#607D8B`, Soft Lavender `#E9E1EA`, Warm Ivory `#F8F6F5`, Charcoal `#25232A`, and White `#FFFFFF`.
- Reworked the home page with an editorial hero, dynamic category collections, catalog-backed featured product filtering, service-benefit strip, and campaign banner.
- Added a generated living-room hero image at `public/images/casloom-hero.png`.
- Redesigned the responsive header, search panel, mobile navigation, product cards, category art, and footer.
- Updated page metadata, favicon, and customer-facing document title.
- Preserved existing routes, catalog hooks, Supabase calls, cart/wishlist actions, product customisation links, account links, and checkout logic.
- Retained legacy Tailwind colour aliases so existing pages continue to use the new brand palette without mass-editing every module.

## Validation
- `npm run build` could not be completed in this environment because dependencies were not installed and `npm ci` timed out while accessing the package registry. A subsequent offline install confirmed the required package tarballs were not cached.
- No Supabase migrations, production data, or deployment actions were performed.
- Browser/mobile visual QA remains to be done after installing dependencies and starting the Vite dev server.

## Files changed
- `tailwind.config.js`
- `src/index.css`
- `src/pages/Home/Home.tsx`
- `src/components/layout/Header.tsx`
- `src/components/layout/Footer.tsx`
- `src/components/products/ProductCard.tsx`
- `src/components/common/ProductArt.tsx`
- `src/context/StoreSettingsContext.tsx`
- `index.html`
- `public/favicon.svg`
- `public/images/casloom-hero.png`
