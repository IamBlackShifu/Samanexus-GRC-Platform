"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { answerState, summarise } from "@/lib/assessment/model";
import { useAssessment } from "@/lib/assessment/use-assessment";
const stateLabels: Record<string, string> = { pending_scope: "Scope answer needed", not_applicable: "Outside the selected scope", unanswered: "Not answered", complete: "Answered", pass: "Check satisfied", gap: "Gap to address", critical_gap: "Critical gap" };

export default function AssessmentRunner({ id, preview }: { id: string; preview: boolean }) {
  const runner = useAssessment(id, preview);
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const { view, loading, saving, dirty, error, conflict, transitioning } = runner;
  async function leave() {
    if (dirty && !await runner.save()) return;
    router.push(preview ? "/" : `/clients/${view?.organisation.id}`);
  }
  function goTo(reference: string) {
    runner.update(reference);
    requestAnimationFrame(() => heading.current?.focus());
  }
  if (loading) return <div className="empty-state" role="status">Loading your assessment...</div>;
  if (!view) return <div className="notice error-notice" role="alert"><h1>Assessment unavailable</h1><p>{error}</p><div className="inline-actions"><button className="secondary-button" onClick={() => void runner.reload()}>Try again</button><Link href="/sign-in">Sign in or complete MFA</Link><Link href="/">Client portfolio</Link></div></div>;
  const { assessment, editable, tasks } = view;
  const { catalogue, answers, cursor, status } = assessment;
  const summary = summarise(catalogue, answers);
  const questions = catalogue.questions.filter(question => answerState(question, answers) !== "not_applicable");
  const question = catalogue.questions.find(item => item.reference === cursor) ?? questions[0];
  const index = questions.findIndex(item => item.reference === question.reference);
  const state = answerState(question, answers);
  const canEdit = editable && status === "draft" && !transitioning && !conflict;
  const answer = answers[question.reference];
  const savedAt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(assessment.updated_at));
  return <>
    <button className="back-link text-button" onClick={() => void leave()}>← {preview ? "Client portfolio" : "Client workspace"}</button>
    {preview && <div className="notice preview-notice"><strong>Assessment preview</strong><span>Demo answers are saved in this browser tab only. No client records or real tasks are created.</span></div>}
    <div className="hero-row assessment-hero"><div><p className="eyebrow">{view.organisation.name}</p><h1>{catalogue.label}</h1><p className="hero-copy">{catalogue.schemeVersion} · {catalogue.questions.length} preparation checks</p></div><div className="assessment-save"><span className="status status-neutral">{status === "reviewed" ? "Results reviewed" : status === "paused" ? "Paused" : "In progress"}</span><span role="status" aria-live="polite">{saving ? "Saving changes..." : dirty ? "Changes waiting to save" : !editable ? "Read-only access" : `Saved ${savedAt} (UK)`}</span></div></div>
    <div className="assessment-context"><p>{catalogue.limitations}</p><a href={catalogue.sourceUrl} target="_blank" rel="noreferrer">Official IASME question set ↗</a></div>
    {error && <div className="form-error" role="alert"><strong>{conflict ? "The saved assessment has changed" : "Changes could not be confirmed"}</strong><p>{error}</p><div className="inline-actions">{conflict ? <><button className="secondary-button" disabled={saving || transitioning} onClick={() => void runner.reload()}>Reload saved answers and discard this draft</button><button className="secondary-button" onClick={runner.downloadDraft}>Download my draft</button></> : <><button className="secondary-button" disabled={saving || transitioning} onClick={() => void runner.save()}>Retry save</button><button className="secondary-button" onClick={runner.downloadDraft}>Download my draft</button></>}</div></div>}
    {runner.message && <div className="notice" role="status">{runner.message}</div>}
    {summary.criticalCount > 0 && <div className="notice critical-notice" role="status"><strong>{summary.criticalCount} critical {summary.criticalCount === 1 ? "gap needs" : "gaps need"} attention</strong><p>These checks can cause an automatic fail in the official assessment. Address them regardless of the preparation percentage.</p></div>}
    <section className={`assessment-metrics ${status !== "reviewed" ? "assessment-in-progress" : ""}`} aria-label="Assessment progress"><div><span>Questions answered</span><strong>{summary.answered} <small>of {summary.required}</small></strong></div><div><span>Scored checks satisfied</span><strong>{summary.readiness}%</strong><small>{summary.satisfied} of {summary.scored} applicable checks</small></div><div><span>Gaps identified</span><strong>{summary.gapCount}</strong></div><div><span>Critical gaps</span><strong className={summary.criticalCount ? "critical-number" : ""}>{summary.criticalCount}</strong></div></section>
    {status === "paused" && <div className="notice action-notice"><div><strong>Pick up where you left off</strong><p>Your answers and assessment position are saved.</p></div>{editable && <button className="primary-button" disabled={transitioning || conflict} onClick={() => void runner.transition("draft")}>Resume assessment</button>}</div>}
    {status !== "reviewed" ? <div className="assessment-layout">
      <aside className="assessment-sections"><h2>Assessment sections</h2><nav aria-label="Assessment sections">{summary.domains.map(domain => {
        const first = questions.find(item => item.domain === domain.domain);
        return <button key={domain.domain} className={`section-button ${question.domain === domain.domain ? "current" : ""}`} disabled={!first || transitioning || conflict} aria-current={question.domain === domain.domain ? "step" : undefined} onClick={() => first && goTo(first.reference)}><span>{domain.domain}</span><small>{domain.answered} / {domain.required} answered</small></button>;
      })}</nav><p className="small-copy muted">Complete every applicable check. Unanswered checks do not increase the preparation percentage.</p></aside>
      <label className="assessment-mobile-section">Assessment section<select value={question.domain} disabled={transitioning || conflict} onChange={event => { const first = questions.find(item => item.domain === event.target.value); if (first) goTo(first.reference); }}>{summary.domains.map(domain => <option key={domain.domain} value={domain.domain} disabled={!domain.required}>{domain.domain} ({domain.answered}/{domain.required} answered)</option>)}</select></label>
      <section className="surface assessment-question" aria-label="Current question"><div className="question-meta"><span className="eyebrow">{question.domain}</span><span className={`status ${state === "critical_gap" ? "status-danger" : state === "pass" || state === "complete" ? "status-good" : "status-neutral"}`}>{stateLabels[state]}</span></div><p className="small-copy muted">Question {index + 1} of {questions.length}{question.sourceReference ? ` · IASME reference ${question.sourceReference}` : ""}</p><h2 ref={heading} tabIndex={-1}>{question.title}</h2><p className="question-guidance" id="question-guidance">{question.guidance}</p>
      {question.critical && <p className="critical-label">Critical check · This requirement must be met.</p>}
      {state === "pending_scope" ? <div className="notice"><p>Answer the scope question first to determine whether this check applies.</p><button className="secondary-button" onClick={() => goTo(question.when!.reference)}>Go to the scope question</button></div> : state === "not_applicable" ? <p className="muted">This question does not apply to the scope you selected.</p> : <div className="answer-fields">
        {question.type === "text" ? <label className="assessment-field">Your answer<textarea aria-describedby="question-guidance" disabled={!canEdit} maxLength={8000} rows={6} value={typeof answer?.value === "string" ? answer.value : ""} onChange={event => runner.update(question.reference, { value: event.target.value })} /></label> : <fieldset disabled={!canEdit} aria-describedby="question-guidance"><legend className="sr-only">Your answer</legend><div className="answer-options">{(question.type === "boolean" ? [{ value: true, label: "Yes" }, { value: false, label: "No" }] : question.choices ?? []).map(option => <label key={String(option.value)} className={`answer-option ${answer?.value === option.value ? "selected" : ""}`}><input type="radio" name={question.reference} checked={answer?.value === option.value} onChange={() => runner.update(question.reference, { value: option.value })} /><span>{option.label}</span></label>)}</div></fieldset>}
        <label className="assessment-field">Supporting notes <span className="muted">(optional)</span><textarea rows={3} maxLength={2000} disabled={!canEdit} value={answer?.note ?? ""} onChange={event => runner.update(question.reference, { note: event.target.value })} /><small>Record the owner, supporting evidence or follow-up needed. {answer?.note?.length ?? 0}/2000 characters.</small></label>
      </div>}
      <div className="question-navigation"><button className="secondary-button" disabled={index <= 0 || transitioning || conflict} onClick={() => goTo(questions[index - 1].reference)}>← Previous</button><button className="primary-button" disabled={index >= questions.length - 1 || transitioning || conflict} onClick={() => goTo(questions[index + 1].reference)}>Next question →</button></div>
      </section>
    </div> : <section className="surface assessment-results"><div className="section-heading"><div><h2>Preparation results</h2><p className="muted">Based on your saved answers. Certification is reviewed by your assessor.</p></div>{editable && <button className="secondary-button" disabled={transitioning || conflict} onClick={() => void runner.transition("draft")}>Reopen answers</button>}</div>
      {summary.gapCount ? <ul className="assessment-gap-list">{summary.gaps.map(gap => <li key={gap.reference}><div><strong>{gap.title}</strong><small>{gap.domain}</small></div><span className={`status ${gap.critical ? "status-danger" : "status-warning"}`}>{gap.critical ? "Critical gap" : "Gap"}</span></li>)}</ul> : <div className="notice"><strong>All selected preparation checks are satisfied</strong><p>Continue with the full official questionnaire and assessor review.</p></div>}
      {editable && <div className="inline-actions"><button className="primary-button" disabled={transitioning || conflict} onClick={() => void runner.generateTasks()}>{transitioning ? "Updating tasks..." : "Create or update remediation tasks"}</button><span className="small-copy muted">Existing task notes and assignments are preserved.</span></div>}
      {tasks.length > 0 && <div className="generated-tasks"><h3>Linked remediation tasks</h3><ul className="task-list">{tasks.map(task => <li key={task.id}><div><strong>{task.title}</strong><small>{task.assessment_gap_state === "open" ? task.status.replaceAll("_", " ") : task.assessment_gap_state === "not_applicable" ? "Outside the selected scope · task history retained" : "Gap resolved in the assessment · task history retained"}</small></div><span className={`status ${task.assessment_gap_state !== "open" ? "status-good" : task.priority === "critical" ? "status-danger" : "status-warning"}`}>{task.assessment_gap_state === "open" ? task.priority : task.assessment_gap_state === "not_applicable" ? "Not applicable" : "Gap resolved"}</span></li>)}</ul></div>}
    </section>}
    {editable && status === "draft" && <div className="assessment-footer"><div><strong>{summary.unanswered ? `${summary.unanswered} ${summary.unanswered === 1 ? "question" : "questions"} left to answer` : "All applicable questions answered"}</strong><p className="small-copy muted">Save your progress at any time, then review the results when you’re ready.</p></div><div className="inline-actions"><button className="secondary-button" disabled={transitioning || conflict} onClick={() => void runner.transition("paused")}>Save & pause</button><button className="primary-button" disabled={!!summary.unanswered || transitioning || conflict} onClick={() => void runner.transition("reviewed")}>{transitioning ? "Saving..." : "Review results"}</button></div></div>}
    {!editable && <p className="small-copy muted">Auditor access is read-only. Ask the organisation team to update answers or generate tasks.</p>}
  </>;
}
