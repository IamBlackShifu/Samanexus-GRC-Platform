import { getAuthContext, hasSatisfiedMfa } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { catalogueSchema, summarise, type Assessment } from "@/lib/assessment/model";

export type AssessmentContext = Awaited<ReturnType<typeof getAuthContext>>;
export function assessmentAccess(context: AssessmentContext, orgId?: string, write = false) {
  const { profile, assurance } = context;
  if (!profile || profile.status !== "active") return errorResponse("Sign in with an active account to access assessments", 401);
  if (!hasSatisfiedMfa(profile.role, assurance?.currentLevel)) return errorResponse("Complete MFA to access assessments", 403);
  if (!["super_admin", "org_admin", "org_member", "auditor"].includes(profile.role)) return errorResponse("Assessment access required", 403);
  if (orgId && profile.role !== "super_admin" && profile.org_id !== orgId) return errorResponse("You cannot access another organisation’s assessment", 403);
  if (write && profile.role === "auditor") return errorResponse("Auditors can view assessments but cannot change answers", 403);
  return null;
}
export function assessmentRpcError(error: { code?: string; message?: string }) {
  const messages: Record<string, [string, number]> = {
    "40001": ["Someone else updated this assessment. Reload the latest answers before continuing.", 409],
    "42501": ["Active organisation access and the appropriate role are required", 403],
    "P0002": ["Assessment not found", 404],
    "22023": [error.message ?? "Check the assessment details", 422],
  };
  const [message, status] = messages[error.code ?? ""] ?? ["Assessment service unavailable. Check the database migration and retry.", 503];
  return errorResponse(message, status);
}
export function assessmentPayload(record: Assessment) {
  const catalogue = catalogueSchema.parse(record.catalogue);
  return { assessment: { ...record, catalogue }, summary: summarise(catalogue, record.answers) };
}
