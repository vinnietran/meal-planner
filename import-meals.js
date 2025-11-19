/**
 * One-time importer for meals from the CSV data below.
 *
 * Usage:
 *   node import-meals.js --base https://us-central1-<project>.cloudfunctions.net
 *
 * Notes:
 * - Expects the functions `addMeal` endpoint at `${base}/addMeal`.
 * - Only tags “Lunch”, “Dinner”, or “Cenzo” are sent; others are ignored.
 * - Sides and ingredients are split on commas and trimmed; empty entries are dropped.
 */

const DATA = `
Meal Name\tTag\tSides\tIngredients
Turkey Wraps\tLunch\tAvocado, tomato, lettuce, swiss\tTurkey, Avocado, Wrap, Swiss Cheese
Taco Beef Bowl\tLunch\tLettuce, Cheese, Salsa\tBeef, Rice, Taco Seasoning
Balsamic Chicken\tDinner\tPotatoes, Broccoli\tChicken, Red Onion, Broccoli, Baby Potatoes, Carrots, Balsamic
Slow Cooker Lemon Chicken\tDinner\tPotatoes, Green Beans\tChicken Broth, Chicken Thighs, Lemon, Garlic, Thyme, Oregano, Parsley
Sweet and Sour Chicken\tDinner\tRice\tPeepers, Carrots, Pineapple Chunks, Soy Sauce, Brown Sugar
Meatball Soup\tDinner\tBread, Crackers\tFrozen Meatballs, Ditalini, Mixed Veggies, Italian Canned Tomatoes
Baked Ziti\tDinner\tCaesar Salad\tZiti, Sauce, Ricotta Cheese, Parsley, Egg, Oregano, Garlic Powder, Parmesan Cheese
Meatloaf\tDinner\tMashed Potatoes, Carrots\tGround Beef, Onion Mushroom Soup Mix, Bread Crumbs, Eggs, Ketchup
Stuffed Peppers\tDinner\t\tSpanish Rice Mix, Ground Beef, Celery, Onion, Egg, Green Peppers, Whole Peeled Tomatoes, Tomato Soup
Chicken Caesar Salad\tLunch\t\tCaesar Salad Mix, Chicken Breast
Shrimp Caesar Salad\tLunch\t\tCaesar Salad Mix, Shrimp
Steak Bowls\tLunch\tRice, Avocado, Edamame\tCilantro Lime Rice, Steak, Avocado, Edamame, Honey, Mayo
Shrimp Bowls\tLunch\tRice, Avocado, Edamame\tCilantro Lime Rice, Shrimp, Avocado, Edamame, Honey, Mayo
Salmon Bowls\tLunch\tRice, Avocado, Edamame\tCilantro Lime Rice, Salmon, Avocado, Edamame, Honey, Mayo
Chicken Teryaki Stir Fry\tLunch\tRice, Stir Fry Veggies\tRice, Chicken, Teryaki Sauce, Frozen Stir Fry Veggies
Tacos\tDinner\tApplesauce, Guac\tGround Beef, Taco Seasoing, Tomatoes, Mexican Shredded Cheese, Sour Cream, Shredded Lettuce, Applesauce, Avocado, Red Onion, Cilantro, Garlic, Hard Shell Tacos
Slow Cooker Chili\tDinner\tCrackers\tRed Onion, Ground Beef, Green Pepper, Garlic, Tomato Paste, Chopped Tomatoes, Black Beans, Kidney Beans, Chicken Broth, Chili Powder, Shredded Cheddar, Green Onion
Chicken Caprese\tDinner\t\tChicken Breast, Mozzarella, Tomatoes, Balsamic Glaze, Corn, Cherry Tomatoes, Vinegar, Balsamic
Pistachio Pork Chops\tDinner\tRoasted Potatoes, Broccoloi\tCenter Cut Pork Chops, Bread Crumbs, Eggs, Pistachio, Parsley, Lemon, Garlic
Weird Egg Breakfast / Vin Leftovers\tLunch\t\t
HH / LEFTOVERS FOR WOMAN\tDinner\t\t
Burger Bowl\tLunch\t\tGround Beef, Cherry Tomatoes, Roasted Potatoes, Lettuce, Chick Fil A Sauce, Shredded Cheese
Steak\tDinner\tBaked Potato, Broccoli\tNY Strip, Baker's Potatoes
Casa De Christel\t\t\t
Ebensburg\t\t\t
OUT\t\t\t
Potato Soup\tDinner\tCrackers\tPre Cooked Bacon, Butter, Yellow Onion, Garlic, Flour, Gold Potatoes, Chicken Broth, Milk, Heavy Cream, Sour Cream, Shredded Cheddar, Chives
Beef Stew\tDinner\t\tChuck Roast, Potatoes, Baby Carrots, Tomato Soup, Onion, Celery, Worchestershire Sauce, Beef Bouillon, Sugar, Cornstarch, Peas
FEND FOR YOURSELF OR PARISH\tLunch\t\t
White Chicken Chili\tDinner\tCornbread\t
Baked Spaghetti \tDinner\tCaesar Salad\t
Turkey\tDinner\tMashed Potatoes, Stuffing, Gravy, Cranberry Sauce, Green Beans\t
LEFTOVERS\t\t\t
Asian Chicken Salad\t\t\t
Greek Salad\t\t\t
Bulgogi\tDinner\tRice, Pepper \t
Apple Pork\tDinner\tMashed Potatoes, broccoli, cauliflower \t
Brunch\tLunch\tEggs, potatoes, ham, pancakes \t
Cajun Orzo with sausage \tDinner\t\t
Turkey Wrap\tLunch\t\t
Shrimp Pad Thai\tDinner\t\t
Pork Medallions \tDinner\t\t
Stuffed Zucchini \tDinner\t\t
Cobb Salad\tLunch\t\t
Sandwiches \t\t\t
Tortellini Soup\t\t\t
Shrimp scampi\t\t\t
Tiktok pasta\t\t\t
French Dip\tDinner\t\tMashed potatoes, corn
Enchiladas \t\t\t
Coconut Shrimp\tDinner\t\tRice, Veggie
Lenten Fish Fry\t\t\t
Mississippi Roast\t\t\t
Orange Chicken\t\t\t
Lettuce Wraps\t\t\t
`;

