document.addEventListener('DOMContentLoaded', function() {
    const cardsContainer = document.getElementById('week-cards');
    const FUNCTIONS_BASE = 'https://fetchmealplan-xzur6xnjsa-uc.a.run.app'; // TODO: set your Cloud Functions base URL
    const fetchPlanUrl = `${FUNCTIONS_BASE}/fetchMealPlan?planType=current`;
    const rolloverWeekUrl = ''; // TODO: set this to your rolloverWeekIfNeeded URL
    const displayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const todayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
    let weekData = createEmptyWeek();

    async function fetchPlan() {
        try {
            const response = await fetch(fetchPlanUrl, { mode: "cors" });
            const data = await response.json();
            weekData = normalizePlan(data.plan);
        } catch (error) {
            console.error('Error fetching plan:', error);
            weekData = createEmptyWeek();
        }
        populateCardsWithPlan();
    }

    async function rolloverWeekIfNeeded() {
        if (!rolloverWeekUrl) return;
        try {
            await fetch(rolloverWeekUrl, { mode: "cors" });
        } catch (error) {
            console.warn('Rollover check failed:', error);
        }
    }

    function createEmptyWeek() {
        return Array.from({length: displayOrder.length}, () => ({}));
    }

    function normalizePlan(plan) {
        if (!Array.isArray(plan)) return createEmptyWeek();
        const normalized = plan.slice(0, displayOrder.length).map((entry) => (
            entry && typeof entry === 'object' ? entry : {}
        ));
        while (normalized.length < displayOrder.length) normalized.push({});
        return normalized;
    }

    function buildDayCard(day) {
        const card = document.createElement('div');
        card.className = 'day-card collapsed';
        const isToday = day === todayName;

        const header = document.createElement('div');
        header.className = 'card-header';
        const dayLabel = document.createElement('div');
        dayLabel.className = 'card-day';
        dayLabel.textContent = day;
        const tag = document.createElement('div');
        tag.className = 'card-chip';
        tag.textContent = isToday ? 'Today' : 'Plan';

        const headerRight = document.createElement('div');
        headerRight.className = 'header-actions';
        headerRight.append(tag);

        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.className = 'collapse-toggle';
        collapseBtn.textContent = 'Expand';
        collapseBtn.addEventListener('click', () => toggleCard(card, collapseBtn));
        headerRight.append(collapseBtn);

        header.append(dayLabel, headerRight);
        card.appendChild(header);

        const cardBody = document.createElement('div');
        cardBody.className = 'card-body';

        const parentsSection = document.createElement('div');
        parentsSection.className = 'section';
        parentsSection.appendChild(makeSectionTitle('Mom & Dad'));
        parentsSection.appendChild(makeField('Lunch', 'momLunch'));

        const cenzoSection = document.createElement('div');
        cenzoSection.className = 'section';
        cenzoSection.appendChild(makeSectionTitle("Cenzo"));
        cenzoSection.appendChild(makeField('Breakfast', 'cenzoBreakfast'));
        cenzoSection.appendChild(makeField('Lunch', 'cenzoLunch'));

        const sharedDinnerSection = document.createElement('div');
        sharedDinnerSection.className = 'section shared-dinner-section';
        sharedDinnerSection.appendChild(makeSectionTitle('Shared Dinner'));
        sharedDinnerSection.appendChild(makeField('Meal', 'dinner'));

        const personalMeals = document.createElement('div');
        personalMeals.className = 'meal-sections';
        personalMeals.append(parentsSection, cenzoSection);

        cardBody.append(personalMeals, sharedDinnerSection);
        card.appendChild(cardBody);
        cardsContainer.appendChild(card);
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
        valueEl.dataset.key = key;

        wrapper.append(labelEl, valueEl);
        return wrapper;
    }

    function generateCards() {
        const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        cardsContainer.innerHTML = '';
        weekDays.forEach(buildDayCard);
    }

    function populateCardsWithPlan() {
        const cards = Array.from(cardsContainer.querySelectorAll('.day-card'));
        weekData.forEach((dayPlan, idx) => {
            const card = cards[idx];
            if (!card || !dayPlan) return;
            card.querySelectorAll('[data-key]').forEach(field => {
                const key = field.dataset.key;
                const val = getFieldValue(dayPlan, key);
                const sidesKey = `${key}Sides`;
                const sides = getFieldValue(dayPlan, sidesKey);
                if (val && sides) {
                    field.innerHTML = `${val}<br><small class="muted">${sides}</small>`;
                } else if (val) {
                    field.textContent = val;
                } else {
                    field.textContent = '—';
                }
            });
        });
    }

    function getFieldValue(dayPlan, key) {
        if (dayPlan[key]) return dayPlan[key];
        if (key === 'dinner') return dayPlan.momDinner || dayPlan.cenzoDinner || dayPlan.Cenzo || '';
        if (key === 'dinnerSides') return dayPlan.momDinnerSides || dayPlan.cenzoDinnerSides || dayPlan.CenzoSides || '';
        return '';
    }

    function toggleCard(card, button) {
        const isCollapsed = card.classList.toggle('collapsed');
        button.textContent = isCollapsed ? 'Expand' : 'Collapse';
    }

    function expandTodayCard() {
        const cards = Array.from(cardsContainer.querySelectorAll('.day-card'));
        const todayIdx = displayOrder.indexOf(todayName);
        if (todayIdx >= 0 && cards[todayIdx]) {
            const card = cards[todayIdx];
            const btn = card.querySelector('.collapse-toggle');
            card.classList.remove('collapsed');
            if (btn) btn.textContent = 'Collapse';
        }
    }

    async function initializeDashboard() {
        generateCards();
        await rolloverWeekIfNeeded();
        await fetchPlan();
        expandTodayCard();
    }

    initializeDashboard();
});
