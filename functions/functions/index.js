const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const {FieldValue, Timestamp} = admin.firestore;

const PROJECT_TIME_ZONE = process.env.PROJECT_TIME_ZONE || process.env.PROJECT_TIMEZONE || "UTC";
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

function normalizePlan(plan) {
  if (!Array.isArray(plan)) return emptyPlan();
  const normalized = plan.slice(0, 7).map((entry) => (
    entry && typeof entry === "object" ? entry : {}
  ));
  while (normalized.length < 7) normalized.push({});
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

  const {name, ingredients = [], sides = [], lastHad, tag} = req.body || {};
  if (!name) {
    return res.status(400).json({error: "name is required"});
  }
  const normalizeArray = (arr) => (Array.isArray(arr) ? arr.map((i) => String(i).trim()).filter(Boolean) : []);
  const allowedTags = ["Lunch", "Dinner", "Cenzo"];
  const tagValue = tag && allowedTags.includes(tag) ? tag : null;

  const now = FieldValue.serverTimestamp();
  const payload = {
    name: String(name).trim(),
    ingredients: normalizeArray(ingredients),
    sides: normalizeArray(sides),
    lastHad: lastHad ? Timestamp.fromDate(new Date(lastHad)) : null,
    tag: tagValue,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await db.collection("meals").add(payload);
  return res.status(201).json({id: docRef.id});
});

exports.fetchMeals = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const snapshot = await db.collection("meals").orderBy("name").get();
  const result = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      ingredients: data.ingredients || [],
      tag: data.tag || null,
      sides: data.sides || [],
      lastHad: data.lastHad ? data.lastHad.toDate().toISOString() : null,
      createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    };
  });

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
  const plan = normalizePlan(planInput);

  await planRef.set({
    weekStart: weekStartISO,
    plan,
    createdAt,
    updatedAt: now,
  }, {merge: true});

  // history entries
  const batch = db.batch();
  const slots = ["momLunch", "momDinner", "cenzoBreakfast", "cenzoLunch", "cenzoDinner", "lunch", "dinner", "Cenzo"];
  plan.forEach((dayEntry, idx) => {
    const dayName = dayEntry?.day || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][idx] || `Day${idx + 1}`;
    slots.forEach((slot) => {
      const mealName = dayEntry?.[slot];
      if (mealName) {
        const historyRef = db.collection("mealHistory").doc();
        batch.set(historyRef, {
          weekStart: weekStartISO,
          day: dayName,
          slot,
          meal: mealName,
          createdAt: now,
        });
      }
    });
  });
  await batch.commit();

  return res.status(200).json({weekStart: weekStartISO, updated: true, planType});
});

exports.rolloverWeekIfNeeded = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const {thisWeekStart, nextWeekStart, timeZone} = getWeekStarts();
  const currentRef = weeklyPlanRef("current");
  const nextRef = weeklyPlanRef("next");
  let rolledOver = false;

  await db.runTransaction(async (tx) => {
    const [currentSnap, nextSnap] = await Promise.all([
      tx.get(currentRef),
      tx.get(nextRef),
    ]);

    const currentData = currentSnap.exists ? currentSnap.data() : null;
    const nextData = nextSnap.exists ? nextSnap.data() : null;
    const currentWeekStart = currentData?.weekStart;
    const now = FieldValue.serverTimestamp();

    if (!currentSnap.exists || currentWeekStart !== thisWeekStart) {
      const nextPlan = normalizePlan(nextData?.plan);
      const rolloverPlan = isPlanEmpty(nextPlan) ? emptyPlan() : nextPlan;
      tx.set(currentRef, {
        weekStart: thisWeekStart,
        plan: rolloverPlan,
        createdAt: nextData?.createdAt || now,
        updatedAt: now,
      }, {merge: true});
      tx.set(nextRef, {
        weekStart: nextWeekStart,
        plan: emptyPlan(),
        createdAt: nextData?.createdAt || now,
        updatedAt: now,
      }, {merge: true});
      rolledOver = true;
      return;
    }

    if (!nextSnap.exists) {
      tx.set(nextRef, {
        weekStart: nextWeekStart,
        plan: emptyPlan(),
        createdAt: now,
        updatedAt: now,
      }, {merge: true});
    }
  });

  return res.status(200).json({
    rolledOver,
    currentWeekStart: thisWeekStart,
    nextWeekStart,
    timeZone,
  });
});

exports.manualOneTimeRolloverFix = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  if (!requireAdminToken(req, res)) return;

  const {thisWeekStart, nextWeekStart, timeZone} = getWeekStarts();
  const currentRef = weeklyPlanRef("current");
  const nextRef = weeklyPlanRef("next");

  let action = "noop";
  let details = {};

  await db.runTransaction(async (tx) => {
    const [currentSnap, nextSnap] = await Promise.all([
      tx.get(currentRef),
      tx.get(nextRef),
    ]);

    const currentData = currentSnap.exists ? currentSnap.data() : null;
    const nextData = nextSnap.exists ? nextSnap.data() : null;
    const currentWeekStart = currentData?.weekStart || null;
    const nextPlan = normalizePlan(nextData?.plan);
    const nextHasContent = !isPlanEmpty(nextPlan);
    const now = FieldValue.serverTimestamp();

    details = {
      currentWeekStart,
      nextWeekStart: nextData?.weekStart || null,
      nextHasContent,
    };

    if (currentWeekStart === thisWeekStart || !nextHasContent) {
      return;
    }

    tx.set(currentRef, {
      weekStart: thisWeekStart,
      plan: nextPlan,
      createdAt: nextData?.createdAt || now,
      updatedAt: now,
    }, {merge: true});

    tx.set(nextRef, {
      weekStart: nextWeekStart,
      plan: emptyPlan(),
      createdAt: nextData?.createdAt || now,
      updatedAt: now,
    }, {merge: true});

    action = "rolled_over";
  });

  return res.status(200).json({
    action,
    thisWeekStart,
    nextWeekStart,
    timeZone,
    ...details,
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
        const plan = normalizePlan(legacyPlan.plan);
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
    return res.status(200).json({weekStart: expectedWeekStart, plan: emptyPlan(), planType});
  }

  const data = snapshot.data();
  return res.status(200).json({
    weekStart: data.weekStart || expectedWeekStart,
    plan: normalizePlan(data.plan),
    planType,
    updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
  });
});
