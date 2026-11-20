import type { AddressErrors, ShippingAddress } from "../../services/checkout";

const fields: { name: keyof ShippingAddress; label: string; autoComplete: string; wide?: boolean; required?: boolean; inputMode?: "tel" | "numeric" | "text" }[] = [
  { name: "full_name", label: "Full name", autoComplete: "name", required: true },
  { name: "phone", label: "Phone number", autoComplete: "tel", required: true, inputMode: "tel" },
  { name: "address_line1", label: "Address line 1", autoComplete: "address-line1", wide: true, required: true },
  { name: "address_line2", label: "Address line 2 (optional)", autoComplete: "address-line2", wide: true },
  { name: "city", label: "City", autoComplete: "address-level2", required: true },
  { name: "state", label: "State", autoComplete: "address-level1", required: true },
  { name: "postal_code", label: "PIN / postal code", autoComplete: "postal-code", required: true, inputMode: "text" },
  { name: "country", label: "Country", autoComplete: "country-name", required: true },
];

export default function AddressFields({ value, errors, disabled, onChange }: {
  value: ShippingAddress; errors: AddressErrors; disabled?: boolean; onChange: (field: keyof ShippingAddress, next: string) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map(({ name, label, autoComplete, wide, required, inputMode }) => {
        const error = errors[name];
        const errorId = `checkout-${name}-error`;
        return (
          <label key={name} className={`grid gap-2 text-sm ${wide ? "sm:col-span-2" : ""}`}>
            <span>{label}{required && <span aria-hidden="true" className="text-brass"> *</span>}</span>
            <input
              name={name} value={value[name]} autoComplete={autoComplete} inputMode={inputMode} disabled={disabled}
              required={required} aria-required={required} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
              onChange={(event) => onChange(name, event.target.value)}
              className={`w-full border bg-transparent px-4 py-3 disabled:opacity-60 ${error ? "border-red-800" : "border-brass/50"}`}
            />
            {error && <span id={errorId} role="alert" className="text-xs text-red-800">{error}</span>}
          </label>
        );
      })}
    </div>
  );
}
