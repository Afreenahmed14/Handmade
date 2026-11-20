import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "../types/database";
import { supabase } from "../lib/supabase";

interface AuthState {
  user: User | null;
  role: AppRole | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, role: null, loading: true });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let requestSequence = 0;

    const resolveRole = async (session: Session | null, sequence: number) => {
      if (!active || sequence !== requestSequence) return;
      setUser(session?.user ?? null);
      if (!session?.user) {
        setRole(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle();
      if (active && sequence === requestSequence) {
        setRole(error ? null : data?.role ?? null);
        setLoading(false);
      }
    };

    const initialSequence = ++requestSequence;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const sequence = ++requestSequence;
      window.setTimeout(() => { void resolveRole(session, sequence); }, 0);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (active && initialSequence === requestSequence) setLoading(false);
        return;
      }
      void resolveRole(data.session, initialSequence);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user, role, loading }}>{children}</AuthContext.Provider>;
}