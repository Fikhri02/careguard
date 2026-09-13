import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";

export const dynamic = "force-dynamic";

// CopilotKit's v1 runtime: deprecated since 1.68.2 but still shipped in 1.71, and the quickest path on event day.
type Handler = (request: Request) => Response | Promise<Response>;
let handler: Handler | null = null;

function getHandler(): Handler {
  // Created on first request, not at import, so builds without an OpenAI key still succeed.
  if (!handler) {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime: new CopilotRuntime(),
      serviceAdapter: new OpenAIAdapter({ model: process.env.COPILOT_MODEL ?? process.env.MODEL ?? "gpt-4o-mini" }),
      endpoint: "/api/copilotkit",
    });
    handler = handleRequest;
  }
  return handler;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: { code: "copilot_unavailable", message: "Set OPENAI_API_KEY in the repo-root .env, then restart the dashboard." } },
      { status: 503 },
    );
  }
  return getHandler()(request);
}
