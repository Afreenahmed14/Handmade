import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ImagePlus, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { deleteProduct, getCategories, getProductImages, getProducts, saveProduct, type ProductImageRow, type ProductWrite } from "../../services/catalog";
import { setPrimaryProductImage, uploadProductImages } from "../../services/storage";
import { adjustInventoryStock } from "../../services/inventory";
import { getEnabledPersonalizationIds, getPersonalizationForAdmin, savePersonalization } from "../../services/personalization";
import PersonalizationFields, { buildPersonalizationWrite, emptyPersonalizationForm, toPersonalizationForm, type PersonalizationForm } from "./PersonalizationFields";
import { formatINR } from "../../utils/currency";
import type { Category, Product } from "../../types";

interface ProductForm {
  name: string;
  slug: string;
  sku: string;
  description: string;
  categoryId: string;
  price: string;
  discountPrice: string;
  material: string;
  colour: string;
  stock: string;
  customizable: boolean;
  published: boolean;
  featured: boolean;
}

const emptyForm: ProductForm = {
  name: "", slug: "", sku: "", description: "", categoryId: "", price: "", discountPrice: "",
  material: "", colour: "", stock: "0", customizable: false, published: false, featured: false,
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function toForm(product: Product): ProductForm {
  return {
    name: product.name, slug: product.slug, sku: product.sku, description: product.description,
    categoryId: product.categoryId ?? "", price: String(product.price), discountPrice: product.discountPrice === undefined ? "" : String(product.discountPrice),
    material: product.material, colour: product.colour, stock: String(product.stock), customizable: product.customizable,
    published: product.published ?? false, featured: product.tag === "featured",
  };
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [images, setImages] = useState<ProductImageRow[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pForm, setPForm] = useState<PersonalizationForm>(emptyPersonalizationForm);
  const [hadConfig, setHadConfig] = useState(false);
  const [personalisedIds, setPersonalisedIds] = useState<Set<string>>(new Set());

  async function reload() {
    const [nextProducts, nextCategories, nextIds] = await Promise.all([getProducts(false), getCategories(true), getEnabledPersonalizationIds().catch(() => new Set<string>())]);
    setProducts(nextProducts);
    setCategories(nextCategories);
    setPersonalisedIds(nextIds);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([getProducts(false), getCategories(true), getEnabledPersonalizationIds().catch(() => new Set<string>())]).then(([nextProducts, nextCategories, nextIds]) => {
      if (!active) return;
      setProducts(nextProducts);
      setCategories(nextCategories);
      setPersonalisedIds(nextIds);
    }).catch((reason: unknown) => {
      if (active) setPageError(errorText(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery = !normalizedQuery || [product.name, product.sku, product.slug].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesCategory = categoryFilter === "all" || product.categoryId === categoryFilter;
      const matchesStatus = statusFilter === "all" || (statusFilter === "published" ? product.published : !product.published);
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [products, query, categoryFilter, statusFilter]);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setPForm(emptyPersonalizationForm);
    setHadConfig(false);
    setImages([]);
    setSelectedFiles([]);
    setSlugTouched(false);
    setFormError("");
    setNotice("");
    setFormOpen(true);
  }

  async function startEdit(product: Product) {
    setEditing(product);
    setForm(toForm(product));
    setPForm(emptyPersonalizationForm);
    setHadConfig(false);
    setSelectedFiles([]);
    setSlugTouched(true);
    setFormError("");
    setNotice("");
    setFormOpen(true);
    try {
      setImages(await getProductImages(product.id));
    } catch (reason) {
      setImages([]);
      setFormError(errorText(reason));
    }
    try {
      const config = await getPersonalizationForAdmin(product.id);
      setHadConfig(config !== null);
      setPForm(toPersonalizationForm(config));
    } catch (reason) {
      // Without the saved settings the form must not overwrite them, so block saving until they load.
      setFormError(`Personalisation settings could not be loaded; close and reopen this product before saving. ${errorText(reason)}`);
    }
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
  }

  function updateField<K extends keyof ProductForm>(field: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateName(value: string) {
    setForm((current) => ({ ...current, name: value, slug: slugTouched ? current.slug : slugify(value) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    const price = Number(form.price);
    const discount = form.discountPrice.trim() ? Number(form.discountPrice) : null;
    const stock = Number(form.stock);
    const slug = slugify(form.slug);

    if (!slug) return setFormError("Enter a name that produces a valid slug.");
    if (!Number.isFinite(price) || price < 0) return setFormError("Enter a valid non-negative price.");
    if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > price)) return setFormError("Discount price must be between zero and the regular price.");
    if (!Number.isInteger(stock) || stock < 0) return setFormError("Stock must be a non-negative whole number.");

    const savePersonalisation = pForm.enabled || hadConfig;
    let personalizationInput: ReturnType<typeof buildPersonalizationWrite> | null = null;
    if (savePersonalisation) {
      personalizationInput = buildPersonalizationWrite(editing?.id ?? "", pForm);
      if ("error" in personalizationInput) return setFormError(personalizationInput.error);
    }

    const payload: ProductWrite = {
      name: form.name.trim(), slug, sku: form.sku.trim(), description: form.description.trim(),
      category_id: form.categoryId || null, price_inr: price, discount_price_inr: discount,
      material: form.material.trim() || null, colour: form.colour.trim() || null, stock_quantity: stock,
      is_customizable: form.customizable || pForm.enabled, is_published: form.published, is_featured: form.featured,
    };
    const targetStock = payload.stock_quantity ?? 0;
    const productPayload: ProductWrite = { ...payload };
    if (editing) delete productPayload.stock_quantity;

    setSaving(true);
    let productWasSaved = false;
    try {
      const saved = await saveProduct(productPayload, editing?.id);
      productWasSaved = true;
      if (personalizationInput && "value" in personalizationInput) {
        await savePersonalization({ ...personalizationInput.value, product_id: saved.id });
      }
      let savedStock = saved.stock_quantity;
      if (editing && targetStock !== editing.stock) {
        const stockResult = await adjustInventoryStock({
          productId: saved.id,
          action: "adjustment",
          newQuantity: targetStock,
          reason: "Manual stock adjustment from Product Management",
        });
        savedStock = stockResult.newQuantity;
      }
      const savedCategory = categories.find((category) => category.id === saved.category_id);
      setEditing({
        id: saved.id, slug: saved.slug, name: saved.name, sku: saved.sku,
        category: savedCategory?.name ?? "", categoryId: saved.category_id ?? undefined, categorySlug: savedCategory?.slug,
        price: Number(saved.price_inr), discountPrice: saved.discount_price_inr === null ? undefined : Number(saved.discount_price_inr),
        material: saved.material ?? "", colour: saved.colour ?? "", art: savedCategory?.art ?? "vase",
        customizable: saved.is_customizable, stock: savedStock, tag: saved.is_featured ? "featured" : undefined,
        description: saved.description, published: saved.is_published, imageUrl: editing?.imageUrl,
      });
      if (selectedFiles.length) {
        await uploadProductImages(saved.id, selectedFiles);
        setSelectedFiles([]);
      }
      await reload();
      setNotice("Product saved successfully.");
      setFormOpen(false);
      setEditing(null);
    } catch (reason) {
      setFormError(productWasSaved ? `Product saved, but a follow-up step (personalisation settings, images or refresh) failed: ${errorText(reason)}` : errorText(reason));
      if (productWasSaved) {
        try { await reload(); } catch { /* Keep the original save error visible. */ }
      }
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(product: Product) {
    setPageError("");
    setNotice("");
    try {
      await saveProduct({ is_published: !product.published }, product.id);
      await reload();
      setNotice(`${product.name} ${product.published ? "unpublished" : "published"}.`);
    } catch (reason) {
      setPageError(errorText(reason));
    }
  }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) return;
    setPageError("");
    setNotice("");
    try {
      const cleanupWarning = await deleteProduct(product.id);
      await reload();
      setNotice(cleanupWarning ?? `${product.name} deleted.`);
    } catch (reason) {
      setPageError(errorText(reason));
    }
  }

  async function choosePrimary(imageId: string, productId: string) {
    setFormError("");
    try {
      await setPrimaryProductImage(productId, imageId);
      setImages(await getProductImages(productId));
      await reload();
    } catch (reason) {
      setFormError(errorText(reason));
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/40 pb-5">
        <div><p className="text-sm text-walnut/70">Catalog</p><h1 className="mt-1 text-3xl text-walnut">Products</h1></div>
        <button type="button" onClick={startCreate} className="btn-primary px-4 py-2"><Plus size={17} />Add product</button>
      </div>

      {notice && <p role="status" className="mt-4 border-l-2 border-green-700 pl-3 text-sm text-green-800">{notice}</p>}
      {pageError && <p role="alert" className="mt-4 border-l-2 border-red-800 pl-3 text-sm text-red-800">{pageError}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_12rem_10rem]">
        <label className="relative"><span className="sr-only">Search products</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-walnut/60" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, SKU or slug" className="w-full border border-brass/40 bg-transparent py-2 pl-9 pr-3 text-sm" /></label>
        <label><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="w-full border border-brass/40 bg-cream px-3 py-2 text-sm"><option value="all">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span className="sr-only">Filter by publication status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full border border-brass/40 bg-cream px-3 py-2 text-sm"><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Drafts</option></select></label>
      </div>

      {loading && <p role="status" className="py-12 text-center text-sm text-walnut/70">Loading products...</p>}
      {!loading && !pageError && !filteredProducts.length && <div className="py-14 text-center"><p className="text-walnut/70">{products.length ? "No products match these filters." : "No products yet."}</p>{!products.length && <button type="button" onClick={startCreate} className="btn-outline mt-4 px-4 py-2">Add your first product</button>}</div>}
      {!loading && filteredProducts.length > 0 && <div className="mt-4 overflow-x-auto border-y border-brass/30">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-brass/30 text-xs uppercase text-walnut/70"><tr><th className="py-3 pr-4 font-medium">Product</th><th className="py-3 pr-4 font-medium">Category</th><th className="py-3 pr-4 font-medium">Price</th><th className="py-3 pr-4 font-medium">Stock</th><th className="py-3 pr-4 font-medium">Status</th><th className="py-3 text-right font-medium">Actions</th></tr></thead>
          <tbody>{filteredProducts.map((product) => <tr key={product.id} className="border-b border-brass/20 last:border-0">
            <td className="py-3 pr-4"><div className="flex items-center gap-3">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-12 w-10 object-cover" /> : <div className="h-12 w-10 bg-walnut/10" />}<div><p className="font-medium text-espresso">{product.name}{personalisedIds.has(product.id) && <span className="ml-2 border border-brass/50 px-1.5 py-0.5 text-[10px] font-normal uppercase text-walnut">Personalised</span>}</p><p className="text-xs text-walnut/70">{product.sku}</p></div></div></td>
            <td className="py-3 pr-4">{product.category || "Unassigned"}</td>
            <td className="py-3 pr-4">{formatINR(product.discountPrice ?? product.price)}{product.discountPrice !== undefined && <span className="ml-1 text-xs text-walnut/60 line-through">{formatINR(product.price)}</span>}</td>
            <td className="py-3 pr-4">{product.stock}</td>
            <td className="py-3 pr-4"><span className={product.published ? "text-green-800" : "text-walnut/60"}>{product.published ? "Published" : "Draft"}</span></td>
            <td className="py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => void togglePublished(product)} title={product.published ? "Unpublish product" : "Publish product"} aria-label={product.published ? `Unpublish ${product.name}` : `Publish ${product.name}`} className="p-2 text-walnut hover:bg-brass/10">{product.published ? <X size={16} /> : <Check size={16} />}</button><button type="button" onClick={() => void startEdit(product)} title="Edit product" aria-label={`Edit ${product.name}`} className="p-2 text-walnut hover:bg-brass/10"><Pencil size={16} /></button><button type="button" onClick={() => void removeProduct(product)} title="Delete product" aria-label={`Delete ${product.name}`} className="p-2 text-red-800 hover:bg-red-50"><Trash2 size={16} /></button></div></td>
          </tr>)}</tbody>
        </table>
      </div>}

      {formOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-espresso/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="product-form-title" className="mx-auto my-6 max-w-3xl bg-cream p-5 shadow-xl sm:p-8">
          <div className="flex items-start justify-between gap-4 border-b border-brass/40 pb-4"><div><p className="text-sm text-walnut/70">Catalog</p><h2 id="product-form-title" className="mt-1 text-2xl text-walnut">{editing ? "Edit product" : "Add product"}</h2></div><button type="button" onClick={closeForm} disabled={saving} aria-label="Close product form" className="p-2 text-walnut hover:bg-brass/10"><X size={19} /></button></div>
          <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Name<input required maxLength={160} value={form.name} onChange={(event) => updateName(event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => { setSlugTouched(true); updateField("slug", event.target.value); }} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">SKU<input required maxLength={80} value={form.sku} onChange={(event) => updateField("sku", event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Category<select value={form.categoryId} onChange={(event) => updateField("categoryId", event.target.value)} className="border border-brass/40 bg-cream px-3 py-2"><option value="">Unassigned</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (inactive)"}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Price (INR)<input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => updateField("price", event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Discount price (INR)<input type="number" min="0" step="0.01" value={form.discountPrice} onChange={(event) => updateField("discountPrice", event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Stock quantity<input required type="number" min="0" step="1" value={form.stock} onChange={(event) => updateField("stock", event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Material<input value={form.material} onChange={(event) => updateField("material", event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Colour<input value={form.colour} onChange={(event) => updateField("colour", event.target.value)} className="border border-brass/40 bg-transparent px-3 py-2" /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">Description<textarea rows={4} value={form.description} onChange={(event) => updateField("description", event.target.value)} className="resize-y border border-brass/40 bg-transparent px-3 py-2" /></label>
            <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(event) => updateField("published", event.target.checked)} />Published</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.featured} onChange={(event) => updateField("featured", event.target.checked)} />Featured</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.customizable} onChange={(event) => updateField("customizable", event.target.checked)} />Customizable</label>
            </div>
            <PersonalizationFields form={pForm} onChange={(patch) => setPForm((current) => ({ ...current, ...patch }))} />
            <label className="grid gap-2 text-sm sm:col-span-2"><span className="flex items-center gap-2"><ImagePlus size={17} />Product images</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} className="block w-full text-sm file:mr-3 file:border-0 file:bg-walnut file:px-3 file:py-2 file:text-cream" />{selectedFiles.length > 0 && <span className="text-xs text-walnut/70">{selectedFiles.length} image(s) selected</span>}</label>
            {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:col-span-2">{images.map((image) => <div key={image.id} className="border border-brass/30 p-2"><img src={image.image_url} alt="Product" className="aspect-square w-full object-cover" /><button type="button" onClick={() => void choosePrimary(image.id, image.product_id)} disabled={image.is_primary} className="mt-2 flex w-full items-center justify-center gap-1 text-xs text-walnut disabled:opacity-60">{image.is_primary ? <><Star size={14} fill="currentColor" />Primary</> : <><Star size={14} />Set primary</>}</button></div>)}</div>}
            {formError && <p role="alert" className="sm:col-span-2 text-sm text-red-800">{formError}</p>}
            <div className="flex justify-end gap-3 border-t border-brass/30 pt-4 sm:col-span-2"><button type="button" onClick={closeForm} disabled={saving} className="btn-outline px-4 py-2">Cancel</button><button type="submit" disabled={saving} className="btn-primary px-5 py-2 disabled:opacity-60">{saving ? "Saving..." : "Save product"}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}