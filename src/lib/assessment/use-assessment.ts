"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import bundledCatalogue from "@/lib/assessment/catalogue.json";
import { catalogueSchema, summarise, validateAnswers, type Answers, type Assessment, type AssessmentStatus } from "@/lib/assessment/model";

export type RemediationTask = { id: string; title: string; priority: string; status: string; assessment_reference: string; assessment_gap_state: string };
export type AssessmentView = { assessment: Assessment; organisation: { id: string; name: string }; editable: boolean; tasks: RemediationTask[] };
const previewKey = "samanexus-assessment-preview-v1";
function newPreview(): AssessmentView {
  const catalogue = catalogueSchema.parse(bundledCatalogue);
  return { assessment: { id: "preview", org_id: "preview", catalogue_version: catalogue.version, catalogue, answers: {}, cursor: catalogue.questions[0].reference, status: "draft", revision: 0, updated_at: new Date().toISOString(), reviewed_at: null }, organisation: { id: "preview", name: "Preview organisation" }, editable: true, tasks: [] };
}

export function useAssessment(id: string, preview: boolean) {
  const [view, setView] = useState<AssessmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const current = useRef<AssessmentView | null>(null);
  const desired = useRef<{ answers: Answers; cursor: string } | null>(null);
  const generation = useRef(0);
  const savedGeneration = useRef(0);
  const conflicted = useRef(false);
  const locked = useRef(false);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      let data: AssessmentView;
      if (preview) {
        const stored = sessionStorage.getItem(previewKey);
        try {
          data = stored ? JSON.parse(stored) : newPreview();
          if (data.assessment.catalogue_version !== bundledCatalogue.version) data = newPreview();
          data.assessment.catalogue = catalogueSchema.parse(bundledCatalogue);
        } catch { data = newPreview(); }
      } else {
        const response = await fetch(`/api/v1/assessments/${id}`, { signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to load the assessment");
        data = payload.data;
        data.assessment.catalogue = catalogueSchema.parse(data.assessment.catalogue);
      }
      data.assessment.answers = validateAnswers(data.assessment.catalogue, data.assessment.answers);
      if (signal?.aborted) return;
      current.current = data;
      desired.current = { answers: data.assessment.answers, cursor: data.assessment.cursor };
      generation.current = 0; savedGeneration.current = 0; conflicted.current = false;
      setView(data); setDirty(false); setConflict(false);
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "Unable to load assessment"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [id, preview]);

  const save = useCallback((nextStatus?: AssessmentStatus): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    queue.current = queue.current.catch(() => false).then(async () => {
      const base = current.current;
      const draft = desired.current;
      if (!base || !draft || conflicted.current || !base.editable) return false;
      const status = nextStatus ?? base.assessment.status;
      if (savedGeneration.current === generation.current && status === base.assessment.status) return true;
      const capturedGeneration = generation.current;
      const answers = structuredClone(draft.answers);
      const cursor = draft.cursor;
      setSaving(true); setError("");
      try {
        let saved: Assessment;
        if (preview) {
          await new Promise(resolve => setTimeout(resolve, 120));
          saved = { ...base.assessment, answers, cursor, status, revision: base.assessment.revision + 1, updated_at: new Date().toISOString(), reviewed_at: status === "reviewed" ? new Date().toISOString() : null };
          sessionStorage.setItem(previewKey, JSON.stringify({ ...base, assessment: saved }));
        } else {
          const response = await fetch(`/api/v1/assessments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: base.assessment.revision, answers, cursor, status }) });
          const payload = await response.json();
          if (response.status === 409) { conflicted.current = true; setConflict(true); }
          if (!response.ok) throw new Error(payload.error?.message ?? "Your changes have not been saved");
          saved = payload.data.assessment;
        }
        current.current = { ...base, assessment: saved };
        savedGeneration.current = capturedGeneration;
        setView({ ...base, assessment: { ...saved, answers: desired.current!.answers, cursor: desired.current!.cursor } });
        setDirty(generation.current > capturedGeneration);
        return true;
      } catch (err) { setError(err instanceof Error ? err.message : "Your changes have not been saved. Retry before leaving."); return false; }
      finally { setSaving(false); }
    });
    return queue.current;
  }, [id, preview]);

  const update = useCallback((reference: string, answer?: Partial<Answers[string]>) => {
    const base = current.current;
    if (!base || !desired.current || locked.current || conflicted.current) return;
    const editable = base.editable && base.assessment.status === "draft";
    const answers = answer && editable ? { ...desired.current.answers, [reference]: { value: desired.current.answers[reference]?.value ?? null, note: desired.current.answers[reference]?.note ?? "", ...answer } } : desired.current.answers;
    desired.current = { answers, cursor: reference };
    setView(previous => previous ? { ...previous, assessment: { ...previous.assessment, answers, cursor: reference } } : previous);
    if (!editable) return;
    generation.current += 1; setDirty(true); setMessage("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  }, [save]);

  const transition = useCallback(async (status: AssessmentStatus) => {
    locked.current = true; setTransitioning(true); setMessage("");
    try { return await save(status); }
    finally { locked.current = false; setTransitioning(false); }
  }, [save]);

  const generateTasks = useCallback(async () => {
    const base = current.current;
    if (!base || !base.editable || base.assessment.status !== "reviewed") return;
    locked.current = true; setTransitioning(true); setError(""); setMessage("");
    try {
      let result: { created: number; reused: number; resolved: number; total: number };
      if (preview) {
        const summary = summarise(base.assessment.catalogue, base.assessment.answers);
        const gapRefs = new Set(summary.gaps.map(gap => gap.reference));
        const tasks = base.tasks.map(task => ({ ...task, assessment_gap_state: gapRefs.has(task.assessment_reference) ? "open" : "resolved" }));
        let created = 0;
        for (const gap of summary.gaps) if (!tasks.some(task => task.assessment_reference === gap.reference)) {
          created += 1; tasks.push({ id: `preview-${gap.reference}`, title: `Address ${gap.domain.toLowerCase()} gap (${base.assessment.catalogue.questions.find(question => question.reference === gap.reference)?.sourceReference ?? gap.reference})`, priority: gap.critical ? "critical" : "high", status: "not_started", assessment_reference: gap.reference, assessment_gap_state: "open" });
        }
        result = { created, reused: summary.gapCount - created, resolved: tasks.filter(task => task.assessment_gap_state === "resolved").length, total: summary.gapCount };
        sessionStorage.setItem(previewKey, JSON.stringify({ ...base, tasks }));
      } else {
        const response = await fetch(`/api/v1/assessments/${id}/remediation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: base.assessment.revision }) });
        const payload = await response.json();
        if (response.status === 409) { conflicted.current = true; setConflict(true); }
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to generate remediation tasks");
        result = payload.data;
      }
      await load();
      setMessage(`${result.created} ${result.created === 1 ? "task" : "tasks"} created; ${result.reused} existing ${result.reused === 1 ? "task" : "tasks"} linked. ${result.total} current ${result.total === 1 ? "gap" : "gaps"} covered.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to generate tasks. Retry safely."); }
    finally { locked.current = false; setTransitioning(false); }
  }, [id, load, preview]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => { controller.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current > savedGeneration.current) { event.preventDefault(); event.returnValue = ""; }
    };
    const retry = () => { if (generation.current > savedGeneration.current && !conflicted.current) void save(); };
    const navigate = (event: MouseEvent) => {
      if (generation.current <= savedGeneration.current || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.download || new URL(link.href).origin !== window.location.origin || link.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault(); event.stopPropagation();
      void save().then(saved => { if (saved) window.location.assign(link.href); });
    };
    window.addEventListener("click", navigate, true);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", retry);
    return () => { window.removeEventListener("click", navigate, true); window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("online", retry); };
  }, [save]);

  function downloadDraft() {
    if (!current.current || !desired.current) return;
    const blob = new Blob([JSON.stringify({ catalogueVersion: current.current.assessment.catalogue_version, organisation: current.current.organisation.name, ...desired.current }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "assessment-draft.json"; link.click(); URL.revokeObjectURL(url);
  }
  return { view, loading, saving, dirty, error, conflict, message, transitioning, update, save, transition, generateTasks, reload: load, downloadDraft };
}
