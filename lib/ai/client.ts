const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// claude-haiku-4-5-20251001 is a cheaper, faster alternative if you'd
// rather not use Sonnet for these — override via AI_MODEL in .env.local.
const DEFAULT_MODEL = "claude-sonnet-5";

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable AI explanations. " +
        "Get a key at https://console.anthropic.com — this is a separate key from anything " +
        "else in this project."
    );
    this.name = "AiNotConfiguredError";
  }
}

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Calls the Claude API with a system prompt and user prompt, returning
 * the plain-text response. Server-only — never call this from a client
 * component; the API key must never reach the browser.
 */
export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();

  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((block: { type: string }) => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude API response contained no text content.");
  }
  return textBlock.text as string;
}
