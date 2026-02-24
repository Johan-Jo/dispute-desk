import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-[#F1F5F9] text-[#64748B] border border-[#E5E7EB]",
        success: "bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]",
        warning: "bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]",
        danger: "bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA]",
        info: "bg-[#E0F2FE] text-[#075985] border border-[#BAE6FD]",
        primary: "bg-[#DBEAFE] text-[#1E3A8A] border border-[#BFDBFE]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
