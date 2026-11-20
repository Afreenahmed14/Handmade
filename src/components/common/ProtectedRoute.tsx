import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import type { AppRole } from "../../types/database";
import { useAuth } from "../../context/AuthContext";

export default function ProtectedRoute({ roles }: { roles?: readonly AppRole[] }) {
  const { user, role: currentRole, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="container-x py-24 text-center text-walnut">Checking your account...</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && (!currentRole || !roles.includes(currentRole))) {
    return <div className="container-x py-24 text-center"><h1 className="text-3xl text-walnut">Access unavailable</h1><Link to="/" className="btn-primary mt-6">Return home</Link></div>;
  }
  return <Outlet />;
}