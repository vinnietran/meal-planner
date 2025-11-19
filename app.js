document.addEventListener('DOMContentLoaded', function() {
    const cardsContainer = document.getElementById('week-cards');
    const FUNCTIONS_BASE = ''; // TODO: set your Cloud Functions base URL
    const fetchPlanUrl = `${FUNCTIONS_BASE}/fetchMealPlan`;
    const displayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const todayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
    const storageKey = 'plannerWeekData';
    let weekData = Array(7).fill(null).map(() => ({}));

    async function fetchPlan() {
        try {
            const response = await fetch(fetchPlanUrl, { mode: "cors" });
            const data = await response.json();
            if (Array.isArray(data.plan) && data.plan.length) {
                weekData = data.plan;
                localStorage.setItem(storageKey, JSON.stringify(weekData));
            } else {
                loadPlanFromLocal();
            }
        } catch (error) {
            console.error('Error fetching plan, using local fallback:', error);
            loadPlanFromLocal();
        }
        populateCardsWithPlan();
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
        parentsSection.appendChild(makeField('Dinner', 'momDinner'));

        const cenzoSection = document.createElement('div');
        cenzoSection.className = 'section';
        cenzoSection.appendChild(makeSectionTitle("Cenzo"));
        cenzoSection.appendChild(makeField('Breakfast', 'cenzoBreakfast'));
        cenzoSection.appendChild(makeField('Lunch', 'cenzoLunch'));
        cenzoSection.appendChild(makeField('Dinner', 'cenzoDinner'));

        cardBody.append(parentsSection, cenzoSection);
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
                const val = dayPlan[key] || '';
                const sidesKey = `${key}Sides`;
                const sides = dayPlan[sidesKey] || '';
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

    function loadPlanFromLocal() {
        const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (stored.length === weekData.length) {
            weekData = stored;
        }
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

    generateCards();
    fetchPlan();
    expandTodayCard();
});
