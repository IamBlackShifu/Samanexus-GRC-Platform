"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import WorkspaceShell from "@/components/workspace-shell";
import { organisationSchema, sectorLabels } from "@/lib/onboarding";

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", sector: "care", size: "micro", primaryContactName: "", primaryContactEmail: "" });
  const [selected, setSelected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const setupKey = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const detailsForm = useRef<HTMLFormElement>(null);
  function goTo(next: number) { setStep(next); setError(""); requestAnimationFrame(() => heading.current?.focus()); }
  function update(field: string, value: string) { setForm(current => ({ ...current, [field]: value })); }
  function next(event: FormEvent) {
    event.preventDefault();
    if (!setupKey.current) setupKey.current = crypto.randomUUID();
    const parsed = organisationSchema.safeParse({ ...form, setupKey: setupKey.current, frameworkCodes: selected ? ["CE"] : [] });
    if (step === 1 && !parsed.success && parsed.error.issues.some(issue => issue.path[0] !== "frameworkCodes")) {
      setError("Enter an organisation name and contact name of at least two characters, and a valid email address."); return;
    }
    if (step === 2 && !selected) { setError("Select Cyber Essentials to continue."); return; }
    goTo(step + 1);
  }
  async function submit() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      let organisation = created;
      if (!organisation) {
        const response = await fetch("/api/v1/organisations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, setupKey: setupKey.current, frameworkCodes: ["CE"] }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to create the workspace");
        organisation = payload.data;
        setCreated(organisation);
      }
      if (!organisation) throw new Error("Workspace creation was not confirmed. Retry safely.");
      const response = await fetch(`/api/v1/organisations/${organisation.id}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.primaryContactEmail, fullName: form.primaryContactName, role: "org_admin" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Workspace saved, but the invitation could not be sent");
      setExpiresAt(payload.data.expiresAt); setSent(true);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to complete client setup"); }
    finally { setBusy(false); }
  }
  return <WorkspaceShell current="New client">
    <Link className="back-link" href="/">← Client portfolio</Link>
    <div className="onboarding-layout"><aside className="onboarding-aside"><p className="eyebrow">Client onboarding</p><h1>A clear start for every client.</h1><p>Create their workspace, select a framework and invite the person leading compliance.</p><div className="setup-note"><strong>One organisation. One workspace.</strong><p>Client data stays within its organisation. The primary contact joins as an organisation admin.</p></div></aside>
    <section className="onboarding-panel" aria-label="Client setup">
      <ol className="stepper" aria-label="Setup progress">{["Organisation", "Framework", "Review & invite"].map((label, index) => <li className={`step ${step === index + 1 ? "current" : ""} ${step > index + 1 ? "complete" : ""}`} aria-current={step === index + 1 ? "step" : undefined} key={label}><span aria-hidden="true">{step > index + 1 ? "✓" : index + 1}</span>{label}</li>)}</ol>
      {sent && created ? <div className="success-state"><span className="success-mark" aria-hidden="true">✓</span><h2 ref={heading} tabIndex={-1}>Workspace created. Invitation sent.</h2><p>{created.name} is set up for Cyber Essentials. We sent an invitation to <strong>{form.primaryContactEmail}</strong>.</p><p>The invitation expires at {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(expiresAt))} (UK time), or sooner if your email provider has a shorter expiry.</p><Link className="primary-button" href={`/clients/${created.id}`}>Open client workspace →</Link></div> : <>
      <form ref={detailsForm} onSubmit={step < 3 ? next : event => { event.preventDefault(); void submit(); }}>
      {step === 1 && <div className="form-step"><p className="eyebrow">Step 1 of 3</p><h2 ref={heading} tabIndex={-1}>Organisation details</h2><p className="form-intro">All fields are required.</p><label>Organisation name<input required minLength={2} maxLength={255} autoComplete="organization" value={form.name} onChange={event => update("name", event.target.value)} placeholder="For example, Sunrise Care Ltd" /></label><div className="form-grid"><label>Sector<select value={form.sector} onChange={event => update("sector", event.target.value)}>{Object.entries(sectorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Organisation size<select value={form.size} onChange={event => update("size", event.target.value)}><option value="micro">Micro · 1–10 people</option><option value="small">Small · 11–50 people</option><option value="medium">Medium · 51–250 people</option></select></label></div><label>Primary contact name<input required minLength={2} maxLength={255} autoComplete="name" value={form.primaryContactName} onChange={event => update("primaryContactName", event.target.value)} /></label><label>Primary contact email<input required type="email" maxLength={255} autoComplete="email" value={form.primaryContactEmail} onChange={event => update("primaryContactEmail", event.target.value)} /><small>Use the address they’ll use to sign in.</small></label></div>}
      {step === 2 && <div className="form-step"><p className="eyebrow">Step 2 of 3</p><h2 ref={heading} tabIndex={-1}>Choose a starting framework</h2><p className="form-intro">Cyber Essentials is available for Phase 1 client setup.</p><label className={`framework-option ${selected ? "selected" : ""}`}><input type="checkbox" checked={selected} onChange={event => setSelected(event.target.checked)} /><span><strong>Cyber Essentials</strong><small>Danzell 2026 · Verified self-assessment preparation</small></span></label><div className="later-frameworks"><strong>Planned for later phases</strong><p>Cyber Essentials Plus technical verification, ISO 27001, UK GDPR and CQC readiness.</p></div></div>}
      {step === 3 && <div className="form-step"><p className="eyebrow">Step 3 of 3</p><h2 ref={heading} tabIndex={-1}>{created ? "Finish the client handoff" : "Review and invite"}</h2><p className="form-intro">{created ? "The workspace is saved. Retry the invitation without creating another organisation." : "Check these details before creating the workspace."}</p><dl className="review-list"><div><dt>Organisation</dt><dd>{form.name}</dd></div><div><dt>Sector & size</dt><dd>{sectorLabels[form.sector] } · {form.size}</dd></div><div><dt>Primary admin</dt><dd>{form.primaryContactName}<br />{form.primaryContactEmail}</dd></div><div><dt>Framework</dt><dd>Cyber Essentials · Danzell 2026</dd></div></dl><div className="security-callout"><strong>A secure invitation</strong><p>The admin receives a single-use link to set a password. Account setup must be completed within one hour.</p></div></div>}
      {error && <div className="form-error" role="alert"><strong>{created ? "Workspace saved — invitation incomplete" : "We couldn’t complete this step"}</strong><p>{error}</p><Link href="/sign-in">Sign in or check MFA</Link></div>}
      <div className="form-actions">{step > 1 && !created ? <button disabled={busy} type="button" className="secondary-button" onClick={() => goTo(step - 1)}>Back</button> : <span />}{step < 3 ? <button type="submit" className="primary-button">Continue →</button> : <button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : created ? "Retry invitation" : "Create workspace & send invite"}</button>}</div>
      </form>{created && <p className="small-copy"><Link href={`/clients/${created.id}`}>Open the saved workspace</Link></p>}
      </>}
    </section></div>
  </WorkspaceShell>;
}
