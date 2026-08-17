document.addEventListener('DOMContentLoaded', () => {
    const fetchMealsUrl = 'https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals';
    const messageEl = document.getElementById('message');
    const searchInput = document.getElementById('meal-library-search');
    const tagFiltersEl = document.getElementById('meal-library-tags');
    const mealGridEl = document.getElementById('meal-library-grid');
    const mealCountEl = document.getElementById('meal-library-count');
    const mealDialog = document.getElementById('meal-detail-dialog');
    const closeDialogButton = document.getElementById('meal-detail-close');
    const editDialogButton = document.getElementById('meal-detail-edit');
    const detailTagEl = document.getElementById('meal-detail-tag');
    const detailNameEl = document.getElementById('meal-detail-name');
    const detailSummaryEl = document.getElementById('meal-detail-summary');
    const detailSidesEl = document.getElementById('meal-detail-sides');
    const detailIngredientsEl = document.getElementById('meal-detail-ingredients');

    const tags = ['All', 'Lunch', 'Dinner', 'Cenzo'];
    let meals = [];
    let activeTag = 'All';

    async function fetchMeals() {
        try {
            const response = await fetch(fetchMealsUrl, { mode: 'cors' });
            meals = await response.json();
            renderTagFilters();
            renderMeals();
        } catch (error) {
            console.error('Failed to fetch meals', error);
            mealGridEl.innerHTML = '<div class="mini-panel">Could not load the meal library.</div>';
            mealCountEl.textContent = 'Load failed';
            showMessage('Could not load meals from the backend.', true);
        }
    }

    function renderTagFilters() {
        tagFiltersEl.innerHTML = '';
        tags.forEach((tag) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'filter-chip';
            if (tag === activeTag) button.classList.add('active');
            button.textContent = tag;
            button.addEventListener('click', () => {
                activeTag = tag;
                renderTagFilters();
                renderMeals();
            });
            tagFiltersEl.appendChild(button);
        });
    }

    function formatDate(value) {
        if (!value) return 'Never logged';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Never logged';
        return date.toLocaleDateString();
    }

    function buildKnowledgePills(meal) {
        const likedBy = Array.isArray(meal.likedBy) ? meal.likedBy : [];
        return [
            meal.prepMinutes ? `${meal.prepMinutes} min` : '',
            meal.effort ? `${meal.effort} effort` : '',
            meal.makesLeftovers ? 'Makes leftovers' : '',
            meal.freezerFriendly ? 'Freezer-friendly' : '',
            likedBy.includes('momDad') ? 'Mom & Dad like it' : '',
            likedBy.includes('cenzo') ? 'Cenzo likes it' : '',
        ].filter(Boolean).map((detail) => `<span class="meta-pill">${detail}</span>`).join('');
    }

    function buildIngredientMeta(ingredient) {
        const details = [
            ingredient.quantity ? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''}` : '',
            ingredient.preparation ? `Prep: ${ingredient.preparation}` : '',
            ingredient.cartQuery ? `Search: ${ingredient.cartQuery}` : '',
            ingredient.cartQuantity ? `Cart qty: ${ingredient.cartQuantity}` : '',
            ingredient.preferredBrand ? `Brand: ${ingredient.preferredBrand}` : '',
            ingredient.preferredSize ? `Size: ${ingredient.preferredSize}` : '',
            ingredient.department ? `Dept: ${ingredient.department}` : '',
            ingredient.allowSubstitutes === false ? 'No substitutes' : 'Substitutes ok',
            ingredient.notes ? `Notes: ${ingredient.notes}` : '',
        ].filter(Boolean);

        return details.map((detail) => `<span class="meta-pill">${detail}</span>`).join('');
    }

    function normalizeIngredientItems(meal) {
        if (Array.isArray(meal.ingredientItems) && meal.ingredientItems.length) {
            return meal.ingredientItems;
        }

        return Array.isArray(meal.ingredients)
            ? meal.ingredients.map((name) => ({ name, cartQuery: name, cartQuantity: 1 }))
            : [];
    }

    function openMealDialog(meal, ingredientItems) {
        detailTagEl.textContent = meal.tag || 'Uncategorized';
        detailNameEl.textContent = meal.name;
        detailSummaryEl.innerHTML = `
            <span class="meta-pill">Last had: ${formatDate(meal.lastHad)}</span>
            <span class="meta-pill">${ingredientItems.length} ingredient${ingredientItems.length === 1 ? '' : 's'}</span>
            ${buildKnowledgePills(meal)}
        `;
        detailSidesEl.textContent = Array.isArray(meal.sides) && meal.sides.length
            ? `Planner sides: ${meal.sides.join(', ')}`
            : '';
        detailSidesEl.style.display = detailSidesEl.textContent ? 'block' : 'none';
        detailIngredientsEl.innerHTML = ingredientItems.map((ingredient) => `
            <div class="ingredient-record">
                <strong>${ingredient.name}</strong>
                <div class="meta-pills">${buildIngredientMeta(ingredient)}</div>
            </div>
        `).join('');
        editDialogButton.disabled = !meal.id;
        editDialogButton.dataset.mealId = meal.id || '';

        if (typeof mealDialog.showModal === 'function') {
            mealDialog.showModal();
            return;
        }

        mealDialog.setAttribute('open', 'open');
    }

    function closeMealDialog() {
        if (typeof mealDialog.close === 'function') {
            mealDialog.close();
            return;
        }

        mealDialog.removeAttribute('open');
    }

    function renderMeals() {
        const query = searchInput.value.trim().toLowerCase();
        const filteredMeals = meals.filter((meal) => {
            const matchesTag = activeTag === 'All' || meal.tag === activeTag;
            const ingredientText = normalizeIngredientItems(meal)
                .map((ingredient) => `${ingredient.name} ${ingredient.cartQuery || ''} ${ingredient.notes || ''}`)
                .join(' ')
                .toLowerCase();
            const matchesSearch = !query ||
                meal.name.toLowerCase().includes(query) ||
                ingredientText.includes(query);
            return matchesTag && matchesSearch;
        });

        mealCountEl.textContent = `${filteredMeals.length} meal${filteredMeals.length === 1 ? '' : 's'}`;
        mealGridEl.innerHTML = '';

        if (!filteredMeals.length) {
            mealGridEl.innerHTML = '<div class="mini-panel">No meals match the current filters.</div>';
            return;
        }

        filteredMeals.forEach((meal) => {
            const ingredientItems = normalizeIngredientItems(meal);
            const mealCard = document.createElement('article');
            mealCard.className = 'meal-library-card';
            mealCard.innerHTML = `
                <div class="meal-library-head">
                    <div class="meal-library-title-row">
                        <div>
                            <p class="eyebrow">${meal.tag || 'Uncategorized'}</p>
                            <h3>${meal.name}</h3>
                        </div>
                        <button type="button" class="ghost-btn meal-toggle">View Ingredients</button>
                    </div>
                    <div class="meta-pills">
                        <span class="meta-pill">Last had: ${formatDate(meal.lastHad)}</span>
                        <span class="meta-pill">${ingredientItems.length} ingredient${ingredientItems.length === 1 ? '' : 's'}</span>
                        ${buildKnowledgePills(meal)}
                    </div>
                </div>
                ${Array.isArray(meal.sides) && meal.sides.length ? `<p class="helper-note">Planner sides: ${meal.sides.join(', ')}</p>` : ''}
                ${meal.planningNotes ? `<p class="helper-note">Planning notes: ${meal.planningNotes}</p>` : ''}
            `;
            mealCard.querySelector('.meal-toggle').addEventListener('click', () => {
                openMealDialog(meal, ingredientItems);
            });
            mealGridEl.appendChild(mealCard);
        });
    }

    function showMessage(message, isError) {
        if (!messageEl) return;
        messageEl.textContent = message;
        messageEl.style.display = 'block';
        messageEl.style.background = isError
            ? 'linear-gradient(135deg, #c92a42, #7a1124)'
            : 'linear-gradient(135deg, #0f9b68, #0c7a79)';

        window.clearTimeout(showMessage.timeoutId);
        showMessage.timeoutId = window.setTimeout(() => {
            messageEl.style.display = 'none';
        }, 2800);
    }

    searchInput.addEventListener('input', renderMeals);
    closeDialogButton.addEventListener('click', closeMealDialog);
    editDialogButton.addEventListener('click', () => {
        const mealId = editDialogButton.dataset.mealId;
        if (!mealId) return;
        window.location.href = `add-meal.html?mealId=${encodeURIComponent(mealId)}`;
    });
    mealDialog.addEventListener('click', (event) => {
        const rect = mealDialog.getBoundingClientRect();
        const clickedOutside = (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        );

        if (clickedOutside) {
            closeMealDialog();
        }
    });
    fetchMeals();
});
