const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const {FieldValue, Timestamp} = admin.firestore;

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

function startOfWeekISO(dateInput = new Date()) {
  const d = new Date(dateInput);
  const day = d.getUTCDay(); // 0 Sun, 1 Mon
  const diff = day === 0 ? -6 : 1 - day; // move to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getWeekStarts(dateInput = new Date()) {
  const thisWeekStart = startOfWeekISO(dateInput);
  const nextDate = new Date(dateInput);
  nextDate.setUTCDate(nextDate.getUTCDate() + 7);
  const nextWeekStart = startOfWeekISO(nextDate);
  return {thisWeekStart, nextWeekStart};
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

function weeklyPlanRef(planType) {
  return db.collection("weeklyPlans").doc(planType);
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

  const {thisWeekStart, nextWeekStart} = getWeekStarts();
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
      const rolloverPlan = normalizePlan(nextData?.plan);
      tx.set(currentRef, {
        weekStart: thisWeekStart,
        plan: rolloverPlan,
        createdAt: nextData?.createdAt || now,
        updatedAt: now,
      }, {merge: true});
      tx.set(nextRef, {
        weekStart: nextWeekStart,
        plan: emptyPlan(),
        createdAt: now,
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
