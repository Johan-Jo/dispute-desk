/**
 * JSX type declarations for Shopify App Bridge web components.
 * These are rendered server-side so App Bridge finds them in the DOM on init.
 */
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { children?: React.ReactNode };
      "s-link": React.DetailedHTMLProps<
        React.AnchorHTMLAttributes<HTMLElement>,
        HTMLElement
      > & { children?: React.ReactNode };
      "s-page": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { heading?: string; children?: React.ReactNode };
      "s-icon": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        type?: string;
        tone?:
          | "info"
          | "success"
          | "warning"
          | "critical"
          | "auto"
          | "neutral"
          | "caution";
        color?: "base" | "subdued";
        size?: "small" | "base";
      };
    }
  }
}
