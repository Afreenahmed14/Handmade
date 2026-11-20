import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, ImagePlus, Loader2, Pencil, Replace, X } from "lucide-react";
import PhotoEditor from "../../components/photoEditor/PhotoEditor";
import { buildDesignResult, defaultState, loadSourceImage, type DesignResult, type EditorState, type PrintArea } from "../../components/photoEditor/editorModel";
import ProductArt from "../../components/common/ProductArt";
import { useAuth } from "../../context/AuthContext";
import { formatINR } from "../../utils/currency";
import { getProductBySlug } from "../../services/catalog";
import {
  CUSTOM_REQUEST_IMAGE_ACCEPT, CUSTOM_REQUEST_MAX_FILES, EDITOR_MAX_PHOTOS, type ReferenceImageRules, CustomRequestSubmitError, CustomRequestValidationError,
  emptyCustomRequestForm, friendlyCustomRequestError, submitCustomization, validateCustomRequestForm, validateReferenceImage,
  type CustomRequestForm, type CustomRequestFormErrors, type SubmitCustomizationResult,
} from "../../services/customRequests";
import {
  getPersonalization, personalizationAccept, personalizationFormatLabel, personalizationTypeLabel, printingAreaSummary, type PersonalizationConfig,
} from "../../services/personalization";
import type { Product } from "../../types";

interface AttachmentDesign { state: EditorState; editedFile: File; editedUrl: string; meta: DesignResult["meta"] }
/** `file` is the untouched original; `design` (personalised products only) is the separately saved edited output. */
interface Attachment { id: string; file: File; previewUrl: string; design?: AttachmentDesign }
const releaseUrls = (item: Attachment) => { URL.revokeObjectURL(item.previewUrl); if (item.design) URL.revokeObjectURL(item.design.editedUrl); };

const inputClass = (error?: string) => `w-full border bg-transparent px-4 py-3 disabled:opacity-60 ${error ? "border-red-800" : "border-brass/50"}`;
const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Field({ label, error, required, hint, children }: { label: string; error?: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm">
      <span>{label}{required && <span aria-hidden="true" className="text-brass"> *</span>}</span>
      {children}
      {hint && !error && <span className="text-xs text-walnut/60">{hint}</span>}
      {error && <span role="alert" className="text-xs text-red-800">{error}</span>}
    </label>
  );
}

