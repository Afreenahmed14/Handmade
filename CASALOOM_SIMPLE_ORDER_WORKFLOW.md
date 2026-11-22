# CasaLoom simple customer order workflow

## Customer

1. Open **Personalised Gifts** and choose a product marked **Customizable** in Admin → Products.
2. Upload one JPEG, PNG or WebP photo (maximum 20 MB).
3. Select an enabled payment mode: UPI or Cash on Delivery.
4. Enter/confirm the delivery address and place the order.
5. UPI orders continue to the existing UPI payment page. COD orders go directly to order details.
6. The customer can review the order, see the attached photo, payment details, status and expected delivery under **My Orders** / **Track Order**.

## Admin

- **Products:** existing product CRUD, including the Customizable toggle and product images.
- **Customers:** existing customer directory and registered-customer count.
- **Orders:** complete order history, customer/product/payment details, private photo preview and download, expected delivery date, and status progression.
- Admin order status progression starts at Pending → Confirmed → Processing → Shipped → Out for Delivery → Delivered. There is no separate accept/reject step.

## Database

Apply the new migrations after the existing payment-hardening migration:

1. `202611220001_simple_customer_order_workflow.sql`
2. `202611220002_simple_photo_order_no_approval.sql`

The second migration replaces the previous draft's approval-based functions with `create_customer_photo_order` and `admin_set_order_expected_delivery_date`, extends the customer tracking response with expected delivery, and retires the approval/payment-after-approval RPCs. Existing orders, payment records, uploaded files, product records, customer accounts and historical quotation/custom-request rows are not deleted.

Photo files remain in the private `customization-uploads` bucket. Customer uploads are owner-scoped; admins use short-lived signed URLs for preview/download.

## Operational notes

- Product price, stock, shipping charge and enabled payment methods are still validated by the existing database order RPC.
- UPI remains manual: the customer submits payment details/proof and an admin verifies it. COD is recorded as due on delivery.
- Admin status confirmation deducts inventory using the existing atomic order-status RPC.
- Expected delivery is a manually entered date; no courier or automatic delivery prediction is configured.
- Apply and test migrations on staging first. Do not run unverified schema changes against production.
