// Transport-agnostic tool layer for the WebMCP agent tools. Nothing in this
// directory imports React or `navigator` except `webmcp-adapter.ts` — the
// handlers are pure functions over the live CollectionsStore so they unit-test
// without a browser, and a future server-MCP transport can wrap the same defs.
// See docs/webmcp-agent-tools.md.

/** MCP tool-result content block. Only text is used today. */
export type ToolContentBlock = Readonly<{ type: "text"; text: string }>;

/** MCP tool result. `structuredContent` is the machine-readable payload; the
 *  text block is the human/agent-readable summary. */
export type ToolResult = Readonly<{
  content: readonly ToolContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}>;

/** Optional hints the agent may use to reason about a tool (MCP annotations). */
export type ToolAnnotations = Readonly<{
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  destructiveHint?: boolean;
}>;

/**
 * One tool. `inputSchema` is an opaque JSON Schema object (validated by the
 * WebMCP layer / documented for the agent); `execute` receives the
 * agent-supplied args as `unknown` and MUST narrow them itself — never trust
 * the shape.
 */
export type ToolDef = Readonly<{
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: ToolAnnotations;
  execute: (args: unknown) => Promise<ToolResult> | ToolResult;
}>;
