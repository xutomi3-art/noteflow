"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">📒</div>
          <h1 className="text-[28px] font-semibold tracking-tight">Noteflow</h1>
          <p className="text-[15px] text-[var(--text-secondary)] mt-1">
            Sign in to your knowledge base
          </p>
        </div>

        <div className="bg-[var(--card-bg)] rounded-2xl p-6 shadow-[var(--shadow-md)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <p className="text-[13px] text-[var(--danger)] text-center">{error}</p>
            )}

            <Button type="submit" loading={loading} className="w-full mt-1" size="lg">
              Sign In
            </Button>
          </form>
        </div>

        <p className="text-center text-[14px] text-[var(--text-secondary)] mt-5">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-[var(--accent)] hover:underline font-medium">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
