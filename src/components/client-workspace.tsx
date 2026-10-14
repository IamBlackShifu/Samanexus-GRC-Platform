"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AssessmentCard from "@/components/assessment-card";
import { formatDate, sectorLabels } from "@/lib/onboarding";
type Dashboard = {
  organisation: { name: string; sector: string; size: string; primary_contact_name: string; primary_contact_email: string; created_at: string; status: string };
  invitation: { sentAt: string | null; expired: boolean } | null;
  admins: { email: string; status: string }[];
  frameworkScores: { code: string; id: string; name: string; version: string; score: number; controlsTracked: number; gaps: number }[];
  urgentTasks: { id: string; title: string; priority: string; due_date: string | null; status: string }[];
  certifications: { id: string; certification_body: string; expiry_date: string; status: string }[];
};
export default function ClientWorkspace({ id }: { id: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [canAssess, setCanAssess] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const [res, session] = await Promise.all([
          fetch(`/api/v1/organisations/${id}/dashboard`, { signal: controller.signal }),
          fetch("/api/v1/auth/me", { signal: controller.signal }).then(res => res.json()),
        ]);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error?.message ?? "Unable to load the workspace");
        setData(payload.data); setCanAssess(["super_admin", "org_admin", "org_member"].includes(session.data?.role)); setCanInvite(["super_admin", "org_admin"].includes(session.data?.role));
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load client"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [id, reload]);
  async function invite() {
    if (!data || busy) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/v1/organisations/${id}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.organisation.primary_contact_email, fullName: data.organisation.primary_contact_name, role: "org_admin" }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error?.message ?? "Unable to send invitation");
      setMessage(payload.data.alreadySent ? "An invitation has already been sent and is still valid." : "Invitation sent. The admin has up to one hour to complete account setup.");
      setReload(value => value + 1);
    } catch (err) { setMessage(err instanceof Error ? err.message : "Unable to send invitation"); }
    finally { setBusy(false); }
  }
  const admin = data?.admins.find(user => user.email.toLowerCase() === data.organisation.primary_contact_email.toLowerCase());
  return <>
    <Link className="back-link" href="/">← Client portfolio</Link>
    {loading ? <div className="empty-state" role="status">Loading client workspace…</div> : error ? <div className="notice error-notice" role="alert"><h1>Workspace unavailable</h1><p>{error}</p><div className="inline-actions"><button className="secondary-button" onClick={() => setReload(value => value + 1)}>Try again</button><Link href="/sign-in">Sign in or complete MFA</Link></div></div> : data && <>
      <div className="hero-row"><div><p className="eyebrow">Client workspace</p><h1>{data.organisation.name}</h1><p className="hero-copy">{sectorLabels[data.organisation.sector] } · {data.organisation.size} organisation · Added {formatDate(data.organisation.created_at)}</p></div><span className="status status-neutral">{data.organisation.status}</span></div>
      <div className="detail-grid"><section className="surface"><h2>Primary admin</h2><p><strong>{data.organisation.primary_contact_name}</strong><br />{data.organisation.primary_contact_email}</p><span className={`status ${admin?.status === "active" ? "status-good" : "status-warning"}`}>{admin?.status === "active" ? "Workspace active" : admin?.status === "invited" && data.invitation?.sentAt ? (data.invitation.expired ? "Invitation expired" : "Invitation sent · awaiting setup") : admin?.status === "suspended" ? "Admin suspended" : "Invitation needed"}</span>{canInvite && (!admin || admin.status === "invited") && <div className="form-actions"><button className="primary-button" disabled={busy} onClick={invite}>{busy ? "Sending…" : admin ? "Check or renew invitation" : "Send admin invitation"}</button></div>}{message && <p role="status" className="notice">{message}</p>}</section>
      <section className="surface"><h2>Selected frameworks</h2>{data.frameworkScores.length ? data.frameworkScores.map(framework => <div className="framework-summary" key={framework.id}><strong>{framework.name}</strong><p className="muted">{framework.version}</p>{framework.controlsTracked ? <><progress max={100} value={framework.score} aria-label={`${framework.name} control completion`} /><p>{framework.score}% of tracked controls complete · {framework.gaps} gaps</p></> : <p className="muted">Framework selected for this organisation.</p>}</div>) : <p>No framework has been selected for this client.</p>}<p className="small-copy muted">Control completion is a preparation indicator. Certification requires an accredited assessor.</p></section></div>
      <AssessmentCard orgId={id} editable={canAssess} selected={data.frameworkScores.some(framework => framework.code === "CE")} />
      <section className="surface"><h2>Open tasks</h2>{data.urgentTasks.length ? <ul className="task-list">{data.urgentTasks.map(task => <li key={task.id}><div><strong>{task.title}</strong><small>{task.status.replaceAll("_", " ") } · {task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}</small></div><span className={`status ${task.priority === "critical" ? "status-danger" : "status-neutral"}`}>{task.priority}</span></li>)}</ul> : <p className="muted">No open tasks. Review the assessment results to generate remediation tasks from identified gaps.</p>}</section>
      <section className="surface"><h2>Certification records</h2>{data.certifications.length ? <ul className="task-list">{data.certifications.map(cert => <li key={cert.id}><div><strong>{cert.certification_body}</strong><small>Expires {formatDate(cert.expiry_date)}</small></div><span className="status status-neutral">{cert.status}</span></li>)}</ul> : <p className="muted">No certification recorded.</p>}</section>
    </>}
  </>;
}
