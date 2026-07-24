import type { ToolDef, ToolResult } from "./types";

// The ONE place the experimental WebMCP browser API is touched, so its churn
// can't leak into the tool logic. WebMCP ships no TypeScript types yet, so we
// declare the minimal surface we call: `navigator.modelContext.registerTool`
// with an AbortSignal to unregister. See docs/webmcp-agent-tools.md.

type WebMcpToolRegistration = Readonly<{
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: ToolDef["annotations"];
  execute: (args: unknown) => Promise<ToolResult> | ToolResult;
}>;

type ModelContext = Readonly<{
  registerTool: (tool: WebMcpToolRegistration, options?: { signal?: AbortSignal }) => void;
}>;

declare global {
  interface Navigator {
    readonly modelContext?: ModelContext;
  }
}

/**
 * Register every tool with the page's WebMCP provider, tying their lifetime to
 * one AbortController. Returns an unregister function (abort). A no-op when the
 * browser has no `navigator.modelContext` (flag off / unsupported), so callers
 * can register unconditionally.
 */
export function registerWebMcpTools(tools: readonly ToolDef[]): () => void {
  const modelContext =
    typeof navigator !== "undefined" ? navigator.modelContext : undefined;
  if (!modelContext?.registerTool) return () => {};

  const controller = new AbortController();
  for (const tool of tools) {
    modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute: (args) => tool.execute(args),
      },
      { signal: controller.signal },
    );
  }
  return () => controller.abort();
}
