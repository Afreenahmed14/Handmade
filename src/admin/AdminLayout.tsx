import { ArrowLeft, Bell, CreditCard, LayoutDashboard, LogOut, Package, ShoppingCart, Tags, Settings, Users, Boxes, Percent } from "lucide-react";
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
    <div className="casaloom-admin min-h-screen text-espresso">
      <header className="casaloom-admin-header sticky top-0 z-30 border-b border-brass/40">
        <div className="container-x flex min-h-14 items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-5">
            <Link to="/" aria-label="Return to storefront" className="text-walnut"><ArrowLeft size={20} /></Link>
            <Link to="/admin/products" className="font-display text-xl font-semibold text-walnut">CasaLoom Admin</Link>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-espresso/70 sm:inline">{user?.email}</span>
            <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="p-2 text-walnut hover:bg-brass/10"><LogOut size={18} /></button>
          </div>
        </div>
      </header>
      <div className="casaloom-admin-shell container-x grid gap-4 py-4 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav aria-label="Admin navigation" className="casaloom-admin-nav flex gap-1.5 overflow-x-auto rounded-2xl border border-white/80 bg-white/75 p-2 shadow-sm lg:sticky lg:top-[76px] lg:h-fit lg:flex-col lg:overflow-visible">
          <NavLink to="/admin/dashboard" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><LayoutDashboard size={16} />Dashboard</NavLink>
          <NavLink to="/admin/products" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Package size={16} />Products</NavLink>
          <NavLink to="/admin/categories" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Tags size={16} />Categories</NavLink>
          <NavLink to="/admin/inventory" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Boxes size={16} />Inventory</NavLink>
          <NavLink to="/admin/customers" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Users size={16} />Customers</NavLink>
          <NavLink to="/admin/orders" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><ShoppingCart size={16} />Orders</NavLink>
          <NavLink to="/admin/payments" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><CreditCard size={16} />Payments</NavLink>
          <NavLink to="/admin/notifications" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Bell size={16} />Notifications</NavLink>
          <NavLink to="/admin/coupons" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Percent size={16} />Coupons</NavLink>
          <NavLink to="/admin/settings" className={({ isActive }) => `admin-nav-link ${isActive ? "is-active" : ""}`}><Settings size={16} />Settings</NavLink>
        </nav>
        <main className="casaloom-admin-content min-w-0 rounded-2xl border border-white/80 bg-white/35 p-3 shadow-[0_10px_35px_rgba(100,48,78,.07)] sm:p-4">{error && <p role="alert" className="mb-4 text-sm text-red-800">{error}</p>}<Outlet /></main>
      </div>
    </div>
  );
}