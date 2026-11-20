/** Formats a rupee amount for display, e.g. 4200 -> "₹4,200" (Indian digit grouping). */
export const formatINR = (n: number): string => "₹" + n.toLocaleString("en-IN");
