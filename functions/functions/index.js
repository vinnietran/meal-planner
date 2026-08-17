const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const {FieldValue, Timestamp} = admin.firestore;

const PROJECT_TIME_ZONE = process.env.PROJECT_TIME_ZONE || process.env.PROJECT_TIMEZONE || "UTC";
const WEEKLY_ROLLOVER_TIME_ZONE = process.env.WEEKLY_ROLLOVER_TIME_ZONE || PROJECT_TIME_ZONE;
const ADMIN_ROLLOVER_TOKEN = process.env.MANUAL_ROLLOVER_TOKEN || "";
const WEEKDAY_INDEX = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};
const NEXT_WEEK_CENZO_DEFAULTS = [
  {dayIndex: 1, fields: {cenzoBreakfast: "Doodlebugs", cenzoLunch: "Doodlebugs"}},
  {dayIndex: 3, fields: {cenzoBreakfast: "Doodlebugs", cenzoLunch: "Doodlebugs"}},
];
const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KNOWLEDGE_SLOTS = ["momLunch", "cenzoBreakfast", "cenzoLunch", "dinner"];
const FEEDBACK_STATUSES = new Set(["planned", "cooked", "skipped", "replaced"]);
const KNOWN_MEAL_ALIASES = new Map([
  ["db", "doodlebugs"],
  ["omelettes", "omelette"],
  ["leftovers", "leftover"],
]);
const KNOWN_MEAL_DISPLAY_NAMES = new Map([
  ["doodlebugs", "Doodlebugs"],
  ["omelette", "Omelette"],
]);

function withCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }
  return true;
}

function getZonedParts(dateInput = new Date(), timeZone = PROJECT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(dateInput);
  const lookup = {};
  parts.forEach((part) => {
    lookup[part.type] = part.value;
  });
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekday: lookup.weekday,
  };
}

function addDaysISO(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function startOfWeekISO(dateInput = new Date(), timeZone = PROJECT_TIME_ZONE) {
  const {year, month, day, weekday} = getZonedParts(dateInput, timeZone);
  const weekdayKey = weekday ? weekday.slice(0, 3) : "Mon";
  const weekdayIndex = WEEKDAY_INDEX[weekdayKey] || 1;
  const diff = weekdayIndex - 1;
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - diff);
  return utcDate.toISOString().slice(0, 10);
}

function getWeekStarts(dateInput = new Date(), timeZone = PROJECT_TIME_ZONE) {
  const thisWeekStart = startOfWeekISO(dateInput, timeZone);
  const nextWeekStart = addDaysISO(thisWeekStart, 7);
  return {thisWeekStart, nextWeekStart, timeZone};
}

function getPlanType(req) {
  const candidate = req.query?.planType || req.query?.scope || req.body?.planType || req.body?.scope;
  return candidate === "next" ? "next" : "current";
}