const allowedTags = new Set(["Lunch", "Dinner", "Cenzo"]);

function parseData(raw) {
  const lines = raw.trim().split(/\r?\n/);
  lines.shift(); // header
  const rows = [];
  for (const line of lines) {
    const cols = line.split("\t");
    const [name, tagRaw = "", sidesRaw = "", ingredientsRaw = ""] = cols.map((c) => c.trim());
    if (!name) {
      console.warn(`Skipping row missing required name: ${line}`);
      continue;
    }
    const tag = tagRaw ? (allowedTags.has(tagRaw) ? tagRaw : null) : null;
    const sides = sidesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ingredients = ingredientsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    rows.push({
      name,
      tag,
      sides: sides.length ? sides : [],
      ingredients: ingredients.length ? ingredients : [],
    });
  }
  return rows;
}

async function run() {
  const baseFlag = process.argv.indexOf("--base");
  if (baseFlag === -1 || !process.argv[baseFlag + 1]) {
    console.error("Usage: node import-meals.js --base https://us-central1-<project>.cloudfunctions.net");
    process.exit(1);
  }
  const base = process.argv[baseFlag + 1].replace(/\/+$/, "");
  const url = `${base}/addMeal`;

  const rows = parseData(DATA);
  console.log(`Importing ${rows.length} meals to ${url}`);

  for (const row of rows) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(row),
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error(`Failed: ${row.name} -> ${resp.status} ${err}`);
      } else {
        console.log(`Imported: ${row.name}`);
      }
    } catch (e) {
      console.error(`Error importing ${row.name}:`, e);
    }
  }
  console.log("Done.");
}

run();
