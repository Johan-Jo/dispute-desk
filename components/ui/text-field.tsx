import { cn } from "./utils";

export interface TextFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export function TextField({
  label,
  error,
  helperText,
  className = "",
  ...props
}: TextFieldProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-[#0B1220] mb-2">
          {label}
        </label>
      )}
      <input
        className={cn(
          "w-full h-10 px-3 border rounded-lg text-sm transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-offset-0",
          "disabled:bg-[#F7F8FA] disabled:text-[#667085] disabled:cursor-not-allowed",
          error
            ? "border-[#EF4444] focus:ring-[#EF4444] focus:border-[#EF4444]"
            : "border-[#E5E7EB] focus:border-[#4F46E5] focus:ring-[#4F46E5]",
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-[#EF4444] mt-1">{error}</p>}
      {helperText && !error && (
        <p className="text-sm text-[#667085] mt-1">{helperText}</p>
      )}
    </div>
  );
}
