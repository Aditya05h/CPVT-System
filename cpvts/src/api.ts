import type { Envelope } from "./types";
export async function api<T>(
  path: string,
  body?: unknown,
  method?: "GET" | "POST" | "DELETE",
): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "Connection interrupted. Refresh to check the result before retrying a change.",
    );
  }
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error?.message ?? "Something went wrong. Please try again.",
    );
  return payload;
}
