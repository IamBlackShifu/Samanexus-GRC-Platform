import { getAuthContext } from "@/lib/auth";
import { errorResponse, successResponse } from "@/lib/api";
import { assessmentAccess, assessmentRpcError } from "@/lib/assessment/server";
import { catalogueSchema } from "@/lib/assessment/model";
export async function GET() {
  try {
    const context = await getAuthContext();
    const denied = assessmentAccess(context);
    if (denied) return denied;
    const { data, error } = await context.supabase.from("assessment_catalogues").select("version, catalogue, published_at").order("published_at", { ascending: false }).order("version").limit(50);
    if (error) return assessmentRpcError(error);
    return successResponse((data ?? []).map(row => {
      const catalogue = catalogueSchema.parse(row.catalogue);
      return { version: row.version, label: catalogue.label, schemeVersion: catalogue.schemeVersion, questionCount: catalogue.questions.length, publishedAt: row.published_at };
    }));
  } catch { return errorResponse("Question sets are unavailable. Check the assessment migration and retry.", 503); }
}
