document.addEventListener('DOMContentLoaded', () => {
    const FUNCTIONS_BASE = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net';
    const fetchKnowledgeUrl = `${FUNCTIONS_BASE}/fetchMealKnowledge`;
    const saveProfileUrl = `${FUNCTIONS_BASE}/saveHouseholdKnowledge`;
    const saveFeedbackUrl = `${FUNCTIONS_BASE}/saveMealFeedback`;
    const fetchReviewUrl = `${FUNCTIONS_BASE}/fetchMealKnowledgeReview`;
    const resolveKnowledgeUrl = `${FUNCTIONS_BASE}/resolveMealKnowledge`;
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
    const reviewCountEl = document.getElementById('knowledge-review-count');
    const reviewListEl = document.getElementById('knowledge-review-list');
    const reviewMoreButton = document.getElementById('knowledge-review-more');
    const connectDialog = document.getElementById('knowledge-connect-dialog');
    const connectForm = document.getElementById('knowledge-connect-form');
    const connectTitle = document.getElementById('knowledge-connect-title');
    const connectMealSelect = document.getElementById('knowledge-connect-meal');
    const connectCloseButton = document.getElementById('knowledge-connect-close');
    let knowledge = null;
    let reviewData = {items: [], meals: [], summary: {}};
    let visibleReviewCount = 10;
    let connectingItem = null;

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
            knowledgeUpdatedEl.textContent = 'Synced with the family knowledge base';
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
        loadReviewQueue();
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
            makeStat(insights.catalogMeals || 0, 'saved meals'),
            makeStat(insights.observedMealEvents || 0, 'unique observations'),
            makeStat(insights.catalogMatchedEvents || 0, 'linked to recipes')
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

    async function loadReviewQueue() {
        reviewCountEl.textContent = 'Loading...';
        try {
            const response = await fetch(fetchReviewUrl, {mode: 'cors'});
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !Array.isArray(data.items)) {
                throw new Error(data.error || 'Could not load unmatched meals.');
            }
            reviewData = data;
            renderReviewQueue();
        } catch (error) {
            console.error(error);
            reviewCountEl.textContent = 'Could not load';
            reviewListEl.innerHTML = '';
            const note = document.createElement('p');
            note.className = 'muted';
            note.textContent = 'The review service is not available yet.';
            reviewListEl.appendChild(note);
        }
    }

    function renderReviewQueue() {
        const items = reviewData.items || [];
        reviewCountEl.textContent = `${items.length} to review`;
        reviewListEl.innerHTML = '';
        items.slice(0, visibleReviewCount).forEach((item) => reviewListEl.appendChild(buildReviewCard(item)));
        reviewMoreButton.hidden = items.length <= visibleReviewCount;
        if (!items.length) {
            const complete = document.createElement('div');
            complete.className = 'knowledge-review-complete';
            complete.textContent = 'Everything is reviewed. New unmatched entries will appear here automatically.';
            reviewListEl.appendChild(complete);
        }
    }

    function buildReviewCard(item) {
        const card = document.createElement('article');
        card.className = 'knowledge-review-card';
        card.dataset.mealKey = item.mealKey;

        const head = document.createElement('div');
        head.className = 'knowledge-review-head';
        const titleWrap = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = item.displayName;
        const context = document.createElement('p');
        context.className = 'muted';
        const slotText = (item.slots || []).map(formatSlot).join(', ');
        context.textContent = `${item.count} plan${item.count === 1 ? '' : 's'}${slotText ? ` · ${slotText}` : ''}`;
        titleWrap.append(title, context);
        const badge = document.createElement('span');
        badge.className = 'knowledge-review-badge';
        badge.textContent = suggestedActionLabel(item.suggestedClassification);
        head.append(titleWrap, badge);

        const actions = document.createElement('div');
        actions.className = 'knowledge-review-actions';
        actions.append(
            reviewAction('Connect Meal', 'connect', true),
            reviewAction('Leftovers', 'leftovers'),
            reviewAction('Eating Out', 'eatingOut'),
            reviewAction('Event', 'event'),
            reviewAction('Create Meal', 'create'),
            reviewAction('Ignore', 'ignore')
        );
        card.append(head, actions);
        return card;
    }

    function suggestedActionLabel(classification) {
        return ({leftovers: 'Likely leftovers', eatingOut: 'Likely eating out', event: 'Likely routine'})[classification] || 'Unmatched meal';
    }

    function reviewAction(label, action, primary = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `knowledge-review-action${primary ? ' primary' : ''}`;
        button.dataset.reviewAction = action;
        button.textContent = label;
        return button;
    }

    function itemForCard(card) {
        return reviewData.items.find((item) => item.mealKey === card.dataset.mealKey);
    }

    function openConnectDialog(item) {
        connectingItem = item;
        connectTitle.textContent = `Connect “${item.displayName}”`;
        connectMealSelect.innerHTML = '<option value="">Select a saved meal</option>';
        (reviewData.meals || []).forEach((meal) => {
            const option = document.createElement('option');
            option.value = meal.id;
            option.textContent = meal.name;
            connectMealSelect.appendChild(option);
        });
        if (typeof connectDialog.showModal === 'function') connectDialog.showModal();
        else connectDialog.setAttribute('open', 'open');
    }

    function closeConnectDialog() {
        connectingItem = null;
        if (typeof connectDialog.close === 'function') connectDialog.close();
        else connectDialog.removeAttribute('open');
    }

    async function resolveReviewItem(item, resolution) {
        const response = await fetch(resolveKnowledgeUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mealKey: item.mealKey, displayName: item.displayName, ...resolution}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not save this decision.');
        reviewData.items = reviewData.items.filter((candidate) => candidate.mealKey !== item.mealKey);
        renderReviewQueue();
        showMessage('Meal knowledge updated.');
    }

    async function handleReviewAction(button, card) {
        const item = itemForCard(card);
        if (!item) return;
        const action = button.dataset.reviewAction;
        if (action === 'connect') {
            openConnectDialog(item);
            return;
        }
        if (action === 'create') {
            const params = new URLSearchParams({name: item.displayName, return: 'knowledge.html'});
            window.location.href = `add-meal.html?${params.toString()}`;
            return;
        }
        button.disabled = true;
        try {
            if (action === 'ignore') await resolveReviewItem(item, {action: 'ignore'});
            else await resolveReviewItem(item, {action: 'classify', classification: action});
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Could not update meal knowledge.');
            button.disabled = false;
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
    reviewListEl.addEventListener('click', (event) => {
        const button = event.target.closest('[data-review-action]');
        const card = event.target.closest('.knowledge-review-card');
        if (button && card) handleReviewAction(button, card);
    });
    reviewMoreButton.addEventListener('click', () => {
        visibleReviewCount += 10;
        renderReviewQueue();
    });
    connectCloseButton.addEventListener('click', closeConnectDialog);
    connectForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!connectingItem || !connectMealSelect.value) return;
        const item = connectingItem;
        const submitButton = connectForm.querySelector('[type="submit"]');
        submitButton.disabled = true;
        try {
            await resolveReviewItem(item, {action: 'connect', mealId: connectMealSelect.value});
            closeConnectDialog();
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Could not connect this meal.');
        } finally {
            submitButton.disabled = false;
        }
    });
    connectDialog.addEventListener('click', (event) => {
        if (event.target === connectDialog) closeConnectDialog();
    });

    loadKnowledge().catch((error) => {
        console.error(error);
        knowledgeUpdatedEl.textContent = 'Could not load knowledge';
        showMessage('Could not load the planning knowledge page.');
    });
});
