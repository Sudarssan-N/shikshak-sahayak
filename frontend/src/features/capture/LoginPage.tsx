import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth";
import { Button } from "../../components/ui";
import { friendlyError } from "./copy";
import { Brand } from "./Brand";
import "./capture.css";

const RESEND_AFTER_S = 30;

/** Accepts "98765 43210", "+91 9876543210", "09876543210" → "9876543210". */
function normalisePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

export default function LoginPage() {
  const { teacher, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notRegistered, setNotRegistered] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (teacher) return <Navigate to={teacher.consent_at ? from || "/" : "/welcome"} replace />;

  const phoneOk = /^\d{10}$/.test(phone);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!phoneOk) {
      setError("Please enter your 10-digit mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotRegistered(false);
    try {
      const r = await api.requestCode(phone);
      setDevCode(r.dev_code ?? null);
      setCode("");
      setStep("code");
      setResendIn(RESEND_AFTER_S);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotRegistered(true);
      else setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, teacher: t } = await api.verify(phone, value);
      setSession(token, t);
      navigate(t.consent_at ? from || "/" : "/welcome", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 401)
          ? "That code didn't match. Please check the SMS and try again."
          : friendlyError(err),
      );
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cap-screen">
      <Brand />

      {step === "phone" ? (
        <form className="cap-panel stack" onSubmit={sendCode} noValidate>
          <h1>Log in</h1>
          <p className="muted">
            Enter the mobile number your pilot lead registered. <span lang="hi">अपना मोबाइल नंबर डालें।</span>
          </p>
          <div className="field">
            <label htmlFor="phone">Mobile number</label>
            <div className="cap-phone">
              <span className="cap-phone-cc" aria-hidden>
                +91
              </span>
              <input
                id="phone"
                className="input cap-input-lg num"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(normalisePhone(e.target.value))}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
          </div>
          {notRegistered ? (
            <div className="cap-callout" role="alert">
              <strong>This number isn't registered yet.</strong>
              <p>Please contact your pilot lead to add you. Once they do, come back and log in with the same number.</p>
            </div>
          ) : null}
          {error ? (
            <p id="login-error" className="error-note" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" block loading={busy} disabled={!phoneOk}>
            Send code
          </Button>
        </form>
      ) : (
        <form
          className="cap-panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          noValidate
        >
          <h1>Enter the code</h1>
          <p className="muted">
            We sent a 6-digit code by SMS to <strong className="num">+91 {phone.slice(0, 5)} {phone.slice(5)}</strong>.
          </p>

          {devCode ? <DevHint code={devCode} onUse={() => { setCode(devCode); void verify(devCode); }} onDismiss={() => setDevCode(null)} /> : null}

          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              ref={codeRef}
              className="input cap-code num"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          {error ? (
            <p id="login-error" className="error-note" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" block loading={busy} disabled={code.length !== 6}>
            Log in
          </Button>
          <div className="row cap-split">
            <Button type="button" variant="ghost" onClick={() => { setStep("phone"); setError(null); }}>
              Change number
            </Button>
            <Button type="button" variant="ghost" disabled={resendIn > 0 || busy} onClick={() => void sendCode()}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function DevHint({ code, onUse, onDismiss }: { code: string; onUse: () => void; onDismiss: () => void }) {
  return (
    <div className="cap-dev" role="note">
      <span>
        Dev mode — code is <strong className="num">{code}</strong>
      </span>
      <span className="row">
        <button type="button" className="cap-linkbtn" onClick={onUse}>
          Use it
        </button>
        <button type="button" className="cap-iconbtn" onClick={onDismiss} aria-label="Dismiss dev hint">
          ×
        </button>
      </span>
    </div>
  );
}
