import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { loginWithPassword, sendPhoneOtp } from "../../services/auth";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const requestedDestination = (
    location.state as { from?: string } | null
  )?.from;

  const destination =
    requestedDestination?.startsWith("/") &&
    !requestedDestination.startsWith("//") &&
    !requestedDestination.includes("\\")
      ? requestedDestination
      : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      if (mode === "email") {
        // Authenticate using Supabase
        await loginWithPassword(email.trim(), password);

        // Get the authenticated user
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          throw new Error("Unable to retrieve your account details.");
        }

        // Fetch the user's actual database role
        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();

        if (roleError) {
          throw new Error("Unable to verify your account permissions.");
        }

        if (!roleData) {
          throw new Error(
            "Your account role has not been configured. Contact the administrator."
          );
        }

        // Role-based redirection
        if (roleData.role === "super_admin") {
          navigate(destination || "/admin/dashboard", {
            replace: true,
          });
        } else {
          // Customers cannot be redirected into admin routes
          // const customerDestination =
          //   destination && !destination.startsWith("/admin")
          //     ? destination
          //     : "/profile";

          const customerDestination =
  destination && !destination.startsWith("/admin")
    ? destination
    : "/";

          navigate(customerDestination, {
            replace: true,
          });
        }
      } else {
        // Phone OTP login
        await sendPhoneOtp(phone);
        navigate("/verify-otp", {
          state: { phone },
        });
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to sign in. Please try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="container-x max-w-xl py-16 md:py-24">
      <h1 className="text-4xl text-walnut">
        Welcome back
      </h1>

      <p className="mt-3 text-espresso/75">
        Sign in to your CasaLoom account.
      </p>

      <div
        className="mt-8 flex border-b border-brass/50"
        role="tablist"
        aria-label="Sign-in method"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "email"}
          onClick={() => setMode("email")}
          className={`px-5 py-3 ${
            mode === "email"
              ? "border-b-2 border-walnut text-walnut"
              : "text-espresso/60"
          }`}
        >
          Email
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mode === "phone"}
          onClick={() => setMode("phone")}
          className={`px-5 py-3 ${
            mode === "phone"
              ? "border-b-2 border-walnut text-walnut"
              : "text-espresso/60"
          }`}
        >
          Phone OTP
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 grid gap-5">
        {mode === "email" ? (
          <>
            <label className="grid gap-2 text-sm">
              Email address
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="border border-brass/50 bg-transparent px-4 py-3"
              />
            </label>

            <label className="grid gap-2 text-sm">
              Password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="border border-brass/50 bg-transparent px-4 py-3"
              />
            </label>
          </>
        ) : (
          <label className="grid gap-2 text-sm">
            Phone number with country code
            <input
              required
              type="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="border border-brass/50 bg-transparent px-4 py-3"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          disabled={pending}
          className="btn-primary disabled:opacity-60"
        >
          {pending
            ? "Please wait..."
            : mode === "email"
              ? "Sign in"
              : "Send verification code"}
        </button>
      </form>

      <p className="mt-6 text-sm">
        New to CasaLoom?{" "}
        <Link
          to="/register"
          className="text-walnut underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </section>
  );
}
