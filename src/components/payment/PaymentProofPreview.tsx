import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, FileText } from "lucide-react";
import { createProofViewUrl } from "../../services/paymentProof";

const VIEW_SECONDS = 120;
const isPdf = (path: string) => path.toLowerCase().endsWith(".pdf");

const styles = {
  customer: {
    button: "inline-flex items-center gap-2 border border-brass px-3 py-2 text-sm text-walnut transition hover:bg-brass hover:text-cream disabled:opacity-50",
    frame: "border border-brass/40 bg-white p-2",
    link: "text-sm text-walnut underline",
    muted: "text-xs text-walnut/70",
    error: "text-sm text-red-700",
  },
  admin: {
    button: "inline-flex items-center gap-2 border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50",
    frame: "border border-slate-700 bg-[#0b1524] p-2",
    link: "text-xs text-sky-200 underline",
    muted: "text-xs text-slate-500",
    error: "text-xs text-red-300",
  },
} as const;

/**
 * Shows a payment proof from the private payment-proofs bucket. A short-lived signed URL is requested only when the
 * viewer asks for it and is dropped again after two minutes, so the file is never public and no long-lived link exists.
 * Storage access rules decide who may succeed: the customer who owns the file, and super admins.
 */
export default function PaymentProofPreview({ path, variant }: { path: string; variant: "customer" | "admin" }) {
  const s = styles[variant];
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { setUrl(""); setError(""); setExpired(false); window.clearTimeout(timer.current); }, [path]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function show() {
    setLoading(true);
    setError("");
    setExpired(false);
    try {
      const signed = await createProofViewUrl(path);
      setUrl(signed);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setUrl(""); setExpired(true); }, (VIEW_SECONDS - 10) * 1000);
    } catch {
      setError("The proof file couldn't be opened. It may have been removed, or you may not have access.");
    } finally {
      setLoading(false);
    }
  }

  function hide() {
    window.clearTimeout(timer.current);
    setUrl("");
    setExpired(false);
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {url
          ? <button type="button" onClick={hide} className={s.button}><EyeOff size={15} aria-hidden="true" />Hide proof</button>
          : <button type="button" onClick={() => void show()} disabled={loading} className={s.button}><Eye size={15} aria-hidden="true" />{loading ? "Opening..." : expired ? "View proof again" : "View submitted proof"}</button>}
        <span className={s.muted}>Private file. The link works for {VIEW_SECONDS / 60} minutes.</span>
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {expired && !url && <p role="status" className={s.muted}>The link expired for your security.</p>}
      {url && (isPdf(path)
        ? <div className={`${s.frame} flex items-center gap-3`}><FileText size={22} aria-hidden="true" /><a href={url} target="_blank" rel="noopener noreferrer" className={s.link}>Open the PDF in a new tab</a></div>
        : <div className={`${s.frame} grid gap-2`}>
            <img src={url} alt="Submitted payment proof" className="max-h-96 w-full object-contain" />
            <a href={url} target="_blank" rel="noopener noreferrer" className={s.link}>Open full size in a new tab</a>
          </div>)}
    </div>
  );
}
