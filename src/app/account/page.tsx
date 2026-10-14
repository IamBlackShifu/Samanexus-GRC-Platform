"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
export default function AccountPage() {
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [organisationId, setOrganisationId] = useState("");
  async function confirmInvitation() {
    setBusy(true); setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const url = new URL(window.location.href);
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type") ?? "invite";
      if (tokenHash && (type === "invite" || type === "recovery")) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) throw new Error("This invitation is expired or already used. Ask your administrator to renew it.");
      } else {
        const fragment = new URLSearchParams(url.hash.slice(1));
        const access_token = fragment.get("access_token");
        const refresh_token = fragment.get("refresh_token");
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw new Error("This invitation could not be verified.");
        } else {
          const { data, error } = await supabase.auth.getUser();
          if (error || !data.user) throw new Error("Open the secure link in your invitation email to continue.");
        }
      }
      window.history.replaceState({}, "", "/account"); setVerified(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to verify invitation"); }
    finally { setBusy(false); }
  }
  async function activate(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error?.message ?? "Unable to activate workspace");
      setPassword(""); setConfirmation(""); setOrganisationId(payload.data.organisationId);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to set up account"); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout"><Link className="auth-brand" href="/">Samanexus <span>GRC workspace</span></Link><section className="auth-panel"><p className="eyebrow">Client invitation</p><h1>{organisationId ? "Your workspace is ready" : "Set up your account"}</h1>{organisationId ? <><p>You can now open your client workspace. Add an authenticator from Account &amp; security.</p><Link className="primary-button" href={`/clients/${organisationId}`}>Open workspace →</Link></> : !verified ? <><p>Confirm your invitation to choose a password and join your organisation.</p><button className="primary-button" disabled={busy} onClick={confirmInvitation}>{busy ? "Verifying…" : "Confirm invitation"}</button></> : <form className="form-step" onSubmit={activate}><p>Use at least 12 characters. A few unrelated words make a memorable password.</p><label>New password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? "Setting up…" : "Save password & join workspace"}</button></form>}{error && <div className="form-error" role="alert">{error}</div>}</section><Link href="/sign-in">Already have an account? Sign in</Link></main>;
}
