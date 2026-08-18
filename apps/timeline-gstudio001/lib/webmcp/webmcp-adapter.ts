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
  /**
   * RETURNS A PROMISE, which is the whole reason this file has a catch in it.
   *
   * It was declared `void` here, so the return was discarded — and Chrome
   * settles the registration asynchronously and REJECTS it with the signal's
   * reason if the signal aborts first. Measured in Chrome 151: six tools
   * registered and the controller aborted in the same tick produced six
   * unhandled rejections, one per tool. Aborting a turn of the event loop later
   * produced none.
   *
   * `void` is kept in the union because the shape is experimental and a build
   * that returns nothing must not become a TypeError here.
   */
  registerTool: (
    tool: WebMcpToolRegistration,
    options?: { signal?: AbortSignal },
  ) => Promise<void> | void;
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
    const registered = modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute: (args) => tool.execute(args),
      },
      { signal: controller.signal },
    );

    // AN ABORT IS THE ORDINARY ENDING, not a failure. A registration torn down
    // before it settles rejects with the signal's reason, and the reason is a
    // DOMException created by `controller.abort()` below — which is why the
    // report for this landed on the abort line rather than on anything to do
    // with tools. Unhandled, it reaches the dev overlay as
    // `AbortError: signal is aborted without reason`.
    //
    // ANYTHING ELSE IS REAL and says so. A registration can fail for reasons
    // worth knowing about — `Duplicate tool name` is one Chrome actually
    // returns — and the symptom otherwise is an agent tool that is silently
    // absent, which is the hardest kind of missing thing to notice.
    void Promise.resolve(registered).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn(`[webmcp] "${tool.name}" failed to register`, error);
    });
  }
  return () => controller.abort();
}
