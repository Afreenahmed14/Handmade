import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Tag, X } from "lucide-react";
import AddressFields from "../../components/checkout/AddressFields";
import ProductArt from "../../components/common/ProductArt";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { formatINR } from "../../utils/currency";
import { buildCartSummary } from "../../services/cartPricing";
import { validateCustomerCoupon } from "../../services/coupons";
import {
  CheckoutAbort, cleanAddress, clearAttemptKey, computeTotals, emptyAddress, friendlyOrderError, getAttemptKey, getCheckoutProfile,
  orderFingerprint, placeOrder, saveCheckoutProfile, validateAddress,
  type AddressErrors, type CheckoutProfile, type ShippingAddress,
} from "../../services/checkout";
import type { PaymentMethod } from "../../types/database";

interface AppliedCoupon { code: string; discount: number }
type Notice = { ok: boolean; text: string } | null;

function Status({ children }: { children: string }) {
  return <section className="container-x py-24 text-center"><p role="status" className="text-walnut/70">{children}</p></section>;
}

export default function Checkout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { cartItems, products, productsLoading, productsError, loadProducts, clearCart } = useCart();
  const { settings, loading: settingsLoading, error: settingsError, deliveryRules, reload: reloadSettings } = useStoreSettings();

  const [address, setAddress] = useState<ShippingAddress>(emptyAddress);
  const [errors, setErrors] = useState<AddressErrors>({});
  const [profile, setProfile] = useState<CheckoutProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [saveAddress, setSaveAddress] = useState(true);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [note, setNote] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [applied, setApplied] = useState<AppliedCoupon | null>(null);
  const [couponNotice, setCouponNotice] = useState<Notice>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [completed, setCompleted] = useState(false);
  const submitLock = useRef(false);

  // Delivery rules: unknown (null) only when the settings could not be read; a store with no settings row yet charges nothing.
  const rules = deliveryRules ?? (settingsError ? null : { shippingCharge: 0, freeThreshold: null });

  // Prices and stock are never trusted from storage: refresh them once when checkout opens.
  const ids = useMemo(() => cartItems.map((line) => line.productId), [cartItems]);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  useEffect(() => { void loadProducts(idsRef.current, { force: true }); }, [loadProducts]);

  const summary = useMemo(() => buildCartSummary(cartItems, products), [cartItems, products]);
  const items = useMemo(() => summary.lines.filter((line) => line.status === "ok" || line.status === "adjusted").map((line) => ({ productId: line.productId, quantity: line.quantity })), [summary.lines]);
  const itemsKey = items.map((item) => `${item.productId}:${item.quantity}`).join(",");
  const unresolved = summary.lines.some((line) => line.status === "unverified");

  // Prefill from the customer's profile.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void getCheckoutProfile(user.id).then((loaded) => {
      if (!active) return;
      setProfile(loaded);
      setAddress(loaded.address);
    }).catch((reason: unknown) => {
      if (!active) return;
      setProfileError(reason instanceof Error ? reason.message : "Unable to load your saved details.");
      setProfile({ address: emptyAddress, hasName: false });
    });
    return () => { active = false; };
  }, [user]);

  // Payment methods come from the store settings.
  const methods = useMemo(() => [
    { id: "cod" as const, label: "Cash on delivery", help: "Pay in cash when your order arrives.", enabled: settings.cod_enabled },
    { id: "upi" as const, label: "UPI", help: "Pay by UPI after you place the order.", enabled: settings.upi_enabled },
  ].filter((option) => option.enabled), [settings.cod_enabled, settings.upi_enabled]);
  useEffect(() => {
    if (!methods.some((option) => option.id === method)) setMethod(methods[0]?.id ?? null);
  }, [methods, method]);

  // The coupon is re-checked whenever the cart contents change, so the discount shown is never stale.
  const validatedFor = useRef("");
  useEffect(() => {
    if (!applied || !items.length || validatedFor.current === `${applied.code}|${itemsKey}`) return;
    let active = true;
    void validateCustomerCoupon(applied.code, items).then((result) => {
      if (!active) return;
      validatedFor.current = `${applied.code}|${itemsKey}`;
      if (result.valid && result.discount_inr !== undefined) setApplied({ code: applied.code, discount: result.discount_inr });
      else { setApplied(null); setCouponNotice({ ok: false, text: `Coupon ${applied.code} was removed: ${result.message}` }); }
    }).catch(() => { /* keep the last known discount; the order is re-validated when it is placed */ });
    return () => { active = false; };
  }, [applied, items, itemsKey]);

  const totals = computeTotals(summary.subtotal, applied?.discount ?? 0, rules);

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) { setCouponNotice({ ok: false, text: "Enter a coupon code." }); return; }
    if (!items.length || couponBusy) return;
    setCouponBusy(true);
    setCouponNotice(null);
    try {
      const result = await validateCustomerCoupon(code, items);
      if (result.valid && result.code && result.discount_inr !== undefined) {
        validatedFor.current = `${result.code}|${itemsKey}`;
        setApplied({ code: result.code, discount: result.discount_inr });
        setCouponInput("");
        setCouponNotice({ ok: true, text: `Coupon ${result.code} applied.` });
      } else {
        setCouponNotice({ ok: false, text: result.message });
      }
    } catch (reason) {
      setCouponNotice({ ok: false, text: friendlyOrderError(reason).message });
    } finally {
      setCouponBusy(false);
    }
  }

  function removeCoupon() {
    setApplied(null);
    validatedFor.current = "";
    setCouponNotice({ ok: true, text: "Coupon removed." });
  }

  function updateField(field: keyof ShippingAddress, value: string) {
    setAddress((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || !user || !profile) return;
    setFormError("");
    const found = validateAddress(address, settings.supported_regions);
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError("Please correct the highlighted fields.");
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    if (!method) { setFormError("Choose a payment method."); return; }
    if (!summary.canCheckout || unresolved || !items.length) { setFormError("Review your cart before placing the order."); return; }
    if (!rules) { setFormError("We couldn't read the store's delivery settings. Please try again."); return; }

    submitLock.current = true;
    setSubmitting(true);
    try {
      let couponCode: string | null = applied?.code ?? null;
      if (applied) {
        // Final server-side check right before ordering.
        const result = await validateCustomerCoupon(applied.code, items);
        if (!result.valid) {
          setApplied(null);
          validatedFor.current = "";
          throw new CheckoutAbort(`Coupon ${applied.code} is no longer valid (${result.message}). It has been removed — please review your total.`);
        }
        if (result.discount_inr !== applied.discount || result.subtotal_inr !== summary.subtotal) {
          setApplied({ code: applied.code, discount: result.discount_inr ?? 0 });
          void loadProducts(idsRef.current, { force: true });
          throw new CheckoutAbort("Your order total changed. Please review the updated amounts and place the order again.");
        }
        couponCode = result.code ?? applied.code;
      }
      const clean = cleanAddress(address);
      await saveCheckoutProfile(user.id, clean, profile, saveAddress);
      const fingerprintInput = { items, paymentMethod: method, couponCode, address: clean, note };
      const idempotencyKey = getAttemptKey(user.id, orderFingerprint(fingerprintInput));
      const orderId = await placeOrder({ ...fingerprintInput, idempotencyKey });
      clearAttemptKey(user.id);
      setCompleted(true);
      clearCart();
      navigate(`/checkout/success/${orderId}`, { replace: true });
    } catch (reason) {
      const friendly = friendlyOrderError(reason);
      setFormError(friendly.message);
      if (friendly.refreshCart) void loadProducts(idsRef.current, { force: true });
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  if (completed) return <Status>Order placed. Taking you to your confirmation...</Status>;
  if (settingsLoading || !profile) return <Status>Loading checkout...</Status>;
  if (!cartItems.length) {
    return (
      <section className="container-x py-24 text-center">
        <h1 className="text-5xl text-walnut">Nothing to check out</h1>
        <p className="mt-4 text-espresso/70">Your cart is empty.</p>
        <Link to="/shop" className="btn-primary mt-8">Continue shopping</Link>
      </section>
    );
  }

  const canSubmit = !submitting && summary.canCheckout && !unresolved && !!rules && !!method;
  const adjusted = summary.lines.filter((line) => line.status === "adjusted");

  return (
    <section className="container-x py-12 md:py-16">
      <div className="border-b border-brass/40 pb-6">
        <Link to="/cart" className="text-sm text-walnut underline underline-offset-4 hover:text-brass">← Back to cart</Link>
        <h1 className="mt-3 text-4xl text-walnut">Checkout</h1>
      </div>
      {settingsError && !rules && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-red-800/40 px-4 py-3 text-sm text-red-800">
          <span>We couldn't load the store's delivery and payment settings, so orders are paused. {settingsError}</span>
          <button type="button" onClick={() => void reloadSettings()} className="underline underline-offset-4">Try again</button>
        </div>
      )}
      {productsError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-red-800/40 px-4 py-3 text-sm text-red-800">
          <span>We couldn't confirm current prices and stock. {productsError}</span>
          <button type="button" onClick={() => void loadProducts(ids, { force: true })} className="underline underline-offset-4">Try again</button>
        </div>
      )}
      {profileError && <p role="status" className="mt-4 border border-brass/40 px-4 py-3 text-sm text-walnut">We couldn't load your saved details, so please enter them below.</p>}
      {adjusted.length > 0 && <p role="status" className="mt-4 border border-brass/40 px-4 py-3 text-sm text-walnut">{adjusted.map((line) => `${line.product?.name ?? "An item"} is limited to ${line.quantity} because of stock.`).join(" ")}</p>}
      {!summary.canCheckout && !unresolved && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-red-800/40 px-4 py-3 text-sm text-red-800">
          <span>Some items in your cart can't be purchased right now.</span>
          <Link to="/cart" className="underline underline-offset-4">Review cart</Link>
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-10">
          <fieldset disabled={submitting} className="grid gap-5">
            <legend className="text-2xl text-walnut">Delivery details</legend>
            <AddressFields value={address} errors={errors} disabled={submitting} onChange={updateField} />
            <p className="text-xs text-walnut/70">We use your phone number for delivery updates and save it to your profile.</p>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} />Save this address to my profile</label>
            {settings.estimated_delivery_text && <p className="text-sm text-walnut/80">Estimated delivery: {settings.estimated_delivery_text}</p>}
          </fieldset>

          <fieldset disabled={submitting} className="grid gap-4">
            <legend className="text-2xl text-walnut">Payment</legend>
            {methods.length === 0
              ? <p role="alert" className="border border-red-800/40 px-4 py-3 text-sm text-red-800">No payment methods are available right now. Please check back soon.</p>
              : methods.map((option) => (
                <label key={option.id} className={`flex cursor-pointer items-start gap-3 border p-4 text-sm ${method === option.id ? "border-walnut" : "border-brass/40"}`}>
                  <input type="radio" name="payment_method" value={option.id} checked={method === option.id} onChange={() => setMethod(option.id)} className="mt-1" />
                  <span><span className="block font-medium text-espresso">{option.label}</span><span className="text-walnut/80">{option.help}</span></span>
                </label>
              ))}
            {method === "upi" && settings.payment_instructions && <p className="whitespace-pre-line border-l-2 border-brass pl-4 text-sm text-walnut/90">{settings.payment_instructions}</p>}
          </fieldset>

          <fieldset disabled={submitting} className="grid gap-2">
            <legend className="text-2xl text-walnut">Order note</legend>
            <label className="grid gap-2 text-sm">
              <span className="text-walnut/80">Anything we should know about delivery? (optional)</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 1000))} rows={3} maxLength={1000} className="w-full border border-brass/50 bg-transparent px-4 py-3" />
              <span className="text-xs text-walnut/60">{note.length}/1000</span>
            </label>
          </fieldset>
        </div>

        <aside className="h-fit border border-brass/40 p-6 lg:sticky lg:top-32" aria-labelledby="checkout-summary">
          <h2 id="checkout-summary" className="text-2xl text-walnut">Order summary</h2>
          <ul className="mt-4 grid gap-3 border-b border-brass/40 pb-4">
            {summary.lines.filter((line) => line.product && (line.status === "ok" || line.status === "adjusted")).map((line) => (
              <li key={line.productId} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                {line.product?.imageUrl
                  ? <img src={line.product.imageUrl} alt="" className="aspect-[4/5] w-14 object-cover" />
                  : <ProductArt kind={line.product?.art ?? "vase"} className="aspect-[4/5] w-14" />}
                <span className="min-w-0"><span className="block truncate text-espresso">{line.product?.name}</span><span className="text-walnut/70">Qty {line.quantity}</span></span>
                <span>{formatINR(line.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            {applied ? (
              <div className="flex items-center justify-between gap-3 border border-brass/40 px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-2"><Tag size={14} />{applied.code}</span>
                <button type="button" onClick={removeCoupon} disabled={submitting} aria-label={`Remove coupon ${applied.code}`} className="inline-flex items-center gap-1 text-walnut underline underline-offset-4 hover:text-brass"><X size={14} />Remove</button>
              </div>
            ) : (
              <div className="grid gap-2">
                <label htmlFor="coupon-code" className="text-sm">Coupon code</label>
                <div className="flex gap-2">
                  <input id="coupon-code" value={couponInput} maxLength={40} disabled={submitting || couponBusy} autoComplete="off"
                    onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void applyCoupon(); } }}
                    className="w-full border border-brass/50 bg-transparent px-3 py-2 text-sm uppercase" />
                  <button type="button" onClick={() => void applyCoupon()} disabled={submitting || couponBusy || unresolved || !items.length} className="btn-outline px-4 py-2 text-sm disabled:opacity-50">
                    {couponBusy ? <Loader2 size={14} className="animate-spin" aria-label="Checking" /> : "Apply"}
                  </button>
                </div>
              </div>
            )}
            <p role="status" className={`mt-2 min-h-4 text-xs ${couponNotice && !couponNotice.ok ? "text-red-800" : "text-walnut/80"}`}>{couponNotice?.text}</p>
          </div>

          <dl className="mt-3 grid gap-3 text-sm">
            <div className="flex justify-between"><dt>Subtotal ({summary.units} {summary.units === 1 ? "item" : "items"})</dt><dd>{unresolved ? "—" : formatINR(totals.subtotal)}</dd></div>
            {summary.savings > 0 && <div className="flex justify-between text-walnut"><dt>Product savings</dt><dd>−{formatINR(summary.savings)}</dd></div>}
            {totals.discount > 0 && <div className="flex justify-between text-walnut"><dt>Coupon ({applied?.code})</dt><dd>−{formatINR(totals.discount)}</dd></div>}
            <div className="flex justify-between"><dt>Delivery</dt><dd>{!totals.deliveryKnown ? "Unavailable" : totals.delivery === 0 ? "Free" : formatINR(totals.delivery)}</dd></div>
            <div className="flex justify-between border-t border-brass/40 pt-3 text-base font-medium"><dt>Total</dt><dd>{unresolved || !totals.deliveryKnown ? "—" : formatINR(totals.total)}</dd></div>
          </dl>
          {totals.remainingForFree != null && <p className="mt-3 text-xs text-walnut/70">Add {formatINR(totals.remainingForFree)} more for free delivery (calculated before coupon discounts).</p>}
          <p className="mt-3 text-xs text-walnut/70">Prices, stock, discount and delivery are confirmed again by the store when you place the order.</p>

          {formError && <p role="alert" className="mt-4 border border-red-800/40 px-3 py-2 text-sm text-red-800">{formError}</p>}
          <button type="submit" disabled={!canSubmit} aria-busy={submitting} className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? <><Loader2 size={16} className="animate-spin" />Placing your order...</> : method === "upi" ? "Place order and pay by UPI" : "Place order"}
          </button>
          {productsLoading && unresolved && <p role="status" className="mt-2 text-xs text-walnut/70">Checking current prices and availability...</p>}
        </aside>
      </form>
    </section>
  );
}
