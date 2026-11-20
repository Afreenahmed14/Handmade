import type { PersonalizationProductType } from "../../types/database";
import { IMAGE_FORMATS, PERSONALIZATION_TYPES, type PersonalizationConfig, type PersonalizationWrite } from "../../services/personalization";

export interface PersonalizationForm {
  enabled: boolean;
  productType: PersonalizationProductType;
  areaLabel: string;
  widthMm: string;
  heightMm: string;
  sizes: string;
  colours: string;
  materials: string;
  formats: string[];
  minWidthPx: string;
  minHeightPx: string;
  maxSizeMb: string;
  maxImages: string;
  imageNotes: string;
  quotationRequired: boolean;
  basePrice: string;
}

export const emptyPersonalizationForm: PersonalizationForm = {
  enabled: false, productType: "other", areaLabel: "", widthMm: "", heightMm: "", sizes: "", colours: "", materials: "",
  formats: ["jpeg", "png", "webp"], minWidthPx: "", minHeightPx: "", maxSizeMb: "10", maxImages: "5", imageNotes: "",
  quotationRequired: true, basePrice: "",
};

const num = (value: number | null) => (value === null ? "" : String(value));

export function toPersonalizationForm(config: PersonalizationConfig | null): PersonalizationForm {
  if (!config) return emptyPersonalizationForm;
  return {
    enabled: config.is_enabled, productType: config.product_type, areaLabel: config.printing_area_label ?? "",
    widthMm: num(config.print_width_mm), heightMm: num(config.print_height_mm),
    sizes: config.available_sizes.join(", "), colours: config.available_colours.join(", "), materials: config.available_materials.join(", "),
    formats: config.allowed_image_formats, minWidthPx: num(config.min_image_width_px), minHeightPx: num(config.min_image_height_px),
    maxSizeMb: String(config.max_image_size_mb), maxImages: String(config.max_images), imageNotes: config.image_notes ?? "",
    quotationRequired: config.quotation_required, basePrice: num(config.base_price_inr),
  };
}

const list = (text: string) => [...new Set(text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];

function optionalNumber(raw: string, label: string, integer = false): number | null | string {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) return `${label} must be a positive ${integer ? "whole " : ""}number.`;
  return value;
}

/** Returns a PersonalizationWrite, or an error message the admin can act on. */
export function buildPersonalizationWrite(productId: string, form: PersonalizationForm): { value: PersonalizationWrite } | { error: string } {
  const width = optionalNumber(form.widthMm, "Print width");
  const height = optionalNumber(form.heightMm, "Print height");
  const minW = optionalNumber(form.minWidthPx, "Minimum image width", true);
  const minH = optionalNumber(form.minHeightPx, "Minimum image height", true);
  for (const result of [width, height, minW, minH]) if (typeof result === "string") return { error: result };
  const maxSize = Number(form.maxSizeMb);
  const maxImages = Number(form.maxImages);
  if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > 10) return { error: "Maximum image size must be a whole number from 1 to 10 MB." };
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 10) return { error: "Maximum images per request must be a whole number from 1 to 10." };
  if (!form.formats.length) return { error: "Choose at least one allowed image format." };
  let basePrice: number | null = null;
  if (form.basePrice.trim()) {
    basePrice = Number(form.basePrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) return { error: "Base price must be zero or more." };
  }
  if (!form.quotationRequired && basePrice === null) return { error: "Enter a base price, or tick “Quotation required”." };
  const sizes = list(form.sizes), colours = list(form.colours), materials = list(form.materials);
  if ([sizes, colours, materials].some((items) => items.length > 30 || items.some((item) => item.length > 80))) return { error: "Use at most 30 sizes, colours or materials, each up to 80 characters." };
  return {
    value: {
      product_id: productId, is_enabled: form.enabled, product_type: form.productType,
      printing_area_label: form.areaLabel.trim() || null, print_width_mm: width as number | null, print_height_mm: height as number | null,
      available_sizes: sizes, available_colours: colours, available_materials: materials,
      allowed_image_formats: form.formats, min_image_width_px: minW as number | null, min_image_height_px: minH as number | null,
      max_image_size_mb: maxSize, max_images: maxImages, image_notes: form.imageNotes.trim() || null,
      quotation_required: form.quotationRequired, base_price_inr: basePrice,
    },
  };
}

