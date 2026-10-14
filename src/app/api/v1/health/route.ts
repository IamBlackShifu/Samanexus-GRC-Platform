import { successResponse } from "@/lib/api";

export async function GET() {
  return successResponse({
    service: "samanexus-api",
    status: "ok",
    environment: process.env.NODE_ENV,
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  });
}