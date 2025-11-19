document.addEventListener('DOMContentLoaded', () => {
    // Set your deployed Functions base URL, e.g. https://us-central1-<project>.cloudfunctions.net
    const FUNCTIONS_BASE = ''; // TODO: set this to your Cloud Functions base URL
    const fetchMealsUrl = `${FUNCTIONS_BASE}/fetchMeals`;
    const fetchPlanUrl = `${FUNCTIONS_BASE}/fetchMealPlan`;
    const groceryListEl = document.getElementById('grocery-list');
    const mealSummaryEl = document.getElementById('meal-summary');

    async function fetchData() {
        try {
            const mealsResponse = await fetch(`${fetchMealsUrl}`, { mode: 'cors' });
            const meals = await mealsResponse.json();
            let mealPlan = [];
            try {
                const planResp = await fetch(`${fetchPlanUrl}`, {mode: 'cors'});
                const planData = await planResp.json();
                mealPlan = Array.isArray(planData.plan) ? planData.plan : [];
            } catch (e) {
                mealPlan = JSON.parse(localStorage.getItem('plannerWeekData') || '[]');
            }
            localStorage.setItem('mealList', JSON.stringify(meals));

            buildGroceryList(mealPlan, meals);
            buildMealSummary(mealPlan, meals);
        } catch (error) {
            console.error('Error fetching data:', error);
            const fallbackMeals = JSON.parse(localStorage.getItem('mealList')) || [];
            const localPlan = JSON.parse(localStorage.getItem('plannerWeekData') || '[]');
            buildGroceryList(localPlan, fallbackMeals);
            buildMealSummary(localPlan, fallbackMeals);
        }
    }

    function buildGroceryList(mealPlan, meals) {
        const items = {};

        mealPlan.forEach(day => {
            const selections = [
                day.lunch,
                day.dinner,
                day.Cenzo,
                day.momLunch,
                day.momDinner,
                day.cenzoBreakfast,
                day.cenzoLunch,
                day.cenzoDinner,
            ].filter(Boolean);

            selections.forEach(name => {
            const meal = meals.find(m => m.name === name);
            if (meal && Array.isArray(meal.ingredients) && meal.ingredients.length) {
                meal.ingredients.filter(Boolean).forEach(ing => {
                    items[ing] = (items[ing] || 0) + 1;
                });
            }
        });
    });

        groceryListEl.innerHTML = '';
        const keys = Object.keys(items).sort((a, b) => a.localeCompare(b));
        if (!keys.length) {
            groceryListEl.innerHTML = '<li class="grocery-item">No items yet. Add meals in the planner.</li>';
            return;
        }

        keys.forEach(item => {
            const li = document.createElement('li');
            li.className = 'grocery-item';
            li.innerHTML = `<span>${item}</span><span class="count">x${items[item]}</span>`;
            groceryListEl.appendChild(li);
        });
    }

    function buildMealSummary(mealPlan, meals) {
        mealSummaryEl.innerHTML = '';
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        const formatEntry = (label, value) => {
            if (!value) return null;
            const meal = meals.find(m => m.name === value);
            return `<div class="meal-chip"><strong>${label}:</strong> ${value}</div>`;
        };

        days.forEach((day, idx) => {
            const entry = mealPlan[idx] || {};
            const chips = [
                formatEntry('Lunch', entry.momLunch || entry.lunch),
                formatEntry('Dinner', entry.momDinner || entry.dinner),
                formatEntry('Cenzo Breakfast', entry.cenzoBreakfast),
                formatEntry('Cenzo Lunch', entry.cenzoLunch),
                formatEntry('Cenzo Dinner', entry.cenzoDinner || entry.Cenzo),
            ].filter(Boolean);

            if (chips.length) {
                const block = document.createElement('div');
                block.className = 'mini-panel';
                block.innerHTML = `<div class="panel-head"><p class="eyebrow">${day}</p></div>${chips.join('')}`;
                mealSummaryEl.appendChild(block);
            }
        });
    }

    fetchData();
});
