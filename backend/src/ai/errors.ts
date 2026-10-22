/** Thrown when an AI service is unreachable or answers with an error. */
export class AiUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message);
  }
}

/** HTTP statuses worth one more try: rate limited (429) or a provider hiccup (502/503). */
export const isRetryableStatus = (status: number) => [429, 502, 503].includes(status);
