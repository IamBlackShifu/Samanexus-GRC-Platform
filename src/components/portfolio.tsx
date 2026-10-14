"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate, sectorLabels } from "@/lib/onboarding";

type Client = {
  id: string; name: string; sector: string; status: string; created_at: string;
  primary_contact_name: string; primary_contact_email: string;
  org_frameworks: { frameworks: { code: string; name: string } | null }[];
  assessmentSummary?: { id: string; status: string; answered: number; required: number; gapCount: number; criticalCount: number } | null;
  invitation?: { sentAt: string | null; expired: boolean } | null;
  users: { id: string; email: string; role: string; status: string }[];
};
const sampleClients: Client[] = [
  { id: "preview-sunrise", name: "Sunrise Care Ltd", sector: "care", status: "active", created_at: "2026-10-12", primary_contact_name: "Alex Morgan", primary_contact_email: "alex@example.com", org_frameworks: [{ frameworks: { code: "CE", name: "Cyber Essentials" } }], users: [{ id: "1", email: "alex@example.com", role: "org_admin", status: "active" }] },
  { id: "preview-meadow", name: "Meadow View Residential", sector: "care", status: "active", created_at: "2026-10-10", primary_contact_name: "Sam Taylor", primary_contact_email: "sam@example.com", org_frameworks: [{ frameworks: { code: "CE", name: "Cyber Essentials" } }], invitation: { sentAt: "2026-10-10", expired: false }, users: [{ id: "2", email: "sam@example.com", role: "org_admin", status: "invited" }] },
  { id: "preview-brightwell", name: "Brightwell Support Services", sector: "care", status: "active", created_at: "2026-10-09", primary_contact_name: "Jo Patel", primary_contact_email: "jo@example.com", org_frameworks: [{ frameworks: { code: "CE", name: "Cyber Essentials" } }], users: [] },
];
export function onboardingStatus(client: Client) {
  if (client.status !== "active") return `Organisation ${client.status}`;
  const contact = client.users.find(user => user.email.toLowerCase() === client.primary_contact_email.toLowerCase() && user.role === "org_admin");
  return contact?.status === "active" ? "Workspace active" : contact?.status === "invited" && client.invitation?.sentAt ? (client.invitation.expired ? "Invitation expired" : "Invitation sent") : contact?.status === "suspended" ? "Admin suspended" : "Invitation needed";
}

function assessmentLabel(summary: NonNullable<Client["assessmentSummary"]>) {
  if (summary.criticalCount) return `${summary.criticalCount} critical ${summary.criticalCount === 1 ? "gap" : "gaps"}`;
  if (summary.gapCount) return `${summary.gapCount} ${summary.gapCount === 1 ? "gap" : "gaps"}`;
  return summary.status === "reviewed" ? "Results reviewed" : summary.status === "paused" ? "Paused" : "In progress";
}

