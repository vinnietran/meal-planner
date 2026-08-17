document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('meal-form');
    const messageEl = document.getElementById('message');
    const ingredientListEl = document.getElementById('ingredient-list');
    const ingredientTemplate = document.getElementById('ingredient-template');
    const addIngredientButton = document.getElementById('add-ingredient');
    const submitButton = document.getElementById('submit-meal');
    const formTitleEl = document.getElementById('meal-form-title');
    const formSubheadEl = document.getElementById('meal-form-subhead');

    const FUNCTIONS_BASE = 'https://addmeal-xzur6xnjsa-uc.a.run.app';
    const addMealUrl = `${FUNCTIONS_BASE}/addMeal`;
    const fetchMealsUrl = 'https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals';
    const updateMealUrl = 'https://updatemeal-xzur6xnjsa-uc.a.run.app/updateMeal';
    const urlParams = new URLSearchParams(window.location.search);
    const editingMealId = urlParams.get('mealId');
    const prefilledMealName = urlParams.get('name');
    const returnPage = urlParams.get('return') === 'knowledge.html' ? 'knowledge.html' : '';

    function createIngredientCard(initialValues = {}) {
        const fragment = ingredientTemplate.content.cloneNode(true);
        const card = fragment.querySelector('.ingredient-card');
        const nameInput = card.querySelector('.ingredient-name');
        const queryInput = card.querySelector('.ingredient-cart-query');

        nameInput.value = initialValues.name || '';
        card.querySelector('.ingredient-quantity').value = initialValues.quantity || '';
        card.querySelector('.ingredient-unit').value = initialValues.unit || '';
        card.querySelector('.ingredient-preparation').value = initialValues.preparation || '';
        queryInput.value = initialValues.cartQuery || '';
        card.querySelector('.ingredient-cart-quantity').value = initialValues.cartQuantity || 1;
        card.querySelector('.ingredient-brand').value = initialValues.preferredBrand || '';
        card.querySelector('.ingredient-size').value = initialValues.preferredSize || '';
        card.querySelector('.ingredient-department').value = initialValues.department || '';
        card.querySelector('.ingredient-notes').value = initialValues.notes || '';
        card.querySelector('.ingredient-allow-substitutes').checked = initialValues.allowSubstitutes !== false;

        nameInput.addEventListener('blur', () => {
            if (!queryInput.value.trim()) {
                queryInput.value = nameInput.value.trim();
            }
        });

        card.querySelector('.remove-ingredient').addEventListener('click', () => {
            card.remove();
            ensureIngredientCard();
            updateIngredientTitles();
        });

        ingredientListEl.appendChild(fragment);
        updateIngredientTitles();
    }

    function updateIngredientTitles() {
        Array.from(ingredientListEl.querySelectorAll('.ingredient-card')).forEach((card, index) => {
            const titleEl = card.querySelector('.ingredient-card-title');
            const removeButton = card.querySelector('.remove-ingredient');
            titleEl.textContent = `Ingredient ${index + 1}`;
            removeButton.disabled = ingredientListEl.children.length === 1;
        });
    }

    function ensureIngredientCard() {
        if (!ingredientListEl.children.length) {
            createIngredientCard();
        }
    }

    function parseCommaSeparatedList(value) {
        return String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function collectIngredientItems() {
        return Array.from(ingredientListEl.querySelectorAll('.ingredient-card'))
            .map((card) => {
                const name = card.querySelector('.ingredient-name').value.trim();
                if (!name) return null;

                const cartQuery = card.querySelector('.ingredient-cart-query').value.trim() || name;
                const cartQuantity = Math.max(1, Number.parseInt(card.querySelector('.ingredient-cart-quantity').value, 10) || 1);

                return {
                    name,
                    quantity: card.querySelector('.ingredient-quantity').value.trim(),
                    unit: card.querySelector('.ingredient-unit').value.trim(),
                    preparation: card.querySelector('.ingredient-preparation').value.trim(),
                    cartQuery,
                    cartQuantity,
                    preferredBrand: card.querySelector('.ingredient-brand').value.trim(),
                    preferredSize: card.querySelector('.ingredient-size').value.trim(),
                    department: card.querySelector('.ingredient-department').value.trim(),
                    notes: card.querySelector('.ingredient-notes').value.trim(),
                    allowSubstitutes: card.querySelector('.ingredient-allow-substitutes').checked,
                };
            })
            .filter(Boolean);
    }

    function resetForm() {
        form.reset();
        ingredientListEl.innerHTML = '';
        createIngredientCard();
    }

    function populateForm(meal) {
        document.getElementById('meal-name').value = meal.name || '';
        document.getElementById('meal-tag').value = meal.tag || '';
        document.getElementById('meal-lastHad').value = meal.lastHad ? meal.lastHad.slice(0, 10) : '';
        document.getElementById('meal-sides').value = Array.isArray(meal.sides) ? meal.sides.join(', ') : '';
        document.getElementById('meal-aliases').value = Array.isArray(meal.aliases) ? meal.aliases.join(', ') : '';
        document.getElementById('meal-prep-minutes').value = meal.prepMinutes || '';
        document.getElementById('meal-effort').value = meal.effort || '';
        document.getElementById('meal-planning-notes').value = meal.planningNotes || '';
        document.getElementById('meal-liked-mom-dad').checked = Array.isArray(meal.likedBy) && meal.likedBy.includes('momDad');
        document.getElementById('meal-liked-cenzo').checked = Array.isArray(meal.likedBy) && meal.likedBy.includes('cenzo');
        document.getElementById('meal-makes-leftovers').checked = meal.makesLeftovers === true;
        document.getElementById('meal-freezer-friendly').checked = meal.freezerFriendly === true;
        ingredientListEl.innerHTML = '';

        const ingredientItems = Array.isArray(meal.ingredientItems) && meal.ingredientItems.length
            ? meal.ingredientItems
            : (Array.isArray(meal.ingredients) ? meal.ingredients.map((name) => ({ name, cartQuery: name, cartQuantity: 1 })) : []);

        ingredientItems.forEach((item) => createIngredientCard(item));
        if (!ingredientItems.length) {
            createIngredientCard();
        }
    }

    async function loadMealForEditing() {
        if (!editingMealId) {
            if (prefilledMealName) {
                document.getElementById('meal-name').value = prefilledMealName;
                document.getElementById('meal-name').focus();
            }
            return;
        }

        formTitleEl.textContent = 'Edit Meal';
        formSubheadEl.textContent = 'Update a saved meal and keep its ingredient metadata aligned with planning and automation.';
        submitButton.textContent = 'Update Meal';

        try {
            const response = await fetch(fetchMealsUrl, { mode: 'cors' });
            const meals = await response.json();
            const meal = Array.isArray(meals) ? meals.find((entry) => entry.id === editingMealId) : null;

            if (!meal) {
                throw new Error('Meal not found.');
            }

            populateForm(meal);
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Could not load meal for editing.', true);
        }
    }

    async function saveMeal(event) {
        event.preventDefault();

        const name = document.getElementById('meal-name').value.trim();
        const tag = document.getElementById('meal-tag').value;
        const lastHad = document.getElementById('meal-lastHad').value;
        const sides = parseCommaSeparatedList(document.getElementById('meal-sides').value);
        const aliases = parseCommaSeparatedList(document.getElementById('meal-aliases').value);
        const likedBy = [];
        if (document.getElementById('meal-liked-mom-dad').checked) likedBy.push('momDad');
        if (document.getElementById('meal-liked-cenzo').checked) likedBy.push('cenzo');
        const ingredientItems = collectIngredientItems();

        if (!name || !tag || !ingredientItems.length) {
            showMessage('Enter a meal name, select a tag, and add at least one ingredient record.', true);
            return;
        }

        submitButton.disabled = true;

        try {
            const payload = {
                name,
                tag,
                sides,
                lastHad: lastHad || null,
                ingredientItems,
                aliases,
                prepMinutes: Number.parseInt(document.getElementById('meal-prep-minutes').value, 10) || 0,
                effort: document.getElementById('meal-effort').value,
                makesLeftovers: document.getElementById('meal-makes-leftovers').checked,
                freezerFriendly: document.getElementById('meal-freezer-friendly').checked,
                likedBy,
                planningNotes: document.getElementById('meal-planning-notes').value.trim(),
            };
            const response = await fetch(editingMealId ? updateMealUrl : addMealUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(editingMealId ? {...payload, id: editingMealId} : payload),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to save meal');
            }

            if (editingMealId) {
                showMessage('Meal updated.', false);
            } else {
                resetForm();
                showMessage('Meal saved with structured ingredients.', false);
                if (returnPage) {
                    window.setTimeout(() => {
                        window.location.href = returnPage;
                    }, 500);
                }
            }
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Failed to save meal', true);
        } finally {
            submitButton.disabled = false;
        }
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
        }, 3000);
    }

    addIngredientButton.addEventListener('click', () => createIngredientCard());
    form.addEventListener('submit', saveMeal);

    createIngredientCard();
    loadMealForEditing();
});
