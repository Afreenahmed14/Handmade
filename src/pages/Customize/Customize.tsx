import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ImagePlus, Loader2 } from "lucide-react";
import AddressFields from "../../components/checkout/AddressFields";
import ProductArt from "../../components/common/ProductArt";
import { useAuth } from "../../context/AuthContext";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { getProductBySlug } from "../../services/catalog";
import { addressToJson, emptyAddress, getCheckoutProfile, validateAddress, type AddressErrors, type ShippingAddress } from "../../services/checkout";
import { createCustomerPhotoOrder } from "../../services/simpleOrders";
import { formatINR } from "../../utils/currency";
import type { Product } from "../../types";
import type { PaymentMethod } from "../../types/database";

const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function Customize() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { settings } = useStoreSettings();
  const [product, setProduct] = useState<Product | null>(null);
  const [address, setAddress] = useState<ShippingAddress>(emptyAddress);
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitLock = useRef(false);
  const idempotencyKey = useRef("");

  const methods = useMemo(() => [
    ...(settings.upi_enabled ? [{ id: "upi" as const, label: "UPI", help: "Pay by UPI after placing your order." }] : []),
    ...(settings.cod_enabled ? [{ id: "cod" as const, label: "Cash on delivery", help: "Pay when your order arrives." }] : []),
  ], [settings.cod_enabled, settings.upi_enabled]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([getProductBySlug(slug), user ? getCheckoutProfile(user.id).catch(() => null) : Promise.resolve(null)])
      .then(([found, profile]) => {
        if (!active) return;
        setProduct(found);
        if (profile) setAddress(profile.address);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load this product."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, user]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError("");
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) { setError("Choose a JPG, PNG or WebP image."); return; }
    if (file.size > PHOTO_MAX_BYTES) { setError("Your image must be 20 MB or smaller."); return; }
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setMethod("");
    idempotencyKey.current = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !product || !photo || !method || submitting || submitLock.current) return;
    const nextErrors = validateAddress(address, settings.supported_regions);
    setAddressErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setError("Please complete your delivery address."); return; }
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    try {
      const orderId = await createCustomerPhotoOrder({
        productId: product.id,
        quantity: 1,
        shippingAddress: addressToJson(address),
        paymentMethod: method,
        idempotencyKey: idempotencyKey.current,
        photo,
      });
      idempotencyKey.current = "";
      if (method === "upi") navigate(`/payment/${orderId}`, { replace: true });
      else navigate(`/my-orders/${orderId}`, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn't place your order. Please try again.");
    } finally { submitLock.current = false; setSubmitting(false); }
  }

  if (loading) return <div className="container-x py-24 text-center text-walnut/70" role="status">Loading this piece...</div>;
  if (!product) return <div className="container-x py-24 text-center"><h1 className="text-3xl text-walnut">Product not found</h1><Link to="/personalised-gifts" className="btn-primary mt-6">Back to personalised gifts</Link></div>;
  if (role && role !== "customer") return <div className="container-x py-24 text-center"><h1 className="text-3xl text-walnut">Customer account required</h1><Link to="/login" className="btn-primary mt-6">Sign in as customer</Link></div>;

  return (
    <section className="container-x py-10 md:py-14">
      <p className="text-sm text-walnut/70"><Link to="/personalised-gifts" className="underline underline-offset-4">Personalised gifts</Link> / {product.name}</p>
      <div className="mt-3 border-b border-brass/40 pb-5">
        <p className="text-sm uppercase text-walnut/70">Made with your photo</p>
        <h1 className="mt-2 text-4xl text-walnut">Send your photo</h1>
        <p className="mt-2 text-sm text-espresso/75">Choose your image, select a payment mode and place your order.</p>
      </div>

      <form onSubmit={(event) => void submit(event)} className="mt-8 grid gap-8 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1.6fr)]" aria-busy={submitting}>
        <aside className="self-start border border-brass/40 bg-white p-4">
          {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="aspect-square w-full object-cover" /> : <ProductArt kind={product.art} className="aspect-square w-full" />}
          <h2 className="mt-4 text-xl text-walnut">{product.name}</h2>
          <p className="mt-1 text-sm text-walnut/70">{product.category} {product.material ? `· ${product.material}` : ""}</p>
          <p className="mt-2 font-semibold text-plum">{formatINR(product.discountPrice ?? product.price)}</p>
          <p className="mt-3 text-xs text-walnut/65">One product per personalised order. Your uploaded photo will be attached privately to this order.</p>
        </aside>

        <div className="grid content-start gap-6">
          <section className="border border-brass/40 bg-white p-5">
            <h2 className="text-xl text-walnut">1. Upload your photo</h2>
            <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-brass/60 bg-cream/60 p-5 text-center text-sm text-walnut hover:bg-brass/10">
              <ImagePlus size={26} />
              <span className="font-medium">{photo ? "Change photo" : "Choose a photo to upload"}</span>
              <span className="text-xs text-walnut/60">JPG, PNG or WebP · Up to 20 MB</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} className="sr-only" />
            </label>
            {preview && <div className="mt-4 flex items-center gap-4"><img src={preview} alt="Your selected upload" className="h-24 w-24 rounded-lg border border-brass/30 object-cover" /><div className="min-w-0"><p className="break-all text-sm font-medium text-walnut">{photo?.name}</p><p className="mt-1 text-xs text-walnut/60">{photo ? `${(photo.size / 1024 / 1024).toFixed(1)} MB` : ""}</p></div></div>}
          </section>

          {photo && <section className="border border-brass/40 bg-white p-5">
            <h2 className="text-xl text-walnut">2. Choose payment mode</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {methods.map((option) => <label key={option.id} className={`flex cursor-pointer gap-3 border p-4 text-sm ${method === option.id ? "border-plum bg-lavender/40" : "border-brass/40"}`}>
                <input type="radio" name="payment-method" value={option.id} checked={method === option.id} onChange={() => setMethod(option.id)} />
                <span><b className="block text-walnut">{option.label}</b><span className="mt-1 block text-xs text-walnut/65">{option.help}</span></span>
              </label>)}
            </div>
            {method === "upi" && settings.payment_instructions && <p className="mt-4 whitespace-pre-line border-l-2 border-brass pl-3 text-sm text-walnut/80">{settings.payment_instructions}</p>}
            {methods.length === 0 && <p className="mt-3 text-sm text-red-800">No payment methods are currently enabled. Please contact CasaLoom.</p>}
          </section>}

          {photo && method && <section className="border border-brass/40 bg-white p-5">
            <h2 className="text-xl text-walnut">3. Delivery address</h2>
            <div className="mt-4"><AddressFields value={address} errors={addressErrors} disabled={submitting} onChange={(field, value) => { setAddress((current) => ({ ...current, [field]: value })); setAddressErrors((current) => ({ ...current, [field]: undefined })); }} /></div>
          </section>}

          {error && <p role="alert" className="border-l-2 border-red-700 pl-3 text-sm text-red-800">{error}</p>}
          <button type="submit" disabled={!photo || !method || methods.length === 0 || submitting} className="btn-primary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting && <Loader2 size={17} className="animate-spin" />}{submitting ? "Placing your order..." : "Place order"}
          </button>
          <p className="text-xs text-walnut/60">After placing your order, you can review its details and track delivery in My Orders.</p>
        </div>
      </form>
    </section>
  );
}
