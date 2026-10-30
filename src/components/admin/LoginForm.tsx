"use client";

import { useState } from "react";
import { api } from "../shared/api";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    const r = await api("/api/admin/login", { method: "POST", body: { username: form.get("username"), password: form.get("password") } });
    setBusy(false);
    if (r.ok) window.location.assign("/admin");
    else setError(r.error.message);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-bold">Username</span>
        <input name="username" required autoComplete="username" className="mt-1 w-full rounded border border-line bg-card px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm font-bold">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded border border-line bg-card px-3 py-2" />
      </label>
      <button type="submit" disabled={busy} className="w-full rounded bg-mustard px-4 py-2.5 font-bold hover:bg-mustard-deep disabled:opacity-60">Sign in</button>
      {error && <p role="alert" className="text-sm text-ketchup">{error}</p>}
    </form>
  );
}
