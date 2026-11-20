# Supabase Edge Functions

There are currently **no Edge Functions** in this project, and none are required for the features that are built.
Seven empty placeholder folders (each holding only a `.gitkeep`) were removed in Phase 7 because every one of them was
either already implemented as a database function (RPC) or needs an external service that has not been chosen.

| Former placeholder | Decision | Where the behaviour lives / what is missing |
| --- | --- | --- |
| `create-order` | Not needed | `create_customer_order` / `create_customer_order_with_coupon` RPCs (atomic, idempotent, prices derived server-side). |
| `verify-order-stock` | Not needed | Stock is checked inside `create_customer_order` and deducted atomically on confirmation by `admin_update_order_status` via `adjust_inventory_stock`. |
| `approve-upi-payment` | Not needed | `admin_verify_order_payment` RPC (super admin only). |
| `reject-upi-payment` | Not built | There is no reject action in the schema; a customer may resubmit while a payment is pending. If wanted, add an `admin_reject_order_payment` RPC (a migration), not an Edge Function. |
| `create-shipment` | Not needed | Shipments are entered manually through `admin_update_order_shipment`. A carrier API integration would need a chosen carrier and its credentials. |
| `tracking-webhook` | Deferred | Needs a carrier that sends webhooks, a shared secret and a signature check. Build it together with a carrier integration. |
| `send-order-notification` | Deferred | Needs an email or SMS provider and its API key (Function secret). No provider is configured, so no notification is sent today. |

Rules for adding one later: keep secrets (service-role key, provider keys) in Supabase Function secrets only, never in
`VITE_` variables or source; verify the caller (JWT or webhook signature) before doing anything; prefer a database RPC
when the work is only database logic.
