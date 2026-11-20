import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Pencil, Plus, Search, Tags, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { deleteCategory, getCategories, getCategoryProductCounts, saveCategory, type CategoryWrite } from "../../services/catalog";
import { uploadCategoryImage } from "../../services/storage";
import type { Category } from "../../types";

type Toast = { message: string; tone: "success" | "warning" | "error" };
type CategoryForm = { name: string; slug: string; description: string; active: boolean };

const emptyForm: CategoryForm = { name: "", slug: "", description: "", active: true };
const perPage = 12;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}

function formFromCategory(category: Category): CategoryForm {
  return { name: category.name, slug: category.slug, description: category.description ?? "", active: category.isActive ?? true };
}

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");

  async function reload() {
    const nextCategories = await getCategories(true);
    const nextCounts = await getCategoryProductCounts(nextCategories.map((category) => category.id));
    setCategories(nextCategories);
    setProductCounts(nextCounts);
  }

  useEffect(() => {
    let active = true;
    void getCategories(true).then(async (nextCategories) => {
      const nextCounts = await getCategoryProductCounts(nextCategories.map((category) => category.id));
      if (!active) return;
      setCategories(nextCategories);
      setProductCounts(nextCounts);
    }).catch((reason: unknown) => {
      if (active) setPageError(errorText(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const filteredCategories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return categories.filter((category) => {
      const active = category.isActive ?? true;
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? active : !active);
      const matchesQuery = !normalizedQuery || [category.name, category.slug, category.description ?? ""].some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [categories, query, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredCategories.length / perPage));
  const pageCategories = filteredCategories.slice((page - 1) * perPage, page * perPage);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  async function refresh() {
    try {
      await reload();
      setPageError("");
    } catch (reason) {
      setPageError(errorText(reason));
    }
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setCurrentImage(null);
    setSelectedFile(null);
    setSlugTouched(false);
    setFormError("");
    setFormOpen(true);
  }

  function startEdit(category: Category) {
    setEditingId(category.id);
    setForm(formFromCategory(category));
    setCurrentImage(category.imageUrl ?? null);
    setSelectedFile(null);
    setSlugTouched(true);
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
  }

  function updateName(value: string) {
    setForm((current) => ({ ...current, name: value, slug: slugTouched ? current.slug : slugify(value) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setPageError("");
    const name = form.name.trim();
    const slug = slugify(form.slug);
    if (!name) return setFormError("Enter a category name.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return setFormError("Use a slug with lowercase letters, numbers, and single hyphens.");

    const payload: CategoryWrite = {
      name,
      slug,
      description: form.description.trim() || null,
      is_active: form.active,
    };
    setSaving(true);
    let categorySaved = false;
    try {
      const saved = await saveCategory(payload, editingId ?? undefined);
      categorySaved = true;
      setEditingId(saved.id);
      setCurrentImage(saved.image_url);
      if (selectedFile) {
        const upload = await uploadCategoryImage(saved.id, selectedFile);
        setCurrentImage(upload.url);
        setSelectedFile(null);
        if (upload.cleanupWarning) setToast({ message: upload.cleanupWarning, tone: "warning" });
      }
      await reload();
      setFormOpen(false);
      setToast((current) => current?.tone === "warning" ? current : { message: "Category saved successfully.", tone: "success" });
    } catch (reason) {
      setFormError(categorySaved ? `Category saved, but its image or list refresh failed: ${errorText(reason)}` : errorText(reason));
      if (categorySaved) void refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(category: Category) {
    const count = productCounts[category.id] ?? 0;
    if (count > 0) {
      setToast({ message: `Cannot delete: ${count} product${count === 1 ? " is" : "s are"} assigned. Reassign or unassign them in Product Management first.`, tone: "warning" });
      return;
    }
    if (!window.confirm(`Delete category “${category.name}”? This cannot be undone.`)) return;
    setPageError("");
    try {
      const cleanupWarning = await deleteCategory(category.id);
      await reload();
      setToast(cleanupWarning ? { message: cleanupWarning, tone: "warning" } : { message: "Category deleted.", tone: "success" });
    } catch (reason) {
      setToast({ message: errorText(reason), tone: "error" });
    }
  }

  async function toggleActive(category: Category) {
    setPageError("");
    try {
      await saveCategory({ is_active: !(category.isActive ?? true) }, category.id);
      await reload();
      setToast({ message: `${category.name} ${category.isActive ? "deactivated" : "activated"}.`, tone: "success" });
    } catch (reason) {
      setPageError(errorText(reason));
    }
  }

  return (
    <section className="relative -m-4 min-h-[calc(100vh-8rem)] bg-cream p-4 text-espresso sm:-m-8 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5">
        <div><p className="text-sm text-espresso/65">Catalog administration</p><h1 className="mt-1 text-3xl text-walnut">Categories</h1></div>
        <button type="button" onClick={startCreate} className="inline-flex items-center gap-2 bg-walnut px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4c173b]"><Plus size={17} />Add category</button>
      </div>

      {pageError && <p role="alert" className="mt-4 border-l-2 border-red-400 pl-3 text-sm text-red-200">{pageError}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_12rem]">
        <label className="relative"><span className="sr-only">Search categories</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-espresso/65" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, slug or description" className="w-full border border-brass/40 bg-white py-2 pl-9 pr-3 text-sm text-walnut placeholder:text-espresso/55" /></label>
        <label><span className="sr-only">Filter category status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full border border-brass/40 bg-white px-3 py-2 text-sm text-walnut"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>

      {loading && <p role="status" className="py-16 text-center text-sm text-espresso/80">Loading categories...</p>}
      {!loading && !pageError && !filteredCategories.length && <div className="py-16 text-center"><div className="mx-auto grid h-12 w-12 place-items-center border border-brass/40 bg-white text-espresso/80"><Tags size={20} /></div><p className="mt-4 text-espresso">{categories.length ? "No categories match these filters." : "No categories yet."}</p>{!categories.length && <button type="button" onClick={startCreate} className="mt-4 border border-walnut px-4 py-2 text-sm text-walnut hover:bg-[#f7edf2]">Create your first category</button>}</div>}

      {!loading && filteredCategories.length > 0 && <>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pageCategories.map((category) => {
            const count = productCounts[category.id] ?? 0;
            const active = category.isActive ?? true;
            return <article key={category.id} className="overflow-hidden border border-brass/40 bg-white">
              <div className="relative aspect-[16/8] bg-[#16263b]">
                {category.imageUrl ? <img src={category.imageUrl} alt={category.name} loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-espresso/55"><Tags size={32} /></div>}
                <span className={`absolute right-3 top-3 border px-2 py-1 text-xs ${active ? "border-emerald-700 bg-[#0d2b2a] text-emerald-300" : "border-brass/50 bg-[#101820] text-espresso/80"}`}>{active ? "Active" : "Inactive"}</span>
              </div>
              <div className="p-4">
                <h2 className="text-lg font-medium text-walnut">{category.name}</h2>
                <p className="mt-1 text-xs text-espresso/65">/{category.slug}</p>
                <p className="mt-3 min-h-10 text-sm text-espresso/80">{category.description || "No description"}</p>
                <p className="mt-3 text-xs text-espresso/65">{count} associated product{count === 1 ? "" : "s"}</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-brass/40 pt-3">
                  <div className="flex gap-2"><button type="button" onClick={() => startEdit(category)} className="inline-flex items-center gap-1 border border-brass/50 px-2.5 py-1.5 text-xs text-espresso hover:bg-[#eadbd2]"><Pencil size={14} />Edit</button><button type="button" onClick={() => void toggleActive(category)} className="border border-brass/50 px-2.5 py-1.5 text-xs text-espresso hover:bg-[#eadbd2]">{active ? "Deactivate" : "Activate"}</button></div>
                  <button type="button" onClick={() => void remove(category)} disabled={count > 0} title={count > 0 ? "Reassign or unassign products before deleting" : "Delete category"} aria-label={`Delete ${category.name}`} className="inline-flex items-center gap-1 border border-red-900 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={14} />Delete</button>
                </div>
                {count > 0 && <p className="mt-2 text-xs text-amber-200">Move these products to another category or set them to Unassigned in <Link to="/admin/products" className="underline underline-offset-2">Product Management</Link> before deletion.</p>}
              </div>
            </article>;
          })}
        </div>
        {pageCount > 1 && <nav aria-label="Category pages" className="mt-6 flex items-center justify-center gap-4 text-sm"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowLeft size={16} /></button><span className="text-espresso/80">Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className="border border-brass/50 p-2 text-espresso disabled:opacity-40"><ArrowRight size={16} /></button></nav>}
      </>}

      {formOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="category-form-title" className="mx-auto my-6 max-w-2xl border border-brass/40 bg-white p-5 text-espresso shadow-2xl sm:p-7">
          <div className="flex items-start justify-between gap-4 border-b border-brass/40 pb-4"><div><p className="text-sm text-espresso/65">Category details</p><h2 id="category-form-title" className="mt-1 text-2xl text-walnut">{editingId ? "Edit category" : "Add category"}</h2></div><button type="button" onClick={closeForm} disabled={saving} aria-label="Close category form" className="p-2 text-espresso/80 hover:bg-[#eadbd2]"><X size={19} /></button></div>
          <form onSubmit={submit} className="mt-5 grid gap-4">
            <label className="grid gap-1.5 text-sm">Name<input required maxLength={120} value={form.name} onChange={(event) => updateName(event.target.value)} className="border border-brass/50 bg-cream px-3 py-2 text-walnut" /></label>
            <label className="grid gap-1.5 text-sm">Slug<input required maxLength={140} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => { setSlugTouched(true); setForm((current) => ({ ...current, slug: event.target.value })); }} className="border border-brass/50 bg-cream px-3 py-2 text-walnut" /><span className="text-xs text-espresso/65">Generated from the name; you can edit it.</span></label>
            <label className="grid gap-1.5 text-sm">Description<textarea maxLength={1000} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="resize-y border border-brass/50 bg-cream px-3 py-2 text-walnut" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />Active on storefront</label>
            <label className="grid gap-2 text-sm"><span className="flex items-center gap-2"><ImagePlus size={16} />Category image (JPEG, PNG or WebP; up to 10 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} className="block w-full text-sm text-espresso/80 file:mr-3 file:border-0 file:bg-walnut file:px-3 file:py-2 file:text-walnut" /></label>
            {(previewUrl || currentImage) && <div className="flex items-center gap-4"><img src={previewUrl || currentImage || ""} alt="Category preview" className="h-24 w-36 border border-brass/40 object-cover" /><span className="text-xs text-espresso/65">{previewUrl ? "New image preview" : "Current image"}</span></div>}
            {formError && <p role="alert" className="border-l-2 border-red-400 pl-3 text-sm text-red-200">{formError}</p>}
            <div className="flex justify-end gap-3 border-t border-brass/40 pt-4"><button type="button" onClick={closeForm} disabled={saving} className="border border-brass/50 px-4 py-2 text-sm text-espresso hover:bg-[#eadbd2]">Cancel</button><button type="submit" disabled={saving} className="bg-walnut px-5 py-2 text-sm font-medium text-walnut hover:bg-[#4c173b] disabled:opacity-60">{saving ? "Saving..." : "Save category"}</button></div>
          </form>
        </section>
      </div>}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-4 border px-4 py-3 text-sm shadow-xl ${toast.tone === "success" ? "border-emerald-700 bg-[#0d2b2a] text-emerald-100" : toast.tone === "warning" ? "border-amber-700 bg-[#382a10] text-amber-100" : "border-red-800 bg-[#3a1720] text-red-100"}`}><span>{toast.message}</span><button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification" className="shrink-0"><X size={16} /></button></div>}
    </section>
  );
}