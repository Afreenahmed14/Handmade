import type { Json } from "../types/database";

/** Reads a stored shipping-address JSON object into display lines, ignoring anything that is not plain text. */
export function shippingAddressLines(address: Json): string[] {
  if (!address || typeof address !== "object" || Array.isArray(address)) return [];
  const read = (key: string) => { const value = address[key]; return typeof value === "string" ? value.trim() : ""; };
  return [
    read("full_name") || read("name"), read("phone"), read("address_line1"), read("address_line2"),
    [read("city"), read("state"), read("postal_code")].filter(Boolean).join(", "), read("country"),
  ].filter(Boolean);
}
