export interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-lg p-8">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-[#0B1220] mb-2">{title}</h2>
          {subtitle && (
            <p className="text-sm text-[#667085]">{subtitle}</p>
          )}
        </div>
        <div className="space-y-4">{children}</div>
      </div>
      {footer && (
        <div className="mt-4 text-center text-sm text-[#667085]">{footer}</div>
      )}
    </div>
  );
}
