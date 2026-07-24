import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

// A render error inside a sandboxed iframe is invisible: React unmounts the
// tree and the host shows an empty frame with no console the user can reach.
// Catching it means a bad clip payload degrades to a readable message instead
// of a blank widget.

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Goes to the iframe's console, which host devtools can still surface.
    console.error("Timeline view crashed:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="notice notice--error" role="alert">
        <p className="notice__title">The timeline view hit an error.</p>
        <p className="notice__detail">{error.message}</p>
        <button type="button" className="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
