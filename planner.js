document.addEventListener('DOMContentLoaded', () => {
    const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const planTypes = ['current', 'next'];
    const planLabels = {current: 'Current Week', next: 'Next Week'};
    const planStoragePrefix = 'plannerWeekData:';
    const activeWeekStorageKey = 'plannerActiveWeekTab';
    const nextWeekCenzoDefaults = [
        {dayIndex: 1, fields: {cenzoBreakfast: 'Doodlebugs', cenzoLunch: 'Doodlebugs'}},
        {dayIndex: 3, fields: {cenzoBreakfast: 'Doodlebugs', cenzoLunch: 'Doodlebugs'}},
    ];

    const weekSwitcher = document.getElementById('week-switcher');
    const weekSubhead = document.getElementById('week-subhead');
    const daySwitcher = document.getElementById('day-switcher');
    const plannerCard = document.getElementById('planner-card');
    const librarySearch = document.getElementById('library-search');
    const tagFiltersEl = document.getElementById('tag-filters');
    const savedMealList = document.getElementById('saved-meal-list');
    const nextDayButton = document.getElementById('next-day');
    const clearWeekButton = document.getElementById('clear-week');
    const saveWeekButton = document.getElementById('save-week');
    const assistantOpenButton = document.getElementById('planning-assistant-open');
    const assistantDialog = document.getElementById('planning-assistant-dialog');
    const assistantCloseButton = document.getElementById('planning-assistant-close');
    const assistantForm = document.getElementById('planning-assistant-form');
    const assistantGenerateButton = document.getElementById('planning-assistant-generate');
    const assistantApplyButton = document.getElementById('planning-assistant-apply');
    const assistantPreview = document.getElementById('planning-assistant-preview');
    const assistantStatus = document.getElementById('planning-assistant-status');

    // Set your deployed Functions base URL, e.g. https://us-central1-<project>.cloudfunctions.net
    const FUNCTIONS_BASE = ''; // TODO: set this to your Cloud Functions base URL
    const fetchMealsUrl = `https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals`;
    const fetchPlanUrl = `https://fetchmealplan-xzur6xnjsa-uc.a.run.app/fetchMealPlan`;
    const savePlanUrl = `https://savemealplan-xzur6xnjsa-uc.a.run.app/saveMealPlan`;
    const suggestPlanUrl = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net/suggestMealPlan';
    const rolloverWeekUrl = ''; // TODO: set this to your rolloverWeekIfNeeded URL

    let meals = [];
    let activeDayIndex = 0;
    let fieldRefs = {};
    let activeTag = 'All';
    let assistantDraft = null;
    let activePlanType = localStorage.getItem(activeWeekStorageKey);
    if (!planTypes.includes(activePlanType)) {
        activePlanType = 'current';
    }

    const weekDataByType = {
        current: createEmptyWeek(),
        next: createEmptyWeek(),
    };
    let weekData = weekDataByType[activePlanType];

    async function fetchMeals() {
        try {
            const response = await fetch(fetchMealsUrl, { mode: 'cors' });
            meals = await response.json();
            localStorage.setItem('mealList', JSON.stringify(meals));
        } catch (error) {
            console.warn('Falling back to local meals:', error);
            meals = JSON.parse(localStorage.getItem('mealList')) || sampleMeals();
        }
        renderMealLibrary(meals);
    }

    async function fetchPlan(planType) {
        try {
            const resp = await fetch(`${fetchPlanUrl}?planType=${planType}`, { mode: 'cors' });
            const data = await resp.json();
            const normalized = normalizePlan(data.plan);
            setWeekData(planType, normalized);
            localStorage.setItem(storageKey(planType), JSON.stringify(normalized));
        } catch (err) {
            console.warn('Using local plan fallback', err);
            populateFromStorage(planType);
        }
    }

    async function rolloverWeekIfNeeded() {
        if (!rolloverWeekUrl) return null;
        try {
            const resp = await fetch(rolloverWeekUrl, { mode: 'cors' });
            return await resp.json();
        } catch (error) {
            console.warn('Rollover check failed', error);
            return null;
        }
    }

    async function initializePlanner() {
        await rolloverWeekIfNeeded();
        await Promise.all(planTypes.map(fetchPlan));
        weekData = weekDataByType[activePlanType];
        renderWeekTabs();
        renderDaySwitcher();
        renderCard();
    }

    function sampleMeals() {
        return [
            { name: 'Roast Chicken', ingredients: ['Roasted potatoes', 'Green beans'] },
            { name: 'Pasta Bolognese', ingredients: ['Parmesan', 'Garlic bread'] },
            { name: 'Veggie Stir Fry', ingredients: ['Rice', 'Sesame seeds'] },
            { name: 'Tacos', ingredients: ['Guac', 'Salsa', 'Chips'] },
            { name: 'Salmon & Veg', ingredients: ['Asparagus', 'Couscous'] },
            { name: 'Pancakes', ingredients: ['Berries', 'Maple syrup'] }
        ];
    }

    function createEmptyWeek() {
        return Array.from({length: weekDays.length}, () => ({}));
    }

    function normalizePlan(plan) {
        if (!Array.isArray(plan)) return createEmptyWeek();
        const normalized = plan.slice(0, weekDays.length).map(normalizeDayEntry);
        while (normalized.length < weekDays.length) normalized.push({});
        return normalized;
    }

    function normalizeDayEntry(entry) {
        if (!entry || typeof entry !== 'object') return {};
        const {
            momDinner,
            momDinnerSides,
            cenzoDinner,
            cenzoDinnerSides,
            Cenzo,
            CenzoSides,
            ...dayEntry
        } = entry;

        const dinner = dayEntry.dinner || momDinner || cenzoDinner || Cenzo || '';
        const dinnerSides = dayEntry.dinnerSides || momDinnerSides || cenzoDinnerSides || CenzoSides || '';
        if (dinner) dayEntry.dinner = dinner;
        if (dinnerSides) dayEntry.dinnerSides = dinnerSides;
        return dayEntry;
    }

    function applyPlanDefaults(planType, plan) {
        const normalized = normalizePlan(plan);
        if (planType !== 'next') return normalized;

        nextWeekCenzoDefaults.forEach(({dayIndex, fields}) => {
            const dayEntry = normalized[dayIndex] || {};
            normalized[dayIndex] = {
                ...dayEntry,
                ...Object.fromEntries(Object.entries(fields).map(([key, value]) => (
                    [key, (dayEntry[key] || '').trim() || value]
                ))),
            };
        });

        return normalized;
    }

    function storageKey(planType) {
        return `${planStoragePrefix}${planType}`;
    }

    function setWeekData(planType, plan) {
        weekDataByType[planType] = applyPlanDefaults(planType, plan);
        if (planType === activePlanType) {
            weekData = weekDataByType[planType];
        }
    }

    function populateFromStorage(planType) {
        const stored = JSON.parse(localStorage.getItem(storageKey(planType)) || '[]');
        if (stored.length) {
            setWeekData(planType, stored);
        }
    }

    function updateWeekSubhead() {
        if (!weekSubhead) return;
        weekSubhead.textContent = `Editing: ${planLabels[activePlanType]}`;
    }

    function renderWeekTabs() {
        if (!weekSwitcher) return;
        weekSwitcher.innerHTML = '';
        planTypes.forEach((planType) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'week-tab';
            if (planType === activePlanType) btn.classList.add('active');
            btn.textContent = planLabels[planType];
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', planType === activePlanType ? 'true' : 'false');
            btn.addEventListener('click', () => {
                if (planType === activePlanType) return;
                stashCurrentCard();
                activePlanType = planType;
                localStorage.setItem(activeWeekStorageKey, activePlanType);
                weekData = weekDataByType[activePlanType];
                renderWeekTabs();
                renderDaySwitcher();
                renderCard();
                updateWeekSubhead();
            });
            weekSwitcher.appendChild(btn);
        });
        updateWeekSubhead();
    }

    function renderDaySwitcher() {
        daySwitcher.innerHTML = '';
        weekDays.forEach((day, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = day;
            btn.className = 'day-tab';
            if (index === activeDayIndex) btn.classList.add('active');
            btn.addEventListener('click', () => {
                stashCurrentCard();
                activeDayIndex = index;
                renderDaySwitcher();
                renderCard();
            });
            daySwitcher.appendChild(btn);
        });
    }

    function buildCardShell() {
        fieldRefs = {};
        plannerCard.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'day-card';
        card.dataset.day = weekDays[activeDayIndex];

        const header = document.createElement('div');
        header.className = 'card-header';
        header.innerHTML = `
            <div class="card-day" id="card-day-label">${weekDays[activeDayIndex]}</div>
            <div class="card-chip">${planLabels[activePlanType]}</div>
        `;
        card.appendChild(header);

        const parents = document.createElement('div');
        parents.className = 'section';
        parents.appendChild(makeSectionTitle('Mom & Dad'));
        parents.appendChild(makeField('Lunch', 'momLunch'));

        const cenzo = document.createElement('div');
        cenzo.className = 'section';
        cenzo.appendChild(makeSectionTitle('Cenzo'));
        cenzo.appendChild(makeField('Breakfast', 'cenzoBreakfast'));
        cenzo.appendChild(makeField('Lunch', 'cenzoLunch'));

        const sharedDinner = document.createElement('div');
        sharedDinner.className = 'section shared-dinner-section';
        sharedDinner.appendChild(makeSectionTitle('Shared Dinner'));
        sharedDinner.appendChild(makeField('Meal', 'dinner'));

        const personalMeals = document.createElement('div');
        personalMeals.className = 'meal-sections';
        personalMeals.append(parents, cenzo);

        card.append(personalMeals, sharedDinner);
        plannerCard.appendChild(card);
    }

    function makeSectionTitle(text) {
        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = text;
        return title;
    }

    function makeField(label, key) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field';

        const labelEl = document.createElement('div');
        labelEl.className = 'field-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('div');
        valueEl.className = 'field-value';
        valueEl.setAttribute('contenteditable', 'true');
        valueEl.dataset.key = key;

        const sidesKey = `${key}Sides`;
        const sidesEl = document.createElement('div');
        sidesEl.className = 'field-sides';
        sidesEl.setAttribute('contenteditable', 'true');
        sidesEl.dataset.key = sidesKey;
        sidesEl.dataset.placeholder = 'Sides (comma separated, optional)';
        sidesEl.addEventListener('focus', () => {
            sidesEl.classList.add('active-slot');
        });
        sidesEl.addEventListener('blur', () => {
            sidesEl.classList.remove('active-slot');
            updateWeekDataForField(key, valueEl, sidesEl);
        });

        valueEl.addEventListener('focus', () => {
            Object.values(fieldRefs).forEach(ref => {
                ref.mealEl.classList.remove('active-slot');
            });
            valueEl.classList.add('active-slot');
        });

        valueEl.addEventListener('blur', () => {
            updateWeekDataForField(key, valueEl, sidesEl);
        });

        wrapper.append(labelEl, valueEl, sidesEl);
        fieldRefs[key] = {mealEl: valueEl, sidesEl};
        return wrapper;
    }

    function renderCard() {
        buildCardShell();
        const data = weekData[activeDayIndex] || {};
        document.getElementById('card-day-label').textContent = weekDays[activeDayIndex];
        Object.entries(fieldRefs).forEach(([key, ref]) => {
            ref.mealEl.textContent = getFieldValue(data, key);
            const sidesKey = `${key}Sides`;
            ref.sidesEl.textContent = getFieldValue(data, sidesKey);
        });
        highlightActiveTab();
    }

    function getFieldValue(dayData, key) {
        if (dayData[key]) return dayData[key];
        if (key === 'dinner') return dayData.momDinner || dayData.cenzoDinner || dayData.Cenzo || '';
        if (key === 'dinnerSides') return dayData.momDinnerSides || dayData.cenzoDinnerSides || dayData.CenzoSides || '';
        return '';
    }

    function highlightActiveTab() {
        daySwitcher.querySelectorAll('.day-tab').forEach((btn, idx) => {
            btn.classList.toggle('active', idx === activeDayIndex);
        });
    }

    function advanceDay() {
        stashCurrentCard();
        activeDayIndex = (activeDayIndex + 1) % weekDays.length;
        renderDaySwitcher();
        renderCard();
    }

    function stashCurrentCard() {
        if (!Object.keys(fieldRefs).length) return;
        Object.entries(fieldRefs).forEach(([key, ref]) => {
            updateWeekDataForField(key, ref.mealEl, ref.sidesEl);
        });
    }

    function updateWeekDataForField(key, mealEl, sidesEl) {
        const sidesKey = `${key}Sides`;
        weekData[activeDayIndex] = {
            ...(weekData[activeDayIndex] || {}),
            [key]: mealEl.textContent.trim(),
            [sidesKey]: sidesEl.textContent.trim()
        };
    }

    function renderMealLibrary(list) {
        savedMealList.innerHTML = '';
        const query = librarySearch.value.trim().toLowerCase();
        list
            .filter(meal => {
                const matchesSearch = meal.name.toLowerCase().includes(query);
                const matchesTag = activeTag === 'All' || meal.tag === activeTag;
                return matchesSearch && matchesTag;
            })
            .forEach(meal => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'meal-chip';
                chip.innerHTML = `<strong>${meal.name}</strong>`;
                chip.addEventListener('click', () => applyMealToActive(meal));
                savedMealList.appendChild(chip);
            });
    }

    function renderTagFilters() {
        const tags = ['All', 'Lunch', 'Dinner', 'Cenzo'];
        tagFiltersEl.innerHTML = '';
        tags.forEach(tag => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'filter-chip';
            if (tag === activeTag) btn.classList.add('active');
            btn.textContent = tag;
            btn.addEventListener('click', () => {
                activeTag = tag;
                renderTagFilters();
                renderMealLibrary(meals);
            });
            tagFiltersEl.appendChild(btn);
        });
    }

    function applyMealToActive(meal) {
        const activeField = plannerCard.querySelector('.field-value.active-slot');
        if (!activeField) {
            showConfirmationMessage('Select a slot first, then tap a saved meal.');
            return;
        }
        activeField.textContent = meal.name;
        const refEntry = Object.entries(fieldRefs).find(([, ref]) => ref.mealEl === activeField);
        if (refEntry) {
            const [key, ref] = refEntry;
            if (Array.isArray(meal.sides) && meal.sides.length) {
                ref.sidesEl.textContent = meal.sides.join(', ');
            }
            updateWeekDataForField(key, ref.mealEl, ref.sidesEl);
        }
    }

    async function saveWeek() {
        stashCurrentCard();
        localStorage.setItem(storageKey(activePlanType), JSON.stringify(weekData));
        const payload = {
            planType: activePlanType,
            plan: weekData,
        };
        try {
            const resp = await fetch(savePlanUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            if (!resp.ok) throw new Error('Save failed');
            showConfirmationMessage('Meal Plan Saved!');
        } catch (err) {
            console.error(err);
            showConfirmationMessage('Saved locally (backend unavailable)');
        }
    }

    function clearWeek() {
        setWeekData(activePlanType, createEmptyWeek());
        localStorage.setItem(storageKey(activePlanType), JSON.stringify(weekData));
        renderCard();
        showConfirmationMessage('Cleared the week.');
    }

    function showConfirmationMessage(message) {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';

        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 2500);
    }

    function openPlanningAssistant() {
        assistantDraft = null;
        assistantPreview.innerHTML = '';
        assistantStatus.textContent = '';
        assistantApplyButton.hidden = true;
        if (typeof assistantDialog.showModal === 'function') {
            assistantDialog.showModal();
        } else {
            assistantDialog.setAttribute('open', 'open');
        }
    }

    function closePlanningAssistant() {
        if (typeof assistantDialog.close === 'function') {
            assistantDialog.close();
        } else {
            assistantDialog.removeAttribute('open');
        }
    }

    function checkedDayValues(groupName) {
        return Array.from(assistantDialog.querySelectorAll(`[data-option-group="${groupName}"] input:checked`))
            .map((input) => input.value);
    }

    async function generateAssistantDraft(event) {
        event.preventDefault();
        assistantGenerateButton.disabled = true;
        assistantApplyButton.hidden = true;
        assistantStatus.textContent = 'Building a draft from your family patterns...';
        try {
            const response = await fetch(suggestPlanUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    busyDays: checkedDayValues('busyDays'),
                    eatingOutDays: checkedDayValues('eatingOutDays'),
                    maxCookingNights: Number.parseInt(document.getElementById('assistant-max-cooking-nights').value, 10),
                    useLeftovers: document.getElementById('assistant-use-leftovers').checked,
                    preserveExisting: document.getElementById('assistant-preserve-existing').checked,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !Array.isArray(result.plan)) {
                throw new Error(result.error || 'Could not build a draft.');
            }
            assistantDraft = result;
            renderAssistantPreview(result);
            assistantStatus.textContent = `Drafted from ${result.generatedFrom?.observations || 0} past meal observations. Review it before applying.`;
            assistantApplyButton.hidden = false;
        } catch (error) {
            console.error(error);
            assistantStatus.textContent = error.message || 'Could not build a draft.';
        } finally {
            assistantGenerateButton.disabled = false;
        }
    }

    function renderAssistantPreview(result) {
        assistantPreview.innerHTML = '';
        const reasonMap = new Map((result.reasons || []).map((item) => [`${item.dayIndex}:${item.slot}`, item.reason]));
        result.plan.forEach((dayPlan, dayIndex) => {
            const card = document.createElement('article');
            card.className = 'assistant-preview-day';
            const heading = document.createElement('h3');
            heading.textContent = weekDays[dayIndex];
            card.appendChild(heading);
            [
                ['Mom & Dad lunch', 'momLunch'],
                ['Cenzo breakfast', 'cenzoBreakfast'],
                ['Cenzo lunch', 'cenzoLunch'],
                ['Shared dinner', 'dinner'],
            ].forEach(([label, key]) => {
                const value = getFieldValue(dayPlan, key);
                if (!value) return;
                const row = document.createElement('div');
                row.className = 'assistant-preview-row';
                const text = document.createElement('div');
                const labelEl = document.createElement('small');
                labelEl.textContent = label;
                const valueEl = document.createElement('strong');
                valueEl.textContent = value;
                text.append(labelEl, valueEl);
                row.appendChild(text);
                const actions = document.createElement('div');
                actions.className = 'assistant-preview-actions';
                const reason = reasonMap.get(`${dayIndex}:${key}`);
                if (reason) {
                    const reasonEl = document.createElement('span');
                    reasonEl.textContent = reason;
                    actions.appendChild(reasonEl);
                }
                const alternatives = result.alternatives?.[`${dayIndex}:${key}`] || [];
                if (alternatives.length > 1) {
                    const swapButton = document.createElement('button');
                    swapButton.type = 'button';
                    swapButton.className = 'assistant-swap';
                    swapButton.textContent = 'Different';
                    swapButton.dataset.dayIndex = String(dayIndex);
                    swapButton.dataset.slot = key;
                    actions.appendChild(swapButton);
                }
                row.appendChild(actions);
                card.appendChild(row);
            });
            assistantPreview.appendChild(card);
        });
    }

    function cycleAssistantMeal(dayIndex, slot) {
        const alternatives = assistantDraft?.alternatives?.[`${dayIndex}:${slot}`] || [];
        if (!alternatives.length) return;
        const dayPlan = assistantDraft.plan[dayIndex] || {};
        const currentValue = getFieldValue(dayPlan, slot);
        const currentIndex = alternatives.findIndex((value) => value === currentValue);
        dayPlan[slot] = alternatives[(currentIndex + 1 + alternatives.length) % alternatives.length];
        assistantDraft.plan[dayIndex] = dayPlan;
        assistantDraft.reasons = (assistantDraft.reasons || []).filter((item) => !(item.dayIndex === dayIndex && item.slot === slot));
        assistantDraft.reasons.push({dayIndex, slot, reason: 'Changed in this draft'});
        renderAssistantPreview(assistantDraft);
    }

    function applyAssistantDraft() {
        if (!assistantDraft || !Array.isArray(assistantDraft.plan)) return;
        stashCurrentCard();
        setWeekData('next', assistantDraft.plan);
        localStorage.setItem(storageKey('next'), JSON.stringify(weekDataByType.next));
        activePlanType = 'next';
        localStorage.setItem(activeWeekStorageKey, activePlanType);
        weekData = weekDataByType.next;
        activeDayIndex = 0;
        renderWeekTabs();
        renderDaySwitcher();
        renderCard();
        closePlanningAssistant();
        showConfirmationMessage('Draft applied to Next Week. Review it, then tap Save week.');
    }

    librarySearch.addEventListener('input', () => renderMealLibrary(meals));
    saveWeekButton.addEventListener('click', saveWeek);
    clearWeekButton.addEventListener('click', clearWeek);
    nextDayButton.addEventListener('click', advanceDay);
    assistantOpenButton.addEventListener('click', openPlanningAssistant);
    assistantCloseButton.addEventListener('click', closePlanningAssistant);
    assistantForm.addEventListener('submit', generateAssistantDraft);
    assistantApplyButton.addEventListener('click', applyAssistantDraft);
    assistantDialog.addEventListener('click', (event) => {
        if (event.target === assistantDialog) closePlanningAssistant();
    });
    assistantPreview.addEventListener('click', (event) => {
        const swapButton = event.target.closest('.assistant-swap');
        if (!swapButton) return;
        cycleAssistantMeal(Number(swapButton.dataset.dayIndex), swapButton.dataset.slot);
    });

    populateFromStorage('current');
    populateFromStorage('next');
    weekData = weekDataByType[activePlanType];
    renderWeekTabs();
    renderDaySwitcher();
    renderCard();
    fetchMeals();
    renderTagFilters();
    initializePlanner();
});
