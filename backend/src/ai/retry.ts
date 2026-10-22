/**
 * A single model/OCR call, retried like the former n8n nodes were (retryOnFail:
 * maxTries 3, waitBetweenTries 3000): any error, up to 3 tries, 3 s apart.
 */
export const STEP_RETRY = { maxTries: 3, waitMs: 3000 } as const;

export async function retryStep<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= STEP_RETRY.maxTries) throw err;
      await new Promise((r) => setTimeout(r, STEP_RETRY.waitMs));
    }
  }
}
