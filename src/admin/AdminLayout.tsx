import { ArrowLeft, Bell, CreditCard, LayoutDashboard, LogOut, Package, ShoppingCart, Tags, Settings } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { logout } from "../services/auth";

export default function AdminLayout() {
  const { user } = useAuth();
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function signOut() {
    setError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign out.");
    }
  }

  return (
    <div className="min-h-screen bg-cream text-espresso">
      <header className="border-b border-brass/40 bg-cream">
        <div className="container-x flex min-h-16 items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-5">
            <Link to="/" aria-label="Return to storefront" className="text-walnut"><ArrowLeft size={20} /></Link>
            <Link to="/admin/products" className="font-display text-2xl font-semibold text-walnut">CasaLoom Admin</Link>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-espresso/70 sm:inline">{user?.email}</span>
            <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="p-2 text-walnut hover:bg-brass/10"><LogOut size={18} /></button>
          </div>
        </div>
      </header>
      <div className="container-x grid gap-8 py-8 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Admin navigation" className="flex gap-2 border-b border-brass/30 pb-4 md:flex-col md:border-b-0 md:border-r md:pb-0 md:pr-5">
          <NavLink to="/admin/dashboard" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><LayoutDashboard size={17} />Dashboard</NavLink>
          <NavLink to="/admin/products" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><Package size={17} />Products</NavLink>
          <NavLink to="/admin/categories" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><Tags size={17} />Categories</NavLink>
          <NavLink to="/admin/orders" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><ShoppingCart size={17} />Orders</NavLink>
          <NavLink to="/admin/payments" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><CreditCard size={17} />Payments</NavLink>
          <NavLink to="/admin/notifications" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><Bell size={17} />Notifications</NavLink>
          <NavLink to="/admin/settings" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 text-sm ${isActive ? "bg-walnut text-cream" : "text-walnut hover:bg-brass/10"}`}><Settings size={17} />Settings</NavLink>
        </nav>
        <main className="min-w-0">{error && <p role="alert" className="mb-4 text-sm text-red-800">{error}</p>}<Outlet /></main>
      </div>
    </div>
  );
}