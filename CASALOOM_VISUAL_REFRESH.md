# CasaLoom visual refresh

Updated customer-facing presentation for:
- Shop All: floral backdrop, pastel plum/pink/lilac styling, category and filter panels, and product-card styling.
- Notifications: colourful notification cards and matching CasaLoom hero styling.
- Wishlist: colourful product cards, matching hero styling, and responsive layout.

Existing catalog, Supabase notification, wishlist, cart, pricing, and navigation logic has been retained.

## Run locally
1. Copy `.env.example` to `.env` and add your own Supabase values.
2. Run `npm install`.
3. Run `npm run dev`.
4. Run `npm run build` before deployment.

The archive intentionally excludes `.env`, `dist`, `.git`, and `node_modules`. Build output should be regenerated locally using your environment variables.