function emptyPlan() {
  return Array.from({length: 7}, () => ({}));
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeArray(arr) {
  return Array.isArray(arr) ? arr.map((i) => normalizeString(i)).filter(Boolean) : [];
}

function normalizeMealKey(value) {
  const key = normalizeString(value)
    .toLowerCase()
    .replace(/[“”'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return KNOWN_MEAL_ALIASES.get(key) || key;
}

function normalizeInteger(value, {min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0} = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function mealEventId(weekStart, dayIndex, slot) {
  return `${weekStart}_${dayIndex}_${slot}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function knowledgeItemId(mealKey) {
  return normalizeString(mealKey).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 240) || "unknown";
}

function getPlanSlotValue(dayEntry, slot) {
  if (!dayEntry || typeof dayEntry !== "object") return "";
  if (slot === "momLunch") return normalizeString(dayEntry.momLunch || dayEntry.lunch);
  if (slot === "dinner") {
    return normalizeString(dayEntry.dinner || dayEntry.momDinner || dayEntry.cenzoDinner || dayEntry.Cenzo);
  }
  return normalizeString(dayEntry[slot]);
}

function canonicalKnowledgeSlot(slot) {
  if (slot === "lunch") return "momLunch";
  if (["momDinner", "cenzoDinner", "Cenzo"].includes(slot)) return "dinner";
  return slot;
}

async function buildMealLookup() {
  const snapshot = await db.collection("meals").get();
  const lookup = new Map();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const names = [data.name, ...(Array.isArray(data.aliases) ? data.aliases : [])];
    names.forEach((name) => {
      const key = normalizeMealKey(name);
      if (key && !lookup.has(key)) {
        lookup.set(key, {id: doc.id, name: data.name});
      }
    });
  });
  return {lookup, count: snapshot.size};
}

function normalizeIngredientItem(item) {
  if (typeof item === "string") {
    const name = normalizeString(item);
    if (!name) return null;
    return {
      name,
      quantity: "",
      unit: "",
      preparation: "",
      cartQuery: name,
      cartQuantity: 1,
      preferredBrand: "",
      preferredSize: "",
      department: "",
      allowSubstitutes: true,
      notes: "",
    };
  }

  if (!item || typeof item !== "object") return null;

  const name = normalizeString(item.name || item.displayName || item.ingredient);
  if (!name) return null;

  const cartQuantity = Number.parseInt(item.cartQuantity, 10);
  return {
    name,
    quantity: normalizeString(item.quantity),
    unit: normalizeString(item.unit),
    preparation: normalizeString(item.preparation),
    cartQuery: normalizeString(item.cartQuery || item.searchQuery || item.query) || name,
    cartQuantity: Number.isFinite(cartQuantity) && cartQuantity > 0 ? cartQuantity : 1,
    preferredBrand: normalizeString(item.preferredBrand),
    preferredSize: normalizeString(item.preferredSize),
    department: normalizeString(item.department),
    allowSubstitutes: item.allowSubstitutes !== false,
    notes: normalizeString(item.notes),
  };
}

function normalizeIngredientItems(ingredientItems = [], ingredients = []) {
  if (Array.isArray(ingredientItems) && ingredientItems.length) {
    return ingredientItems.map((item) => normalizeIngredientItem(item)).filter(Boolean);
  }
  return normalizeArray(ingredients)
    .map((item) => normalizeIngredientItem(item))
    .filter(Boolean);
}

function ingredientNamesFromItems(ingredientItems = [], fallbackIngredients = []) {
  const names = ingredientItems
    .map((item) => normalizeString(item?.name))
    .filter(Boolean);

  return names.length ? names : normalizeArray(fallbackIngredients);
}

function normalizeNecessityItem(item) {
  const normalizedItem = normalizeIngredientItem(item);
  if (!normalizedItem) return null;

  return {
    ...normalizedItem,
    category: normalizeString(item?.category),
    includeInCart: item?.includeInCart !== false,
    isActive: item?.isActive !== false,
  };
}

function buildMealPayload({
  name,
  ingredients = [],
  ingredientItems = [],
  sides = [],
  lastHad,
  tag,
  aliases = [],
  prepMinutes = 0,
  effort = "",
  makesLeftovers = false,
  freezerFriendly = false,
  likedBy = [],
  planningNotes = "",
}) {
  const mealName = normalizeString(name);
  if (!mealName) {
    return {error: "name is required"};
  }

  const allowedTags = ["Lunch", "Dinner", "Cenzo"];
  const tagValue = tag && allowedTags.includes(tag) ? tag : null;
  const allowedEffort = ["easy", "moderate", "involved"];
  const effortValue = allowedEffort.includes(effort) ? effort : "";
  const allowedPeople = new Set(["momDad", "cenzo"]);
  const normalizedIngredientItems = normalizeIngredientItems(ingredientItems, ingredients);

  if (!normalizedIngredientItems.length) {
    return {error: "at least one ingredient item is required"};
  }

  return {
    payload: {
      name: mealName,
      ingredientItems: normalizedIngredientItems,
      ingredients: ingredientNamesFromItems(normalizedIngredientItems, ingredients),
      sides: normalizeArray(sides),
      lastHad: lastHad ? Timestamp.fromDate(new Date(lastHad)) : null,
      tag: tagValue,
      aliases: normalizeArray(aliases).filter((alias) => normalizeMealKey(alias) !== normalizeMealKey(mealName)),
      prepMinutes: normalizeInteger(prepMinutes, {min: 0, max: 1440}),
      effort: effortValue,
      makesLeftovers: makesLeftovers === true,
      freezerFriendly: freezerFriendly === true,
      likedBy: normalizeArray(likedBy).filter((person) => allowedPeople.has(person)),
      planningNotes: normalizeString(planningNotes),
      ingredientSchemaVersion: 2,
      knowledgeSchemaVersion: 1,
    },
  };
}

function normalizePlan(plan) {
  if (!Array.isArray(plan)) return emptyPlan();
  const normalized = plan.slice(0, 7).map((entry) => {
    if (!entry || typeof entry !== "object") return {};
    const {
      momDinner,
      momDinnerSides,
      cenzoDinner,
      cenzoDinnerSides,
      Cenzo,
      CenzoSides,
      ...dayEntry
    } = entry;
    const dinner = dayEntry.dinner || momDinner || cenzoDinner || Cenzo || "";
    const dinnerSides = dayEntry.dinnerSides || momDinnerSides || cenzoDinnerSides || CenzoSides || "";
    if (dinner) dayEntry.dinner = dinner;
    if (dinnerSides) dayEntry.dinnerSides = dinnerSides;
    return dayEntry;
  });
  while (normalized.length < 7) normalized.push({});
  return normalized;
}

function applyPlanDefaults(plan, planType) {
  const normalized = normalizePlan(plan);
  if (planType !== "next") return normalized;

  NEXT_WEEK_CENZO_DEFAULTS.forEach(({dayIndex, fields}) => {
    normalized[dayIndex] = {
      ...(normalized[dayIndex] || {}),
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => (
        [key, normalizeString(normalized[dayIndex]?.[key]) || value]
      ))),
    };
  });

  return normalized;
}

function isPlanEmpty(plan) {
  if (!Array.isArray(plan)) return true;
  return !plan.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Object.entries(entry).some(([key, value]) => {
      if (key === "day") return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === "object") return Object.keys(value).length > 0;
      return Boolean(value);
    });
  });
}

function weeklyPlanRef(planType) {
  return db.collection("weeklyPlans").doc(planType);
}

async function rolloverWeeklyPlans({requireNextContent = false, timeZone = WEEKLY_ROLLOVER_TIME_ZONE} = {}) {
  const {thisWeekStart, nextWeekStart} = getWeekStarts(new Date(), timeZone);
  const currentRef = weeklyPlanRef("current");
  const nextRef = weeklyPlanRef("next");
  let rolledOver = false;
  let nextHasContent = false;
  let currentWeekStart = null;

  await db.runTransaction(async (tx) => {
    const [currentSnap, nextSnap] = await Promise.all([
      tx.get(currentRef),
      tx.get(nextRef),
    ]);

    const currentData = currentSnap.exists ? currentSnap.data() : null;
    const nextData = nextSnap.exists ? nextSnap.data() : null;
    currentWeekStart = currentData?.weekStart || null;
    const nextPlan = normalizePlan(nextData?.plan);
    nextHasContent = !isPlanEmpty(nextPlan);
    const now = FieldValue.serverTimestamp();

    if (currentWeekStart === thisWeekStart) {
      if (!nextSnap.exists) {
        tx.set(nextRef, {
          weekStart: nextWeekStart,
          plan: applyPlanDefaults(emptyPlan(), "next"),
          createdAt: now,
          updatedAt: now,
        }, {merge: true});
      }
      return;
    }

    if (requireNextContent && !nextHasContent) {
      return;
    }

    const rolloverPlan = nextHasContent ? nextPlan : emptyPlan();
    tx.set(currentRef, {
      weekStart: thisWeekStart,
      plan: rolloverPlan,
      createdAt: nextData?.createdAt || now,
      updatedAt: now,
    }, {merge: true});
    tx.set(nextRef, {
      weekStart: nextWeekStart,
      plan: applyPlanDefaults(emptyPlan(), "next"),
      createdAt: nextData?.createdAt || now,
      updatedAt: now,
    }, {merge: true});
    rolledOver = true;
  });

  return {
    rolledOver,
    thisWeekStart,
    nextWeekStart,
    timeZone,
    currentWeekStart,
    nextHasContent,
  };
}

function requireAdminToken(req, res) {
  if (!ADMIN_ROLLOVER_TOKEN) {
    res.status(500).json({error: "MANUAL_ROLLOVER_TOKEN is not configured"});
    return false;
  }
  const provided = req.get("x-admin-token") || req.query?.token || req.body?.token;
  if (provided !== ADMIN_ROLLOVER_TOKEN) {
    res.status(403).json({error: "Forbidden"});
    return false;
  }
  return true;
}

async function loadLegacyCurrentPlan(weekStartISO) {
  const exactSnap = await db.collection("mealPlans").doc(weekStartISO).get();
  if (exactSnap.exists) {
    return exactSnap.data();
  }

  const latest = await db.collection("mealPlans").orderBy("updatedAt", "desc").limit(1).get();
  if (latest.empty) return null;
  return latest.docs[0].data();
}

exports.addMeal = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const built = buildMealPayload(req.body || {});
  if (built.error) {
    return res.status(400).json({error: built.error});
  }

  const now = FieldValue.serverTimestamp();
  const payload = {
    ...built.payload,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await db.collection("meals").add(payload);
  return res.status(201).json({id: docRef.id});
});

exports.updateMeal = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const {id} = req.body || {};
  const mealId = normalizeString(id);
  if (!mealId) {
    return res.status(400).json({error: "id is required"});
  }

  const built = buildMealPayload(req.body || {});
  if (built.error) {
    return res.status(400).json({error: built.error});
  }

  const mealRef = db.collection("meals").doc(mealId);
  const existing = await mealRef.get();
  if (!existing.exists) {
    return res.status(404).json({error: "meal not found"});
  }

  await mealRef.set({
    ...built.payload,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  return res.status(200).json({id: mealId, updated: true});
});

exports.fetchMeals = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const snapshot = await db.collection("meals").orderBy("name").get();
  const result = snapshot.docs.map((doc) => {
    const data = doc.data();
    const ingredientItems = normalizeIngredientItems(data.ingredientItems, data.ingredients);
    return {
      id: doc.id,
      name: data.name,
      ingredientItems,
      ingredients: ingredientNamesFromItems(ingredientItems, data.ingredients),
      tag: data.tag || null,
      sides: data.sides || [],
      aliases: data.aliases || [],
      prepMinutes: data.prepMinutes || 0,
      effort: data.effort || "",
      makesLeftovers: data.makesLeftovers === true,
      freezerFriendly: data.freezerFriendly === true,
      likedBy: data.likedBy || [],
      planningNotes: data.planningNotes || "",
      ingredientSchemaVersion: data.ingredientSchemaVersion || (ingredientItems.length ? 2 : 1),
      knowledgeSchemaVersion: data.knowledgeSchemaVersion || 0,
      lastHad: data.lastHad ? data.lastHad.toDate().toISOString() : null,
      createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    };
  });

  return res.status(200).json(result);
});

exports.addNecessity = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const rawItem = req.body || {};
  const normalizedItem = normalizeNecessityItem(rawItem);
  if (!normalizedItem) {
    return res.status(400).json({error: "name is required"});
  }

  const now = FieldValue.serverTimestamp();
  const payload = {
    ...normalizedItem,
    necessitySchemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await db.collection("necessities").add(payload);
  return res.status(201).json({id: docRef.id});
});

exports.updateNecessity = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const {id} = req.body || {};
  const necessityId = normalizeString(id);
  if (!necessityId) {
    return res.status(400).json({error: "id is required"});
  }

  const builtNecessity = normalizeNecessityItem(req.body || {});
  if (!builtNecessity) {
    return res.status(400).json({error: "name is required"});
  }

  const necessityRef = db.collection("necessities").doc(necessityId);
  const existing = await necessityRef.get();
  if (!existing.exists) {
    return res.status(404).json({error: "necessity not found"});
  }

  await necessityRef.set({
    ...builtNecessity,
    necessitySchemaVersion: 2,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  return res.status(200).json({id: necessityId, updated: true});
});

exports.fetchNecessities = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const includeInactive = req.query?.includeInactive === "true";
  const snapshot = await db.collection("necessities").orderBy("name").get();
  const result = snapshot.docs.map((doc) => {
    const data = doc.data();
    const necessityItem = normalizeNecessityItem(data);
    return {
      id: doc.id,
      ...necessityItem,
      necessitySchemaVersion: data.necessitySchemaVersion || 1,
      createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    };
  }).filter((item) => includeInactive || item.isActive);

  return res.status(200).json(result);
});

exports.saveMealPlan = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const planType = getPlanType(req);
  const {plan: planInput} = req.body || {};
  if (!Array.isArray(planInput)) {
    return res.status(400).json({error: "plan (array) is required"});
  }

  const {thisWeekStart, nextWeekStart} = getWeekStarts();
  const weekStartISO = planType === "next" ? nextWeekStart : thisWeekStart;
  const planRef = weeklyPlanRef(planType);

  const existing = await planRef.get();
  const now = FieldValue.serverTimestamp();
  const createdAt = existing.exists && existing.get("createdAt") ? existing.get("createdAt") : now;
  const plan = applyPlanDefaults(planInput, planType);

  await planRef.set({
    weekStart: weekStartISO,
    plan,
    createdAt,
    updatedAt: now,
  }, {merge: true});

  // Knowledge events use deterministic IDs so saving the same plan updates history instead of duplicating it.
  const {lookup: mealLookup} = await buildMealLookup();
  const existingEvents = await db.collection("mealEvents").where("weekStart", "==", weekStartISO).get();
  const existingById = new Map(existingEvents.docs.map((doc) => [doc.id, doc.data()]));
  const activeEventIds = new Set();
  const batch = db.batch();
  plan.forEach((dayEntry, idx) => {
    const dayName = dayEntry?.day || WEEK_DAYS[idx] || `Day${idx + 1}`;
    KNOWLEDGE_SLOTS.forEach((slot) => {
      const mealName = getPlanSlotValue(dayEntry, slot);
      if (mealName) {
        const eventId = mealEventId(weekStartISO, idx, slot);
        const eventRef = db.collection("mealEvents").doc(eventId);
        const existingEvent = existingById.get(eventId);
        const resolvedMeal = mealLookup.get(normalizeMealKey(mealName));
        const sameMeal = normalizeMealKey(existingEvent?.mealName) === normalizeMealKey(mealName);
        activeEventIds.add(eventId);
        batch.set(eventRef, {
          weekStart: weekStartISO,
          planType,
          dayIndex: idx,
          day: dayName,
          slot,
          mealName,
          mealKey: normalizeMealKey(mealName),
          mealId: resolvedMeal?.id || null,
          canonicalMealName: resolvedMeal?.name || null,
          status: sameMeal && FEEDBACK_STATUSES.has(existingEvent?.status) ? existingEvent.status : "planned",
          rating: sameMeal ? (existingEvent?.rating || 0) : 0,
          feedbackNotes: sameMeal ? (existingEvent?.feedbackNotes || "") : "",
          source: "manual",
          createdAt: existingEvent?.createdAt || now,
          updatedAt: now,
        }, {merge: true});
      }
    });
  });
  existingEvents.docs.forEach((doc) => {
    if (activeEventIds.has(doc.id)) return;
    batch.set(doc.ref, {status: "removed", updatedAt: now}, {merge: true});
  });
  await batch.commit();

  return res.status(200).json({weekStart: weekStartISO, updated: true, planType});
});

exports.saveHouseholdKnowledge = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const body = req.body || {};
  const leftoversPreference = ["rarely", "sometimes", "often"].includes(body.leftoversPreference)
    ? body.leftoversPreference
    : "sometimes";
  const profile = {
    planningGoals: normalizeString(body.planningGoals),
    maxCookingNights: normalizeInteger(body.maxCookingNights, {min: 0, max: 7, fallback: 5}),
    newMealsPerWeek: normalizeInteger(body.newMealsPerWeek, {min: 0, max: 7, fallback: 1}),
    leftoversPreference,
    favoriteMeals: normalizeArray(body.favoriteMeals),
    dislikedMeals: normalizeArray(body.dislikedMeals),
    recurringRoutines: normalizeArray(body.recurringRoutines),
    updatedAt: FieldValue.serverTimestamp(),
    knowledgeSchemaVersion: 1,
  };
  await db.collection("knowledge").doc("household").set(profile, {merge: true});
  return res.status(200).json({updated: true});
});

exports.saveMealFeedback = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const body = req.body || {};
  const weekStart = normalizeString(body.weekStart);
  const dayIndex = normalizeInteger(body.dayIndex, {min: 0, max: 6, fallback: -1});
  const slot = KNOWLEDGE_SLOTS.includes(body.slot) ? body.slot : "";
  const status = FEEDBACK_STATUSES.has(body.status) ? body.status : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || dayIndex < 0 || !slot || !status) {
    return res.status(400).json({error: "valid weekStart, dayIndex, slot, and status are required"});
  }

  const eventId = mealEventId(weekStart, dayIndex, slot);
  const eventRef = db.collection("mealEvents").doc(eventId);
  const existing = await eventRef.get();
  const existingData = existing.exists ? existing.data() : {};
  const mealName = normalizeString(body.actualMealName || body.mealName || existingData.mealName);
  const {lookup: mealLookup} = await buildMealLookup();
  const resolvedMeal = mealLookup.get(normalizeMealKey(mealName));
  const rating = normalizeInteger(body.rating, {min: -1, max: 1, fallback: 0});
  const now = FieldValue.serverTimestamp();

  await eventRef.set({
    weekStart,
    dayIndex,
    day: WEEK_DAYS[dayIndex],
    slot,
    mealName,
    mealKey: normalizeMealKey(mealName),
    mealId: resolvedMeal?.id || existingData.mealId || null,
    canonicalMealName: resolvedMeal?.name || existingData.canonicalMealName || null,
    status,
    rating,
    feedbackNotes: normalizeString(body.feedbackNotes),
    actualMealName: normalizeString(body.actualMealName),
    createdAt: existingData.createdAt || now,
    updatedAt: now,
  }, {merge: true});

  const cookedMealId = resolvedMeal?.id || existingData.mealId;
  if (status === "cooked" && cookedMealId) {
    const mealDateISO = addDaysISO(weekStart, dayIndex);
    await db.collection("meals").doc(cookedMealId).set({
      lastHad: Timestamp.fromDate(new Date(`${mealDateISO}T12:00:00.000Z`)),
      updatedAt: now,
    }, {merge: true});
  }

  return res.status(200).json({updated: true, eventId});
});

exports.fetchMealKnowledge = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const [profileSnap, mealsSnap, currentPlanSnap, eventSnap, legacyHistorySnap] = await Promise.all([
    db.collection("knowledge").doc("household").get(),
    db.collection("meals").get(),
    weeklyPlanRef("current").get(),
    db.collection("mealEvents").orderBy("weekStart", "desc").limit(500).get(),
    db.collection("mealHistory").limit(1000).get(),
  ]);

  const profile = profileSnap.exists ? profileSnap.data() : {};
  const currentPlanData = currentPlanSnap.exists ? currentPlanSnap.data() : {};
  const events = eventSnap.docs.map((doc) => ({id: doc.id, ...doc.data()}));
  const observations = new Map();
  const addObservation = ({weekStart, day, dayIndex, slot, mealName, mealId, status, rating}) => {
    const key = [weekStart, day || dayIndex, slot, normalizeMealKey(mealName)].join("|");
    if (!mealName || observations.has(key)) return;
    observations.set(key, {weekStart, day, dayIndex, slot, mealName, mealId, status, rating});
  };
  events.filter((event) => event.status !== "removed").forEach(addObservation);
  legacyHistorySnap.docs.forEach((doc) => {
    const item = doc.data();
    addObservation({
      weekStart: item.weekStart,
      day: item.day,
      dayIndex: WEEK_DAYS.indexOf(item.day),
      slot: canonicalKnowledgeSlot(item.slot),
      mealName: item.meal,
      status: "planned",
      rating: 0,
    });
  });

  const mealCounts = new Map();
  const routineCounts = new Map();
  observations.forEach((item) => {
    const mealKey = normalizeMealKey(item.mealName);
    const mealEntry = mealCounts.get(mealKey) || {name: KNOWN_MEAL_DISPLAY_NAMES.get(mealKey) || item.mealName, count: 0};
    mealEntry.count += 1;
    mealCounts.set(mealKey, mealEntry);
    const dayName = item.day || WEEK_DAYS[item.dayIndex] || "Unknown";
    const routineKey = `${dayName}|${item.slot}|${mealKey}`;
    const routineEntry = routineCounts.get(routineKey) || {
      day: dayName,
      slot: item.slot,
      mealName: KNOWN_MEAL_DISPLAY_NAMES.get(mealKey) || item.mealName,
      count: 0,
    };
    routineEntry.count += 1;
    routineCounts.set(routineKey, routineEntry);
  });

  const learnedMeals = Array.from(mealCounts.values()).sort((a, b) => b.count - a.count).slice(0, 12);
  const inferredRoutines = Array.from(routineCounts.values())
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const catalogKeys = new Set();
  mealsSnap.docs.forEach((doc) => {
    const data = doc.data();
    [data.name, ...(data.aliases || [])].forEach((name) => catalogKeys.add(normalizeMealKey(name)));
  });
  const matchedCount = Array.from(observations.values())
    .filter((item) => item.mealId || catalogKeys.has(normalizeMealKey(item.mealName))).length;

  return res.status(200).json({
    profile: {
      planningGoals: profile.planningGoals || "",
      maxCookingNights: profile.maxCookingNights ?? 5,
      newMealsPerWeek: profile.newMealsPerWeek ?? 1,
      leftoversPreference: profile.leftoversPreference || "sometimes",
      favoriteMeals: profile.favoriteMeals || [],
      dislikedMeals: profile.dislikedMeals || [],
      recurringRoutines: profile.recurringRoutines || [],
    },
    currentWeek: {
      weekStart: currentPlanData.weekStart || getWeekStarts().thisWeekStart,
      plan: applyPlanDefaults(currentPlanData.plan, "current"),
    },
    feedback: events.filter((event) => event.weekStart === currentPlanData.weekStart),
    insights: {
      catalogMeals: mealsSnap.size,
      observedMealEvents: observations.size,
      catalogMatchedEvents: matchedCount,
      learnedMeals,
      inferredRoutines,
    },
  });
});

exports.fetchMealKnowledgeReview = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const [mealsSnap, eventsSnap, legacyHistorySnap, resolutionSnap] = await Promise.all([
    db.collection("meals").get(),
    db.collection("mealEvents").orderBy("weekStart", "desc").limit(500).get(),
    db.collection("mealHistory").limit(1000).get(),
    db.collection("knowledgeMealItems").get(),
  ]);

  const catalogKeys = new Set();
  const meals = mealsSnap.docs.map((doc) => {
    const data = doc.data();
    [data.name, ...normalizeArray(data.aliases)].forEach((name) => catalogKeys.add(normalizeMealKey(name)));
    return {id: doc.id, name: data.name, aliases: normalizeArray(data.aliases)};
  }).sort((left, right) => left.name.localeCompare(right.name));
  const resolutions = new Map(resolutionSnap.docs.map((doc) => [doc.data().mealKey, {id: doc.id, ...doc.data()}]));
  const observations = new Map();
  const addObservation = ({weekStart, day, dayIndex, slot, mealName}) => {
    const mealKey = normalizeMealKey(mealName);
    const canonicalSlot = canonicalKnowledgeSlot(slot);
    const normalizedDayIndex = Number.isInteger(dayIndex) && dayIndex >= 0 ? dayIndex : WEEK_DAYS.indexOf(day);
    if (!mealKey || normalizedDayIndex < 0 || !KNOWLEDGE_SLOTS.includes(canonicalSlot)) return;
    const key = [weekStart, normalizedDayIndex, canonicalSlot, mealKey].join("|");
    if (!observations.has(key)) {
      observations.set(key, {
        weekStart,
        dayIndex: normalizedDayIndex,
        day: WEEK_DAYS[normalizedDayIndex],
        slot: canonicalSlot,
        mealName,
        mealKey,
      });
    }
  };
  eventsSnap.docs.map((doc) => doc.data()).filter((event) => event.status !== "removed").forEach(addObservation);
  legacyHistorySnap.docs.map((doc) => doc.data()).forEach((item) => addObservation({
    weekStart: item.weekStart,
    day: item.day,
    slot: item.slot,
    mealName: item.meal,
  }));

  const unmatched = new Map();
  observations.forEach((item) => {
    if (catalogKeys.has(item.mealKey) || resolutions.has(item.mealKey)) return;
    const aggregate = unmatched.get(item.mealKey) || {
      mealKey: item.mealKey,
      displayName: KNOWN_MEAL_DISPLAY_NAMES.get(item.mealKey) || item.mealName,
      count: 0,
      slots: new Set(),
      days: new Set(),
      lastWeekStart: item.weekStart || "",
    };
    aggregate.count += 1;
    aggregate.slots.add(item.slot);
    aggregate.days.add(item.day);
    if (item.weekStart && item.weekStart > aggregate.lastWeekStart) aggregate.lastWeekStart = item.weekStart;
    unmatched.set(item.mealKey, aggregate);
  });

  const items = Array.from(unmatched.values()).map((item) => {
    let suggestedClassification = "meal";
    if (item.mealKey.includes("leftover")) suggestedClassification = "leftovers";
    if (["doodlebugs", "ideals", "ebensburg"].includes(item.mealKey)) suggestedClassification = "event";
    if (["out", "eating out", "restaurant"].includes(item.mealKey)) suggestedClassification = "eatingOut";
    return {
      ...item,
      slots: Array.from(item.slots),
      days: Array.from(item.days),
      suggestedClassification,
    };
  }).sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName));

  return res.status(200).json({
    items,
    meals,
    summary: {
      unresolved: items.length,
      resolved: resolutionSnap.size,
      catalogMeals: mealsSnap.size,
      observations: observations.size,
    },
  });
});

exports.resolveMealKnowledge = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const body = req.body || {};
  const mealKey = normalizeMealKey(body.mealKey || body.displayName);
  const displayName = normalizeString(body.displayName);
  const action = normalizeString(body.action);
  if (!mealKey || !displayName) {
    return res.status(400).json({error: "mealKey and displayName are required"});
  }

  const resolutionRef = db.collection("knowledgeMealItems").doc(knowledgeItemId(mealKey));
  const now = FieldValue.serverTimestamp();
  let resolution;

  if (action === "connect") {
    const mealId = normalizeString(body.mealId);
    const mealRef = db.collection("meals").doc(mealId);
    const mealSnap = await mealRef.get();
    if (!mealSnap.exists) return res.status(404).json({error: "saved meal not found"});
    const canonicalName = mealSnap.data().name;
    await mealRef.set({aliases: FieldValue.arrayUnion(displayName), updatedAt: now}, {merge: true});
    resolution = {
      mealKey,
      displayName,
      action: "connected",
      linkedMealId: mealId,
      canonicalName,
      updatedAt: now,
    };

    const matchingEvents = await db.collection("mealEvents").where("mealKey", "==", mealKey).limit(450).get();
    if (!matchingEvents.empty) {
      const batch = db.batch();
      matchingEvents.docs.forEach((doc) => batch.set(doc.ref, {
        mealId,
        canonicalMealName: canonicalName,
        updatedAt: now,
      }, {merge: true}));
      await batch.commit();
    }
  } else if (action === "classify") {
    const classification = normalizeString(body.classification);
    if (!["leftovers", "eatingOut", "event"].includes(classification)) {
      return res.status(400).json({error: "invalid classification"});
    }
    resolution = {mealKey, displayName, action: "classified", classification, updatedAt: now};
  } else if (action === "ignore") {
    resolution = {mealKey, displayName, action: "ignored", classification: "ignored", updatedAt: now};
  } else {
    return res.status(400).json({error: "action must be connect, classify, or ignore"});
  }

  await resolutionRef.set(resolution, {merge: true});
  return res.status(200).json({updated: true, resolution: {...resolution, updatedAt: undefined}});
});

exports.suggestMealPlan = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const body = req.body || {};
  const busyDays = new Set(normalizeArray(body.busyDays).map(Number).filter((day) => day >= 0 && day <= 6));
  const eatingOutDays = new Set(normalizeArray(body.eatingOutDays).map(Number).filter((day) => day >= 0 && day <= 6));
  const preserveExisting = body.preserveExisting !== false;
  const useLeftovers = body.useLeftovers !== false;

  const [profileSnap, mealsSnap, currentSnap, nextSnap, eventSnap, legacyHistorySnap, resolutionSnap] = await Promise.all([
    db.collection("knowledge").doc("household").get(),
    db.collection("meals").get(),
    weeklyPlanRef("current").get(),
    weeklyPlanRef("next").get(),
    db.collection("mealEvents").orderBy("weekStart", "desc").limit(500).get(),
    db.collection("mealHistory").limit(1000).get(),
    db.collection("knowledgeMealItems").get(),
  ]);

  const profile = profileSnap.exists ? profileSnap.data() : {};
  const dislikedKeys = new Set(normalizeArray(profile.dislikedMeals).map(normalizeMealKey));
  const favoriteKeys = new Set(normalizeArray(profile.favoriteMeals).map(normalizeMealKey));
  const currentPlan = normalizePlan(currentSnap.exists ? currentSnap.data().plan : []);
  const draft = normalizePlan(nextSnap.exists ? nextSnap.data().plan : []);
  const observations = new Map();
  const resolutions = new Map(resolutionSnap.docs.map((doc) => [doc.data().mealKey, doc.data()]));
  const addObservation = ({weekStart, day, dayIndex, slot, mealName}) => {
    const canonicalSlot = canonicalKnowledgeSlot(slot);
    const normalizedDayIndex = Number.isInteger(dayIndex) && dayIndex >= 0 ? dayIndex : WEEK_DAYS.indexOf(day);
    const originalMealKey = normalizeMealKey(mealName);
    const resolution = resolutions.get(originalMealKey);
    if (resolution?.classification === "ignored") return;
    const mealKey = resolution?.canonicalName ? normalizeMealKey(resolution.canonicalName) : originalMealKey;
    const resolvedMealName = resolution?.canonicalName || mealName;
    if (!mealKey || normalizedDayIndex < 0 || !KNOWLEDGE_SLOTS.includes(canonicalSlot)) return;
    const key = [weekStart, normalizedDayIndex, canonicalSlot, mealKey].join("|");
    if (!observations.has(key)) {
      observations.set(key, {weekStart, dayIndex: normalizedDayIndex, slot: canonicalSlot, mealName: resolvedMealName, mealKey});
    }
  };
  eventSnap.docs.map((doc) => doc.data()).filter((event) => event.status !== "removed").forEach(addObservation);
  legacyHistorySnap.docs.map((doc) => doc.data()).forEach((item) => addObservation({
    weekStart: item.weekStart,
    day: item.day,
    slot: item.slot,
    mealName: item.meal,
  }));

  const mealDisplayNames = new Map();
  const mealMetadata = new Map();
  mealsSnap.docs.forEach((doc) => {
    const meal = doc.data();
    const key = normalizeMealKey(meal.name);
    if (!key) return;
    mealDisplayNames.set(key, meal.name);
    mealMetadata.set(key, meal);
    normalizeArray(meal.aliases).forEach((alias) => mealDisplayNames.set(normalizeMealKey(alias), meal.name));
  });

  const slotCounts = new Map();
  const routineCounts = new Map();
  observations.forEach((item) => {
    const slotKey = `${item.slot}|${item.mealKey}`;
    const slotEntry = slotCounts.get(slotKey) || {
      slot: item.slot,
      mealKey: item.mealKey,
      mealName: KNOWN_MEAL_DISPLAY_NAMES.get(item.mealKey) || item.mealName,
      count: 0,
    };
    slotEntry.count += 1;
    if (mealDisplayNames.has(item.mealKey)) slotEntry.mealName = mealDisplayNames.get(item.mealKey);
    slotCounts.set(slotKey, slotEntry);

    const routineKey = `${item.dayIndex}|${item.slot}|${item.mealKey}`;
    const routineEntry = routineCounts.get(routineKey) || {...slotEntry, dayIndex: item.dayIndex, count: 0};
    routineEntry.count += 1;
    routineCounts.set(routineKey, routineEntry);
  });

  const candidatesForSlot = (slot) => Array.from(slotCounts.values())
    .filter((item) => {
      const classification = resolutions.get(item.mealKey)?.classification;
      return item.slot === slot && !dislikedKeys.has(item.mealKey) && !["ignored", "leftovers", "eatingOut", "event"].includes(classification);
    })
    .map((item) => ({...item, score: item.count + (favoriteKeys.has(item.mealKey) ? 20 : 0)}))
    .sort((left, right) => right.score - left.score);
  const routinesFor = (dayIndex, slot) => Array.from(routineCounts.values())
    .filter((item) => item.dayIndex === dayIndex && item.slot === slot && !dislikedKeys.has(item.mealKey))
    .sort((left, right) => right.count - left.count);

  const recentDinnerKeys = new Set(currentPlan.map((day) => normalizeMealKey(getPlanSlotValue(day, "dinner"))).filter(Boolean));
  const usedKeys = new Set();
  const reasons = [];
  let cookingNights = 0;
  const maxCookingNights = normalizeInteger(body.maxCookingNights, {
    min: 0,
    max: 7,
    fallback: profile.maxCookingNights ?? 5,
  });

  const pickCandidate = (slot, dayIndex, {avoidRecent = false, preferEasy = false} = {}) => {
    const routine = routinesFor(dayIndex, slot)[0];
    if (routine && routine.count >= 2) return {...routine, reason: `A ${WEEK_DAYS[dayIndex]} routine`};
    const candidates = candidatesForSlot(slot).map((candidate) => {
      const metadata = mealMetadata.get(candidate.mealKey) || {};
      let score = candidate.score;
      if (usedKeys.has(candidate.mealKey)) score -= 12;
      if (avoidRecent && recentDinnerKeys.has(candidate.mealKey)) score -= 18;
      if (preferEasy && (metadata.effort === "easy" || (metadata.prepMinutes && metadata.prepMinutes <= 30))) score += 10;
      return {...candidate, score};
    }).sort((left, right) => right.score - left.score);
    const chosen = candidates[0];
    return chosen ? {...chosen, reason: preferEasy ? "Fits a busy day" : "Based on past plans"} : null;
  };

  draft.forEach((dayEntry, dayIndex) => {
    const nextDay = {...dayEntry};
    KNOWLEDGE_SLOTS.filter((slot) => slot !== "dinner").forEach((slot) => {
      if (preserveExisting && getPlanSlotValue(nextDay, slot)) return;
      const suggestion = pickCandidate(slot, dayIndex, {preferEasy: busyDays.has(dayIndex)});
      if (!suggestion) return;
      nextDay[slot] = suggestion.mealName;
      usedKeys.add(suggestion.mealKey);
      reasons.push({dayIndex, slot, reason: suggestion.reason});
    });

    if (preserveExisting && getPlanSlotValue(nextDay, "dinner")) {
      draft[dayIndex] = nextDay;
      return;
    }
    if (eatingOutDays.has(dayIndex)) {
      nextDay.dinner = "Eating out";
      reasons.push({dayIndex, slot: "dinner", reason: "Marked as eating out"});
      draft[dayIndex] = nextDay;
      return;
    }
    if (useLeftovers && cookingNights >= maxCookingNights) {
      const previousDinner = dayIndex > 0 ? getPlanSlotValue(draft[dayIndex - 1], "dinner") : "";
      nextDay.dinner = previousDinner && !normalizeMealKey(previousDinner).includes("leftover")
        ? `Leftovers: ${previousDinner}`
        : "Freezer leftovers";
      reasons.push({dayIndex, slot: "dinner", reason: "Keeps the week within the cooking-night goal"});
      draft[dayIndex] = nextDay;
      return;
    }
    const dinner = pickCandidate("dinner", dayIndex, {avoidRecent: true, preferEasy: busyDays.has(dayIndex)});
    if (dinner) {
      nextDay.dinner = dinner.mealName;
      usedKeys.add(dinner.mealKey);
      cookingNights += 1;
      reasons.push({dayIndex, slot: "dinner", reason: dinner.reason});
    }
    draft[dayIndex] = nextDay;
  });

  const alternatives = {};
  draft.forEach((dayEntry, dayIndex) => {
    KNOWLEDGE_SLOTS.forEach((slot) => {
      const names = [
        ...routinesFor(dayIndex, slot).map((item) => item.mealName),
        ...candidatesForSlot(slot).map((item) => item.mealName),
      ];
      if (slot === "dinner") names.push("Eating out", "Freezer leftovers");
      alternatives[`${dayIndex}:${slot}`] = Array.from(new Set(names.filter(Boolean))).slice(0, 8);
    });
  });

  return res.status(200).json({
    planType: "next",
    weekStart: nextSnap.exists ? nextSnap.data().weekStart : getWeekStarts().nextWeekStart,
    plan: draft,
    reasons,
    alternatives,
    generatedFrom: {
      observations: observations.size,
      savedMeals: mealsSnap.size,
      maxCookingNights,
    },
  });
});

exports.weeklyRolloverTask = onSchedule({
  schedule: "1 0 * * 1",
  timeZone: "America/New_York",
}, async () => {
  const result = await rolloverWeeklyPlans({
    requireNextContent: false,
    timeZone: WEEKLY_ROLLOVER_TIME_ZONE,
  });
  console.info("weeklyRolloverTask", result);
});

exports.rolloverWeekIfNeeded = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const result = await rolloverWeeklyPlans({requireNextContent: false});
  return res.status(200).json({
    rolledOver: result.rolledOver,
    currentWeekStart: result.thisWeekStart,
    nextWeekStart: result.nextWeekStart,
    timeZone: result.timeZone,
  });
});

exports.manualOneTimeRolloverFix = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  if (!requireAdminToken(req, res)) return;

  const result = await rolloverWeeklyPlans({requireNextContent: true});
  const action = result.rolledOver
    ? "rolled_over"
    : (result.currentWeekStart !== result.thisWeekStart && !result.nextHasContent)
      ? "skipped_empty_next"
      : "noop";

  return res.status(200).json({
    action,
    thisWeekStart: result.thisWeekStart,
    nextWeekStart: result.nextWeekStart,
    timeZone: result.timeZone,
    currentWeekStart: result.currentWeekStart,
    nextHasContent: result.nextHasContent,
  });
});

exports.manualOneTimeRolloverRecovery = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  if (!requireAdminToken(req, res)) return;

  const result = await rolloverWeeklyPlans({requireNextContent: true});
  const action = result.rolledOver
    ? "rolled_over"
    : (result.currentWeekStart !== result.thisWeekStart && !result.nextHasContent)
      ? "skipped_empty_next"
      : "noop";

  return res.status(200).json({
    action,
    thisWeekStart: result.thisWeekStart,
    nextWeekStart: result.nextWeekStart,
    timeZone: result.timeZone,
    currentWeekStart: result.currentWeekStart,
    nextHasContent: result.nextHasContent,
  });
});

exports.fetchMealPlan = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const planType = getPlanType(req);
  const {thisWeekStart, nextWeekStart} = getWeekStarts();
  const expectedWeekStart = planType === "next" ? nextWeekStart : thisWeekStart;
  const snapshot = await weeklyPlanRef(planType).get();

  if (!snapshot || !snapshot.exists) {
    if (planType === "current") {
      const legacyPlan = await loadLegacyCurrentPlan(expectedWeekStart);
      if (legacyPlan) {
        const plan = applyPlanDefaults(legacyPlan.plan, "current");
        const now = FieldValue.serverTimestamp();
        await weeklyPlanRef("current").set({
          weekStart: expectedWeekStart,
          plan,
          createdAt: legacyPlan.createdAt || now,
          updatedAt: now,
        }, {merge: true});
        return res.status(200).json({weekStart: expectedWeekStart, plan, planType});
      }
    }
    return res.status(200).json({
      weekStart: expectedWeekStart,
      plan: applyPlanDefaults(emptyPlan(), planType),
      planType,
    });
  }

  const data = snapshot.data();
  return res.status(200).json({
    weekStart: data.weekStart || expectedWeekStart,
    plan: applyPlanDefaults(data.plan, planType),
    planType,
    updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
  });
});
