import { getAuthContext } from "@/lib/auth";
import { errorResponse, pageParams, successResponse } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthContext();
    if (!user) return errorResponse("Authentication required", 401);

    const { page, limit, from, to } = pageParams(request);
    const { data, error, count } = await supabase
      .from("frameworks")
      .select("id, code, name, version, description", { count: "exact" })
      .order("name")
      .range(from, to);

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, { page, limit, total: count ?? 0 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to load frameworks", 503);
  }
}