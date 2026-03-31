"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.refresh();
      router.push("/admin");
    } else {
      setError("Invalid credentials");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-[#0B1220] mb-1">DisputeDesk Admin</h1>
        <p className="text-sm text-[#667085] mb-6">Internal operator panel</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin secret"
            className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
            autoFocus
          />
          {error && <p className="text-sm text-[#EF4444] mb-3">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 bg-[#0B1220] text-white text-sm font-medium rounded-lg hover:bg-[#1E293B] disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
