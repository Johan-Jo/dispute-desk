import { AlertCircle } from "lucide-react";

export interface InlineErrorProps {
  title?: string;
  message: string;
}

export function InlineError({ title, message }: InlineErrorProps) {
  return (
    <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-4 flex gap-3">
      <AlertCircle className="w-5 h-5 text-[#EF4444] flex-shrink-0 mt-0.5" />
      <div>
        {title && (
          <h4 className="font-semibold text-[#991B1B] mb-1">{title}</h4>
        )}
        <p className="text-sm text-[#991B1B]">{message}</p>
      </div>
    </div>
  );
}
