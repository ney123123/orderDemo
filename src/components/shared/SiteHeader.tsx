import Link from "next/link";

export function SiteHeader({ name, status }: { name: string; status: string }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-4">
        <Link href="/" className="font-display text-2xl font-extrabold tracking-tight">
          {name}
        </Link>
        <nav className="flex items-baseline gap-5 text-[15px]">
          <span className="text-ink-soft">{status}</span>
          <Link href="/menu" className="font-bold underline decoration-mustard decoration-2 underline-offset-4 hover:decoration-mustard-deep">
            Menu
          </Link>
        </nav>
      </div>
    </header>
  );
}
