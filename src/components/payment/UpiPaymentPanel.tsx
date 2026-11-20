import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, Copy, FileText, RefreshCw, Smartphone, Upload, X } from "lucide-react";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { formatINR } from "../../utils/currency";
import {
  PROOF_ACCEPT, buildUpiUri, friendlyPaymentError, getUpiPaymentDetails, submitPaymentProof, validateProofFile, validateReference,
  type UpiPaymentDetails,
} from "../../services/paymentProof";
import type { OrderPaymentStatus } from "../../types/database";
import PaymentProofPreview from "./PaymentProofPreview";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const statusText: Record<OrderPaymentStatus, { label: string; tone: string }> = {
  pending: { label: "Awaiting your payment", tone: "border-brass bg-brass/10 text-walnut" },
  verification_pending: { label: "Submitted, being verified", tone: "border-brass bg-brass/10 text-walnut" },
  paid: { label: "Payment verified", tone: "border-olive bg-olive/10 text-olive" },
  failed: { label: "Needs attention", tone: "border-red-700 bg-red-50 text-red-800" },
  cod_due: { label: "Cash on delivery", tone: "border-brass bg-brass/10 text-walnut" },
  refunded: { label: "Refunded", tone: "border-brass bg-brass/10 text-walnut" },
};

function loadErrorText(reason: unknown): string {
  const e = (typeof reason === "object" && reason !== null ? reason : {}) as { code?: string; message?: string };
  if (e.code === "P0002") return "We couldn't find this order in your account.";
  if (e.code === "22023" && e.message) return e.message;
  if (e.code === "42501") return "Please sign in to see this order's payment details.";
  return "We couldn't load the payment details. Please check your connection and try again.";
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`} className="inline-flex items-center gap-1 border border-brass/60 px-2 py-1 text-xs text-walnut transition hover:bg-brass hover:text-cream">
      <Copy size={12} aria-hidden="true" />{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

interface Props {
  orderId: string;
  /** Called after details were successfully submitted, so a parent can refresh anything that shows the payment status. */
  onSubmitted?: () => void;
}

/**
 * Customer-facing UPI payment step for one order: where to pay, the exact amount from the database, the order
 * reference, and a form for the transaction reference and an optional private screenshot. Submitting never marks the
 * order paid; it only asks the store to verify the payment.
 */
export default function UpiPaymentPanel({ orderId, onSubmitted }: Props) {
  const { settings } = useStoreSettings();
  const [details, setDetails] = useState<UpiPaymentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [reference, setReference] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState("");
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [qrBroken, setQrBroken] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const next = await getUpiPaymentDetails(orderId);
      setDetails(next);
      setLoadError("");
      return next;
    } catch (reason) {
      setLoadError(loadErrorText(reason));
      return null;
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    setDetails(null); setEditing(false); setNotice(""); setFormError("");
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setFilePreview(""); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearFile() {
    setFile(null);
    setFileError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function chooseFile(chosen: File | null) {
    setFormError("");
    if (!chosen) { clearFile(); return; }
    const problem = await validateProofFile(chosen);
    if (problem) { clearFile(); setFileError(problem); return; }
    setFileError("");
    setFile(chosen);
  }

  function startEditing() {
    setReference(details?.transactionReference ?? "");
    setReferenceError(""); setFormError(""); setNotice("");
    clearFile();
    setEditing(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || submittingRef.current) return;
    setFormError("");
    const problem = validateReference(reference);
    setReferenceError(problem);
    if (problem) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { cleanupWarning } = await submitPaymentProof({ orderId, reference, file, previousProofPath: details.proofPath });
      clearFile();
      setEditing(false);
      setNotice(cleanupWarning ?? "Thank you. Your payment details were submitted. We'll confirm your payment once our team has checked it against our bank records.");
      await load(false);
      onSubmitted?.();
    } catch (reason) {
      setFormError(friendlyPaymentError(reason));
      // The outcome may be unknown after a dropped connection, so show the latest recorded state.
      void load(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (loading) return <section className="mt-10 border border-brass/40 p-6"><p role="status" className="text-sm text-walnut/70">Loading payment details...</p></section>;
  if (loadError || !details) {
    return (
      <section className="mt-10 border border-brass/40 p-6">
        <h2 className="text-2xl text-walnut">Pay by UPI</h2>
        <p role="alert" className="mt-3 text-sm text-red-700">{loadError || "Payment details are unavailable."}</p>
        <button type="button" onClick={() => void load(true)} className="btn-outline mt-4"><RefreshCw size={15} aria-hidden="true" />Try again</button>
      </section>
    );
  }

  const status = statusText[details.paymentStatus];
  const upiUri = buildUpiUri(details);
  const supportContact = settings.support_email || settings.contact_email || settings.support_phone || settings.contact_phone;
  const showInstructions = details.canSubmit;
  const showForm = details.canSubmit && (details.paymentStatus !== "verification_pending" || editing);

  return (
    <section className="mt-10 border border-brass/40 p-6" aria-labelledby="upi-payment-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="upi-payment-title" className="text-2xl text-walnut">Pay by UPI</h2>
          <p className="mt-1 text-sm text-walnut/70">Order {details.orderNumber}</p>
        </div>
        <span className={`inline-flex items-center border px-3 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>
      </div>

      <div className="mt-5">
        <p className="text-sm text-walnut/70">Amount to pay</p>
        <p className="font-display text-4xl text-walnut">{formatINR(details.amountInr)}</p>
        <p className="mt-1 text-xs text-walnut/70">This is the total for the order, including delivery and any coupon. Please pay exactly this amount.</p>
      </div>

      {details.paymentStatus === "paid" && (
        <p role="status" className="mt-6 flex items-start gap-3 border-l-2 border-olive pl-4 text-sm text-espresso">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-olive" aria-hidden="true" />
          <span>Your payment was verified{details.verifiedAt ? ` on ${formatDate(details.verifiedAt)}` : ""}. Thank you.</span>
        </p>
      )}
      {!details.canSubmit && details.paymentStatus !== "paid" && details.blockReason && (
        <p role="status" className="mt-6 border-l-2 border-brass pl-4 text-sm text-espresso">{details.blockReason}</p>
      )}
      {details.paymentStatus === "failed" && details.canSubmit && (
        <p role="alert" className="mt-6 flex items-start gap-3 border-l-2 border-red-700 pl-4 text-sm text-espresso">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
          <span>We couldn't verify this payment. Please check the reference and submit again{supportContact ? `, or contact us at ${supportContact}` : ""}.</span>
        </p>
      )}

      {showInstructions && (
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid content-start gap-4">
            {details.upiId ? (
              <dl className="grid gap-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brass/30 pb-3"><dt className="text-walnut/70">UPI ID</dt><dd className="flex items-center gap-3"><strong className="break-all text-walnut">{details.upiId}</strong><CopyButton value={details.upiId} label="UPI ID" /></dd></div>
                {details.payeeName && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brass/30 pb-3"><dt className="text-walnut/70">Payee name</dt><dd className="text-walnut">{details.payeeName}</dd></div>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brass/30 pb-3"><dt className="text-walnut/70">Amount</dt><dd className="flex items-center gap-3"><strong className="text-walnut">{formatINR(details.amountInr)}</strong><CopyButton value={details.amountInr.toFixed(2)} label="amount" /></dd></div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brass/30 pb-3"><dt className="text-walnut/70">Order reference</dt><dd className="flex items-center gap-3"><strong className="text-walnut">{details.orderNumber}</strong><CopyButton value={details.orderNumber} label="order reference" /></dd></div>
              </dl>
            ) : (
              <p role="status" className="flex items-start gap-3 border-l-2 border-brass pl-4 text-sm text-espresso">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-brass" aria-hidden="true" />
                <span>The store hasn't published a UPI ID yet. Please follow the instructions below{supportContact ? ` or contact us at ${supportContact}` : ""} before paying.</span>
              </p>
            )}
            {upiUri && (
              <div>
                <a href={upiUri} className="btn-primary"><Smartphone size={16} aria-hidden="true" />Open my UPI app</a>
                <p className="mt-2 text-xs text-walnut/70">On a phone this opens your UPI app with the details filled in. On a computer, scan the QR code with your phone instead.</p>
              </div>
            )}
            {details.paymentInstructions && <p className="whitespace-pre-line border-l-2 border-brass pl-4 text-sm text-walnut/90">{details.paymentInstructions}</p>}
            {!details.upiEnabled && <p className="text-xs text-walnut/70">The store has paused UPI for new orders. If anything looks unclear, contact us before paying{supportContact ? ` at ${supportContact}` : ""}.</p>}
          </div>
          {details.qrUrl && !qrBroken && (
            <figure className="justify-self-center">
              <img src={details.qrUrl} alt={`UPI QR code${details.payeeName ? ` for ${details.payeeName}` : ""}`} onError={() => setQrBroken(true)} className="h-48 w-48 border border-brass/40 bg-white object-contain p-2" />
              <figcaption className="mt-2 text-center text-xs text-walnut/70">Scan with any UPI app</figcaption>
            </figure>
          )}
        </div>
      )}

      {details.paymentStatus === "verification_pending" && (
        <div className="mt-6 grid gap-4 border border-brass/40 bg-brass/5 p-4">
          <p role="status" className="flex items-start gap-3 text-sm text-espresso">
            <Clock size={18} className="mt-0.5 shrink-0 text-brass" aria-hidden="true" />
            <span>{notice || "Your payment details were submitted. We'll confirm your payment once our team has checked it against our bank records."}</span>
          </p>
          <dl className="grid gap-1 text-sm">
            <div className="flex flex-wrap gap-2"><dt className="text-walnut/70">Transaction reference:</dt><dd className="break-all text-walnut">{details.transactionReference}</dd></div>
            {details.submittedAt && <div className="flex flex-wrap gap-2"><dt className="text-walnut/70">Submitted:</dt><dd className="text-walnut">{formatDate(details.submittedAt)}</dd></div>}
          </dl>
          {details.proofPath ? <PaymentProofPreview path={details.proofPath} variant="customer" /> : <p className="text-xs text-walnut/70">No screenshot was attached.</p>}
          <p className="text-xs text-walnut/70">Your order stays unpaid until the payment is verified. A screenshot or reference on its own does not confirm payment.</p>
          {details.canSubmit && !editing && <div><button type="button" onClick={startEditing} className="btn-outline">Correct or add details</button></div>}
        </div>
      )}
      {notice && details.paymentStatus !== "verification_pending" && <p role="status" className="mt-4 text-sm text-olive">{notice}</p>}

      {showForm && (
        <form onSubmit={(event) => void submit(event)} noValidate className="mt-6 grid gap-5 border-t border-brass/40 pt-6">
          <div>
            <h3 className="text-xl text-walnut">{details.paymentStatus === "verification_pending" ? "Update your payment details" : "I've paid. Confirm my payment"}</h3>
            <p className="mt-1 text-sm text-walnut/70">After paying, enter the transaction reference from your UPI app and, if you can, attach a screenshot.</p>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="text-walnut">Transaction reference (UTR)</span>
            <input
              value={reference} onChange={(event) => { setReference(event.target.value); if (referenceError) setReferenceError(validateReference(event.target.value)); }}
              onBlur={() => { if (reference.trim()) setReferenceError(validateReference(reference)); }}
              maxLength={100} autoComplete="off" inputMode="text" placeholder="e.g. 412345678901"
              aria-invalid={referenceError ? true : undefined} aria-describedby="reference-help"
              className="border border-brass/60 bg-white px-3 py-2.5 text-espresso" required
            />
            <span id="reference-help" className={`text-xs ${referenceError ? "text-red-700" : "text-walnut/70"}`} role={referenceError ? "alert" : undefined}>
              {referenceError || "Find it in your UPI app under the payment's details. It is usually a 12-digit number."}
            </span>
          </label>

          <div className="grid gap-2 text-sm">
            <span className="text-walnut">Payment screenshot <span className="text-walnut/60">(optional, JPEG, PNG, WebP or PDF, up to 10 MB)</span></span>
            {!file ? (
              <label className="flex cursor-pointer items-center gap-3 border border-dashed border-brass/70 px-4 py-4 text-walnut transition hover:bg-brass/10">
                <Upload size={18} aria-hidden="true" />
                <span>Choose a file</span>
                <input ref={fileInput} type="file" accept={PROOF_ACCEPT} onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} className="sr-only" />
              </label>
            ) : (
              <div className="flex flex-wrap items-center gap-4 border border-brass/40 p-3">
                {filePreview
                  ? <img src={filePreview} alt="Preview of the screenshot you chose" className="h-24 w-24 border border-brass/40 object-cover" />
                  : <span className="grid h-24 w-24 place-items-center border border-brass/40 text-walnut"><FileText size={28} aria-hidden="true" /></span>}
                <div className="min-w-0 flex-1"><p className="truncate text-walnut">{file.name}</p><p className="text-xs text-walnut/70">{formatSize(file.size)}</p></div>
                <button type="button" onClick={clearFile} className="inline-flex items-center gap-1 text-xs text-walnut underline"><X size={13} aria-hidden="true" />Remove</button>
              </div>
            )}
            {fileError && <p role="alert" className="text-xs text-red-700">{fileError}</p>}
            <p className="text-xs text-walnut/70">Your file is stored privately. Only you and our payments team can open it.</p>
          </div>

          {formError && <p role="alert" className="border-l-2 border-red-700 pl-3 text-sm text-red-700">{formError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">{submitting ? "Submitting..." : details.paymentStatus === "verification_pending" ? "Save updated details" : "Submit payment details"}</button>
            {editing && <button type="button" onClick={() => { setEditing(false); setFormError(""); clearFile(); }} disabled={submitting} className="btn-outline">Cancel</button>}
          </div>
          <p className="text-xs text-walnut/70">Submitting doesn't confirm your payment. Our team marks it as paid only after checking it against our bank records.</p>
        </form>
      )}
    </section>
  );
}
