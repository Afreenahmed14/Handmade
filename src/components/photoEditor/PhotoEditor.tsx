import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, RotateCcw, RotateCw, Trash2, Type, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  EDITOR_MAX_TEXTS, EDITOR_MAX_ZOOM, EDITOR_MIN_ZOOM, buildDesignResult, clamp, defaultState, drawDesign, effectiveDpi, fitZoom, frameFor,
  hitText, isPrintAreaDefined, loadSourceImage, panState, type DesignResult, type EditorState, type PrintArea, type SourceImage,
} from "./editorModel";

interface Props {
  file: File;
  initial: EditorState | null;
  area: PrintArea;
  productType: string | null;
  onCancel: () => void;
  onDone: (state: EditorState, result: DesignResult) => void;
  /** Optional wording overrides (used by the admin workspace). Omitted = the customer-facing text, unchanged. */
  copy?: EditorCopy;
}

export interface EditorCopy { title?: string; description?: string; areaNotSet?: string; saveLabel?: string; savingLabel?: string }

const SWATCHES = ["#FFFFFF", "#25232A", "#581A45", "#607D8B", "#E9E1EA", "#C9A24B"];
const btn = "inline-flex items-center justify-center gap-1 border border-brass/50 px-3 py-2 text-sm text-walnut hover:bg-brass/10 disabled:opacity-40";

