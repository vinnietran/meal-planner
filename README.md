# meal-planner

## Giant Eagle cart helper

This repo now includes a local Playwright runner that reads the next-week meal plan plus necessities marked for cart inclusion and tries to add those items to `gianteagle.com` in a real browser session.

## Structured meals

Meals are now expected to store structured `ingredientItems`, not just a flat array of ingredient names. Each ingredient row can carry:

- a human-friendly ingredient name
- recipe quantity and unit
- a Giant Eagle search query
- cart quantity
- preferred brand and size
- department, notes, and substitute preference

The planner still works with the legacy `ingredients` array because the backend derives it automatically, but new meal entries should be created through the rebuilt add-meal form so the cart automation has the metadata it needs.

## Necessities

Standalone necessities live in their own collection and use the same cart metadata shape as meal ingredients. Use them for items that should be included in grocery/cart runs when selected, such as milk, bananas, apples, eggs, bread, or pantry staples.

Necessities marked `includeInCart` are merged into the grocery list and the Giant Eagle Playwright runner automatically.

## Planning knowledge

The Knowledge page builds a durable family planning profile from three Firestore sources:

- `knowledge/household` stores explicit planning goals, favorites, dislikes, leftover preferences, and recurring routines.
- `mealEvents/{weekStart}_{dayIndex}_{slot}` stores one idempotent planned/cooked/skipped/replaced event per meal slot. Re-saving a week updates the same event instead of duplicating history.
- `meals` stores planning metadata such as aliases, effort, prep time, leftovers, freezer suitability, and who likes a meal.

Existing `mealHistory` records are read as deduplicated observations so older planning activity can contribute learned patterns. Weekly feedback updates a matched saved meal's `lastHad` value when it is marked cooked. The existing `weekStart` and current/next plan date model is unchanged.

The Knowledge review inbox ranks unmatched historical names by frequency. A reviewer can connect an alias to a saved meal, classify it as eating out or a recurring event, ignore it, or open the Add Meal form with the name prefilled. Leftover entries are derived from the original dinner and excluded from the knowledge catalog. Resolutions live in `knowledgeMealItems`, and connected aliases backfill matching `mealEvents` records.

The planner's Help Me Plan flow uses this resolved knowledge, explicit family preferences, recurring routines, busy days, eating-out days, and cooking-night limits to create a reviewable next-week draft. When it schedules leftovers, it repeats a dinner already planned earlier in the week (for example, `Spaghetti leftovers`) instead of looking for a generic leftovers meal. The draft remains local until the user applies it and saves the week.

Deploy the Functions project before expecting Knowledge data to sync across devices. Until those endpoints are deployed, the Knowledge page keeps profile and feedback edits in local browser storage as a preview fallback.

### Install

```bash
npm install
```

### Run against the next-week meal plan

```bash
npm run giant-eagle:cart
```

The script opens Giant Eagle, waits for you to log in and confirm your store, then searches and clicks add-to-cart buttons for each grocery item from the `next` weekly plan plus selected necessities.

### Useful flags

```bash
npm run giant-eagle:cart -- --dry-run
npm run giant-eagle:cart -- --limit 5
npm run giant-eagle:cart -- --list ./giant-eagle-groceries.json
```

Use `--dry-run` to print the grocery list without opening a browser. Use `--list` if you want to run from a saved JSON snapshot instead of the live planner data.

### Notes

- The Giant Eagle storefront can change, so this automation is best effort and may skip items.
- The Playwright browser profile is stored in `.playwright/giant-eagle` so your login can persist between runs.
- Review the cart before checkout.
