document.addEventListener('DOMContentLoaded', () => {
    const fetchMealsUrl = `https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals`;
    const fetchPlanUrl = `https://fetchmealplan-xzur6xnjsa-uc.a.run.app/fetchMealPlan?planType=current`;
    const fetchNecessitiesUrl = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net/fetchNecessities';
    const groceryListEl = document.getElementById('grocery-list');
    const necessityListEl = document.getElementById('necessity-list');
    const mealSummaryEl = document.getElementById('meal-summary');
    const automationStatusEl = document.getElementById('automation-status');
    const groceryUtils = window.GroceryListUtils;
    let currentGroceryItems = [];
    let currentNecessityItems = [];

    async function fetchData() {
        try {
            const [mealsResponse, planResp, necessitiesResp] = await Promise.all([
                fetch(fetchMealsUrl, { mode: 'cors' }),
                fetch(fetchPlanUrl, { mode: 'cors' }),
                fetch(fetchNecessitiesUrl, { mode: 'cors' }).catch(() => ({ ok: false })),
            ]);
            const meals = await mealsResponse.json();
            const planData = await planResp.json();
            const necessities = necessitiesResp.ok ? await necessitiesResp.json() : [];
            const mealPlan = Array.isArray(planData.plan) ? planData.plan : [];

            currentNecessityItems = groceryUtils.buildNecessityList(necessities);
            currentGroceryItems = groceryUtils.mergeCartLists([
                groceryUtils.buildGroceryList(mealPlan, meals),
                currentNecessityItems,
            ]);
            buildGroceryList(currentGroceryItems);
            buildNecessityList(currentNecessityItems);
            buildMealSummary(mealPlan, meals);
            updateAutomationStatus();
        } catch (error) {
            console.error('Error fetching data:', error);
            currentGroceryItems = [];
            currentNecessityItems = [];
            buildGroceryList(currentGroceryItems);
            buildNecessityList(currentNecessityItems);
            buildMealSummary([], []);
            updateAutomationStatus('Could not load the live grocery list yet.');
        }
    }

    function buildGroceryList(items) {
        groceryListEl.innerHTML = '';
        if (!items.length) {
            groceryListEl.innerHTML = '<li class="grocery-item">No items yet. Add meals in the planner.</li>';
            return;
        }

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'grocery-item';
            li.innerHTML = `<span>${item.name}</span><span class="count">x${item.count}</span>`;
            groceryListEl.appendChild(li);
        });
    }

    function buildNecessityList(items) {
        necessityListEl.innerHTML = '';
        if (!items.length) {
            necessityListEl.innerHTML = '<li class="grocery-item">No necessities are selected for this run. Toggle them on the Necessities page.</li>';
            return;
        }

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'grocery-item';
            li.innerHTML = `<span>${item.name}</span><span class="count">x${item.count}</span>`;
            necessityListEl.appendChild(li);
        });
    }

    function buildMealSummary(mealPlan, meals) {
        mealSummaryEl.innerHTML = '';
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        const formatEntry = (label, value) => {
            if (!value) return null;
            return `<div class="meal-chip"><strong>${label}:</strong> ${value}</div>`;
        };

        days.forEach((day, idx) => {
            const entry = mealPlan[idx] || {};
            const chips = [
                formatEntry('Mom & Dad Lunch', entry.momLunch || entry.lunch),
                formatEntry('Cenzo Breakfast', entry.cenzoBreakfast),
                formatEntry('Cenzo Lunch', entry.cenzoLunch),
                formatEntry('Shared Dinner', entry.dinner || entry.momDinner || entry.cenzoDinner || entry.Cenzo),
            ].filter(Boolean);

            if (chips.length) {
                const block = document.createElement('div');
                block.className = 'mini-panel';
                block.innerHTML = `<div class="panel-head"><p class="eyebrow">${day}</p></div>${chips.join('')}`;
                mealSummaryEl.appendChild(block);
            }
        });
    }

    function updateAutomationStatus(message) {
        const defaultMessage = currentGroceryItems.length
            ? `${currentGroceryItems.length} grocery items are ready for Playwright automation, including ${currentNecessityItems.length} selected necessities.`
            : 'The script needs at least one grocery item before it can build a Giant Eagle cart.';
        automationStatusEl.textContent = message || defaultMessage;
    }

    updateAutomationStatus();
    fetchData();
});
