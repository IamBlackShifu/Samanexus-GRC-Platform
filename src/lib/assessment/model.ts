import { z } from "zod";

const answerValue = z.union([z.boolean(), z.string().max(8000), z.null()]);
export const answersSchema = z.record(z.string().min(1).max(80), z.object({
  value: answerValue,
  note: z.string().max(2000).default(""),
}).strict());
export const questionSchema = z.object({
  reference: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),
  domain: z.string().min(1).max(100),
  title: z.string().trim().min(2).max(400),
  type: z.enum(["boolean", "text", "choice"]),
  guidance: z.string().max(4000),
  critical: z.boolean(),
  sourceReference: z.string().max(80).optional(),
  choices: z.array(z.object({ value: z.string().min(1).max(100), label: z.string().min(1).max(200) })).min(1).max(30).optional(),
  passValues: z.array(z.union([z.boolean(), z.string()])).min(1).max(30).optional(),
  when: z.object({ reference: z.string(), values: z.array(z.union([z.boolean(), z.string()])).min(1).max(30) }).optional(),
  remediation: z.string().max(4000).optional(),
}).strict();
export const catalogueSchema = z.object({
  version: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,100}$/),
  label: z.string().min(1).max(200),
  schemeVersion: z.string().min(1).max(100),
  kind: z.literal("preparation"),
  sourceUrl: z.url().refine(value => new URL(value).protocol === "https:", "Use an HTTPS source URL"),
  limitations: z.string().min(1).max(1000),
  questions: z.array(questionSchema).min(1).max(500),
}).strict().superRefine((catalogue, context) => {
  if (!catalogue.questions.some(question => question.passValues)) context.addIssue({ code: "custom", path: ["questions"], message: "A preparation catalogue needs at least one scored check" });
  const previous = new Map<string, z.infer<typeof questionSchema>>();
  for (const [index, question] of catalogue.questions.entries()) {
    const issue = (message: string) => context.addIssue({ code: "custom", path: ["questions", index], message });
    if (previous.has(question.reference)) issue("Question references must be unique");
    const allowed: (string | boolean)[] = question.type === "boolean" ? [true, false] : question.choices?.map(choice => choice.value) ?? [];
    if (question.type === "choice" && (!question.choices || new Set(allowed).size !== allowed.length)) issue("Choices must have unique values");
    if (question.type === "text" && question.passValues) issue("Descriptive answers need human review; they cannot be automatically scored");
    if (question.passValues?.some(value => !allowed.includes(value))) issue("Pass values must be valid answer values");
    if (question.critical && !question.passValues) issue("Critical questions need an explicit pass rule");
    if (question.passValues && !question.remediation) issue("Scored checks need remediation guidance");
    if (question.when) {
      const dependency = previous.get(question.when.reference);
      const dependencyValues: (string | boolean)[] = dependency?.type === "boolean" ? [true, false] : dependency?.choices?.map(choice => choice.value) ?? [];
      if (!dependency || dependency.when || question.when.values.some(value => !dependencyValues.includes(value))) issue("Conditions must use valid values from an earlier, always-applicable question");
    }
    previous.set(question.reference, question);
  }
});
export type Catalogue = z.infer<typeof catalogueSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Answers = z.infer<typeof answersSchema>;
export type AnswerState = "pending_scope" | "not_applicable" | "unanswered" | "complete" | "pass" | "gap" | "critical_gap";
export type AssessmentStatus = "draft" | "paused" | "reviewed";
export type Assessment = {
  id: string; org_id: string; catalogue_version: string; catalogue: Catalogue;
  answers: Answers; cursor: string; status: AssessmentStatus; revision: number;
  updated_at: string; reviewed_at: string | null;
};

export function answerState(question: Question, answers: Answers): AnswerState {
  if (question.when) {
    const dependency = answers[question.when.reference]?.value;
    if (dependency === undefined || dependency === null || dependency === "") return "pending_scope";
    if (!question.when.values.includes(dependency)) return "not_applicable";
  }
  const value = answers[question.reference]?.value;
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "unanswered";
  if (question.type === "text") return "complete";
  if (!question.passValues) return "complete";
  if (question.passValues.includes(value)) return "pass";
  return question.critical ? "critical_gap" : "gap";
}

export function validateAnswers(catalogue: Catalogue, input: unknown): Answers {
  const answers = answersSchema.parse(input);
  const questions = new Map(catalogue.questions.map(question => [question.reference, question]));
  for (const [reference, answer] of Object.entries(answers)) {
    const question = questions.get(reference);
    if (!question) throw new Error("The answer refers to an unknown question");
    if (answer.value === null) continue;
    if (question.type === "boolean" && typeof answer.value !== "boolean") throw new Error("Choose Yes or No");
    if (question.type === "text" && typeof answer.value !== "string") throw new Error("A written answer is required");
    if (question.type === "choice" && !question.choices?.some(choice => choice.value === answer.value)) throw new Error("Choose a valid option");
  }
  return answers;
}

export function summarise(catalogue: Catalogue, answers: Answers) {
  const rows = catalogue.questions.map(question => ({ question, state: answerState(question, answers) }));
  const applicable = rows.filter(row => row.state !== "not_applicable");
  const answered = applicable.filter(row => !["unanswered", "pending_scope"].includes(row.state)).length;
  const scored = applicable.filter(row => row.question.passValues);
  const satisfied = scored.filter(row => row.state === "pass").length;
  const gaps = rows.filter(row => row.state === "gap" || row.state === "critical_gap");
  const critical = gaps.filter(row => row.state === "critical_gap");
  return {
    required: applicable.length, answered, unanswered: applicable.length - answered,
    scored: scored.length, satisfied, readiness: scored.length ? Math.floor(100 * satisfied / scored.length) : 0,
    gapCount: gaps.length, criticalCount: critical.length,
    outcome: critical.length ? "critical_gaps" : answered < applicable.length ? "incomplete" : gaps.length ? "gaps" : "checks_satisfied",
    gaps: gaps.map(row => ({ reference: row.question.reference, title: row.question.title, domain: row.question.domain, critical: row.question.critical })),
    domains: [...new Set(catalogue.questions.map(question => question.domain))].map(domain => {
      const questions = applicable.filter(row => row.question.domain === domain);
      return { domain, required: questions.length, answered: questions.filter(row => !["unanswered", "pending_scope"].includes(row.state)).length };
    }),
  };
}
