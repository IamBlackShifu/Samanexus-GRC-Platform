import { z } from "zod";
import { getAuthContext } from "@/lib/auth";
import { errorResponse, successResponse } from "@/lib/api";
import { assessmentAccess, assessmentPayload, assessmentRpcError } from "@/lib/assessment/server";
import { summarise, validateAnswers, catalogueSchema, type Assessment } from "@/lib/assessment/model";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return errorResponse("Invalid assessment", 422);
    const context = await getAuthContext();
    const denied = assessmentAccess(context);
    if (denied) return denied;
    const { data, error } = await context.supabase.from("assessments").select("*").eq("id", id).maybeSingle();
    if (error) return assessmentRpcError(error);
    if (!data) return errorResponse("Assessment not found", 404);
    const scoped = assessmentAccess(context, data.org_id);
    if (scoped) return scoped;
    const [orgResult, tasksResult] = await Promise.all([
      context.supabase.from("organisations").select("id, name, status").eq("id", data.org_id).eq("status", "active").maybeSingle(),
      context.supabase.from("tasks").select("id, title, priority, status, assessment_reference, assessment_gap_state").eq("assessment_id", id).order("created_at"),
    ]);
    if (orgResult.error || tasksResult.error) return errorResponse("Unable to load assessment details", 503);
    if (!orgResult.data) return errorResponse("An active organisation is required", 403);
    return successResponse({ ...assessmentPayload(data as Assessment), organisation: orgResult.data, editable: context.profile!.role !== "auditor", tasks: tasksResult.data ?? [] });
  } catch { return errorResponse("Unable to load the assessment. Please try again.", 503); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return errorResponse("Invalid assessment", 422);
    const context = await getAuthContext();
    const denied = assessmentAccess(context, undefined, true);
    if (denied) return denied;
    const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), answers: z.unknown(), cursor: z.string().min(1).max(80), status: z.enum(["draft", "paused", "reviewed"]) }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Invalid assessment update", 422);
    const { data, error } = await context.supabase.from("assessments").select("*").eq("id", id).maybeSingle();
    if (error) return assessmentRpcError(error);
    if (!data) return errorResponse("Assessment not found", 404);
    const scoped = assessmentAccess(context, data.org_id, true);
    if (scoped) return scoped;
    if (data.revision !== parsed.data.expectedRevision) return assessmentRpcError({ code: "40001" });
    const catalogue = catalogueSchema.parse(data.catalogue);
    let answers;
    try { answers = validateAnswers(catalogue, parsed.data.answers); }
    catch { return errorResponse("Check the answer types, options and note lengths", 422); }
    if (!catalogue.questions.some(question => question.reference === parsed.data.cursor)) return errorResponse("Choose a valid question", 422);
    if (parsed.data.status === "reviewed" && summarise(catalogue, answers).unanswered) return errorResponse("Answer every applicable question before reviewing the results", 422);
    const { data: saved, error: saveError } = await context.supabase.rpc("save_assessment", {
      p_id: id, p_expected_revision: parsed.data.expectedRevision, p_answers: answers, p_cursor: parsed.data.cursor, p_status: parsed.data.status,
    });
    if (saveError) return assessmentRpcError(saveError);
    return successResponse(assessmentPayload(saved as Assessment));
  } catch { return errorResponse("Your changes have not been confirmed as saved. Please retry.", 503); }
}
