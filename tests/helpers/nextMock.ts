/**
 * Helpers for creating mock Next.js request/response objects
 * compatible with App Router Route Handlers.
 */

export function createMockRequest(
  options: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
    formData?: FormData;
  } = {}
): Request & { headers: Headers; formData: () => Promise<FormData> } {
  const {
    method = "GET",
    url = "http://localhost:3000/api/test",
    headers = {},
    body,
    formData,
  } = options;

  const h = new Headers(headers);

  const req = {
    method,
    url,
    headers: h,
    json: async () => body,
    formData: async () => formData ?? new FormData(),
    text: async () => JSON.stringify(body),
  } as unknown as Request & { headers: Headers; formData: () => Promise<FormData> };

  return req;
}

export async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  return JSON.parse(text);
}
