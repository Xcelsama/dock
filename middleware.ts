"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function GateForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        const next = searchParams.get("next") || "/";
        router.replace(next);
        router.refresh();
      } else {
        setError(data.error || "Wrong password");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xs space-y-4 rounded-xl border border-white/10 bg-white/5 p-6"
    >
      <h1 className="text-center text-lg font-medium text-white">Dock is locked</h1>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-white/30"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full rounded-lg bg-white py-2 font-medium text-black disabled:opacity-50"
      >
        {loading ? "Checking..." : "Unlock"}
      </button>
    </form>
  );
}

export default function GatePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#101314] px-4">
      <Suspense fallback={null}>
        <GateForm />
      </Suspense>
    </main>
  );
}
