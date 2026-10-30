import { formatCents } from "@/lib/domain/money";
import type { PublicMenu } from "@/lib/http/views";
import { AddItem } from "./AddItem";

type Item = PublicMenu["items"][number];

function prices(item: Item): string[] {
  if (item.category === "BURGER") return [formatCents(item.basePriceCents)];
  const sizes = (["REGULAR", "LARGE"] as const).filter((s) => item.sizes[s]);
  return sizes.map((s) => `${s === "LARGE" ? "L" : "R"} ${formatCents(item.sizes[s]!.priceCents)}`);
}

function Row({ item, menu, interactive }: { item: Item; menu: PublicMenu; interactive: boolean }) {
  const soldOut = item.availability === "SOLD_OUT";
  return (
    <li className="border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className={`font-display text-2xl font-bold tracking-tight sm:text-3xl ${soldOut ? "text-ink-soft line-through decoration-ketchup decoration-2" : ""}`}>{item.name}</h3>
        <span className="tabular flex gap-4 font-display text-2xl font-bold sm:text-3xl">
          {prices(item).map((p) => <span key={p} className="whitespace-nowrap">{p}</span>)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-ink-soft">
          {item.description}
          {item.allergens.length > 0 && <span className="block text-sm">Contains {item.allergens.join(", ")}.</span>}
          {item.dietary.length > 0 && <span className="block text-sm capitalize">{item.dietary.join(", ")}</span>}
        </p>
        {interactive && <AddItem item={item} menu={menu} />}
      </div>
    </li>
  );
}

export function MenuBoard({ menu, interactive = true }: { menu: PublicMenu; interactive?: boolean }) {
  const burgers = menu.items.filter((i) => i.category === "BURGER");
  const sides = menu.items.filter((i) => i.category === "SIDE");
  const drinks = menu.items.filter((i) => i.category === "DRINK");
  const { baseFeeCents: fee, largeUpgradeCents: up } = menu.combo;
  return (
    <div className="space-y-10">
      <section aria-labelledby="burgers">
        <h2 id="burgers" className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Burgers</h2>
        <p className="mt-1 text-ink-soft">Every burger comes spicy or not, your call.</p>
        <ul className="mt-2">{burgers.map((i) => <Row key={i.id} item={i} menu={menu} interactive={interactive} />)}</ul>
      </section>

      <section aria-labelledby="combos" className="rounded-lg bg-ink px-5 py-6 text-paper">
        <h2 id="combos" className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Combos</h2>
        <p className="mt-2 max-w-prose">Any burger with one side and one drink. Pick a burger above and choose “Combo”.</p>
        <dl className="tabular mt-4 grid max-w-md grid-cols-[1fr_auto] gap-y-1 text-lg">
          <dt>Both regular</dt><dd className="font-bold">+{formatCents(fee)}</dd>
          <dt>One large</dt><dd className="font-bold">+{formatCents(fee + up)}</dd>
          <dt>Both large</dt><dd className="font-bold">+{formatCents(fee + 2 * up)}</dd>
        </dl>
      </section>

      <section aria-labelledby="sides">
        <h2 id="sides" className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Sides</h2>
        <p className="mt-1 text-ink-soft">R regular, L large.</p>
        <ul className="mt-2">{sides.map((i) => <Row key={i.id} item={i} menu={menu} interactive={interactive} />)}</ul>
      </section>

      <section aria-labelledby="drinks">
        <h2 id="drinks" className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Drinks</h2>
        <ul className="mt-2">{drinks.map((i) => <Row key={i.id} item={i} menu={menu} interactive={interactive} />)}</ul>
      </section>
    </div>
  );
}
