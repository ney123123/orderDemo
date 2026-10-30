import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { ADMIN_COOKIE } from "@/lib/auth/session";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kitchen sign in", robots: { index: false } };

export default async function LoginPage() {
  const c = container();
  if (c.auth.verify((await cookies()).get(ADMIN_COOKIE)?.value)) redirect("/admin");
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="font-display text-3xl font-extrabold">Kitchen sign in</h1>
      <p className="mt-1 mb-6 text-ink-soft">For restaurant staff only.</p>
      {c.auth.configured ? (
        <LoginForm />
      ) : (
        <p role="alert" className="rounded border border-ketchup/40 bg-ketchup/5 p-3 text-sm">
          Admin login is off: {c.config.adminProblem} Fix it in <code>.env.local</code>, then restart <code>npm run dev</code>.
        </p>
      )}
    </main>
  );
}
