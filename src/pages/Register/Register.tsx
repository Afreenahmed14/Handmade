import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerCustomer, resendSignupConfirmation } from "../../services/auth";

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const navigate = useNavigate();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setNeedsConfirmation(false);
    setPending(true);
    try {
      const signedIn = await registerCustomer(email, password, fullName.trim());
      if (signedIn) navigate("/profile", { replace: true });
      else {
        setMessage("Check your email to confirm your account before signing in.");
        setNeedsConfirmation(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create your account.");
    } finally {
      setPending(false);
    }
  }

  async function resendConfirmation() {
    setResending(true);
    setError("");
    try {
      await resendSignupConfirmation(email);
      setMessage("A new confirmation email has been sent.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to resend the confirmation email.");
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="container-x max-w-xl py-16 md:py-24">
      <h1 className="text-4xl text-walnut">Create your account</h1>
      <p className="mt-3 text-espresso/75">Keep your details close for future visits.</p>
      <form onSubmit={submit} className="mt-8 grid gap-5">
        <label className="grid gap-2 text-sm">Full name<input required autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="border border-brass/50 bg-transparent px-4 py-3" /></label>
        <label className="grid gap-2 text-sm">Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="border border-brass/50 bg-transparent px-4 py-3" /></label>
        <label className="grid gap-2 text-sm">Password<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="border border-brass/50 bg-transparent px-4 py-3" /><span className="text-xs text-espresso/60">Use at least 8 characters.</span></label>
        {message && <p role="status" className="text-sm text-green-800">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <button disabled={pending} className="btn-primary disabled:opacity-60">{pending ? "Creating account..." : "Create account"}</button>
        {needsConfirmation && <button type="button" disabled={resending} onClick={resendConfirmation} className="justify-self-start text-sm text-walnut underline underline-offset-4 disabled:opacity-60">{resending ? "Sending..." : "Resend confirmation email"}</button>}
      </form>
      <p className="mt-6 text-sm">Already registered? <Link to="/login" className="text-walnut underline underline-offset-4">Sign in</Link></p>
    </section>
  );
}