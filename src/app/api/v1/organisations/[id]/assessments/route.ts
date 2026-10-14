import { z } from "zod";
import { getAuthContext } from "@/lib/auth";
import { errorResponse, successResponse } from "@/lib/api";
import { assessmentAccess, assessmentPayload, assessmentRpcError } from "@/lib/assessment/server";
import type { Assessment } from "@/lib/assessment/model";
import defaultCatalogue from "@/lib/assessment/catalogue.json";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return errorResponse("Invalid organisation", 422);
    const context = await getAuthContext();
    const denied = assessmentAccess(context, id);
    if (denied) return denied;
    const { data, error } = await context.supabase.from("assessments").select("*").eq("org_id", id).order("updated_at", { ascending: false }).limit(20);
    if (error) return assessmentRpcError(error);
    return successResponse((data ?? []).map(record => assessmentPayload(record as Assessment)));
  } catch { return errorResponse("Unable to load assessments. Check the assessment migration and try again.", 503); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return errorResponse("Invalid organisation", 422);
    const context = await getAuthContext();
    const denied = assessmentAccess(context, id, true);
    if (denied) return denied;
    const parsed = z.object({ catalogueVersion: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,100}$/).default(defaultCatalogue.version) }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Choose a valid assessment question set", 422);
    const { data, error } = await context.supabase.rpc("start_assessment", { p_org_id: id, p_catalogue_version: parsed.data.catalogueVersion });
    if (error) return assessmentRpcError(error);
    return successResponse(assessmentPayload(data as Assessment), {}, 201);
  } catch { return errorResponse("Unable to start the assessment. Retry without creating another copy.", 503); }
}
