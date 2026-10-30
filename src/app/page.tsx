import Link from "next/link";
import { CallTranscript } from "@/components/customer/CallTranscript";
import { CartPanel } from "@/components/customer/CartPanel";
import { ChatWidget } from "@/components/customer/ChatWidget";
import { MockConsole } from "@/components/customer/MockConsole";
import { SiteHeader } from "@/components/shared/SiteHeader";
import { openStatusText } from "@/lib/domain/settings/hours";
import { WEEKDAYS } from "@/lib/domain/settings/schema";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";

const DAY_NAMES = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" } as const;

export default async function Home() {
  const c = container();
  const settings = await c.repo.getSettings();
  const status = openStatusText(settings, new Date());
  // The Connect widget opens over the bottom-right corner. When it is on, the order panel moves to the
  // left on wide screens, and the content keeps clear of the chat window on extra-wide ones.
  const widgetOn = !c.config.mockConsole && Boolean(c.config.widget);

  return (
    <>
      <SiteHeader name={settings.name} status={status} />
      <main className={`mx-auto grid gap-8 px-4 py-8 ${widgetOn ? "max-w-7xl lg:grid-cols-[22rem_1fr] xl:pr-[25rem]" : "max-w-6xl lg:grid-cols-[1fr_22rem]"}`}>
        <div className="min-w-0 space-y-10">
          <section>
            <h1 className="font-display text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-7xl">
              Burgers for pickup, ordered by chat.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-ink-soft">
              Tell our assistant what you’d like, or pick from the <Link href="/menu" className="font-bold text-ink underline decoration-mustard decoration-2 underline-offset-4">menu</Link>. Your order shows up {widgetOn ? "on the left" : "on the right"} as you go. Pay at the counter when you pick it up.
            </p>
          </section>

          {c.config.mockConsole ? (
            <MockConsole />
          ) : c.config.widget ? (
            <section aria-labelledby="chat-heading" className="rounded-lg border border-line bg-card p-5">
              <h2 id="chat-heading" className="font-display text-xl font-bold">Chat with us</h2>
              <p className="mt-1 text-ink-soft">Open the chat button in the corner, then type or press Start a Call, and tell us what you’d like. Your order appears on the left as you go.</p>
              <ChatWidget scriptUrl={c.config.widget.scriptUrl} widgetId={c.config.widget.widgetId} snippetId={c.config.widget.snippetId} />
            </section>
          ) : (
            <section aria-labelledby="chat-heading" className="rounded-lg border border-line bg-card p-5">
              <h2 id="chat-heading" className="font-display text-xl font-bold">Chat with us</h2>
              <p className="mt-1 text-ink-soft">The chat assistant isn’t switched on yet. You can still order from the menu.</p>
            </section>
          )}

          <section aria-labelledby="hours-heading" className="grid gap-6 sm:grid-cols-2">
            <div>
              <h2 id="hours-heading" className="font-display text-xl font-bold">Hours</h2>
              <table className="tabular mt-2 w-full text-[15px]">
                <tbody>
                  {WEEKDAYS.map((d) => (
                    <tr key={d} className="border-b border-line last:border-b-0">
                      <th scope="row" className="py-1 pr-4 text-left font-normal">{DAY_NAMES[d]}</th>
                      <td className="py-1 text-right">{(settings.hours[d] ?? []).map((w) => `${w.open}–${w.close}`).join(", ") || "Closed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">Pickup</h2>
              <p className="mt-2">{settings.pickupInfo}</p>
              <p className="mt-3 text-[15px] text-ink-soft">
                {settings.contact.address}
                <br />
                {settings.contact.phone}
              </p>
            </div>
          </section>
        </div>
        <div className={`lg:sticky lg:top-6 lg:self-start ${widgetOn ? "lg:order-first" : ""}`}>
          <CartPanel />
          {c.config.transcriptAssistantId && <CallTranscript />}
        </div>
      </main>
    </>
  );
}
