import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorHandlerProps {
  children: ReactNode;
  onRetry?: () => void;
}

interface ErrorHandlerState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorHandler extends Component<ErrorHandlerProps, ErrorHandlerState> {
  constructor(props: ErrorHandlerProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorHandlerState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });
    
    // Log error for debugging (in production, send to error tracking service)
    console.error("Draftwise error:", error);
    if (errorInfo.componentStack) {
      console.debug("Component stack:", errorInfo.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-secondary p-4">
          <div className="max-w-md w-full bg-card border rounded-lg p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
              <span className="text-2xl" aria-hidden="true">⚠️</span>
            </div>
            
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            
            <p className="text-muted-foreground text-sm">
              We encountered an error while loading this feature. This shouldn't happen, but sometimes things break.
            </p>
            
            {this.state.error && (
              <details className="text-left text-xs bg-secondary p-3 rounded overflow-auto max-h-32">
                <summary className="cursor-pointer font-medium mb-2">Error Details</summary>
                <code className="break-all">{this.state.error.message}</code>
                {this.state.errorInfo && (
                  <>
                    <pre className="mt-2 text-xs opacity-75">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </>
                )}
              </details>
            )}
            
            <div className="flex gap-3 justify-center mt-4">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 border rounded-lg hover:bg-secondary transition-colors"
              >
                Reload Page
              </button>
            </div>
            
            <div className="text-xs text-muted-foreground pt-4 border-t">
              Your work is safe - Draftwise stores everything locally in your browser.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Wrapper hook for easier usage
export function useErrorHandler() {
  const handleError = (error: Error) => {
    console.error("Caught error:", error);
  };
  
  return { handleError };
}
