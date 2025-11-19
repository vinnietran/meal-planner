document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('meal-form');
    const messageEl = document.getElementById('message');

    // Set your deployed Functions base URL, e.g. "https://us-central1-<project>.cloudfunctions.net"
    const FUNCTIONS_BASE = 'https://addmeal-xzur6xnjsa-uc.a.run.app'; // TODO: set this after deploy/emulator start
    const addMealUrl = `${FUNCTIONS_BASE}/addMeal`;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('meal-name').value.trim();
        const ingredientsRaw = document.getElementById('meal-ingredients').value;
        const sidesRaw = document.getElementById('meal-sides').value;
        const lastHad = document.getElementById('meal-lastHad').value;
        const tag = document.getElementById('meal-tag').value;

        const ingredients = ingredientsRaw
            .split(',')
            .map((i) => i.trim())
            .filter(Boolean);
        const sides = sidesRaw
            ? sidesRaw.split(',').map((i) => i.trim()).filter(Boolean)
            : [];

        if (!name || !ingredients.length || !tag) {
            showMessage('Please enter a name, at least one ingredient, and select a tag.', true);
            return;
        }

        try {
            const response = await fetch(addMealUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name, ingredients, sides, tag, lastHad: lastHad || null})
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to save meal');
            }

            showMessage('Meal saved!', false);
            form.reset();
        } catch (err) {
            console.error(err);
            showMessage(err.message || 'Failed to save meal', true);
        }
    });

    function showMessage(msg, isError) {
        if (!messageEl) return;
        messageEl.textContent = msg;
        messageEl.style.display = 'block';
        messageEl.style.background = isError
            ? 'linear-gradient(135deg, #c92a42, #7a1124)'
            : 'linear-gradient(135deg, #0f9b68, #0c7a79)';

        setTimeout(() => {
            messageEl.style.display = 'none';
        }, 2500);
    }
});
