export interface OAuthButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  provider: "shopify";
}

export function OAuthButton({
  children,
  ...props
}: OAuthButtonProps) {
  return (
    <button
      className="w-full h-11 px-4 flex items-center justify-center gap-3 bg-[#5E8E3E] hover:bg-[#4D7332] text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#5E8E3E] focus:ring-offset-2"
      {...props}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M16.372 5.132l-.737-.065s-.586-.058-.777-.252c-.191-.194-.58-.775-.58-.775s-.205-.201-.43-.147l-.978.311-.001-.008c-.195-.57-.537-1.096-1.035-1.096h-.069c-.194-.25-.424-.373-.623-.373-.02 0-.04.002-.06.005C10.89 1.55 9.968.75 8.706.75c-2.008 0-2.976 2.51-3.279 3.777-.857.265-1.457.451-1.529.475-.45.14-.465.154-.523.568-.044.315-1.202 9.268-1.202 9.268l9.755 1.69 4.445-1.097S16.597 5.187 16.372 5.132zM12.52 3.38l-.808.25c-.001-.542-.068-1.302-.327-1.944.706.102 1.04 1.263 1.135 1.693zm-1.695-.423c.24.62.294 1.428.294 1.938v.046l-1.695.525c.331-1.258.936-1.87 1.401-2.509zm-.543-1.186c.09 0 .178.043.266.13-.645.816-1.39 2-1.684 3.856l-1.313.407c.411-1.584 1.568-4.393 2.73-4.393z"
          fill="#fff"
        />
      </svg>
      {children || "Continue with Shopify"}
    </button>
  );
}
