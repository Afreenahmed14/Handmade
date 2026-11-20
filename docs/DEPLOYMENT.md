# Supabase Setup and Deployment

## Local frontend

1. Copy `.env.example` to `.env.local` and fill in the Supabase **Project URL** and **Publishable key** (Project Settings → API Keys). Never use a secret or service-role key; the client refuses to start with one.
2. `npm install`, then `npm run dev`.
3. `npm run build` type-checks and produces `dist/`.

`.env` and `.env.local` are ignored by Git; `.env.example` is only a blank template. Vite bakes the two `VITE_` values into the bundle at build time, so build with the right values for the target environment.

## Database and Storage

Apply the 12 migrations in `supabase/migrations/` in the order listed in `docs/DATABASE.md`, after checking the project's migration history (do not re-run applied ones). The first migration creates the five buckets:

| Bucket | Access | Use |
| --- | --- | --- |
| `product-images` | Public read, super-admin write | Product photos |
| `category-images` | Public read, super-admin write | Category photos |
| `homepage-banners` | Public read, super-admin write | Store logo and UPI QR image |
| `customization-uploads` | Private; owner folder and super-admin read | Customer reference images |
| `payment-proofs` | Private; owner folder and super-admin read | UPI payment proof files |

Promote the first administrator with the SQL in `docs/DATABASE.md` (there is no admin sign-up page).

## Authentication configuration

- **Email/password:** enable the Email provider, set the site URL and add the exact redirect URLs (`http://localhost:5173/profile` and `https://YOUR_DOMAIN/profile`). Decide whether email confirmation is required.
- **Phone OTP:** enable the Phone provider and an SMS provider with rate limits; it does not work until that is configured.
- Never accept a role from registration metadata or the browser.

## Hosting the built site (static)

Upload the contents of `dist/` to the web root (for example Hostinger `public_html`).

- **SPA fallback is required**, otherwise reloading `/shop` or opening `/product/...` directly returns 404. `public/.htaccess` is copied into `dist/` and handles Apache. Nginx: `try_files $uri /index.html;`. Vercel/Netlify: rewrite everything to `/index.html`.
- `public/robots.txt` and `public/favicon.svg` are copied too. Check the hidden `.htaccess` was uploaded (some FTP clients skip dotfiles).
- Serve over HTTPS only.
- **Sitemap:** none yet; needs the production domain and the live product list (see `docs/DECISIONS.md`). After adding one, add a `Sitemap:` line to `robots.txt`.

## Edge Functions

None are used. See `supabase/functions/README.md`.

## Pre-launch checklist

- Auth redirect allowlist, email-confirmation policy and SMS provider verified.
- Database backups enabled; bucket size/MIME limits reviewed.
- RLS verified as anonymous, customer and super admin (steps in `docs/DATABASE.md` and the verification notes of migrations 11 and 12).
- Decide on the payment-records hardening proposal (`docs/SECURITY.md`).
- Open the deployed site, a product page via direct URL, and `/admin` once.
- Store settings filled in (name, contact details, UPI ID/QR, delivery text); maintenance mode off.
