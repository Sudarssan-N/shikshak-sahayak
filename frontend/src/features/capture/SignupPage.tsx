import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui";
import { friendlyError } from "./copy";
import { Brand } from "./Brand";
import "./capture.css";

function normalisePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

export default function SignupPage() {
  const { teacher, setSession } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (teacher) return <Navigate to={teacher.consent_at ? "/" : "/welcome"} replace />;

  const ok = name.trim().length >= 2 && /^\d{10}$/.test(phone) && /^\d{6}$/.test(pin) && pin === pin2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, teacher: t } = await api.signup(name.trim(), phone, pin);
      setSession(token, t);
      navigate(t.consent_at ? "/" : "/welcome", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 409 || err.status === 422 || err.status === 403)
          ? err.message
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cap-screen">
      <Brand />
      <form className="cap-panel stack" onSubmit={submit} noValidate>
        <h1>Create account</h1>
        <p className="muted">
          Your mobile number and a 6-digit PIN are all you need to log in. <span lang="hi">नया खाता बनाएँ।</span>
        </p>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" className="input" autoComplete="name" value={name} maxLength={120}
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="phone">Mobile number</label>
          <div className="cap-phone">
            <span className="cap-phone-cc" aria-hidden>+91</span>
            <input id="phone" className="input cap-input-lg num" type="tel" inputMode="numeric"
                   autoComplete="tel-national" placeholder="98765 43210" value={phone}
                   onChange={(e) => setPhone(normalisePhone(e.target.value))} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="pin">Choose a 6-digit PIN</label>
          <input id="pin" className="input cap-code num" type="password" inputMode="numeric"
                 autoComplete="new-password" maxLength={6} placeholder="••••••" value={pin}
                 onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </div>
        <div className="field">
          <label htmlFor="pin2">Type the PIN again</label>
          <input id="pin2" className="input cap-code num" type="password" inputMode="numeric"
                 autoComplete="new-password" maxLength={6} placeholder="••••••" value={pin2}
                 onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          {pin2.length === 6 && pin !== pin2 ? <p className="error-note">The two PINs don't match.</p> : null}
        </div>
        {error ? <p className="error-note" role="alert">{error}</p> : null}
        <Button type="submit" block loading={busy} disabled={!ok}>
          Create account
        </Button>
        <p className="muted">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
