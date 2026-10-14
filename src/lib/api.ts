export type ApiMeta = Record<string, unknown>;

export function successResponse<T>(data: T, meta: ApiMeta = {}, status = 200) {
  return Response.json({ success: true, data, error: null, meta }, { status });
}

export function errorResponse(message: string, status = 400, details?: unknown) {
  return Response.json(
    { success: false, data: null, error: { message, details: details ?? null }, meta: {} },
    { status },
  );
}

export function pageParams(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "25") || 25));
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
}