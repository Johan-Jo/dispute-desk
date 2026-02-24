export interface DividerProps {
  label?: string;
}

export function Divider({ label }: DividerProps) {
  if (!label) {
    return <hr className="border-t border-[#E5E7EB]" />;
  }

  return (
    <div className="relative flex items-center py-2">
      <div className="flex-grow border-t border-[#E5E7EB]" />
      <span className="flex-shrink mx-4 text-sm text-[#667085]">{label}</span>
      <div className="flex-grow border-t border-[#E5E7EB]" />
    </div>
  );
}
