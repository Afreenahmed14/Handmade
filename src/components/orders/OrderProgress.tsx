import { Check, Circle, XCircle } from "lucide-react";
import type { OrderStatus } from "../../types/database";
import type { TrackingEvent } from "../../services/customerOrders";
import { ORDER_STEPS, customerOrderStatusLabel, customerOrderStatusMessage, formatDateTime } from "../../utils/orderStatus";

/**
 * Vertical progress list. It is built from the status/time pairs the database returns, so a step shows a time only if
 * the order really reached it. Cancelled and returned orders show the steps they did reach, then the terminal state.
 */
export default function OrderProgress({ status, timeline }: { status: OrderStatus; timeline: TrackingEvent[] }) {
  const reachedAt = new Map<OrderStatus, string>();
  for (const event of timeline) if (!reachedAt.has(event.status)) reachedAt.set(event.status, event.at);
  const terminal = status === "cancelled" || status === "returned";
  const currentIndex = ORDER_STEPS.indexOf(status);

  const steps = ORDER_STEPS.map((step, index) => {
    const at = reachedAt.get(step) ?? null;
    if (terminal) return { step, at, state: at ? "done" as const : "skipped" as const };
    if (index < currentIndex) return { step, at, state: "done" as const };
    if (index === currentIndex) return { step, at, state: step === "delivered" ? "done" as const : "current" as const };
    return { step, at: null, state: "upcoming" as const };
  }).filter((entry) => !(terminal && entry.state === "skipped"));

  return (
    <ol aria-label="Order progress" className="grid gap-0">
      {steps.map(({ step, at, state }, index) => {
        const isLast = index === steps.length - 1 && !terminal;
        return (
          <li key={step} aria-current={state === "current" ? "step" : undefined} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast && <span aria-hidden="true" className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-px ${state === "done" ? "bg-olive" : "bg-brass/30"}`} />}
            <span aria-hidden="true" className={`relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border ${state === "done" ? "border-olive bg-olive text-cream" : state === "current" ? "border-walnut bg-walnut text-cream" : "border-brass/40 bg-cream text-brass/50"}`}>
              {state === "done" ? <Check size={13} /> : <Circle size={7} fill="currentColor" />}
            </span>
            <div className={state === "upcoming" ? "text-espresso/50" : "text-espresso"}>
              <p className={`text-sm ${state === "current" ? "font-bold text-walnut" : "font-medium"}`}>
                {customerOrderStatusLabel[step]}
                <span className="sr-only">{state === "done" ? " (completed)" : state === "current" ? " (current step)" : " (not reached yet)"}</span>
              </p>
              {at && <p className="text-xs text-walnut/70">{formatDateTime(at)}</p>}
              {state === "current" && <p className="mt-1 text-sm text-espresso/80">{customerOrderStatusMessage[step]}</p>}
            </div>
          </li>
        );
      })}
      {terminal && (
        <li aria-current="step" className="relative flex gap-4">
          <span aria-hidden="true" className="relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border border-red-700 bg-red-50 text-red-800"><XCircle size={14} /></span>
          <div>
            <p className="text-sm font-bold text-red-800">{customerOrderStatusLabel[status]}</p>
            {reachedAt.get(status) && <p className="text-xs text-walnut/70">{formatDateTime(reachedAt.get(status))}</p>}
            <p className="mt-1 text-sm text-espresso/80">{customerOrderStatusMessage[status]}</p>
          </div>
        </li>
      )}
    </ol>
  );
}
