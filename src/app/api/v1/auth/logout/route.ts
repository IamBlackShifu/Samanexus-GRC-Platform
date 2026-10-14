import { errorResponse, successResponse } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) return errorResponse(error.message, 500);
    return successResponse({ signedOut: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to sign out", 503);
  }
}