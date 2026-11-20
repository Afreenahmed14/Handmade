# CasaLoom collection marquee update

Updated the "Find your favourite little things" category section.

- Categories now move continuously from right to left in a seamless marquee.
- Hovering anywhere over the collection strip pauses the movement.
- Keyboard focus inside the strip also pauses the movement.
- Category images start slightly enlarged and zoom back to their natural size on hover.
- The strip remains responsive and respects reduced-motion accessibility preferences.
- Category data and product/category image lookup continue to come from the existing Supabase-backed `useCatalog` hook.

Files changed:
- `src/pages/Home/Home.tsx`
- `src/index.css`

No database, Supabase, authentication, product, payment, or order workflow changes.
