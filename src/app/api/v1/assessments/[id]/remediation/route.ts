import { z } from "zod";
import { getAuthContext } from "@/lib/auth";
import { errorResponse, successResponse } from "@/lib/api";
import { assessmentAccess, assessmentRpcError } from "@/lib/assessment/server";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return errorResponse("Invalid assessment", 422);
    const context = await getAuthContext();
    const denied = assessmentAccess(context, undefined, true);
    if (denied) return denied;
    const parsed = z.object({ expectedRevision: z.number().int().nonnegative() }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Reload the assessment before generating tasks", 422);
    // The database verifies tenant access, saved results and revision under a row lock.
    const { data, error } = await context.supabase.rpc("generate_assessment_remediation", { p_id: id, p_expected_revision: parsed.data.expectedRevision });
    if (error) return assessmentRpcError(error);
    return successResponse(data);
  } catch { return errorResponse("Remediation tasks could not be confirmed. Retry safely.", 503); }
}
