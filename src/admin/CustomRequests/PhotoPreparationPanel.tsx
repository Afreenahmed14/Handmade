import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Image as ImageIcon, Loader2, Pencil, RefreshCw } from "lucide-react";
import PhotoEditor from "../../components/photoEditor/PhotoEditor";
import type { DesignResult, EditorState } from "../../components/photoEditor/editorModel";
import { useAuth } from "../../context/AuthContext";
import {
  PRODUCTION_NOTES_MAX, PhotoPreparationUnavailableError, downloadPrivateImage, friendlyPhotoPreparationError, getPhotoPreparations,
  loadPrivateImageAsFile, savePhotoPreparation, signPreviewUrls, updatePhotoPreparation, type PhotoPreparation, type PreparationStart,
} from "../../services/photoPreparation";
import type { CustomRequestStatus, Json } from "../../types/database";
import {
  PHOTO_STAGES, achievedStages, asRecord, editorStateFromMeta, groupPreparations, parsePhotoSets, photoStage, stageIndex, summarizeMeta, type PhotoSet,
} from "../../utils/photoDesign";

type NotifyTone = "success" | "error" | "warning";
interface Props {
  requestId: string;
  requestNumber: string;
  status: CustomRequestStatus;
  preferences: Json;
  attachmentPaths: string[];
  notify: (text: string, tone: NotifyTone) => void;
}

interface EditingSession { set: PhotoSet; file: File; initial: EditorState | null; from: PreparationStart }
interface Draft { set: PhotoSet; result: DesignResult; from: PreparationStart; notes: string; ready: boolean }

const button = "inline-flex items-center gap-1.5 border border-brass/50 px-3 py-1.5 text-xs text-espresso hover:bg-[#eadbd2] disabled:opacity-50";
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (value: string) => dateFormat.format(new Date(value));
const extensionOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "jpg";

function Tile({ title, path, url, caption, downloading, onDownload, emptyText, onImageError }: {
  title: string; path: string | null; url: string | null | undefined; caption?: string; downloading: boolean;
  onDownload: () => void; emptyText: string; onImageError: () => void;
}) {
  return (
    <figure className="grid content-start gap-2 border border-brass/40 bg-cream p-3">
      <figcaption className="text-xs font-medium uppercase tracking-wide text-espresso/65">{title}</figcaption>
      {path ? (
        <>
          <div className="grid h-48 place-items-center overflow-hidden bg-white">
            {url
              ? <img src={url} alt={`${title}`} referrerPolicy="no-referrer" onError={onImageError} className="max-h-48 max-w-full object-contain" />
              : <span className="px-2 text-center text-xs text-espresso/55">Preview unavailable. Use Refresh previews.</span>}
          </div>
          {caption && <p className="text-[11px] text-espresso/55">{caption}</p>}
          <button type="button" className={button} onClick={onDownload} disabled={downloading}>
            {downloading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}Download
          </button>
        </>
      ) : <div className="grid h-48 place-items-center bg-white/50 px-3 text-center text-xs text-espresso/55">{emptyText}</div>}
    </figure>
  );
}

