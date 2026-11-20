# Product scope

Customer-facing store plus a super-admin console for a vintage home-décor and appliance shop. All data comes from Supabase; there is no sample data.

## Customer features
Browse and search (name, SKU, description, category) with category, price, availability and customizable filters and five sort orders; product details; cart and wishlist (kept on the device, re-priced from the live catalog); registration and login by email/password or phone OTP; checkout with cash on delivery or UPI; UPI payment-proof submission; order history and tracking; customization requests with reference images and a "My requests" page showing status and replies.

## Admin features (super admin only)
Dashboard analytics; product, category and inventory management; customer directory; order management (status, payment verification, returns, shipments); coupons; payment overview; custom-request handling (status, internal notes, replies); store settings (identity, shipping, payment methods, UPI details, maintenance mode).

## Out of scope (not built)
Online payment gateway, refunds, email/SMS notifications, carrier integrations and tracking webhooks, product reviews, mailing list, staff permissions (the `staff` role has no extra access). See `docs/DECISIONS.md`.
