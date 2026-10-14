import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse("Email and password are required", 422);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) return errorResponse("Invalid email or password", 401);

    return successResponse({ userId: data.user.id, email: data.user.email }, {}, 200);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to sign in", 503);
  }
}