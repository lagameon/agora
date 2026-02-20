const BACKOFF_MS = [500, 1000, 2000, 4000];

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = BACKOFF_MS[attempt] ?? 4000;
        const isRateLimit =
          err instanceof Error &&
          ('status' in err && (err as { status: number }).status === 429);
        if (isRateLimit) {
          console.error(`[retry] Rate limited, waiting ${delay}ms...`);
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
