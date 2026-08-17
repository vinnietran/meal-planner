#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const process = require('node:process');
const {chromium} = require('playwright');
const {
  buildAutomationQuery,
  buildGroceryList,
  buildClipboardText,
  buildNecessityList,
  mergeCartLists,
  normalizeIngredientItem,
} = require('../grocery-utils');

const FETCH_MEALS_URL = process.env.MEAL_PLANNER_FETCH_MEALS_URL ||
  'https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals';
const FETCH_PLAN_URL = process.env.MEAL_PLANNER_FETCH_PLAN_URL ||
  'https://fetchmealplan-xzur6xnjsa-uc.a.run.app/fetchMealPlan?planType=next';
const FETCH_NECESSITIES_URL = process.env.MEAL_PLANNER_FETCH_NECESSITIES_URL ||
  'https://us-central1-fork-cast-f19a9.cloudfunctions.net/fetchNecessities';
const GIANT_EAGLE_HOME_URL = process.env.GIANT_EAGLE_HOME_URL || 'https://www.gianteagle.com/';
const DEFAULT_USER_DATA_DIR = path.join(process.cwd(), '.playwright', 'giant-eagle');

function printHelp() {
  console.log(`
Usage:
  npm run giant-eagle:cart -- [options]

Options:
  --list <path>     Load grocery items from an exported JSON file instead of the live meal plan
  --limit <count>   Only process the first N grocery items
  --dry-run         Fetch and print the grocery list without opening a browser
  --headless        Launch Playwright without a visible browser window
  --help            Show this help text

Environment:
  MEAL_PLANNER_FETCH_MEALS_URL   Override the meals endpoint
  MEAL_PLANNER_FETCH_PLAN_URL    Override the weekly plan endpoint
  MEAL_PLANNER_FETCH_NECESSITIES_URL Override the necessities endpoint
  GIANT_EAGLE_HOME_URL           Override the storefront home page
  PLAYWRIGHT_CHANNEL             Preferred browser channel (default tries chrome, msedge, then bundled chromium)
  PLAYWRIGHT_USER_DATA_DIR       Persistent profile directory for Giant Eagle login/session

Notes:
  - Live automation reads the next-week meal plan by default.
  - The script waits for you to log into Giant Eagle and select your store before it starts.
  - Cart adds are best effort. Review the cart before checkout.
  - Only necessities marked for cart inclusion are added from the necessities library.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    headless: false,
    help: false,
    limit: 0,
    listPath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--headless') {
      options.headless = true;
      continue;
    }

    if (arg === '--list') {
      const listPath = argv[index + 1];
      if (!listPath) {
        throw new Error('--list requires a file path.');
      }
      options.listPath = listPath;
      index += 1;
      continue;
    }

    if (arg === '--limit') {
      const rawLimit = argv[index + 1];
      if (!rawLimit) {
        throw new Error('--limit requires a number.');
      }
      options.limit = Number.parseInt(rawLimit, 10) || 0;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function fetchJson(url) {
  const response = await fetch(url, {headers: {'Accept': 'application/json'}});
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

async function loadItemsFromLivePlan() {
  const [meals, planData, necessities] = await Promise.all([
    fetchJson(FETCH_MEALS_URL),
    fetchJson(FETCH_PLAN_URL),
    fetchJson(FETCH_NECESSITIES_URL).catch(() => []),
  ]);

  const items = mergeCartLists([
    buildGroceryList(planData.plan, meals),
    buildNecessityList(necessities),
  ]);
  if (!items.length) {
    throw new Error('The next-week meal plan did not produce any grocery items.');
  }
  return items;
}

function normalizeItem(rawItem) {
  const normalized = normalizeIngredientItem(rawItem);
  const name = String(rawItem && rawItem.name || normalized && normalized.name || '').trim();
  const query = String(
    rawItem && (rawItem.searchText || rawItem.query) ||
    normalized && buildAutomationQuery(normalized) ||
    ''
  ).trim();
  const count = Math.max(
    1,
    Number.parseInt(rawItem && (rawItem.count || rawItem.cartQuantity), 10) ||
    normalized && normalized.cartQuantity ||
    1
  );

  if (!name || !query) {
    return null;
  }

  return {
    name,
    query,
    count,
    preferredBrand: String(rawItem && rawItem.preferredBrand || normalized && normalized.preferredBrand || '').trim(),
    preferredSize: String(rawItem && rawItem.preferredSize || normalized && normalized.preferredSize || '').trim(),
    department: String(rawItem && rawItem.department || normalized && normalized.department || '').trim(),
    notes: String(rawItem && rawItem.notes || normalized && normalized.notes || '').trim(),
    allowSubstitutes: rawItem && typeof rawItem.allowSubstitutes === 'boolean' ?
      rawItem.allowSubstitutes :
      normalized ? normalized.allowSubstitutes : true,
  };
}

async function loadItemsFromFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const fileContents = await fs.readFile(absolutePath, 'utf8');
  const payload = JSON.parse(fileContents);
  const sourceItems = Array.isArray(payload) ? payload : payload.items;

  if (!Array.isArray(sourceItems)) {
    throw new Error(`Expected ${absolutePath} to contain an array or an { items: [] } payload.`);
  }

  const items = sourceItems
    .map(normalizeItem)
    .filter(Boolean);

  if (!items.length) {
    throw new Error(`No grocery items found in ${absolutePath}.`);
  }

  return items;
}

function applyLimit(items, limit) {
  if (!limit || limit < 1) return items;
  return items.slice(0, limit);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForVisible(locator, timeout = 2500) {
  try {
    await locator.waitFor({state: 'visible', timeout});
    return locator;
  } catch (error) {
    return null;
  }
}

async function resolveSearchInput(page) {
  const candidates = [
    page.getByRole('searchbox').first(),
    page.locator('input[type="search"]').first(),
    page.locator('input[placeholder*="search" i]').first(),
    page.locator('input[name*="search" i]').first(),
    page.locator('input[aria-label*="search" i]').first(),
  ];

  for (const candidate of candidates) {
    const visible = await waitForVisible(candidate, 3000);
    if (visible) return visible;
  }

  return null;
}

async function resolveActionableButton(candidates) {
  for (const candidate of candidates) {
    const visible = await waitForVisible(candidate, 2000);
    if (visible) return visible;
  }
  return null;
}

async function searchForItem(page, query) {
  const searchInput = await resolveSearchInput(page);
  if (!searchInput) {
    throw new Error('Could not find the Giant Eagle search field.');
  }

  await searchInput.click();
  await searchInput.fill('');
  await searchInput.fill(query);
  await searchInput.press('Enter');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1800);
}

async function resolveResultScope(page, query) {
  const queryPattern = new RegExp(escapeRegExp(query), 'i');
  const scopedCandidates = [
    page.locator('[data-testid*="product"]').filter({hasText: queryPattern}).first(),
    page.locator('[data-automation-id*="product"]').filter({hasText: queryPattern}).first(),
    page.locator('[class*="product"]').filter({hasText: queryPattern}).first(),
    page.locator('[class*="Product"]').filter({hasText: queryPattern}).first(),
    page.locator('article').filter({hasText: queryPattern}).first(),
    page.locator('li').filter({hasText: queryPattern}).first(),
  ];

  for (const scoped of scopedCandidates) {
    const visible = await waitForVisible(scoped, 1200);
    if (visible) return visible;
  }

  return page;
}

async function clickAddButton(scope) {
  const button = await resolveActionableButton([
    scope.getByRole('button', {name: /add to cart/i}).first(),
    scope.getByRole('button', {name: /^add$/i}).first(),
    scope.locator('button').filter({hasText: /add/i}).first(),
    scope.locator('[aria-label*="add" i]').first(),
  ]);

  if (!button) return false;

  await button.click();
  return true;
}

async function increaseQuantity(page, scope, extraCount) {
  if (extraCount < 1) return 0;

  let incrementsApplied = 0;
  for (let index = 0; index < extraCount; index += 1) {
    const incrementButton = await resolveActionableButton([
      scope.getByRole('button', {name: /increase|increment|\+/i}).first(),
      scope.locator('button[aria-label*="increase" i]').first(),
      scope.locator('button').filter({hasText: /^\+$/}).first(),
    ]);

    if (!incrementButton) {
      break;
    }

    await incrementButton.click();
    incrementsApplied += 1;
    await page.waitForTimeout(350);
  }

  return incrementsApplied;
}

async function promptForManualSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    await rl.question('Log into Giant Eagle, confirm your store, then press Enter here to start adding items. ');
  } finally {
    rl.close();
  }
}

async function launchBrowser(headless) {
  const userDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR || DEFAULT_USER_DATA_DIR;
  const preferredChannel = process.env.PLAYWRIGHT_CHANNEL || 'chrome';
  const attemptedChannels = [];

  for (const channel of [preferredChannel, 'msedge', undefined]) {
    if (attemptedChannels.includes(String(channel))) continue;
    attemptedChannels.push(String(channel));

    try {
      return await chromium.launchPersistentContext(userDataDir, {
        headless,
        channel,
        viewport: null,
      });
    } catch (error) {
      if (channel === undefined) {
        throw error;
      }
    }
  }

  throw new Error('Could not launch Playwright with an installed browser.');
}

function printItemList(items) {
  console.log('\nGrocery items:\n');
  console.log(buildClipboardText(items));
  console.log('');
}

function summarizeResults(results) {
  const added = results.filter((result) => result.status === 'added');
  const partial = results.filter((result) => result.status === 'partial');
  const skipped = results.filter((result) => result.status === 'skipped');

  console.log('\nRun summary:');
  console.log(`  Added: ${added.length}`);
  console.log(`  Partial: ${partial.length}`);
  console.log(`  Skipped: ${skipped.length}`);

  if (partial.length || skipped.length) {
    console.log('\nItems needing review:');
    partial.concat(skipped).forEach((item) => {
      console.log(`  - ${item.name}: ${item.details}`);
    });
  }
}

async function addItemsToCart(page, items) {
  const results = [];

  for (const item of items) {
    process.stdout.write(`Adding "${item.name}"... `);

    try {
      await searchForItem(page, item.query);
      const resultScope = await resolveResultScope(page, item.query);
      const added = await clickAddButton(resultScope);

      if (!added) {
        results.push({
          name: item.name,
          status: 'skipped',
          details: 'No add button was found for the search result page.',
        });
        console.log('skipped');
        continue;
      }

      await page.waitForTimeout(700);

      const incrementsApplied = await increaseQuantity(page, resultScope, item.count - 1);
      const remaining = item.count - 1 - incrementsApplied;
      const status = remaining > 0 ? 'partial' : 'added';

      results.push({
        name: item.name,
        status,
        details: remaining > 0
          ? `Added once, but could not increase quantity ${remaining} more time(s).`
          : `Added ${item.count} time(s).`,
      });

      await page.keyboard.press('Escape').catch(() => {});
      console.log(status);
    } catch (error) {
      results.push({
        name: item.name,
        status: 'skipped',
        details: error.message,
      });
      console.log('skipped');
    }
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const loadedItems = options.listPath
    ? await loadItemsFromFile(options.listPath)
    : await loadItemsFromLivePlan();
  const items = applyLimit(loadedItems, options.limit);

  if (!items.length) {
    throw new Error('No grocery items available to process.');
  }

  printItemList(items);

  if (options.dryRun) {
    console.log('Dry run complete. No browser was opened.');
    return;
  }

  const context = await launchBrowser(options.headless);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(GIANT_EAGLE_HOME_URL, {waitUntil: 'domcontentloaded'});
    console.log(`Opened Giant Eagle at ${GIANT_EAGLE_HOME_URL}`);
    await promptForManualSetup();
    const results = await addItemsToCart(page, items);
    summarizeResults(results);
  } finally {
    if (options.headless) {
      await context.close();
    }
  }
}

main().catch((error) => {
  console.error(`\nGiant Eagle automation failed: ${error.message}`);
  process.exitCode = 1;
});
