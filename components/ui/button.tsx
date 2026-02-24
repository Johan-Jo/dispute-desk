import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[#1D4ED8] text-white hover:bg-[#1E40AF] focus:ring-[#1D4ED8]",
        secondary:
          "bg-[#F1F5F9] text-[#0B1220] border border-[#E5E7EB] hover:bg-[#E5E7EB]",
        ghost:
          "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0B1220]",
        danger:
          "bg-[#EF4444] text-white hover:bg-[#DC2626] focus:ring-[#EF4444]",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4",
        lg: "h-12 px-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
