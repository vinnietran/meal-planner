document.addEventListener('DOMContentLoaded', () => {
    const FUNCTIONS_BASE = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net';
    const fetchKnowledgeUrl = `${FUNCTIONS_BASE}/fetchMealKnowledge`;
    const saveProfileUrl = `${FUNCTIONS_BASE}/saveHouseholdKnowledge`;
    const saveFeedbackUrl = `${FUNCTIONS_BASE}/saveMealFeedback`;
    const fetchCurrentPlanUrl = 'https://fetchmealplan-xzur6xnjsa-uc.a.run.app/fetchMealPlan?planType=current';
    const fetchMealsUrl = 'https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals';
    const profileStorageKey = 'mealKnowledgeProfile';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    const form = document.getElementById('knowledge-profile-form');
    const messageEl = document.getElementById('message');
    const statsEl = document.getElementById('knowledge-stats');
    const frequentMealsEl = document.getElementById('frequent-meals');
    const inferredRoutinesEl = document.getElementById('inferred-routines');
    const feedbackEl = document.getElementById('weekly-feedback');
    const feedbackWeekEl = document.getElementById('feedback-week');
    const knowledgeUpdatedEl = document.getElementById('knowledge-updated');
    let knowledge = null;

    function parseList(value) {
        return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    }

    function parseLines(value) {
        return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    }

    function getProfileFromForm() {
        return {
            planningGoals: document.getElementById('planning-goals').value.trim(),
            maxCookingNights: Number.parseInt(document.getElementById('max-cooking-nights').value, 10),
            newMealsPerWeek: Number.parseInt(document.getElementById('new-meals-per-week').value, 10),
            leftoversPreference: document.getElementById('leftovers-preference').value,
            favoriteMeals: parseList(document.getElementById('favorite-meals').value),
            dislikedMeals: parseList(document.getElementById('disliked-meals').value),
            recurringRoutines: parseLines(document.getElementById('recurring-routines').value),
        };
    }

    function populateProfile(profile = {}) {
        document.getElementById('planning-goals').value = profile.planningGoals || '';
        document.getElementById('max-cooking-nights').value = String(profile.maxCookingNights ?? 5);
        document.getElementById('new-meals-per-week').value = String(profile.newMealsPerWeek ?? 1);
        document.getElementById('leftovers-preference').value = profile.leftoversPreference || 'sometimes';
        document.getElementById('favorite-meals').value = (profile.favoriteMeals || []).join(', ');
        document.getElementById('disliked-meals').value = (profile.dislikedMeals || []).join(', ');
        document.getElementById('recurring-routines').value = (profile.recurringRoutines || []).join('\n');
    }

    async function loadKnowledge() {
        try {
            const response = await fetch(fetchKnowledgeUrl, {mode: 'cors'});
            if (!response.ok) throw new Error('Knowledge endpoint is not available.');
            knowledge = await response.json();
            knowledgeUpdatedEl.textContent = 'Learned automatically from past weeks';
        } catch (error) {
            console.warn('Using local knowledge fallback', error);
            const [planResponse, mealsResponse] = await Promise.all([
                fetch(fetchCurrentPlanUrl, {mode: 'cors'}),
                fetch(fetchMealsUrl, {mode: 'cors'}),
            ]);
            const planData = await planResponse.json();
            const meals = await mealsResponse.json();
            knowledge = {
                profile: JSON.parse(localStorage.getItem(profileStorageKey) || '{}'),
                currentWeek: {weekStart: planData.weekStart, plan: planData.plan || []},
                feedback: JSON.parse(localStorage.getItem(`mealKnowledgeFeedback:${planData.weekStart}`) || '[]'),
                insights: {
                    catalogMeals: Array.isArray(meals) ? meals.length : 0,
                    observedMealEvents: 0,
                    catalogMatchedEvents: 0,
                    learnedMeals: [],
                    inferredRoutines: [],
                },
            };
            knowledgeUpdatedEl.textContent = 'Local preview — deploy backend to sync learning';
        }

        populateProfile(knowledge.profile);
        renderInsights(knowledge.insights || {});
        renderFeedback();
    }

    function makeStat(value, label) {
        const card = document.createElement('div');
        card.className = 'knowledge-stat';
        const strong = document.createElement('strong');
        strong.textContent = String(value);
        const span = document.createElement('span');
        span.textContent = label;
        card.append(strong, span);
        return card;
    }

    function renderInsights(insights) {
        statsEl.innerHTML = '';
        statsEl.append(
            makeStat(insights.observedMealEvents || 0, 'past meal uses'),
            makeStat((insights.learnedMeals || []).length, 'meals learned'),
            makeStat((insights.inferredRoutines || []).length, 'recurring patterns')
        );
        renderInsightList(frequentMealsEl, insights.learnedMeals || [], (item) => `${item.name} · ${item.count}×`);
        renderInsightList(inferredRoutinesEl, insights.inferredRoutines || [], (item) => (
            `${item.day}: ${formatSlot(item.slot)} — ${item.mealName} · ${item.count}×`
        ));
    }

    function renderInsightList(container, items, formatter) {
        container.innerHTML = '';
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'muted';
            empty.textContent = 'Patterns will appear as weekly plans and feedback accumulate.';
            container.appendChild(empty);
            return;
        }
        items.forEach((item) => {
            const chip = document.createElement('span');
            chip.className = 'knowledge-chip';
            chip.textContent = formatter(item);
            container.appendChild(chip);
        });
    }

    function formatSlot(slot) {
        return ({momLunch: 'Mom & Dad lunch', cenzoBreakfast: 'Cenzo breakfast', cenzoLunch: 'Cenzo lunch', dinner: 'Dinner'})[slot] || slot;
    }

    function feedbackMap() {
        return new Map((knowledge.feedback || []).map((item) => [`${item.dayIndex}:${item.slot}`, item]));
    }

    function getDinner(dayPlan = {}) {
        return dayPlan.dinner || dayPlan.momDinner || dayPlan.cenzoDinner || dayPlan.Cenzo || '';
    }

    function renderFeedback() {
        const weekStart = knowledge.currentWeek?.weekStart || '';
        const plan = knowledge.currentWeek?.plan || [];
        const existingFeedback = feedbackMap();
        feedbackWeekEl.textContent = weekStart ? `Week of ${weekStart}` : '';
        feedbackEl.innerHTML = '';

        plan.forEach((dayPlan, dayIndex) => {
            const mealName = getDinner(dayPlan);
            if (!mealName) return;
            const prior = existingFeedback.get(`${dayIndex}:dinner`) || {};
            const card = document.createElement('article');
            card.className = 'feedback-card';
            card.dataset.dayIndex = String(dayIndex);
            card.dataset.mealName = mealName;

            const header = document.createElement('div');
            header.className = 'feedback-card-head';
            const titleWrap = document.createElement('div');
            const dayLabel = document.createElement('p');
            dayLabel.className = 'eyebrow';
            dayLabel.textContent = days[dayIndex];
            const mealLabel = document.createElement('h3');
            mealLabel.textContent = mealName;
            titleWrap.append(dayLabel, mealLabel);
            const rating = document.createElement('div');
            rating.className = 'feedback-rating';
            rating.append(
                makeRatingButton('👍', 1, prior.rating),
                makeRatingButton('👎', -1, prior.rating)
            );
            header.append(titleWrap, rating);

            const statuses = document.createElement('div');
            statuses.className = 'feedback-statuses';
            [['Made it', 'cooked'], ['Skipped', 'skipped'], ['Replaced', 'replaced']].forEach(([label, value]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'feedback-choice';
                button.textContent = label;
                button.dataset.status = value;
                if (prior.status === value) button.classList.add('active');
                statuses.appendChild(button);
            });

            const replacement = document.createElement('input');
            replacement.type = 'text';
            replacement.className = 'feedback-replacement';
            replacement.placeholder = 'What did you have instead?';
            replacement.value = prior.actualMealName || '';
            replacement.hidden = prior.status !== 'replaced';

            const notes = document.createElement('input');
            notes.type = 'text';
            notes.className = 'feedback-notes';
            notes.placeholder = 'Optional note';
            notes.value = prior.feedbackNotes || '';

            card.append(header, statuses, replacement, notes);
            feedbackEl.appendChild(card);
        });

        if (!feedbackEl.children.length) {
            const empty = document.createElement('p');
            empty.className = 'muted';
            empty.textContent = 'Add dinners to the current week to start collecting feedback.';
            feedbackEl.appendChild(empty);
        }
    }

    function makeRatingButton(label, value, currentRating) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rating-button';
        button.textContent = label;
        button.dataset.rating = String(value);
        button.setAttribute('aria-label', value === 1 ? 'Liked this meal' : 'Did not like this meal');
        if (Number(currentRating) === value) button.classList.add('active');
        return button;
    }

    async function saveProfile(event) {
        event.preventDefault();
        const profile = getProfileFromForm();
        localStorage.setItem(profileStorageKey, JSON.stringify(profile));
        try {
            const response = await fetch(saveProfileUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(profile),
            });
            if (!response.ok) throw new Error('Backend save failed');
            showMessage('Planning profile saved.');
        } catch (error) {
            console.warn(error);
            showMessage('Saved on this device. Deploy the knowledge backend to sync it everywhere.');
        }
    }

    async function saveFeedback(card, overrides = {}) {
        const dayIndex = Number(card.dataset.dayIndex);
        const existing = (knowledge.feedback || []).find((item) => item.dayIndex === dayIndex && item.slot === 'dinner') || {};
        const payload = {
            weekStart: knowledge.currentWeek.weekStart,
            dayIndex,
            slot: 'dinner',
            mealName: card.dataset.mealName,
            status: overrides.status || existing.status || 'planned',
            rating: overrides.rating ?? existing.rating ?? 0,
            actualMealName: card.querySelector('.feedback-replacement').value.trim(),
            feedbackNotes: card.querySelector('.feedback-notes').value.trim(),
        };
        const nextFeedback = (knowledge.feedback || []).filter((item) => !(item.dayIndex === dayIndex && item.slot === 'dinner'));
        nextFeedback.push(payload);
        knowledge.feedback = nextFeedback;
        localStorage.setItem(`mealKnowledgeFeedback:${payload.weekStart}`, JSON.stringify(nextFeedback));
        renderFeedback();

        try {
            const response = await fetch(saveFeedbackUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
            });
            if (!response.ok) throw new Error('Backend feedback save failed');
            showMessage('Feedback saved.');
        } catch (error) {
            console.warn(error);
            showMessage('Feedback saved on this device for now.');
        }
    }

    function showMessage(message) {
        messageEl.textContent = message;
        messageEl.style.display = 'block';
        window.clearTimeout(showMessage.timeoutId);
        showMessage.timeoutId = window.setTimeout(() => {
            messageEl.style.display = 'none';
        }, 2800);
    }

    form.addEventListener('submit', saveProfile);
    feedbackEl.addEventListener('click', (event) => {
        const card = event.target.closest('.feedback-card');
        if (!card) return;
        const statusButton = event.target.closest('[data-status]');
        const ratingButton = event.target.closest('[data-rating]');
        if (statusButton) saveFeedback(card, {status: statusButton.dataset.status});
        if (ratingButton) saveFeedback(card, {rating: Number(ratingButton.dataset.rating)});
    });
    feedbackEl.addEventListener('change', (event) => {
        const card = event.target.closest('.feedback-card');
        if (card && (event.target.matches('.feedback-replacement') || event.target.matches('.feedback-notes'))) {
            saveFeedback(card);
        }
    });
    loadKnowledge().catch((error) => {
        console.error(error);
        knowledgeUpdatedEl.textContent = 'Could not load knowledge';
        showMessage('Could not load the planning knowledge page.');
    });
});
