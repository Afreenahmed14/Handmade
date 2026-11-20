import type { CustomRequestStatus } from "../types/database";
import type { Json } from "../types/database";

/** Customer-facing wording for the administrative statuses (customers can only read them, never change them). */
export const customerRequestStatusLabel: Record<CustomRequestStatus, string> = {
  new: "Received", pending: "Under review", in_progress: "In progress", completed: "Completed", rejected: "Not possible",
};
export const customerRequestStatusHint: Record<CustomRequestStatus, string> = {
  new: "We have your request and will review it shortly.",
  pending: "Our team is reviewing feasibility and pricing.",
  in_progress: "Our team is working on your request.",
  completed: "This request has been completed.",
  rejected: "We're sorry — we couldn't take this request forward. See the team's reply if one was left.",
};
export const customerRequestStatusStyle: Record<CustomRequestStatus, string> = {
  new: "border-brass/60 bg-brass/10 text-walnut", pending: "border-amber-700/50 bg-amber-50 text-amber-900",
  in_progress: "border-sky-700/40 bg-sky-50 text-sky-900", completed: "border-olive/60 bg-olive/10 text-olive",
  rejected: "border-red-800/40 bg-red-50 text-red-900",
};
export const customerRequestStatuses = Object.keys(customerRequestStatusLabel) as CustomRequestStatus[];

/** Turns a requirements / preferences JSON object into readable label/value pairs. */
export function readableEntries(value: Json | null | undefined): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (item === null || item === undefined || item === "") return [];
    if (key === "photo_design") return []; // technical editor metadata for the team; the customer sees design_summary instead
    const text = Array.isArray(item) ? item.join(", ") : typeof item === "object" ? JSON.stringify(item) : String(item);
    const label = key.replace(/_/g, " ");
    return [[label.charAt(0).toUpperCase() + label.slice(1), text] as [string, string]];
  });
}

export function budgetText(min: number | null, max: number | null): string {
  const f = (n: number) => "₹" + Number(n).toLocaleString("en-IN");
  if (min !== null && max !== null) return `${f(min)} – ${f(max)}`;
  if (min !== null) return `From ${f(min)}`;
  if (max !== null) return `Up to ${f(max)}`;
  return "Not specified";
}
