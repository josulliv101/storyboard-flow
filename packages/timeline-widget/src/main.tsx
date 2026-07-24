import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";

// Entry point only. The view lives in `app/App.tsx`, and everything below it is
// split so the presentational parts stay renderable without an MCP host
// attached — which is the only way to iterate on them in Storybook.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
