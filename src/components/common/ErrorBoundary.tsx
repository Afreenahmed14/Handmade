import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { failed: boolean }

/**
 * Top-level safety net: if rendering throws anywhere below, show a recoverable page instead of a blank screen.
 * It sits outside the router and providers, so it uses plain links and styles only.
 * (Errors in event handlers and async code are not caught by React error boundaries; those are handled where they occur.)
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled rendering error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="container-x py-32 text-center">
        <h1 className="text-5xl text-walnut">Something went wrong</h1>
        <p className="mx-auto mt-4 max-w-md text-espresso/80">An unexpected problem stopped this page from loading. Your cart and wishlist are saved on this device. Please reload, or go back to the home page.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">Reload page</button>
          <a href="/" className="btn-outline">Back to home</a>
        </div>
      </main>
    );
  }
}