/** Notes + ready flag of the CURRENT prepared version. Remounted (via key) whenever the stored row changes. */
function CurrentPreparationForm({ prep, locked, onSaved, notify }: { prep: PhotoPreparation; locked: boolean; onSaved: () => void; notify: Props["notify"] }) {
  const [notes, setNotes] = useState(prep.production_notes ?? "");
  const [ready, setReady] = useState(prep.is_ready_for_quotation);
  const [saving, setSaving] = useState(false);
  const dirty = notes.trim() !== (prep.production_notes ?? "").trim() || ready !== prep.is_ready_for_quotation;

  async function save() {
    setSaving(true);
    try {
      await updatePhotoPreparation(prep.id, notes, ready);
      notify("Photo notes saved.", "success");
      onSaved();
    } catch (error) {
      notify(friendlyPhotoPreparationError(error), "error");
    } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-3 border border-brass/40 bg-cream p-3">
      <label className="grid gap-1 text-xs text-espresso/65">Internal production notes (admin-only)
        <textarea value={notes} maxLength={PRODUCTION_NOTES_MAX} rows={3} disabled={locked || saving} onChange={(event) => setNotes(event.target.value)}
          className="resize-y border border-brass/50 bg-white px-3 py-2 text-sm text-white disabled:opacity-60" />
      </label>
      <label className="flex items-start gap-2 text-sm text-espresso">
        <input type="checkbox" checked={ready} disabled={locked || saving} onChange={(event) => setReady(event.target.checked)} className="mt-1" />
        <span>Ready for quotation<span className="block text-xs text-espresso/55">Marks this prepared version as final for this photo. It does not create a quotation.</span></span>
      </label>
      {prep.is_ready_for_quotation && prep.ready_marked_at && <p className="text-xs text-emerald-300">Marked ready {formatDate(prep.ready_marked_at)}.</p>}
      {!locked && <div className="flex justify-end"><button type="button" className={button} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save notes"}</button></div>}
    </div>
  );
}

export default function PhotoPreparationPanel({ requestId, requestNumber, status, preferences, attachmentPaths, notify }: Props) {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { sets, ignoredEntries } = useMemo(() => parsePhotoSets(preferences, attachmentPaths), [preferences, attachmentPaths]);

  const [preps, setPreps] = useState<PhotoPreparation[]>([]);
  const [prepState, setPrepState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [urlVersion, setUrlVersion] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingSession | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastRefresh = useRef(0);

  const grouped = useMemo(() => groupPreparations(preps), [preps]);
  const locked = status === "completed" || status === "rejected";
  const canPrepare = isSuperAdmin && prepState === "ready" && !locked;
  const isDownloading = (path: string | null | undefined) => Boolean(path) && downloading === path;

  useEffect(() => {
    if (!isSuperAdmin) return;
    let active = true;
    setPrepState("loading");
    void getPhotoPreparations(requestId)
      .then((rows) => { if (active) { setPreps(rows); setPrepState("ready"); } })
      .catch((error: unknown) => {
        if (!active) return;
        setPreps([]);
        setPrepState(error instanceof PhotoPreparationUnavailableError ? "unavailable" : "error");
        if (!(error instanceof PhotoPreparationUnavailableError)) notify(friendlyPhotoPreparationError(error), "error");
      });
    return () => { active = false; };
  }, [requestId, reload, isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Thumbnails: original, customer-edited and the current admin-prepared file of each photo, signed in one request.
  const previewPaths = useMemo(() => sets.flatMap((set) => [set.originalPath, set.customerEditedPath, grouped.get(set.key)?.[0]?.prepared_path ?? null].filter((p): p is string => Boolean(p))), [sets, grouped]);
  const previewKey = previewPaths.join("|");
  useEffect(() => {
    if (!isSuperAdmin || !previewPaths.length || prepState === "loading") return;
    let active = true;
    setUrlsLoading(true);
    void signPreviewUrls(previewPaths)
      .then((result) => { if (active) setUrls(result); })
      .catch(() => { if (active) { setUrls({}); notify("Photo previews could not be loaded.", "error"); } })
      .finally(() => { if (active) setUrlsLoading(false); });
    return () => { active = false; };
  }, [previewKey, urlVersion, isSuperAdmin, prepState]); // eslint-disable-line react-hooks/exhaustive-deps

  // A preview URL that expired mid-session fails to load: mint fresh ones (at most once per 15 seconds, so it cannot loop).
  const onImageError = useCallback(() => {
    if (Date.now() - lastRefresh.current < 15000) return;
    lastRefresh.current = Date.now();
    setUrlVersion((value) => value + 1);
  }, []);

  // Local preview of the freshly rendered file in the review dialog.
  const draftFile = draft?.result.editedFile ?? null;
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!draftFile) { setDraftUrl(null); return; }
    const url = URL.createObjectURL(draftFile);
    setDraftUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draftFile]);
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) setDraft(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, saving]);

  async function download(path: string, kind: string, position: number) {
    setDownloading(path);
    try { await downloadPrivateImage(path, `${requestNumber}-photo${position}-${kind}.${extensionOf(path)}`); }
    catch (error) { notify(friendlyPhotoPreparationError(error), "error"); }
    finally { setDownloading(null); }
  }

  async function openEditor(set: PhotoSet, from: PreparationStart) {
    if (opening) return;
    setOpening(`${set.key}:${from}`);
    try {
      const file = await loadPrivateImageAsFile(set.originalPath); // always edit from the untouched original, never a re-encoded copy
      let initial: EditorState | null = null;
      if (from === "admin_version") initial = editorStateFromMeta(asRecord(grouped.get(set.key)?.[0]?.preparation_meta));
      else if (from === "customer_design") initial = editorStateFromMeta(set.customerMeta);
      if (from !== "original" && !initial) notify("The saved settings could not be reused, so the editor opened on the original photo.", "warning");
      setEditing({ set, file, initial, from: initial ? from : "original" });
    } catch (error) {
      notify(friendlyPhotoPreparationError(error), "error");
    } finally { setOpening(null); }
  }

  function onEditorDone(result: DesignResult) {
    if (!editing) return;
    setDraftError("");
    setDraft({ set: editing.set, result, from: editing.from, notes: grouped.get(editing.set.key)?.[0]?.production_notes ?? "", ready: false });
    setEditing(null);
  }

  async function saveDraft() {
    if (!draft || saving) return;
    setSaving(true); setDraftError("");
    try {
      await savePhotoPreparation({ requestId, originalPath: draft.set.originalPath, result: draft.result, startedFrom: draft.from, productionNotes: draft.notes, markReady: draft.ready });
      setDraft(null);
      setReload((value) => value + 1);
      notify("Prepared photo saved. The original and the customer's version are unchanged.", "success");
    } catch (error) {
      setDraftError(friendlyPhotoPreparationError(error)); // the draft stays open so nothing the admin did is lost
    } finally { setSaving(false); }
  }

  if (!isSuperAdmin) return <section className="border border-brass/40 p-4"><h3 className="font-medium text-white">Photo preparation</h3><p className="mt-2 text-sm text-espresso/55">Photo preparation is available to super admins only.</p></section>;

  return (
    <section className="border border-brass/40 p-4" aria-labelledby="photo-prep-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="photo-prep-title" className="flex items-center gap-2 font-medium text-white"><ImageIcon size={16} />Photo preparation</h3>
        <button type="button" className={button} disabled={urlsLoading || !previewPaths.length} onClick={() => setUrlVersion((value) => value + 1)}><RefreshCw size={13} className={urlsLoading ? "animate-spin" : ""} aria-hidden="true" />Refresh previews</button>
      </div>
      <p className="mt-1 text-xs text-espresso/55">Originals and customer edits are never changed. Your prepared version is saved as a separate private file. Previews expire after 2 minutes; downloads after 1 minute.</p>

      {prepState === "unavailable" && <p role="status" className="mt-3 border-l-2 border-amber-500 pl-3 text-sm text-amber-200">Preparing photos is not enabled yet because the Phase 2B database migration has not been applied. Previews and downloads still work.</p>}
      {prepState === "error" && <p role="alert" className="mt-3 border-l-2 border-red-400 pl-3 text-sm text-red-200">Saved preparations could not be loaded. <button type="button" className="underline" onClick={() => setReload((value) => value + 1)}>Try again</button></p>}
      {locked && <p className="mt-3 text-xs text-espresso/65">This request is {status}; photo preparation is read-only.</p>}
      {ignoredEntries > 0 && <p className="mt-3 text-xs text-amber-200">{ignoredEntries} design entr{ignoredEntries === 1 ? "y" : "ies"} in the customer's metadata did not match this request's attachments and {ignoredEntries === 1 ? "was" : "were"} ignored.</p>}
      {!sets.length && <p className="mt-4 text-sm text-espresso/55">This request has no customer photos.</p>}

      <div className="mt-4 grid gap-6">
        {sets.map((set) => {
          const versions = grouped.get(set.key) ?? [];
          const current = versions[0] ?? null;
          const stage = photoStage(set, current);
          const achieved = achievedStages(set, current);
          const summary = current ? summarizeMeta(current.preparation_meta) : null;
          const customerUsable = editorStateFromMeta(set.customerMeta) !== null;
          const busyHere = opening?.startsWith(`${set.key}:`) ?? false;
          return (
            <article key={set.key} className="grid gap-4 border-t border-brass/30 pt-4 first:border-t-0 first:pt-0" aria-label={`Photo ${set.position}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-medium text-espresso">Photo {set.position}{set.productType ? <span className="ml-2 text-xs font-normal text-espresso/55">{set.productType}</span> : null}</h4>
                <ol className="flex flex-wrap gap-1.5" aria-label={`Photo ${set.position} status`}>
                  {PHOTO_STAGES.map((item, index) => (
                    <li key={item.stage} aria-current={index === stageIndex(stage) ? "step" : undefined}
                      className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] ${index === stageIndex(stage) ? "border-walnut bg-sky-950/50 text-walnut" : achieved[index] ? "border-emerald-800 bg-emerald-950/30 text-emerald-200" : "border-brass/40 text-espresso/55"}`}>
                      {achieved[index] && <Check size={11} aria-hidden="true" />}{item.label}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Tile title="Original (customer)" path={set.originalPath} url={urls[set.originalPath]} downloading={isDownloading(set.originalPath)} onImageError={onImageError}
                  caption={set.originalAttachmentNumber ? `Attachment ${set.originalAttachmentNumber}` : undefined} emptyText="" onDownload={() => void download(set.originalPath, "original", set.position)} />
                <Tile title="Customer edited" path={set.customerEditedPath} url={set.customerEditedPath ? urls[set.customerEditedPath] : null} downloading={isDownloading(set.customerEditedPath)} onImageError={onImageError}
                  caption={set.editedAttachmentNumber ? `Attachment ${set.editedAttachmentNumber}` : undefined} emptyText="The customer did not edit this photo." onDownload={() => set.customerEditedPath && void download(set.customerEditedPath, "customer-edited", set.position)} />
                <Tile title="Admin prepared" path={current?.prepared_path ?? null} url={current ? urls[current.prepared_path] : null} downloading={isDownloading(current?.prepared_path)} onImageError={onImageError}
                  caption={current ? `Version ${current.version} · ${formatDate(current.prepared_at)}${summary?.widthPx && summary.heightPx ? ` · ${summary.widthPx} × ${summary.heightPx} px` : ""}${summary?.dpi ? ` · ~${summary.dpi} DPI` : ""}` : undefined}
                  emptyText="Not prepared yet." onDownload={() => current && void download(current.prepared_path, `prepared-v${current.version}`, set.position)} />
              </div>

              {set.printArea.widthMm && set.printArea.heightMm
                ? <p className="text-xs text-espresso/55">Print area: {set.printArea.widthMm} × {set.printArea.heightMm} mm</p>
                : <p className="text-xs text-espresso/55">Print size not recorded for this photo.</p>}

              {canPrepare && set.editable && (
                <div className="flex flex-wrap items-center gap-2">
                  {current && <button type="button" className={button} disabled={Boolean(opening)} onClick={() => void openEditor(set, "admin_version")}>{busyHere && opening?.endsWith("admin_version") ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}Continue prepared version</button>}
                  {customerUsable && <button type="button" className={button} disabled={Boolean(opening)} onClick={() => void openEditor(set, "customer_design")}>{busyHere && opening?.endsWith("customer_design") ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}Prepare from customer's design</button>}
                  <button type="button" className={button} disabled={Boolean(opening)} onClick={() => void openEditor(set, "original")}>{busyHere && opening?.endsWith(":original") ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}Prepare from original</button>
                </div>
              )}

              {current && prepState === "ready" && <CurrentPreparationForm key={`${current.id}:${current.updated_at}`} prep={current} locked={locked} notify={notify} onSaved={() => setReload((value) => value + 1)} />}

              {versions.length > 1 && (
                <details className="text-xs text-espresso/65">
                  <summary className="cursor-pointer">Earlier prepared versions ({versions.length - 1})</summary>
                  <ul className="mt-2 grid gap-1">
                    {versions.slice(1).map((version) => (
                      <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-brass/30 pb-1">
                        <span>Version {version.version} · {formatDate(version.prepared_at)}{version.production_notes ? ` · ${version.production_notes.slice(0, 80)}${version.production_notes.length > 80 ? "…" : ""}` : ""}</span>
                        <button type="button" className={button} disabled={isDownloading(version.prepared_path)} onClick={() => void download(version.prepared_path, `prepared-v${version.version}`, set.position)}><Download size={12} aria-hidden="true" />Download</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>

      {editing && (
        <PhotoEditor
          key={`${editing.set.key}:${editing.from}`} file={editing.file} initial={editing.initial} area={editing.set.printArea} productType={editing.set.productType}
          onCancel={() => setEditing(null)} onDone={(_state, result) => onEditorDone(result)}
          copy={{
            title: `Prepare photo ${editing.set.position}`,
            description: `${requestNumber}. Working from the customer's original. Nothing is saved until you confirm; the original and the customer's edit stay untouched.`,
            areaNotSet: "No print size was recorded for this photo, so the frame follows the photo's shape.",
            saveLabel: "Review prepared photo", savingLabel: "Rendering…",
          }}
        />
      )}

      {draft && draftUrl && createPortal(
        <div className="fixed inset-0 z-[55] overflow-y-auto bg-black/70 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="prep-review-title" className="mx-auto my-6 max-w-2xl border border-brass/40 bg-white p-5 text-espresso shadow-2xl">
            <h2 id="prep-review-title" className="text-xl text-white">Save prepared photo {draft.set.position}</h2>
            <p className="mt-1 text-sm text-espresso/65">This is saved as a new private file. The original and the customer's version are not changed.</p>
            <div className="mt-4 grid h-64 place-items-center bg-white"><img src={draftUrl} alt="Prepared photo preview" className="max-h-64 max-w-full object-contain" /></div>
            {(() => { const s = summarizeMeta(draft.result.meta as Record<string, unknown>); return <p className="mt-2 text-xs text-espresso/65">{s.widthPx && s.heightPx ? `${s.widthPx} × ${s.heightPx} px` : ""}{s.dpi ? ` · about ${s.dpi} DPI at print size` : ""}{s.dpi !== null && s.dpi < 150 ? " · low resolution for print" : ""}</p>; })()}
            <label className="mt-4 grid gap-1 text-xs text-espresso/65">Internal production notes (admin-only)
              <textarea rows={3} maxLength={PRODUCTION_NOTES_MAX} value={draft.notes} disabled={saving} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="resize-y border border-brass/50 bg-cream px-3 py-2 text-sm text-white" />
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-espresso">
              <input type="checkbox" checked={draft.ready} disabled={saving} onChange={(event) => setDraft({ ...draft, ready: event.target.checked })} className="mt-1" />
              <span>Mark ready for quotation</span>
            </label>
            {draftError && <p role="alert" className="mt-3 border-l-2 border-red-400 pl-3 text-sm text-red-200">{draftError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={button} disabled={saving} onClick={() => setDraft(null)}>Discard</button>
              <button type="button" className="bg-walnut px-4 py-2 text-sm text-white hover:bg-[#4c173b] disabled:opacity-50" disabled={saving} onClick={() => void saveDraft()}>{saving ? "Saving…" : "Save prepared photo"}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}
