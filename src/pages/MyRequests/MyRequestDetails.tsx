import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, ImageOff } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { friendlyMyRequestsError, getMyAttachmentLinks, getMyCustomRequestDetail, type AttachmentLink, type MyRequestDetail } from "../../services/customRequests";
import { budgetText, customerRequestStatusHint, readableEntries } from "../../utils/customRequestStatus";
import { formatDate, formatDateTime } from "../../utils/orderStatus";
import { RequestStatusBadge } from "./MyRequests";
import QuotationSection from "./QuotationSection";

function Entries({ title, entries, empty }: { title: string; entries: [string, string][]; empty: string }) {
  return (
    <section className="border border-brass/40 p-5">
      <h2 className="text-lg text-walnut">{title}</h2>
      {entries.length ? <dl className="mt-3 grid gap-2 text-sm">{entries.map(([k, v]) => <div key={k} className="grid gap-0.5 sm:grid-cols-[10rem_1fr]"><dt className="text-walnut/70">{k}</dt><dd className="break-words text-espresso">{v}</dd></div>)}</dl> : <p className="mt-3 text-sm text-walnut/60">{empty}</p>}
    </section>
  );
}

export default function MyRequestDetails() {
  const { requestId = "" } = useParams();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [detail, setDetail] = useState<MyRequestDetail | null>(null);
  const [links, setLinks] = useState<AttachmentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  const loadLinks = useCallback(async (paths: string[]) => {
    setBrokenImages(new Set());
    setLinks(await getMyAttachmentLinks(userId, paths));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true); setError(""); setDetail(null); setLinks([]);
    void getMyCustomRequestDetail(userId, requestId).then(async (result) => {
      if (!active) return;
      setDetail(result);
      if (result?.request.attachment_paths.length) {
        const signed = await getMyAttachmentLinks(userId, result.request.attachment_paths);
        if (active) setLinks(signed);
      }
    }).catch((reason: unknown) => { if (active) setError(friendlyMyRequestsError(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, requestId, attempt]);

  if (loading) return <section className="container-x py-24 text-center"><p role="status" className="text-walnut/70">Loading your request...</p></section>;
  if (error) return <section className="container-x py-24 text-center"><p role="alert" className="mx-auto max-w-md text-red-800">{error}</p><div className="mt-6 flex justify-center gap-4"><button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-outline">Try again</button><Link to="/my-requests" className="btn-primary">My requests</Link></div></section>;
  if (!detail) return <section className="container-x py-24 text-center"><h1 className="text-4xl text-walnut">Request not found</h1><p className="mt-3 text-espresso/70">We couldn't find this request in your account.</p><Link to="/my-requests" className="btn-primary mt-6">My requests</Link></section>;

  const { request, replies, productSlug } = detail;
  return (
    <section className="container-x max-w-4xl py-12 md:py-16">
      <p className="text-sm text-walnut/70"><Link to="/my-requests" className="underline underline-offset-4">My requests</Link></p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h1 className="break-words text-4xl text-walnut">{request.title}</h1><p className="mt-2 text-sm text-walnut/70">Reference {request.request_number} · Submitted {formatDateTime(request.created_at)}</p></div>
        <RequestStatusBadge status={request.status} />
      </div>
      <p className="mt-4 text-sm text-espresso/80">{customerRequestStatusHint[request.status]} <span className="text-walnut/60">Status last updated {formatDate(request.updated_at)}.</span></p>

      <div className="mt-8 grid gap-5">
        <section className="border border-brass/40 p-5">
          <h2 className="text-lg text-walnut">Request</h2>
          <p className="mt-3 text-sm text-espresso/80">Product: {productSlug ? <Link to={`/product/${productSlug}`} className="underline underline-offset-4">{request.requested_product}</Link> : request.requested_product}</p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-espresso">{request.description}</p>
          <p className="mt-3 text-sm text-espresso/80">Budget: {budgetText(request.budget_min_inr, request.budget_max_inr)}</p>
        </section>
        <div className="grid gap-5 md:grid-cols-2">
          <Entries title="Specifications" entries={readableEntries(request.requirements)} empty="No specifications provided." />
          <Entries title="Preferences" entries={readableEntries(request.preferences)} empty="No preferences provided." />
        </div>

        <QuotationSection requestId={request.id} />

        <section className="border border-brass/40 p-5">
          <h2 className="text-lg text-walnut">Replies from our team</h2>
          {replies.length ? (
            <ul className="mt-3 grid gap-4">{replies.map((reply) => <li key={reply.id} className="border-l-2 border-brass pl-4"><p className="whitespace-pre-wrap break-words text-sm text-espresso">{reply.response}</p><p className="mt-1 text-xs text-walnut/60">{formatDateTime(reply.created_at)}</p></li>)}</ul>
          ) : <p className="mt-3 text-sm text-walnut/60">No reply yet. We'll post it here as soon as our team responds.</p>}
        </section>

        <section className="border border-brass/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg text-walnut">Your reference images</h2>
            {request.attachment_paths.length > 0 && <button type="button" onClick={() => void loadLinks(request.attachment_paths)} className="text-sm underline underline-offset-4">Refresh links</button>}
          </div>
          {request.attachment_paths.length === 0 && <p className="mt-3 text-sm text-walnut/60">You didn't attach any images.</p>}
          {request.attachment_paths.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {links.map((item, index) => (
                <li key={item.path} className="border border-brass/30 p-2">
                  {item.url && !brokenImages.has(item.path)
                    ? <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open image ${index + 1} in a new tab`}><img src={item.url} alt={`Reference image ${index + 1}`} loading="lazy" onError={() => setBrokenImages((s) => new Set(s).add(item.path))} className="aspect-square w-full object-cover" /></a>
                    : <div className="flex aspect-square flex-col items-center justify-center gap-2 text-center text-xs text-walnut/60"><ImageOff size={22} aria-hidden="true" />Image unavailable</div>}
                  <p className="mt-2 flex items-center justify-between text-xs text-walnut/70">Image {index + 1}{item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open image ${index + 1}`}><ExternalLink size={13} /></a>}</p>
                </li>
              ))}
              {links.length === 0 && request.attachment_paths.map((p, i) => <li key={p} className="border border-brass/30 p-2 text-xs text-walnut/60">Loading image {i + 1}...</li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-walnut/60">Images are private. Links expire after a few minutes; use “Refresh links” if one stops working.</p>
        </section>
      </div>
    </section>
  );
}
