import type { Menu, SizedItem } from "./schema";

// Fictional seed menu (§3). Editable later through the admin API.
const SEED_TIME = "2026-10-29T00:00:00.000Z";
const stamps = { createdAt: SEED_TIME, updatedAt: SEED_TIME };

const sized = (
  id: string,
  name: string,
  category: "SIDE" | "DRINK",
  description: string,
  extra: Partial<SizedItem> = {},
): SizedItem => ({
  id,
  name,
  category,
  description,
  availability: "AVAILABLE",
  sizes: {
    REGULAR: { priceCents: 150, availability: "AVAILABLE" },
    LARGE: { priceCents: 250, availability: "AVAILABLE" },
  },
  ingredients: [],
  allergens: [],
  dietary: [],
  ...stamps,
  ...extra,
});

export function seedMenu(): Menu {
  return {
    updatedAt: SEED_TIME,
    combo: { baseFeeCents: 200, largeUpgradeCents: 50 },
    items: [
      {
        id: "beef",
        name: "Beef Burger",
        category: "BURGER",
        description: "Grilled beef patty, lettuce, tomato, house sauce.",
        basePriceCents: 700,
        availability: "AVAILABLE",
        ingredients: ["beef patty", "bun", "lettuce", "tomato", "house sauce"],
        allergens: ["gluten", "egg"],
        dietary: [],
        ...stamps,
      },
      {
        id: "chicken",
        name: "Chicken Burger",
        category: "BURGER",
        description: "Crispy chicken fillet, slaw, mayo.",
        basePriceCents: 500,
        availability: "AVAILABLE",
        ingredients: ["chicken fillet", "bun", "slaw", "mayo"],
        allergens: ["gluten", "egg"],
        dietary: [],
        ...stamps,
      },
      {
        id: "sausage",
        name: "Sausage Burger",
        category: "BURGER",
        description: "Pork sausage patty, onions, mustard.",
        basePriceCents: 600,
        availability: "AVAILABLE",
        ingredients: ["pork sausage patty", "bun", "onions", "mustard"],
        allergens: ["gluten", "mustard"],
        dietary: [],
        ...stamps,
      },
      sized("fries", "Fries", "SIDE", "Skin-on fries.", { dietary: ["vegan"] }),
      sized("salad", "Salad", "SIDE", "Mixed greens with vinaigrette.", { dietary: ["vegan"] }),
      sized("coke", "Coke", "DRINK", "Coca-Cola."),
      sized("coke_zero", "Coke Zero", "DRINK", "Coca-Cola Zero Sugar."),
    ],
  };
}
