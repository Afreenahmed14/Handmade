import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import { useAuth } from "../../context/AuthContext";
import { useStoreSettings } from "../../context/StoreSettingsContext";

/** Sign-in stays reachable during maintenance so an administrator can still get to /admin. */
const MAINTENANCE_OPEN_PATHS = ["/login", "/verify-otp"];

export default function CustomerLayout() {
  const { settings } = useStoreSettings();
  const { role, loading } = useAuth();
  const { pathname } = useLocation();
  const maintenance = settings.maintenance_mode;
  const isAdmin = role === "super_admin";
  if (maintenance && !isAdmin && !MAINTENANCE_OPEN_PATHS.includes(pathname)) {
    const email = settings.support_email ?? settings.contact_email;
    return (
      <main className="container-x py-32 text-center">
        {loading
          ? <p role="status" className="text-walnut/70">Loading...</p>
          : <>
              <h1 className="text-5xl text-walnut">{settings.store_name}</h1>
              <p role="status" className="mx-auto mt-6 max-w-lg text-espresso/80">{settings.maintenance_message || "We're making a few improvements and will be back shortly."}</p>
              {email && <p className="mt-6 text-sm text-walnut/70">Questions? <a href={`mailto:${email}`} className="underline underline-offset-4">{email}</a></p>}
            </>}
      </main>
    );
  }
  return (
    <>
      {maintenance && isAdmin && <p role="status" className="bg-brass px-4 py-2 text-center text-sm text-cream">Maintenance mode is on. Customers cannot see the storefront; you can because you are signed in as an administrator.</p>}
      <Header /><main><Outlet /></main><Footer />
    </>
  );
}
