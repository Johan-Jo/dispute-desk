"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { TextField, type TextFieldProps } from "./text-field";

export interface PasswordFieldProps extends Omit<TextFieldProps, "type"> {
  showStrength?: boolean;
}

function calculateStrength(pass: string) {
  if (!pass) return { strength: 0, label: "" };
  let s = 0;
  if (pass.length >= 8) s++;
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) s++;
  if (/\d/.test(pass)) s++;
  if (/[^a-zA-Z0-9]/.test(pass)) s++;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  return { strength: s, label: labels[s] };
}

const BAR_COLORS = [
  "",
  "bg-[#EF4444]",
  "bg-[#F59E0B]",
  "bg-[#2DD4BF]",
  "bg-[#10B981]",
];

export function PasswordField({ showStrength, ...props }: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const strength = showStrength ? calculateStrength(password) : null;

  return (
    <div>
      <div className="relative">
        <TextField
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            props.onChange?.(e);
          }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-[50%] -translate-y-[50%] text-[#667085] hover:text-[#0B1220] transition-colors"
        >
          {showPassword ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>
      </div>

      {showStrength && password && strength && (
        <div className="mt-2">
          <div className="flex gap-1 mb-1">
            {[1, 2, 3, 4].map((level) => (
              <div
                key={level}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  level <= strength.strength
                    ? BAR_COLORS[strength.strength]
                    : "bg-[#E5E7EB]"
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-[#667085]">{strength.label} password</p>
        </div>
      )}
    </div>
  );
}