const box = "border border-brass/40 bg-transparent px-3 py-2";

export default function PersonalizationFields({ form, onChange }: { form: PersonalizationForm; onChange: (patch: Partial<PersonalizationForm>) => void }) {
  const toggleFormat = (value: string, on: boolean) => onChange({ formats: on ? [...form.formats, value] : form.formats.filter((item) => item !== value) });
  return (
    <fieldset className="grid gap-4 border border-brass/40 p-4 sm:col-span-2 sm:grid-cols-2">
      <legend className="px-2 text-sm font-medium text-walnut">Personalised (photo printing)</legend>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={form.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        Enable photo personalisation for this product
        <span className="text-xs text-walnut/60">(also marks the product Customizable)</span>
      </label>
      {form.enabled && <>
        <label className="grid gap-1 text-sm">Product type
          <select value={form.productType} onChange={(event) => onChange({ productType: event.target.value as PersonalizationProductType })} className={`${box} bg-cream`}>
            {PERSONALIZATION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Printing area
          <input maxLength={200} value={form.areaLabel} onChange={(event) => onChange({ areaLabel: event.target.value })} placeholder="e.g. Wrap-around, front face" className={box} />
        </label>
        <label className="grid gap-1 text-sm">Print width (mm)
          <input inputMode="decimal" value={form.widthMm} onChange={(event) => onChange({ widthMm: event.target.value })} className={box} />
        </label>
        <label className="grid gap-1 text-sm">Print height (mm)
          <input inputMode="decimal" value={form.heightMm} onChange={(event) => onChange({ heightMm: event.target.value })} className={box} />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">Available sizes
          <input value={form.sizes} onChange={(event) => onChange({ sizes: event.target.value })} placeholder="Comma separated, e.g. 11 oz, 15 oz" className={box} />
        </label>
        <label className="grid gap-1 text-sm">Available colours
          <input value={form.colours} onChange={(event) => onChange({ colours: event.target.value })} placeholder="e.g. White, Black, Magic colour-change" className={box} />
        </label>
        <label className="grid gap-1 text-sm">Available materials
          <input value={form.materials} onChange={(event) => onChange({ materials: event.target.value })} placeholder="e.g. Ceramic, Stainless steel" className={box} />
        </label>
        <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:col-span-2">
          <legend className="mb-1">Allowed image formats</legend>
          {IMAGE_FORMATS.map((format) => <label key={format.value} className="flex items-center gap-2"><input type="checkbox" checked={form.formats.includes(format.value)} onChange={(event) => toggleFormat(format.value, event.target.checked)} />{format.label}</label>)}
        </fieldset>
        <label className="grid gap-1 text-sm">Minimum image width (px)
          <input inputMode="numeric" value={form.minWidthPx} onChange={(event) => onChange({ minWidthPx: event.target.value })} placeholder="Optional" className={box} />
        </label>
        <label className="grid gap-1 text-sm">Minimum image height (px)
          <input inputMode="numeric" value={form.minHeightPx} onChange={(event) => onChange({ minHeightPx: event.target.value })} placeholder="Optional" className={box} />
        </label>
        <label className="grid gap-1 text-sm">Max image size (MB, 1–10)
          <input inputMode="numeric" value={form.maxSizeMb} onChange={(event) => onChange({ maxSizeMb: event.target.value })} className={box} />
        </label>
        <label className="grid gap-1 text-sm">Max images per request (1–10)
          <input inputMode="numeric" value={form.maxImages} onChange={(event) => onChange({ maxImages: event.target.value })} className={box} />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">Image guidance for customers
          <textarea rows={2} maxLength={1000} value={form.imageNotes} onChange={(event) => onChange({ imageNotes: event.target.value })} placeholder="e.g. Use well-lit, high-resolution photos. Faces near the edge may be cropped." className={`${box} resize-y`} />
        </label>
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.quotationRequired} onChange={(event) => onChange({ quotationRequired: event.target.checked })} />Quotation required (price set by admin per request)</label>
          <label className="grid gap-1 text-sm">Base price (INR){form.quotationRequired ? " — optional, shown as “from”" : ""}
            <input inputMode="decimal" value={form.basePrice} onChange={(event) => onChange({ basePrice: event.target.value })} className={box} />
          </label>
        </div>
      </>}
    </fieldset>
  );
}