export default function Portfolio({ preview }: { preview: boolean }) {
  const [clients, setClients] = useState<Client[]>(preview ? sampleClients : []);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(preview ? sampleClients.length : 0);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All clients");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const session = await fetch("/api/v1/auth/me", { signal: controller.signal }).then(res => res.json());
        if (session.success && session.data.role !== "super_admin" && session.data.organisationId) {
          window.location.replace(`/clients/${session.data.organisationId}`); return;
        }
        const res = await fetch(`/api/v1/organisations?page=${page}&limit=25`, { signal: controller.signal });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error?.message ?? "Unable to load clients");
        setClients(payload.data); setTotal(payload.meta.total);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load clients"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [page, preview, reload]);
  const visible = clients.filter(client => client.name.toLowerCase().includes(query.toLowerCase()) && (filter === "All clients" || onboardingStatus(client) === filter));
  const active = clients.filter(client => onboardingStatus(client) === "Workspace active").length;
  const criticalClients = clients.filter(client => (client.assessmentSummary?.criticalCount ?? 0) > 0);
  const criticalCount = clients.reduce((total, client) => total + (client.assessmentSummary?.criticalCount ?? 0), 0);
  const needsInvite = clients.filter(client => ["Invitation needed", "Invitation expired"].includes(onboardingStatus(client)));
  return <>
    {preview && <div className="notice preview-notice"><strong>Preview workspace</strong><span>Sample clients are shown. Connect Supabase to manage your live portfolio.</span><Link className="text-link preview-assessment-link" href="/assessments/preview">Try the assessment workflow →</Link></div>}
    <section className="hero-row"><div><p className="eyebrow">Client management</p><h1>Your client portfolio</h1><p className="hero-copy">Bring clients onboard and keep their compliance work moving.</p></div><Link className="primary-button" href="/onboarding">+ Add client</Link></section>
    {error ? <div className="notice error-notice" role="alert"><strong>We couldn’t load your portfolio</strong><p>{error}</p><div className="inline-actions"><button className="secondary-button" onClick={() => setReload(value => value + 1)}>Try again</button><Link href="/sign-in">Sign in or complete MFA</Link></div></div> : <>
      <section className="metrics-grid" aria-label="Client setup summary" aria-busy={loading}>{[
        ["Total clients", total, "Across your portfolio"], ["Workspace active", active, "Primary admin has joined"], ["Critical assessment gaps", criticalCount, "Across clients on this page"], ["Invitation needed", needsInvite.length, "Complete the client handoff"],
      ].map(([label, value, detail]) => <div className="metric-card" key={label}><span>{label}</span><strong>{loading ? "—" : value}</strong><small>{detail}</small></div>)}</section>
      {total > 25 && <p className="muted small-copy">Progress and setup counts cover the clients on this page.</p>}
      {criticalClients.length > 0 && <div className="notice critical-notice"><strong>{criticalClients.length} {criticalClients.length === 1 ? "client has" : "clients have"} critical assessment gaps</strong><p>Review the saved assessment and prioritise the remediation work.</p><Link className="text-link" href={`/assessments/${criticalClients[0].assessmentSummary!.id}`}>Review critical gaps →</Link></div>}
      {needsInvite.length > 0 && <div className="notice action-notice"><div><strong>Finish the client handoff</strong><p>{needsInvite.length} {needsInvite.length === 1 ? "client needs an admin invitation" : "clients need admin invitations"} on this page.</p></div>{!preview && <Link className="text-link" href={`/clients/${needsInvite[0].id}`}>Review client →</Link>}</div>}
      <section aria-labelledby="client-list-title"><div className="section-heading"><div><h2 id="client-list-title">Client directory</h2><p className="muted">{loading ? "Loading clients…" : `${visible.length} ${visible.length === 1 ? "client" : "clients"} shown`}</p></div><button className="secondary-button" disabled={loading || preview} onClick={() => setReload(value => value + 1)}>Refresh</button></div>
      <div className="filters"><label>Search this page<input type="search" placeholder="Search organisation name" value={query} onChange={event => setQuery(event.target.value)} /></label><label>Setup status<select value={filter} onChange={event => setFilter(event.target.value)}>{["All clients", "Workspace active", "Invitation sent", "Invitation needed", "Invitation expired", "Admin suspended", "Organisation archived", "Organisation suspended"].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <div className="table-card" aria-busy={loading}><table><caption className="sr-only">Client organisations and onboarding status</caption><thead><tr><th scope="col">Organisation</th><th scope="col">Assessment</th><th scope="col">Primary contact</th><th scope="col">Setup status</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Open workspace</span></th></tr></thead><tbody>{!loading && visible.map(client => <tr key={client.id}><td><div className="client-name"><span className="org-avatar" aria-hidden="true">{client.name.charAt(0)}</span><div><strong>{client.name}</strong><small>{sectorLabels[client.sector]}{client.status !== "active" ? ` · ${client.status}` : ""}</small><div>{client.org_frameworks.map(item => <span className="framework-pill" key={item.frameworks?.code}>{item.frameworks?.name}</span>)}</div></div></div></td><td>{client.assessmentSummary ? <div className="portfolio-assessment"><Link className="text-link" href={`/assessments/${client.assessmentSummary.id}`}>{client.assessmentSummary.answered}/{client.assessmentSummary.required} answered</Link><span className={`status ${client.assessmentSummary.criticalCount ? "status-danger" : client.assessmentSummary.gapCount ? "status-warning" : "status-neutral"}`}>{assessmentLabel(client.assessmentSummary)}</span></div> : <span className="muted">Not started</span>}</td><td>{client.primary_contact_name}</td><td><span className={`status ${onboardingStatus(client) === "Workspace active" ? "status-good" : "status-warning"}`}>{onboardingStatus(client)}</span></td><td className="muted">{formatDate(client.created_at)}</td><td>{preview ? <span className="muted">Preview</span> : <Link className="text-link" aria-label={`Open ${client.name}`} href={`/clients/${client.id}`}>Open →</Link>}</td></tr>)}</tbody></table>
      {loading && <div className="empty-state" role="status">Loading your clients…</div>}
      {!loading && visible.length === 0 && <div className="empty-state"><h3>{clients.length ? "No matching clients" : "Your first client starts here"}</h3><p>{clients.length ? "Try another organisation name or setup status." : "Create an organisation and invite its primary admin."}</p>{!clients.length && <Link className="primary-button" href="/onboarding">Add your first client</Link>}</div>}</div>
      {total > 25 && <nav className="pagination" aria-label="Client pages"><button className="secondary-button" disabled={page === 1 || loading} onClick={() => { setPage(page - 1); setQuery(""); setFilter("All clients"); }}>Previous</button><span>Page {page} of {Math.ceil(total / 25)}</span><button className="secondary-button" disabled={page * 25 >= total || loading} onClick={() => { setPage(page + 1); setQuery(""); setFilter("All clients"); }}>Next</button></nav>}
      </section>
    </>}
    <div className="workspace-footnote"><span className="muted">Cyber Essentials</span><span>Client setup is separate from assessment readiness and certification.</span></div>
  </>;
}
