"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/onboarding";
import type { Assessment, summarise } from "@/lib/assessment/model";

type AssessmentItem = { assessment: Assessment; summary: ReturnType<typeof summarise> };
export default function AssessmentCard({ orgId, editable, selected }: { orgId: string; editable: boolean; selected: boolean }) {
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [catalogues, setCatalogues] = useState<{ version: string; label: string; schemeVersion: string; questionCount: number }[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const [response, catalogueResponse] = await Promise.all([
          fetch(`/api/v1/organisations/${orgId}/assessments`, { signal: controller.signal }),
          fetch("/api/v1/assessment-catalogues", { signal: controller.signal }),
        ]);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to load assessment progress");
        const available = await catalogueResponse.json();
        if (!catalogueResponse.ok) throw new Error(available.error?.message ?? "Unable to load question sets");
        setItems(payload.data); setCatalogues(available.data);
        setSelectedVersion(available.data.find((catalogue: { version: string }) => !payload.data.some((item: AssessmentItem) => item.assessment.catalogue_version === catalogue.version))?.version ?? "");
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load assessments"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [orgId, retry]);
  async function start() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/organisations/${orgId}/assessments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selectedVersion ? { catalogueVersion: selectedVersion } : {}) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to start assessment");
      router.push(`/assessments/${payload.data.assessment.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to start assessment"); }
    finally { setBusy(false); }
  }
  const latest = items[0];
  const available = catalogues.filter(catalogue => !items.some(item => item.assessment.catalogue_version === catalogue.version));
  return <section className="surface"><div className="section-heading assessment-card-heading"><div><p className="eyebrow">Compliance workflow</p><h2>Cyber Essentials preparation</h2></div>{latest && <span className={`status ${latest.summary.criticalCount ? "status-danger" : "status-neutral"}`}>{latest.summary.criticalCount ? "Critical gaps" : latest.assessment.status === "reviewed" ? "Results reviewed" : latest.assessment.status === "paused" ? "Paused" : "In progress"}</span>}</div>
    {loading ? <p className="muted" role="status">Loading assessment progress...</p> : error ? <div className="form-error" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : latest ? <><div className="assessment-card-summary"><div><strong>{latest.summary.answered}/{latest.summary.required}</strong><span>questions answered</span></div><div><strong>{latest.summary.gapCount}</strong><span>gaps identified</span></div><div><strong>{latest.summary.criticalCount}</strong><span>critical gaps</span></div></div><p className="muted small-copy">{latest.assessment.catalogue.schemeVersion} · Last saved {formatDate(latest.assessment.updated_at)}</p><Link className="primary-button" href={`/assessments/${latest.assessment.id}`}>{!editable ? "View assessment" : latest.assessment.status === "reviewed" ? "View preparation results" : "Continue assessment"} →</Link>{items.length > 1 && <details className="assessment-history"><summary>Previous question-set versions</summary>{items.slice(1).map(item => <p key={item.assessment.id}><Link href={`/assessments/${item.assessment.id}`}>{item.assessment.catalogue.label} · {item.assessment.catalogue_version}</Link></p>)}</details>}</> : <><p className="muted">Work through the preparation checks, save your answers and turn gaps into remediation tasks.</p>{!selected ? <p>Select Cyber Essentials for this organisation before starting an assessment.</p> : editable ? <button className="primary-button" disabled={busy} onClick={start}>{busy ? "Starting..." : "Start preparation assessment"}</button> : <p className="muted">The organisation team has not started an assessment yet.</p>}</>}
    {latest && editable && available.length > 0 && <details className="assessment-history"><summary>Start another question-set version</summary><label className="assessment-catalogue-picker">Question set<select value={selectedVersion} onChange={event => setSelectedVersion(event.target.value)}>{available.map(catalogue => <option key={catalogue.version} value={catalogue.version}>{catalogue.label} · {catalogue.schemeVersion} · {catalogue.questionCount} checks</option>)}</select></label><button className="secondary-button" disabled={busy || !selectedVersion} onClick={start}>{busy ? "Starting..." : "Start selected question set"}</button></details>}
    <p className="small-copy muted assessment-card-note">Preparation results cover the selected checklist. Complete the official IASME questionnaire with an assessor for certification.</p>
  </section>;
}
