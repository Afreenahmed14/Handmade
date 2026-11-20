import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bell, Building2, CreditCard, ImagePlus, MapPin, Save, Settings2, ShieldCheck, Truck, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { deleteStoreLogo, deleteUpiQrImage, uploadStoreLogo, uploadUpiQrImage } from "../../services/storage";
import { defaultStoreSettings, getAdminProfileSettings, getAdminStoreSettings, saveAdminStoreSettings, updateOwnAdminProfile, type AdminProfileSettings, type AdminStoreSettings } from "../../services/settings";

type Section = "store" | "preferences" | "shipping" | "payments" | "notifications" | "admin";
type Toast = { text: string; tone: "success" | "warning" | "error" };

const sections: { id: Section; label: string; icon: typeof Building2 }[] = [
  { id: "store", label: "Store information", icon: Building2 },
  { id: "preferences", label: "Preferences", icon: Settings2 },
  { id: "shipping", label: "Shipping", icon: Truck },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "admin", label: "Admin profile", icon: ShieldCheck },
];

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "Unable to save settings.";
}

function parseRegions(value: string) {
  return [...new Set(value.split(/[\n,]/).map((region) => region.trim()).filter(Boolean))];
}

export default function Settings() {
  const { user, role } = useAuth();
  const [settings, setSettings] = useState<AdminStoreSettings | null>(null);
  const [original, setOriginal] = useState<AdminStoreSettings | null>(null);
  const [adminProfile, setAdminProfile] = useState<AdminProfileSettings>({ full_name: "", mobile_number: "" });
  const [originalProfile, setOriginalProfile] = useState<AdminProfileSettings>({ full_name: "", mobile_number: "" });
  const [section, setSection] = useState<Section>("store");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState("");
  const [supportedRegionsText, setSupportedRegionsText] = useState("");

  useEffect(() => {
    let active = true;
    if (!user) return;
    void Promise.all([getAdminStoreSettings(), getAdminProfileSettings(user.id)]).then(([storeSettings, profile]) => {
      if (!active) return;
      setSettings(storeSettings);
      setOriginal(storeSettings);
      setSupportedRegionsText(storeSettings.supported_regions.join("\n"));
      setAdminProfile(profile);
      setOriginalProfile(profile);
    }).catch((reason: unknown) => {
      if (active) setError(errorText(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!logoFile) { setLogoPreview(""); return; }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!qrFile) { setQrPreview(""); return; }
    const url = URL.createObjectURL(qrFile);
    setQrPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [qrFile]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const storeDirty = Boolean(settings && original && (JSON.stringify(settings) !== JSON.stringify(original) || Boolean(logoFile) || Boolean(qrFile)));
  const profileDirty = JSON.stringify(adminProfile) !== JSON.stringify(originalProfile);
  const hasUnsavedChanges = section === "admin" ? profileDirty : storeDirty;

  const displayedLogo = logoPreview || settings?.logo_url || "";
  const displayedQr = qrPreview || settings?.upi_qr_url || "";
  const publicPreview = useMemo(() => settings ? ({
    store_name: settings.store_name,
    contact_email: settings.contact_email,
    contact_phone: settings.contact_phone,
    currency: settings.currency,
    store_description: settings.store_description,
    logo_url: settings.logo_url,
    business_address: settings.business_address,
    support_email: settings.support_email,
    support_phone: settings.support_phone,
    time_zone: settings.time_zone,
    date_format: settings.date_format,
    maintenance_mode: settings.maintenance_mode,
    maintenance_message: settings.maintenance_message,
    shipping_charge_inr: settings.shipping_charge_inr,
    free_shipping_threshold_inr: settings.free_shipping_threshold_inr,
    estimated_delivery_text: settings.estimated_delivery_text,
    supported_regions: settings.supported_regions,
    cod_enabled: settings.cod_enabled,
    upi_enabled: settings.upi_enabled,
    payment_instructions: settings.payment_instructions,
  }) : null, [settings]);

  function switchSection(next: Section) {
    if (hasUnsavedChanges && !window.confirm("Discard unsaved changes?")) return;
    if (hasUnsavedChanges) {
      if (section === "admin") setAdminProfile(originalProfile);
      else if (original) { setSettings(original); setSupportedRegionsText(original.supported_regions.join("\n")); setLogoFile(null); setQrFile(null); }
    }
    setError("");
    setSection(next);
  }

  function cancelChanges() {
    if (section === "admin") setAdminProfile(originalProfile);
    else if (original) { setSettings(original); setSupportedRegionsText(original.supported_regions.join("\n")); setLogoFile(null); setQrFile(null); }
    setError("");
  }

  function updateSetting<K extends keyof AdminStoreSettings>(key: K, value: AdminStoreSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  function updateProfile<K extends keyof AdminProfileSettings>(key: K, value: AdminProfileSettings[K]) {
    setAdminProfile((current) => ({ ...current, [key]: value }));
  }

  async function saveStoreSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setError("");
    if (!settings.store_name.trim()) { setError("Store name is required."); return; }
    if (settings.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact_email)) { setError("Enter a valid contact email."); return; }
    if (settings.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.support_email)) { setError("Enter a valid support email."); return; }
    if (!Number.isFinite(settings.shipping_charge_inr) || settings.shipping_charge_inr < 0) { setError("Shipping charge must be non-negative."); return; }
    if (settings.free_shipping_threshold_inr !== null && (!Number.isFinite(settings.free_shipping_threshold_inr) || settings.free_shipping_threshold_inr < 0)) { setError("Free shipping threshold must be non-negative or empty."); return; }
    const upiId = settings.upi_id.trim();
    const upiPayee = settings.upi_payee_name.trim();
    if (upiId && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,48}$/.test(upiId)) { setError("Enter a valid UPI ID such as name@bank."); return; }
    if (upiPayee.length > 120) { setError("UPI payee name must be 120 characters or fewer."); return; }
    setSaving(true);
    const previousLogo = original?.logo_url ?? null;
    const previousQr = original?.upi_qr_url ?? null;
    let uploadedLogo: string | null = null;
    let uploadedQr: string | null = null;
    try {
      let nextSettings = { ...settings, upi_id: upiId, upi_payee_name: upiPayee, supported_regions: parseRegions(supportedRegionsText) };
      if (logoFile) {
        uploadedLogo = await uploadStoreLogo(logoFile);
        nextSettings = { ...nextSettings, logo_url: uploadedLogo };
      }
      if (qrFile) {
        uploadedQr = await uploadUpiQrImage(qrFile);
        nextSettings = { ...nextSettings, upi_qr_url: uploadedQr };
      }
      await saveAdminStoreSettings(nextSettings);
      setSettings(nextSettings);
      setOriginal(nextSettings);
      setSupportedRegionsText(nextSettings.supported_regions.join("\n"));
      setLogoFile(null);
      setQrFile(null);
      const logoWarning = previousLogo && previousLogo !== nextSettings.logo_url ? await deleteStoreLogo(previousLogo) : null;
      const qrWarning = previousQr && previousQr !== nextSettings.upi_qr_url ? await deleteUpiQrImage(previousQr) : null;
      const cleanupWarning = logoWarning ?? qrWarning;
      setToast(cleanupWarning ? { text: cleanupWarning, tone: "warning" } : { text: "Store settings saved.", tone: "success" });
    } catch (reason) {
      if (uploadedLogo) await deleteStoreLogo(uploadedLogo);
      if (uploadedQr) await deleteUpiQrImage(uploadedQr);
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError("");
    setProfileSaving(true);
    try {
      await updateOwnAdminProfile(user.id, adminProfile);
      const next = { ...adminProfile, full_name: adminProfile.full_name.trim(), mobile_number: adminProfile.mobile_number.trim() };
      setAdminProfile(next);
      setOriginalProfile(next);
      setToast({ text: "Administrator profile updated.", tone: "success" });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setProfileSaving(false);
    }
  }

  if (loading) return <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-8 text-espresso"><div className="h-8 w-48 animate-pulse bg-[#ddc9bd]" /><div className="mt-8 h-64 animate-pulse bg-white" /></section>;
  if (!settings) return <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-8 text-espresso"><p role="alert" className="border-l-2 border-red-400 pl-3 text-red-200">{error || "Store settings are unavailable. Verify the admin settings migration has been applied."}</p></section>;

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <header className="border-b border-brass/40 pb-5"><p className="text-sm text-espresso/65">Administration</p><h1 className="mt-1 text-3xl text-white">Settings</h1><p className="mt-2 text-sm text-espresso/65">Store preferences and administrator profile</p></header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto border-b border-brass/40 pb-3 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
          {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => switchSection(id)} className={`flex shrink-0 items-center gap-2 px-3 py-2 text-left text-sm ${section === id ? "bg-walnut text-white" : "text-espresso/80 hover:bg-[#eadbd2]"}`}><Icon size={16} />{label}</button>)}
        </nav>

        <main className="min-w-0">
          {error && <p role="alert" className="mb-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{error}</p>}
          {section === "store" && <form onSubmit={saveStoreSettings} className="space-y-6">
            <SectionHeading title="Store information" description="Public-facing business details." />
            <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Store name<input required maxLength={160} value={settings.store_name} onChange={(event) => updateSetting("store_name", event.target.value)} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Store description<input value={settings.store_description} maxLength={2000} onChange={(event) => updateSetting("store_description", event.target.value)} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Contact email<input type="email" value={settings.contact_email ?? ""} onChange={(event) => updateSetting("contact_email", event.target.value || null)} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Contact phone<input type="tel" maxLength={40} value={settings.contact_phone ?? ""} onChange={(event) => updateSetting("contact_phone", event.target.value || null)} className={inputClass} /></label><label className="grid gap-1.5 text-sm sm:col-span-2">Business address<textarea rows={3} maxLength={1000} value={settings.business_address ?? ""} onChange={(event) => updateSetting("business_address", event.target.value || null)} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Support email<input type="email" value={settings.support_email ?? ""} onChange={(event) => updateSetting("support_email", event.target.value || null)} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Support phone<input type="tel" maxLength={40} value={settings.support_phone ?? ""} onChange={(event) => updateSetting("support_phone", event.target.value || null)} className={inputClass} /></label></div>
            <section className="border border-brass/40 bg-white p-4"><h2 className="font-medium text-white">Store logo</h2><p className="mt-1 text-xs text-espresso/65">Stored in the existing public homepage-banners bucket.</p><div className="mt-3 flex flex-wrap items-center gap-4">{displayedLogo && <img src={displayedLogo} alt="Store logo preview" className="h-16 max-w-48 border border-brass/40 bg-cream object-contain p-2" />}<label className="grid gap-2 text-sm"><span className="sr-only">Upload store logo</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} className="block w-full text-sm text-espresso/80 file:mr-3 file:border-0 file:bg-walnut file:px-3 file:py-2 file:text-white" /></label>{settings.logo_url && <button type="button" onClick={() => { updateSetting("logo_url", null); setLogoFile(null); }} className="text-xs text-red-200 underline">Remove logo</button>}</div></section>
            <SaveBar dirty={storeDirty} saving={saving} onCancel={cancelChanges} />
          </form>}

          {section === "preferences" && <form onSubmit={saveStoreSettings} className="space-y-6"><SectionHeading title="Store preferences" description="Regional defaults used by the storefront and operations." /><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Currency<select value={settings.currency} onChange={(event) => updateSetting("currency", event.target.value)} className={inputClass}><option value="INR">INR · Indian Rupee</option></select><span className="text-xs text-espresso/55">Only INR is supported by current order pricing.</span></label><label className="grid gap-1.5 text-sm">Time zone<select value={settings.time_zone} onChange={(event) => updateSetting("time_zone", event.target.value)} className={inputClass}>{["Asia/Kolkata", "UTC", "Asia/Dubai", "Europe/London", "America/New_York"].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label><label className="grid gap-1.5 text-sm">Date format<select value={settings.date_format} onChange={(event) => updateSetting("date_format", event.target.value)} className={inputClass}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></label><div className="border border-brass/40 p-3"><p className="text-sm text-espresso">Tax / GST</p><p className="mt-1 text-xs text-espresso/55">Tax fields are not supported by the current order schema.</p></div></div><div className="border border-amber-900/70 bg-amber-950/20 p-4"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={settings.maintenance_mode} onChange={(event) => { if (event.target.checked && !window.confirm("Enable maintenance mode? Customers will see the maintenance message instead of the storefront. Sign-in stays available and administrators can still browse.")) return; updateSetting("maintenance_mode", event.target.checked); }} /><span className="text-espresso">Maintenance mode</span></label><p className="mt-2 text-xs text-amber-200/80">When on, the customer storefront shows this message instead of its pages. Sign-in stays reachable and signed-in administrators bypass it.</p>{settings.maintenance_mode && <label className="mt-3 grid gap-1 text-sm">Maintenance message<input maxLength={500} value={settings.maintenance_message} onChange={(event) => updateSetting("maintenance_message", event.target.value)} className={inputClass} /></label>}</div><SaveBar dirty={storeDirty} saving={saving} onCancel={cancelChanges} /></form>}

          {section === "shipping" && <form onSubmit={saveStoreSettings} className="space-y-6"><SectionHeading title="Shipping settings" description="Basic store shipping defaults only; no shipping provider is connected." /><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">Shipping charge (INR)<input type="number" min="0" step="0.01" value={settings.shipping_charge_inr} onChange={(event) => updateSetting("shipping_charge_inr", Number(event.target.value))} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Free shipping threshold (INR, optional)<input type="number" min="0" step="0.01" value={settings.free_shipping_threshold_inr ?? ""} onChange={(event) => updateSetting("free_shipping_threshold_inr", event.target.value === "" ? null : Number(event.target.value))} className={inputClass} /></label><label className="grid gap-1.5 text-sm sm:col-span-2">Estimated delivery information<input maxLength={500} value={settings.estimated_delivery_text} onChange={(event) => updateSetting("estimated_delivery_text", event.target.value)} className={inputClass} placeholder="e.g. 5–7 business days" /></label><label className="grid gap-1.5 text-sm sm:col-span-2">Supported delivery regions (one per line)<textarea rows={5} value={supportedRegionsText} onChange={(event) => setSupportedRegionsText(event.target.value)} className={inputClass} placeholder="India" /><span className="text-xs text-espresso/55">Checkout only accepts addresses whose country, state or city matches one of these lines; leave empty to deliver anywhere. This check runs in the browser, not in the database.</span></label></div><SaveBar dirty={storeDirty} saving={saving} onCancel={cancelChanges} /></form>}

          {section === "payments" && <form onSubmit={saveStoreSettings} className="space-y-6"><SectionHeading title="Payment settings" description="Availability, customer instructions and the UPI payee details customers pay to. No secret credentials are stored here." /><div className="space-y-3"><label className="flex items-center gap-3 border border-brass/40 bg-white p-4 text-sm"><input type="checkbox" checked={settings.cod_enabled} onChange={(event) => updateSetting("cod_enabled", event.target.checked)} />Cash on Delivery available</label><label className="flex items-center gap-3 border border-brass/40 bg-white p-4 text-sm"><input type="checkbox" checked={settings.upi_enabled} onChange={(event) => updateSetting("upi_enabled", event.target.checked)} />UPI available</label><section className="grid gap-4 border border-brass/40 bg-white p-4"><div><h2 className="font-medium text-white">UPI payee details</h2><p className="mt-1 text-xs text-espresso/65">Shown only to a signed-in customer on their own UPI order. The QR image is stored in the public homepage-banners bucket, so upload only a QR code you are happy to publish.</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">UPI ID<input maxLength={100} autoComplete="off" value={settings.upi_id} onChange={(event) => updateSetting("upi_id", event.target.value)} className={inputClass} placeholder="yourshop@bank" /></label><label className="grid gap-1.5 text-sm">Payee name<input maxLength={120} value={settings.upi_payee_name} onChange={(event) => updateSetting("upi_payee_name", event.target.value)} className={inputClass} placeholder="Name registered with your UPI ID" /></label></div><div className="flex flex-wrap items-center gap-4">{displayedQr && <img src={displayedQr} alt="UPI QR code preview" className="h-28 w-28 border border-brass/40 bg-white object-contain p-1" />}<label className="grid gap-2 text-sm"><span className="sr-only">Upload UPI QR code</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setQrFile(event.target.files?.[0] ?? null)} className="block w-full text-sm text-espresso/80 file:mr-3 file:border-0 file:bg-walnut file:px-3 file:py-2 file:text-white" /></label>{(settings.upi_qr_url || qrFile) && <button type="button" onClick={() => { updateSetting("upi_qr_url", null); setQrFile(null); }} className="text-xs text-red-200 underline">Remove QR image</button>}</div>{settings.upi_enabled && !settings.upi_id.trim() && <p className="text-xs text-amber-200">UPI is switched on but no UPI ID is set. Customers will be asked to follow your payment instructions instead.</p>}</section><label className="grid gap-1.5 text-sm">Payment instructions<textarea rows={4} maxLength={2000} value={settings.payment_instructions} onChange={(event) => updateSetting("payment_instructions", event.target.value)} className={inputClass} placeholder="Customer-facing payment instructions" /></label><p className="text-xs text-espresso/55">Customers pay you directly by UPI and submit a transaction reference; a payment is marked paid only after you verify it on the Payments screen. UPI provider credentials and live bank checks are not managed here.</p></div><SaveBar dirty={storeDirty} saving={saving} onCancel={cancelChanges} /></form>}

          {section === "notifications" && <div className="space-y-5"><SectionHeading title="Notification preferences" description="Current notification capability status." /><div className="border border-brass/40 bg-white p-4"><h2 className="font-medium text-white">Email notifications</h2><p className="mt-2 text-sm text-espresso/80">No email delivery provider is configured in the existing application. Settings here do not send email.</p></div><div className="grid gap-3 sm:grid-cols-2"><Capability label="Order email notifications" /><Capability label="Low-stock email notifications" /><Capability label="Custom request email notifications" /></div><p className="text-xs text-espresso/55">Notification toggles are omitted until a verified backend email workflow exists.</p></div>}

          {section === "admin" && <form onSubmit={saveProfile} className="space-y-6"><SectionHeading title="Administrator profile" description="Safe profile details for the signed-in administrator." /><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm sm:col-span-2">Name<input maxLength={160} value={adminProfile.full_name} onChange={(event) => updateProfile("full_name", event.target.value)} className={inputClass} /></label><label className="grid gap-1.5 text-sm">Email (read-only)<input readOnly value={user?.email ?? ""} className={`${inputClass} opacity-60`} /></label><label className="grid gap-1.5 text-sm">Phone<input maxLength={40} type="tel" value={adminProfile.mobile_number} onChange={(event) => updateProfile("mobile_number", event.target.value)} className={inputClass} /></label><div className="flex items-center gap-2 border border-brass/40 p-3 text-sm text-espresso/80"><ShieldCheck size={17} className="text-emerald-300" />Role: {role ?? "Unavailable"} · role changes are not allowed here</div></div><SaveBar dirty={profileDirty} saving={profileSaving} onCancel={cancelChanges} /></form>}

          {publicPreview && <details className="mt-8 border-t border-brass/30 pt-4"><summary className="cursor-pointer text-xs text-espresso/55">Public store configuration preview</summary><pre className="mt-3 max-h-64 overflow-auto border border-brass/30 bg-cream p-3 text-[11px] text-espresso/65">{JSON.stringify(publicPreview, null, 2)}</pre></details>}
        </main>
      </div>
      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : toast.tone === "warning" ? "border-amber-700 bg-[#382a10] text-amber-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}>{toast.text}</div>}
    </section>
  );
}

const inputClass = "border border-brass/50 bg-cream px-3 py-2 text-sm text-white";

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <header className="border-b border-brass/40 pb-4"><h2 className="text-xl font-medium text-white">{title}</h2><p className="mt-1 text-sm text-espresso/65">{description}</p></header>;
}

function SaveBar({ dirty, saving, onCancel }: { dirty: boolean; saving: boolean; onCancel: () => void }) {
  return <div className="sticky bottom-0 flex justify-end gap-3 border-t border-brass/40 bg-cream/95 py-4 backdrop-blur"><button type="button" onClick={onCancel} disabled={!dirty || saving} className="border border-brass/50 px-4 py-2 text-sm text-espresso disabled:opacity-40">Cancel</button><button type="submit" disabled={!dirty || saving} className="inline-flex items-center gap-2 bg-walnut px-5 py-2 text-sm font-medium text-white hover:bg-[#4c173b] disabled:opacity-50"><Save size={15} />{saving ? "Saving..." : "Save changes"}</button></div>;
}

function Capability({ label }: { label: string }) {
  return <div className="flex items-center justify-between border border-brass/40 bg-white p-4 text-sm"><span className="text-espresso/80">{label}</span><span className="text-xs text-espresso/55">Unavailable</span></div>;
}
