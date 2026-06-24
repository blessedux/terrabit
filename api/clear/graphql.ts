/**
 * Vercel serverless proxy for CLEAR GraphQL.
 * Keeps CLEAR_API_KEY server-side (same role as Vite dev proxy).
 */
const CLEAR_GRAPHQL_URL = "https://api.clearinitiative.io/graphql";

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
  send: (body: string) => void;
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ errors: [{ message: "Method not allowed" }] });
    return;
  }

  const key = process.env.CLEAR_API_KEY?.trim();
  if (!key) {
    res.status(500).json({
      errors: [{ message: "CLEAR_API_KEY not configured on server" }],
    });
    return;
  }

  try {
    const upstream = await fetch(CLEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch {
    res.status(502).json({
      errors: [{ message: "CLEAR API upstream request failed" }],
    });
  }
}
