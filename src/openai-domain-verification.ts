export const OPENAI_APPS_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

export function openAiAppsChallengeResponseForPath(pathname: string, token?: string): Response | null {
  if (pathname !== OPENAI_APPS_CHALLENGE_PATH || !token) {
    return null;
  }

  return new Response(token, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
