import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { sendPhoneOtp, verifyPhoneOtp } from "../../services/auth";

export default function VerifyOTP() {
  const location = useLocation();
  const initialPhone = (location.state as { phone?: string } | null)?.phone ?? "";
  const [phone, setPhone] = useState(initialPhone);
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(Boolean(initialPhone));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (!sent) {
        await sendPhoneOtp(phone);
        setSent(true);
      } else {
        await verifyPhoneOtp(phone, token);
        navigate("/profile", { replace: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to verify this phone number.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="container-x max-w-xl py-16 md:py-24">
      <h1 className="text-4xl text-walnut">Verify your phone</h1>
      <p className="mt-3 text-espresso/75">Enter your number with its country code to receive a one-time code.</p>
      <form onSubmit={submit} className="mt-8 grid gap-5">
        <label className="grid gap-2 text-sm">Phone number<input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} readOnly={sent} className="border border-brass/50 bg-transparent px-4 py-3 read-only:opacity-70" /></label>
        {sent && <label className="grid gap-2 text-sm">Verification code<input required inputMode="numeric" autoComplete="one-time-code" value={token} onChange={(event) => setToken(event.target.value)} className="border border-brass/50 bg-transparent px-4 py-3" /></label>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <button disabled={pending} className="btn-primary disabled:opacity-60">{pending ? "Please wait..." : sent ? "Verify code" : "Send code"}</button>
      </form>
    </section>
  );
}