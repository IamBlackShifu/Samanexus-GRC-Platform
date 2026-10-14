"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/me", { signal: controller.signal }).then(res => res.json()).then(payload => { if (payload.success) { setSignedIn(true); setEmail(payload.data.email); } }).catch(() => {});
    return () => controller.abort();
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error("Check your email and password and try again.");
      setSignedIn(true); setPassword("");
      const response = await fetch("/api/v1/auth/me");
      const session = await response.json();
      if (!response.ok) throw new Error(session.error?.message ?? "Unable to load your account");
      if (session.data.role === "super_admin") await prepareMfa();
      else setReady(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in"); }
    finally { setBusy(false); }
  }
  async function prepareMfa() {
    const supabase = createSupabaseBrowserClient();
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === "aal2") { setReady(true); return; }
    const { data: factors, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    if (factors.totp.length) { setFactorId(factors.totp[0].id); return; }
    for (const factor of factors.all.filter(factor => factor.status === "unverified" && factor.factor_type === "totp")) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
    }
    const { data: enrolment, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Samanexus authenticator" });
    if (enrolError) throw enrolError;
    setFactorId(enrolment.id); setQr(enrolment.totp.qr_code); setSecret(enrolment.totp.secret);
  }
  async function secureAccount() {
    setBusy(true); setError("");
    try { await prepareMfa(); } catch { setError("Unable to prepare your authenticator. Try again."); }
    finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw new Error("The code could not be verified. Enter the latest six-digit code.");
      setQr(""); setSecret(""); setCode(""); setReady(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to verify code"); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) throw error;
      setSignedIn(false); setReady(false); setFactorId(""); setQr(""); setSecret(""); setCode("");
    } catch { setError("Unable to sign out. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout"><Link className="auth-brand" href="/">Samanexus <span>GRC workspace</span></Link><section className="auth-panel"><p className="eyebrow">Account & security</p><h1>{ready ? "You’re ready to continue" : signedIn ? "Secure your account" : "Welcome back"}</h1><p className="muted">{signedIn ? `Signed in as ${email}. Super admins need MFA to manage clients.` : "Sign in to your compliance workspace."}</p>
    {!signedIn ? <form className="form-step" onSubmit={login}><label>Email address<input type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form> : ready ? <Link className="primary-button" href="/">Open workspace →</Link> : factorId ? <form className="form-step" onSubmit={verify}>{qr && <><p>Scan this QR code with your authenticator app.</p>{/* Authenticator secrets stay in memory only. */}<Image unoptimized className="mfa-qr" src={qr} alt="Authenticator setup QR code" width={200} height={200} /><details><summary>Enter a setup key instead</summary><code className="mfa-secret">{secret}</code></details></>}<label>Six-digit authenticator code<input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button></form> : <div className="inline-actions"><button disabled={busy} className="primary-button" onClick={secureAccount}>{busy ? "Preparing…" : "Set up or verify MFA"}</button><Link href="/">Open workspace</Link></div>}
    {error && <div role="alert" className="form-error">{error}</div>}{signedIn && <button disabled={busy} className="secondary-button logout-button" onClick={logout}>Sign out</button>}
  </section><p className="muted small-copy">Joining a new client workspace? Use the invitation in your email.</p></main>;
}