export default function Customize() {
  const { slug = "" } = useParams();
  const { role } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [config, setConfig] = useState<PersonalizationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<CustomRequestForm>(emptyCustomRequestForm());
  const [errors, setErrors] = useState<CustomRequestFormErrors>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileMessages, setFileMessages] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<SubmitCustomizationResult | null>(null);
  const submitLock = useRef(false); // synchronous guard: state updates are async, so a fast double click could slip through
  const resume = useRef<{ paths: string[]; startedAt: string } | null>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(""); setProduct(null); setConfig(null); setResult(null);
    void getProductBySlug(slug).then(async (found) => {
      const personalization = found?.personalised ? await getPersonalization(found.id) : null;
      if (!active) return;
      setProduct(found);
      setConfig(personalization);
      if (found) setForm(emptyCustomRequestForm(found.name));
    }).catch((reason: unknown) => {
      if (active) setLoadError(reason instanceof Error ? reason.message : "Unable to load this piece.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => () => { attachmentsRef.current.forEach(releaseUrls); }, []);

  // Personalised photos store two files each (original + edited) and a request holds at most 10 attachments.
  const maxFiles = config ? Math.min(EDITOR_MAX_PHOTOS, config.max_images) : CUSTOM_REQUEST_MAX_FILES;
  const printArea: PrintArea = { widthMm: config?.print_width_mm ?? null, heightMm: config?.print_height_mm ?? null };

  async function makeDefaultDesign(file: File): Promise<AttachmentDesign> {
    const src = await loadSourceImage(file);
    try {
      const state = defaultState(src);
      const result = await buildDesignResult(file, src, state, printArea, config?.product_type ?? null);
      return { state, editedFile: result.editedFile, editedUrl: URL.createObjectURL(result.editedFile), meta: result.meta };
    } finally { src.dispose(); }
  }
  const imageRules: ReferenceImageRules | undefined = config ? {
    allowedMimes: personalizationAccept(config).split(","), maxBytes: config.max_image_size_mb * 1024 * 1024, maxFiles,
    minWidth: config.min_image_width_px, minHeight: config.min_image_height_px,
  } : undefined;
  const imageAccept = config ? personalizationAccept(config) : CUSTOM_REQUEST_IMAGE_ACCEPT;

  const update = useCallback(<K extends keyof CustomRequestForm>(key: K, value: CustomRequestForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
    resume.current = null; // the details changed, so an earlier unresolved attempt no longer applies
  }, []);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!chosen.length || submitting) return;
    const messages: string[] = [];
    const accepted: Attachment[] = [];
    const existing = attachmentsRef.current;
    for (const file of chosen) {
      if (existing.length + accepted.length >= maxFiles) { messages.push(`You can attach up to ${maxFiles} images; extra files were skipped.`); break; }
      if ([...existing, ...accepted].some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) { messages.push(`${file.name}: already added.`); continue; }
      const problem = await validateReferenceImage(file, imageRules);
      if (problem) { messages.push(problem); continue; }
      let design: AttachmentDesign | undefined;
      if (config) {
        try { design = await makeDefaultDesign(file); } catch { messages.push(`${file.name}: we couldn't open this photo in the editor. Please choose another.`); continue; }
      }
      accepted.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), design });
    }
    setFileMessages(messages);
    if (accepted.length) {
      setAttachments((current) => [...current, ...accepted]); resume.current = null;
      if (config) setEditingId(accepted[0].id); // open the editor straight away for the first new photo
    }
  }

  async function replaceFile(id: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || submitting) return;
    if (attachmentsRef.current.some((item) => item.id !== id && item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) { setFileMessages([`${file.name}: already added.`]); return; }
    const problem = await validateReferenceImage(file, imageRules);
    if (problem) { setFileMessages([problem]); return; }
    let design: AttachmentDesign | undefined;
    if (config) {
      try { design = await makeDefaultDesign(file); } catch { setFileMessages([`${file.name}: we couldn't open this photo in the editor. Please choose another.`]); return; }
    }
    const previewUrl = URL.createObjectURL(file);
    setFileMessages([]);
    setAttachments((current) => current.map((item) => {
      if (item.id !== id) return item;
      releaseUrls(item); // the old original was never uploaded, so only the local previews need cleaning up
      return { ...item, file, previewUrl, design };
    }));
    resume.current = null;
    if (config) setEditingId(id);
  }

  function saveDesign(id: string, state: EditorState, result: DesignResult) {
    setAttachments((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (item.design) URL.revokeObjectURL(item.design.editedUrl);
      return { ...item, design: { state, editedFile: result.editedFile, editedUrl: URL.createObjectURL(result.editedFile), meta: result.meta } };
    }));
    resume.current = null; // the design changed, so an earlier unresolved attempt no longer applies
    setEditingId(null);
  }

  function removeFile(id: string) {
    if (submitting) return;
    setAttachments((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) releaseUrls(removed);
      return current.filter((item) => item.id !== id);
    });
    resume.current = null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!product || submitLock.current || result) return;
    const found = validateCustomRequestForm(form);
    setErrors(found);
    if (Object.keys(found).length) {
      setSubmitError("Please fix the highlighted fields.");
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    if (config && !attachments.length) { setSubmitError("Add at least one photo to personalise."); return; }
    submitLock.current = true;
    setSubmitting(true); setSubmitError(""); setProgress("Checking your details...");
    try {
      const submitted = await submitCustomization({
        productId: product.id, productName: product.name, form, files: attachments.map((item) => item.file),
        imageRules, extraRequirements: config ? { product_type: config.product_type } : undefined,
        designs: config ? attachments.flatMap((item) => item.design ? [{ editedFile: item.design.editedFile, meta: item.design.meta }] : []) : undefined,
        resume: resume.current, onProgress: setProgress,
      });
      resume.current = null;
      attachments.forEach(releaseUrls);
      setAttachments([]);
      setResult(submitted);
    } catch (error) {
      if (error instanceof CustomRequestSubmitError) resume.current = error.resume;
      else if (!(error instanceof CustomRequestValidationError)) resume.current = null;
      setSubmitError(friendlyCustomRequestError(error));
    } finally {
      submitLock.current = false;
      setSubmitting(false); setProgress("");
    }
  }

  if (loading) return <div className="container-x py-24 text-center text-walnut/70" role="status">Loading this piece...</div>;
  if (loadError) return <div role="alert" className="container-x py-24 text-center text-red-800">{loadError}</div>;
  if (!product) return <div className="container-x py-24 text-center"><h1 className="text-4xl text-walnut">Piece not found</h1><Link to="/shop" className="btn-primary mt-6">Browse the collection</Link></div>;

  if (!product.customizable) {
    return (
      <section className="container-x max-w-2xl py-24 text-center">
        <h1 className="text-4xl text-walnut">This piece can't be customized</h1>
        <p className="mt-4 text-espresso/80">{product.name} is only available as shown. Browse other pieces that can be personalised, or view the product.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4"><Link to={`/product/${product.slug}`} className="btn-primary">View {product.name}</Link><Link to="/shop" className="btn-outline">Browse the collection</Link></div>
      </section>
    );
  }

  if (role && role !== "customer") {
    return (
      <section className="container-x max-w-2xl py-24 text-center">
        <h1 className="text-4xl text-walnut">Customer account required</h1>
        <p className="mt-4 text-espresso/80">Customization requests can only be sent from a customer account.</p>
        <Link to={`/product/${product.slug}`} className="btn-primary mt-8">Back to product</Link>
      </section>
    );
  }

  if (result) {
    return (
      <section className="container-x max-w-2xl py-20 text-center">
        <CheckCircle2 size={44} className="mx-auto text-olive" aria-hidden="true" />
        <h1 className="mt-4 text-4xl text-walnut">Request received</h1>
        <p role="status" className="mt-4 text-espresso/80">Thank you. Our team will review your customization request for <strong>{product.name}</strong> and respond with feasibility and a quote.</p>
        <div className="mx-auto mt-6 max-w-sm border border-brass/50 px-6 py-4">
          <p className="text-xs uppercase tracking-wide text-walnut/70">Request reference</p>
          <p className="mt-1 break-all font-medium text-walnut">{result.requestNumber ?? "Saved — reference unavailable right now"}</p>
        </div>
        <p className="mt-3 text-xs text-walnut/60">Keep this reference if you contact us about your request.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4"><Link to={`/my-requests/${result.requestId}`} className="btn-primary">View my request</Link><Link to="/shop" className="btn-outline">Continue shopping</Link></div>
      </section>
    );
  }

  const unitPrice = product.discountPrice ?? product.price;
  const priceText = config
    ? config.base_price_inr !== null ? `${config.quotation_required ? "Starting from" : "Base price"} ${formatINR(config.base_price_inr)}` : config.quotation_required ? "Quotation on request" : formatINR(unitPrice)
    : `Starting from ${formatINR(unitPrice)}`;
  const choice = (key: "dimensions" | "material" | "colour", label: string, options: string[], fallback: ReactNode) => options.length ? (
    <Field label={label} error={errors[key]}>
      <select value={form[key]} onChange={(e) => update(key, e.target.value)} className={inputClass(errors[key])}>
        <option value="">Choose…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </Field>
  ) : fallback;
  return (
    <section className="container-x py-12 md:py-16">
      <p className="text-sm text-walnut/70"><Link to={`/product/${product.slug}`} className="underline underline-offset-4">{product.name}</Link> / Customize</p>
      <h1 className="mt-2 text-4xl text-walnut">{config ? "Personalise with your photos" : "Customize this piece"}</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <aside className="self-start">
          {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="aspect-[4/5] w-full object-cover" /> : <ProductArt kind={product.art} className="aspect-[4/5] w-full" />}
          <h2 className="mt-4 text-2xl text-espresso">{product.name}</h2>
          <p className="text-sm text-walnut/80">{[product.category, product.material, product.colour].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 font-medium">{priceText}</p>
          {config && <p className="mt-1 text-sm text-walnut/80">{[personalizationTypeLabel(config.product_type), printingAreaSummary(config)].filter(Boolean).join(" · ")}</p>}
          <p className="mt-3 text-sm leading-relaxed text-espresso/80">{product.description}</p>
          <div className="mt-6 border border-brass/40 p-4 text-sm text-espresso/80">
            <h3 className="font-medium text-walnut">How customization works</h3>
            {config ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Upload your photos and choose your options.</li>
                <li>Our team prepares a quotation for you.</li>
                <li>Accept the quotation and pay; production starts after payment.</li>
                <li>Nothing is charged when you send a request.</li>
              </ol>
            ) : <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Tell us what you'd like changed and attach reference images.</li>
              <li>Our team reviews feasibility and replies with a quote and timeline.</li>
              <li>Nothing is charged when you send a request.</li>
            </ol>}
            {!config && <p className="mt-2 text-xs text-walnut/70">The price shown is the standard price; customized pieces may be priced differently.</p>}
          </div>
        </aside>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate aria-busy={submitting} className="grid gap-6">
          <fieldset disabled={submitting} className="grid gap-5">
            <legend className="mb-1 text-xl text-walnut">Your requirements</legend>
            <Field label="Request title" required error={errors.title}>
              <input value={form.title} maxLength={200} onChange={(e) => update("title", e.target.value)} aria-invalid={errors.title ? true : undefined} aria-required className={inputClass(errors.title)} />
            </Field>
            <Field label="What would you like customized?" required error={errors.description} hint={`${form.description.trim().length}/5000`}>
              <textarea rows={5} value={form.description} maxLength={5000} onChange={(e) => update("description", e.target.value)} aria-invalid={errors.description ? true : undefined} aria-required className={inputClass(errors.description)} placeholder="Describe the changes you have in mind: size, finish, engraving, colours, purpose..." />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              {choice("dimensions", "Size", config?.available_sizes ?? [], <Field label="Dimensions" error={errors.dimensions}><input value={form.dimensions} maxLength={300} onChange={(e) => update("dimensions", e.target.value)} placeholder="e.g. 60 × 40 cm" aria-invalid={errors.dimensions ? true : undefined} className={inputClass(errors.dimensions)} /></Field>)}
              <Field label="Quantity" error={errors.quantity}><input inputMode="numeric" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} aria-invalid={errors.quantity ? true : undefined} className={inputClass(errors.quantity)} /></Field>
              {choice("material", "Material", config?.available_materials ?? [], <Field label="Material" error={errors.material}><input value={form.material} maxLength={300} onChange={(e) => update("material", e.target.value)} placeholder={product.material || "e.g. Brass"} aria-invalid={errors.material ? true : undefined} className={inputClass(errors.material)} /></Field>)}
              {choice("colour", "Colour", config?.available_colours ?? [], <Field label="Colour" error={errors.colour}><input value={form.colour} maxLength={300} onChange={(e) => update("colour", e.target.value)} placeholder={product.colour || "e.g. Antique gold"} aria-invalid={errors.colour ? true : undefined} className={inputClass(errors.colour)} /></Field>)}
              <Field label="Finish" error={errors.finish}><input value={form.finish} maxLength={300} onChange={(e) => update("finish", e.target.value)} placeholder="e.g. Matte, polished" aria-invalid={errors.finish ? true : undefined} className={inputClass(errors.finish)} /></Field>
              <Field label="Engraving / text" error={errors.engravingText}><input value={form.engravingText} maxLength={300} onChange={(e) => update("engravingText", e.target.value)} aria-invalid={errors.engravingText ? true : undefined} className={inputClass(errors.engravingText)} /></Field>
            </div>
            <Field label="Style preferences" error={errors.styleNotes} hint="Optional — inspirations, styles, things to avoid.">
              <textarea rows={3} value={form.styleNotes} maxLength={1000} onChange={(e) => update("styleNotes", e.target.value)} aria-invalid={errors.styleNotes ? true : undefined} className={inputClass(errors.styleNotes)} />
            </Field>
            <Field label="Needed by" error={errors.neededBy} hint="Optional — the date you'd like to have it by.">
              <input type="date" value={form.neededBy} onChange={(e) => update("neededBy", e.target.value)} aria-invalid={errors.neededBy ? true : undefined} className={inputClass(errors.neededBy)} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Budget — minimum (₹)" error={errors.budgetMin} hint="Optional"><input inputMode="decimal" value={form.budgetMin} onChange={(e) => update("budgetMin", e.target.value)} aria-invalid={errors.budgetMin ? true : undefined} className={inputClass(errors.budgetMin)} /></Field>
              <Field label="Budget — maximum (₹)" error={errors.budgetMax} hint="Optional"><input inputMode="decimal" value={form.budgetMax} onChange={(e) => update("budgetMax", e.target.value)} aria-invalid={errors.budgetMax ? true : undefined} className={inputClass(errors.budgetMax)} /></Field>
            </div>
          </fieldset>

          <fieldset disabled={submitting} className="grid gap-3">
            <legend className="mb-1 text-xl text-walnut">Reference images</legend>
            <p className="text-sm text-walnut/70">{config ? "Upload the photos to print. " : "Optional. "}{config ? personalizationFormatLabel(config) : "JPEG, PNG or WebP"}, up to {config?.max_image_size_mb ?? 10} MB each{config?.min_image_width_px && config.min_image_height_px ? `, at least ${config.min_image_width_px} × ${config.min_image_height_px} px` : ""}, maximum {maxFiles} images. Images are stored privately and visible only to you and our team. Only upload photos you have the right to use.</p>
            {config?.image_notes && <p className="text-sm text-walnut/70">{config.image_notes}</p>}
            <label className={`btn-outline w-fit cursor-pointer ${submitting || attachments.length >= maxFiles ? "pointer-events-none opacity-50" : ""}`}>
              <ImagePlus size={16} aria-hidden="true" />Add images
              <input type="file" multiple accept={imageAccept} onChange={(e) => void addFiles(e)} className="sr-only" disabled={submitting || attachments.length >= maxFiles} />
            </label>
            {fileMessages.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-800">{fileMessages.map((message) => <li key={message}>{message}</li>)}</ul>}
            {attachments.length > 0 && (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3" aria-label="Attached reference images">
                {attachments.map((item) => (
                  <li key={item.id} className="relative border border-brass/40 p-2">
                    <img src={item.design?.editedUrl ?? item.previewUrl} alt={item.design ? `Edited design for ${item.file.name}` : `Preview of ${item.file.name}`} className={`aspect-square w-full ${item.design ? "object-contain bg-white" : "object-cover"}`} />
                    <p className="mt-2 truncate text-xs text-espresso/80" title={item.file.name}>{item.file.name}</p>
                    <p className="text-xs text-walnut/60">{formatSize(item.file.size)}{item.design ? " · original kept unchanged" : ""}</p>
                    {item.design && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setEditingId(item.id)} className="btn-outline inline-flex items-center gap-1 px-2 py-1 text-xs"><Pencil size={12} aria-hidden="true" />Edit</button>
                        <label className="btn-outline inline-flex cursor-pointer items-center gap-1 px-2 py-1 text-xs"><Replace size={12} aria-hidden="true" />Replace
                          <input type="file" accept={imageAccept} onChange={(e) => void replaceFile(item.id, e)} className="sr-only" aria-label={`Replace ${item.file.name}`} />
                        </label>
                      </div>
                    )}
                    <button type="button" onClick={() => removeFile(item.id)} aria-label={`Remove ${item.file.name}`} className="absolute right-3 top-3 rounded-full bg-cream/90 p-1 text-walnut"><X size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {editingId && (() => {
            const item = attachments.find((entry) => entry.id === editingId);
            return item?.design ? <PhotoEditor key={item.id + item.file.name} file={item.file} initial={item.design.state} area={printArea} productType={config?.product_type ?? null} onCancel={() => setEditingId(null)} onDone={(state, result) => saveDesign(item.id, state, result)} /> : null;
          })()}
          {submitError && <p role="alert" className="border border-red-800/60 bg-red-50 px-4 py-3 text-sm text-red-900">{submitError}</p>}
          {submitting && <p role="status" className="flex items-center gap-2 text-sm text-walnut"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{progress}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={submitting} className="btn-primary disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Sending..." : submitError && resume.current ? "Retry sending" : "Send customization request"}</button>
            <Link to={`/product/${product.slug}`} className={`btn-outline ${submitting ? "pointer-events-none opacity-50" : ""}`}>Cancel</Link>
          </div>
        </form>
      </div>
    </section>
  );
}
