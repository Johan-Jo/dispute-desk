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
    }
  }
}
