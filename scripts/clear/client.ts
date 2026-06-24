const CLEAR_GRAPHQL_URL = "https://api.clearinitiative.io/graphql";

export type ClearGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
};

export async function clearQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<ClearGraphQLResponse<T>> {
  const apiKey = process.env.CLEAR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CLEAR_API_KEY is missing. Add it to .env.local (see .env.example).",
    );
  }

  const response = await fetch(CLEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as ClearGraphQLResponse<T>;

  if (!response.ok) {
    const message =
      payload.errors?.map((e) => e.message).join("; ") ||
      `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  return payload;
}

export async function clearQueryData<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const payload = await clearQuery<T>(query, variables);
  if (!payload.data) {
    throw new Error("GraphQL response missing data");
  }
  return payload.data;
}
