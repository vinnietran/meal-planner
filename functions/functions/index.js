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

  const {weekStart, plan} = req.body || {};
  if (!Array.isArray(plan) || !plan.length) {
    return res.status(400).json({error: "plan (array) is required"});
  }

  const weekStartISO = weekStart || startOfWeekISO();
  const planRef = db.collection("mealPlans").doc(weekStartISO);

  const existing = await planRef.get();
  const now = FieldValue.serverTimestamp();
  const createdAt = existing.exists && existing.get("createdAt") ? existing.get("createdAt") : now;

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

  return res.status(200).json({weekStart: weekStartISO, updated: true});
});

exports.fetchMealPlan = onRequest(async (req, res) => {
  if (!withCors(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({error: "Method not allowed"});
  }

  const {weekStart} = req.query;
  let snapshot;
  if (weekStart) {
    snapshot = await db.collection("mealPlans").doc(weekStart).get();
  } else {
    const latest = await db.collection("mealPlans").orderBy("updatedAt", "desc").limit(1).get();
    snapshot = latest.docs[0];
  }

  if (!snapshot || !snapshot.exists) {
    return res.status(200).json({weekStart: weekStart || startOfWeekISO(), plan: []});
  }

  const data = snapshot.data();
  return res.status(200).json({
    weekStart: data.weekStart,
    plan: data.plan || [],
    updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
  });
});
