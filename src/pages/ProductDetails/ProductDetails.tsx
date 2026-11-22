import { useEffect, useState, type FormEvent } from "react";
import { Heart, MessageCircle, ShoppingBag, Upload, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ProductArt from "../../components/common/ProductArt";
import { useAuth } from "../../context/AuthContext";
import { formatINR } from "../../utils/currency";
import type { Product } from "../../types";
import { getProductBySlug } from "../../services/catalog";
import { isPurchasable, stockLabel } from "../../services/cartPricing";
import { createSimpleOrderRequest } from "../../services/simpleOrders";
import type { PaymentMethod } from "../../types/database";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { useCart } from "../../context/CartContext";

export default function ProductDetails() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useStoreSettings();
  const { isInWishlist, toggleWishlist } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showOrder, setShowOrder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("upi");
  const [form, setForm] = useState({ phone: "", address: "", city: "", state: "", postal: "" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void getProductBySlug(slug).then(result => { if (active) setProduct(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Unable to load this product."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  if (loading) return <div className="container-x py-24 text-center text-walnut/70">Loading this piece...</div>;
  if (error) return <div role="alert" className="container-x py-24 text-center text-red-800">{error}</div>;
  if (!product) return <div className="container-x py-24 text-center"><h1 className="font-display text-4xl text-walnut">Piece not found</h1><Link to="/shop" className="btn-primary mt-6">Browse the collection</Link></div>;

  const price = product.discountPrice ?? product.price;
  const whatsappNumber = (settings.support_phone || "").replace(/\D/g, "");
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi CasaLoom, I have a customization enquiry for ${product.name}.`)}` : "";
  const wished = isInWishlist(product.id);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { navigate("/login", { state: { from: `/product/${product!.slug}` } }); return; }
    if (!photo) { setNotice("Upload the photo you want us to use for customization."); return; }
    if (!form.address.trim() || !form.city.trim() || !form.state.trim() || !form.postal.trim()) {
      setNotice("Complete your delivery address."); return;
    }
    setSaving(true); setNotice("");
    try {
      const id = await createSimpleOrderRequest({
        productId: product!.id, quantity,
        shippingAddress: { phone: form.phone, address_line1: form.address, city: form.city, state: form.state, postal_code: form.postal, country: "India" },
        idempotencyKey: crypto.randomUUID(), customizationPhoto: photo, paymentMethod,
      });
      if (paymentMethod === "upi") navigate(`/payment/${id}`);
      else navigate(`/my-orders/${id}`, { state: { submittedOrderId: id } });
    } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to submit your order request."); }
    finally { setSaving(false); }
  }

  return <section className="container-x mx-auto max-w-6xl py-5 md:py-8">
    <div className="mx-auto grid max-w-5xl items-center gap-5 rounded-2xl border border-[#ead1d9] bg-white/70 p-3 shadow-[0_10px_30px_rgba(100,35,78,0.08)] sm:p-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:gap-7 md:p-5">
      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-xl border border-[#ead1d9] bg-[#f2e9e5] shadow-sm">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="aspect-[4/5] max-h-[410px] w-full object-cover" /> : <ProductArt kind={product.art} className="aspect-[4/5] max-h-[410px] w-full" />}</div>
      <div className="self-center px-1 py-2 md:px-2">
        {product.categorySlug && <Link to={`/category/${product.categorySlug}`} className="text-xs text-walnut underline underline-offset-4">{product.category}</Link>}
        <p className="mt-2 text-[10px] uppercase tracking-[.2em] text-walnut/70">Made for your home</p>
        <h1 className="mt-1 font-display text-3xl leading-tight text-walnut md:text-4xl">{product.name}</h1>
        <p className="mt-2 text-sm text-espresso/70">{product.material}{product.colour ? ` · ${product.colour}` : ""}</p>
        <div className="mt-3 flex items-baseline gap-2"><span className="text-xl text-espresso">{formatINR(price)}</span>{product.discountPrice && <span className="text-xs text-espresso/50 line-through">{formatINR(product.price)}</span>}</div>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-espresso/80">{product.description}</p>
        <p className="mt-2 text-xs text-walnut/70">{isPurchasable(product) ? stockLabel(product.stock) : "Currently unavailable"}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={!isPurchasable(product)} onClick={() => { if (!user) navigate("/login", {state:{from:`/product/${product.slug}`}}); else setShowOrder(true); }} className="btn-primary !px-4 !py-2 !text-sm disabled:opacity-50"><ShoppingBag size={14}/> Order this product</button>
          <button type="button" aria-pressed={wished} onClick={() => toggleWishlist(product)} className="btn-outline !px-3 !py-2 !text-sm"><Heart size={14} fill={wished ? "#64234e" : "none"}/>{wished ? "Saved" : "Wishlist"}</button>
          {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn-outline !px-3 !py-2 !text-sm"><MessageCircle size={14}/> Customization enquiry</a>}
        </div>

      </div>
    </div>
    {showOrder && <div className="fixed inset-0 z-50 flex items-end justify-center bg-espresso/50 p-0 sm:items-center sm:p-5" onClick={() => setShowOrder(false)}>
      <form onSubmit={submitOrder} onClick={e => e.stopPropagation()} className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-cream p-5 sm:rounded-2xl sm:p-7">
        <div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-walnut/60">Order request</p><h2 className="mt-1 font-display text-2xl text-walnut">{product.name}</h2><p className="mt-1 font-medium">{formatINR(price)} per item</p></div><button type="button" onClick={() => setShowOrder(false)} className="p-2 text-walnut"><X/></button></div>
        <label className="mt-5 block text-sm">Quantity<input type="number" min="1" max={Math.max(1,product.stock)} value={quantity} onChange={e=>setQuantity(Math.max(1,Math.min(product.stock,Number(e.target.value)||1)))} className="mt-1 w-full rounded-md border border-brass/50 bg-white px-3 py-2"/></label>
        <label className="mt-4 block text-sm">Customization photo <span className="text-walnut/60">(required)</span><span className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-brass bg-white p-4 text-walnut"><Upload size={18}/>{photo ? photo.name : "Choose photo to customize"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setPhoto(e.target.files?.[0] ?? null)} className="sr-only"/></span></label>
        <h3 className="mt-5 font-medium text-walnut">Delivery details</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">Full address<input required value={form.address} onChange={e=>setForm({...form,address:e.target.value})} className="mt-1 w-full rounded-md border border-brass/50 bg-white px-3 py-2"/></label>
          <label className="text-sm">City<input required value={form.city} onChange={e=>setForm({...form,city:e.target.value})} className="mt-1 w-full rounded-md border border-brass/50 bg-white px-3 py-2"/></label>
          <label className="text-sm">State<input required value={form.state} onChange={e=>setForm({...form,state:e.target.value})} className="mt-1 w-full rounded-md border border-brass/50 bg-white px-3 py-2"/></label>
          <label className="text-sm">PIN code<input required value={form.postal} onChange={e=>setForm({...form,postal:e.target.value})} className="mt-1 w-full rounded-md border border-brass/50 bg-white px-3 py-2"/></label>
          <label className="text-sm">Phone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} className="mt-1 w-full rounded-md border border-brass/50 bg-white px-3 py-2"/></label>
        </div>
        {photo && <>
          <h3 className="mt-5 font-medium text-walnut">Payment mode</h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className={`cursor-pointer rounded-lg border p-3 text-sm ${paymentMethod === "upi" ? "border-[#713B58] bg-[#f7eaf0]" : "border-brass/50 bg-white"}`}><input type="radio" name="paymentMethod" value="upi" checked={paymentMethod === "upi"} onChange={() => setPaymentMethod("upi")} className="mr-2"/>UPI</label>
            <label className={`cursor-pointer rounded-lg border p-3 text-sm ${paymentMethod === "cod" ? "border-[#713B58] bg-[#f7eaf0]" : "border-brass/50 bg-white"}`}><input type="radio" name="paymentMethod" value="cod" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} className="mr-2"/>Cash on Delivery</label>
          </div>
          <div className="mt-4 rounded-lg bg-[#f2e9e5] p-3 text-sm"><div className="flex justify-between"><span>Product total</span><b>{formatINR(price*quantity)}</b></div><p className="mt-1 text-xs text-espresso/60">Choose your payment mode and place your order.</p></div>
        </>}
        {notice && <p role="alert" className="mt-3 text-sm text-red-800">{notice}</p>}
        <button disabled={saving || !photo} className="btn-primary mt-5 w-full justify-center disabled:opacity-50">{saving ? "Placing order..." : "Place order"}</button>
      </form>
    </div>}
  </section>;
}