export default function PhotoEditor({ file, initial, area, productType, onCancel, onDone, copy }: Props) {
  const [src, setSrc] = useState<SourceImage | null>(null);
  const [state, setState] = useState<EditorState | null>(initial);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ kind: "image" | "text"; id?: string; x: number; y: number } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const stateRef = useRef<EditorState | null>(initial);
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    let loaded: SourceImage | null = null;
    void loadSourceImage(file).then((image) => {
      if (!active) { image.dispose(); return; }
      loaded = image;
      setSrc(image);
      setState((current) => current ?? defaultState(image));
    }).catch(() => { if (active) setLoadError("We couldn't open this photo. Please choose another one."); });
    return () => { active = false; loaded?.dispose(); };
  }, [file]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const frame = src && state ? frameFor(area, src, state.quarter) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src || !state || !frame) return;
    canvas.width = Math.round(frame.width);
    canvas.height = Math.round(frame.height);
    const ctx = canvas.getContext("2d");
    if (ctx) drawDesign(ctx, src, state, frame, 1, selectedId);
  }, [src, state, frame?.width, frame?.height, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((change: Partial<EditorState> | ((current: EditorState) => EditorState)) => {
    setState((current) => current ? (typeof change === "function" ? change(current) : { ...current, ...change }) : current);
  }, []);

  const setZoom = useCallback((zoom: number) => patch({ zoom: clamp(zoom, EDITOR_MIN_ZOOM, EDITOR_MAX_ZOOM) }), [patch]);

  // Mouse wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      patch((current) => ({ ...current, zoom: clamp(current.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), EDITOR_MIN_ZOOM, EDITOR_MAX_ZOOM) }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [patch, src]);

  function toFrame(event: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) * canvas.width) / rect.width, y: ((event.clientY - rect.top) * canvas.height) / rect.height };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!src || !state || !frame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toFrame(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: state.zoom };
      drag.current = null;
      return;
    }
    const ctx = event.currentTarget.getContext("2d");
    const hit = ctx ? hitText(ctx, state, frame, point.x, point.y) : null;
    if (hit) { setSelectedId(hit.id); drag.current = { kind: "text", id: hit.id, ...point }; }
    else { drag.current = { kind: "image", ...point }; }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(event.pointerId) || !src || !frame) return;
    const point = toFrame(event);
    pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      setZoom(pinch.current.zoom * ((Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.current.distance));
      return;
    }
    const current = drag.current;
    if (!current) return;
    const dx = point.x - current.x, dy = point.y - current.y;
    drag.current = { ...current, x: point.x, y: point.y };
    if (current.kind === "image") patch((s) => panState(s, frame, src, dx, dy));
    else patch((s) => ({ ...s, texts: s.texts.map((t) => t.id === current.id ? { ...t, x: clamp(t.x + dx / frame.width, 0, 1), y: clamp(t.y + dy / frame.height, 0, 1) } : t) }));
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
    else if (!pinch.current) drag.current = null; // one finger left after a pinch: wait for a fresh touch instead of jumping
  }

  function addText() {
    if (!state || state.texts.length >= EDITOR_MAX_TEXTS) return;
    const id = crypto.randomUUID();
    patch((s) => ({ ...s, texts: [...s.texts, { id, text: "Your text", x: 0.5, y: 0.5, size: 0.08, color: "#FFFFFF" }] }));
    setSelectedId(id);
  }
  const updateText = (id: string, change: Partial<EditorState["texts"][number]>) => patch((s) => ({ ...s, texts: s.texts.map((t) => t.id === id ? { ...t, ...change } : t) }));
  function removeText(id: string) { patch((s) => ({ ...s, texts: s.texts.filter((t) => t.id !== id) })); setSelectedId(null); }

  function rotateQuarter(direction: 1 | -1) {
    patch((s) => ({ ...s, quarter: ((s.quarter + (direction === 1 ? 1 : 3)) % 4) as 0 | 1 | 2 | 3 }));
  }
  function reset() {
    if (!src) return;
    setState((current) => ({ ...defaultState(src), texts: current?.texts ?? [] })); // resetting the photo keeps the text
  }

  async function save() {
    if (!src || !state || busy) return;
    setBusy(true); setSaveError("");
    try {
      const cleaned: EditorState = { ...state, texts: state.texts.filter((t) => t.text.trim()) };
      const result = await buildDesignResult(file, src, cleaned, area, productType);
      onDone(cleaned, result);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "We couldn't save your design. Please try again.");
      setBusy(false);
    }
  }

  const selected = state?.texts.find((t) => t.id === selectedId) ?? null;
  const defined = isPrintAreaDefined(area);
  const dpi = src && state && frame ? effectiveDpi(state, frame, src, area) : null;

  // Rendered in a portal so Enter in the text box can't submit the surrounding request form.
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-espresso/60 p-3 sm:p-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="photo-editor-title" className="mx-auto max-w-4xl bg-cream p-4 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3 border-b border-brass/40 pb-3">
          <div>
            <h2 id="photo-editor-title" className="text-2xl text-walnut">{copy?.title ?? "Edit your photo"}</h2>
            <p className="mt-1 text-sm text-walnut/70">{copy?.description ?? `${file.name}. Your original photo is kept unchanged; we save your edited version separately.`}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close photo editor" className="p-2 text-walnut hover:bg-brass/10"><X size={19} /></button>
        </div>

        {loadError && <p role="alert" className="mt-6 text-red-800">{loadError}</p>}
        {!loadError && !src && <p role="status" className="py-16 text-center text-walnut/70"><Loader2 className="mr-2 inline animate-spin" size={16} aria-hidden="true" />Opening photo…</p>}

        {src && state && frame && (
          <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div>
              <p className="mb-2 text-sm text-espresso/80">
                {defined ? <>Printable area: <strong>{area.widthMm} × {area.heightMm} mm</strong></> : <>{copy?.areaNotSet ?? "Print size isn’t set for this product, so the frame follows your photo’s shape. Our team will confirm the final size."}</>}
              </p>
              <canvas
                ref={canvasRef} aria-label="Design preview. Drag to move the photo or text; pinch or use the zoom controls to resize."
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
                style={{ touchAction: "none", aspectRatio: `${frame.width} / ${frame.height}` }}
                className="mx-auto block max-h-[60vh] w-full max-w-full cursor-grab border-2 border-dashed border-plum bg-white object-contain active:cursor-grabbing"
              />
              <p className="mt-2 text-xs text-walnut/70">Drag to reposition. Pinch or scroll to zoom. Tap text to select and move it. Anything outside the dashed frame won’t be printed.</p>
              {dpi !== null && dpi < 150 && <p role="status" className="mt-2 border-l-2 border-amber-600 pl-3 text-sm text-amber-900">This photo is stretched to about {dpi} DPI at this size and may print soft. Zoom out or use a larger photo.</p>}
            </div>

            <div className="grid content-start gap-4 text-sm">
              <fieldset className="grid gap-2">
                <legend className="font-medium text-walnut">Zoom</legend>
                <div className="flex items-center gap-2">
                  <button type="button" className={btn} aria-label="Zoom out" onClick={() => setZoom(state.zoom / 1.15)}><ZoomOut size={16} /></button>
                  <input type="range" aria-label="Zoom" min={EDITOR_MIN_ZOOM} max={EDITOR_MAX_ZOOM} step={0.01} value={state.zoom} onChange={(e) => setZoom(Number(e.target.value))} className="min-w-0 flex-1" />
                  <button type="button" className={btn} aria-label="Zoom in" onClick={() => setZoom(state.zoom * 1.15)}><ZoomIn size={16} /></button>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={btn} onClick={() => patch({ zoom: 1 })}>Fill area</button>
                  <button type="button" className={btn} onClick={() => patch({ zoom: fitZoom(frame, src, state.quarter) })}>Fit whole photo</button>
                </div>
              </fieldset>

              <fieldset className="grid gap-2">
                <legend className="font-medium text-walnut">Rotate</legend>
                <div className="flex gap-2">
                  <button type="button" className={btn} onClick={() => rotateQuarter(-1)}><RotateCcw size={16} />90° left</button>
                  <button type="button" className={btn} onClick={() => rotateQuarter(1)}><RotateCw size={16} />90° right</button>
                </div>
                <label className="grid gap-1">Straighten ({state.fine.toFixed(0)}°)
                  <input type="range" min={-45} max={45} step={1} value={state.fine} onChange={(e) => patch({ fine: Number(e.target.value) })} />
                </label>
              </fieldset>

              <fieldset className="grid gap-2">
                <legend className="font-medium text-walnut">Text</legend>
                <button type="button" className={btn} onClick={addText} disabled={state.texts.length >= EDITOR_MAX_TEXTS}><Type size={16} />Add text</button>
                {state.texts.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Text layers">
                    {state.texts.map((t) => <li key={t.id}><button type="button" aria-pressed={t.id === selectedId} onClick={() => setSelectedId(t.id)} className={`max-w-[10rem] truncate border px-2 py-1 text-xs ${t.id === selectedId ? "border-plum bg-plum text-white" : "border-brass/50 text-walnut"}`}>{t.text || "(empty)"}</button></li>)}
                  </ul>
                )}
                {selected && (
                  <div className="grid gap-3 border border-brass/40 p-3">
                    <label className="grid gap-1">Text<input value={selected.text} maxLength={60} onChange={(e) => updateText(selected.id, { text: e.target.value })} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
                    <label className="grid gap-1">Size<input type="range" min={0.03} max={0.3} step={0.005} value={selected.size} onChange={(e) => updateText(selected.id, { size: Number(e.target.value) })} /></label>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Colour</span>
                      {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Text colour ${c}`} aria-pressed={selected.color.toLowerCase() === c.toLowerCase()} onClick={() => updateText(selected.id, { color: c })} style={{ background: c }} className={`h-7 w-7 rounded-full border ${selected.color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-plum ring-offset-1" : "border-charcoal/30"}`} />)}
                      <input type="color" aria-label="Custom text colour" value={selected.color} onChange={(e) => updateText(selected.id, { color: e.target.value.toUpperCase() })} className="h-8 w-10 border border-brass/40 bg-transparent p-0" />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={btn} onClick={() => updateText(selected.id, { x: 0.5 })}>Centre across</button>
                      <button type="button" className={`${btn} text-red-800`} onClick={() => removeText(selected.id)}><Trash2 size={15} />Delete</button>
                    </div>
                  </div>
                )}
              </fieldset>

              <button type="button" className={btn} onClick={reset}>Reset photo position</button>
            </div>
          </div>
        )}

        {saveError && <p role="alert" className="mt-4 text-sm text-red-800">{saveError}</p>}
        <div className="mt-5 flex justify-end gap-3 border-t border-brass/30 pt-4">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-outline px-4 py-2">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!src || !state || busy} className="btn-primary px-5 py-2 disabled:opacity-60">{busy ? (copy?.savingLabel ?? "Saving…") : (copy?.saveLabel ?? "Save design")}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
