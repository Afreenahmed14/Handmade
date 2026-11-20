import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DeliveryRules } from "../services/cartPricing";
import { defaultStoreSettings, getPublicStoreSettings, parsePublicStoreSettings, type StoreSettings } from "../services/settings";

interface Ctx {
  /** Public store settings. Falls back to neutral defaults until (or unless) the database row can be read. */
  settings: StoreSettings;
  /** true once a settings row has actually been read from the database */
  configured: boolean;
  loading: boolean;
  error: string;
  /** Delivery rules for price estimates; null when the settings could not be read, so callers never guess. */
  deliveryRules: DeliveryRules | null;
  reload: () => Promise<void>;
}

const C = createContext<Ctx>({
  settings: defaultStoreSettings, configured: false, loading: true, error: "", deliveryRules: null,
  reload: async () => undefined,
});

export const useStoreSettings = () => useContext(C);

export function StoreSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const parsed = parsePublicStoreSettings(await getPublicStoreSettings());
      if (parsed) setSettings(parsed);
      setConfigured(parsed !== null);
      setError("");
    } catch (reason) {
      // Keep whatever we last knew: a failed read must neither open nor close the store on its own.
      setError(reason instanceof Error ? reason.message : "Unable to load store settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [reload]);

  useEffect(() => {
    if (configured && settings.store_name) document.title = "CasaLoom — Home & Lifestyle";
  }, [configured, settings.store_name]);

  const deliveryRules = useMemo<DeliveryRules | null>(() => configured
    ? { shippingCharge: settings.shipping_charge_inr, freeThreshold: settings.free_shipping_threshold_inr }
    : null, [configured, settings.shipping_charge_inr, settings.free_shipping_threshold_inr]);

  const value = useMemo<Ctx>(() => ({ settings, configured, loading, error, deliveryRules, reload }), [settings, configured, loading, error, deliveryRules, reload]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
