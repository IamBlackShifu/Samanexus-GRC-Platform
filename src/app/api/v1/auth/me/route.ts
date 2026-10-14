import { errorResponse, successResponse } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";

export async function GET() {
  try {
    const { user, profile } = await getAuthContext();
    if (!user || !profile) return errorResponse("Authentication required", 401);
    return successResponse({
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role: profile.role,
      organisationId: profile.org_id,
      status: profile.status,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to load session", 503);
  }
}