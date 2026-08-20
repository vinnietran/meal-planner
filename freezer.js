document.addEventListener('DOMContentLoaded', () => {
    const FUNCTIONS_BASE = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net';
    const fetchUrl = `${FUNCTIONS_BASE}/fetchFreezerLeftovers`;
    const addUrl = `${FUNCTIONS_BASE}/addFreezerLeftover`;
    const useUrl = `${FUNCTIONS_BASE}/useFreezerLeftover`;
    const fetchMealsUrl = 'https://fetchmeals-xzur6xnjsa-uc.a.run.app/fetchMeals';

    const form = document.getElementById('freezer-form');
    const nameInput = document.getElementById('freezer-meal-name');
    const dateInput = document.getElementById('freezer-date');
    const quantityInput = document.getElementById('freezer-quantity');
    const list = document.getElementById('freezer-list');
    const summary = document.getElementById('freezer-summary');
    const message = document.getElementById('message');
    const mealOptions = document.getElementById('saved-meal-options');
    let leftovers = [];

    function todayLocalISO() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatFrozenDate(value) {
        if (!value) return 'Date not recorded';
        const date = new Date(`${value}T12:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return `Frozen ${date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}`;
    }

    function showMessage(text, isError = false) {
        message.textContent = text;
        message.style.display = 'block';
        message.style.background = isError
            ? 'linear-gradient(135deg, #b4233c, #7f1d32)'
            : 'linear-gradient(135deg, #0f9b68, #0c7a79)';
        window.clearTimeout(showMessage.timer);
        showMessage.timer = window.setTimeout(() => {
            message.style.display = 'none';
        }, 3200);
    }

    function setBusy(button, busy, label = 'Working…') {
        if (!button) return;
        if (busy) button.dataset.originalLabel = button.textContent;
        button.disabled = busy;
        button.textContent = busy ? label : button.dataset.originalLabel;
    }

    function updateSummary() {
        const portions = leftovers.reduce((sum, item) => sum + item.quantity, 0);
        summary.textContent = `${portions} portion${portions === 1 ? '' : 's'} · ${leftovers.length} meal${leftovers.length === 1 ? '' : 's'}`;
    }

    function buildLeftoverCard(item) {
        const card = document.createElement('article');
        card.className = 'freezer-card';
        card.dataset.id = item.id;

        const details = document.createElement('div');
        details.className = 'freezer-card-details';
        const name = document.createElement('h3');
        name.textContent = item.name;
        const quantity = document.createElement('span');
        quantity.className = 'freezer-portion-count';
        quantity.textContent = `${item.quantity} portion${item.quantity === 1 ? '' : 's'}`;
        const frozenDate = document.createElement('span');
        frozenDate.className = 'freezer-date';
        frozenDate.textContent = formatFrozenDate(item.frozenOn);
        details.append(name, quantity, frozenDate);

        const actions = document.createElement('div');
        actions.className = 'freezer-card-actions';
        const addOne = document.createElement('button');
        addOne.type = 'button';
        addOne.className = 'ghost-btn freezer-action';
        addOne.dataset.action = 'add';
        addOne.textContent = '+ Add one';
        const useOne = document.createElement('button');
        useOne.type = 'button';
        useOne.className = 'primary-btn freezer-action';
        useOne.dataset.action = 'use';
        useOne.textContent = 'Use one';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger-btn freezer-action';
        remove.dataset.action = 'remove';
        remove.textContent = 'Remove';
        actions.append(addOne, useOne, remove);
        card.append(details, actions);
        return card;
    }

    function render() {
        list.innerHTML = '';
        updateSummary();
        if (!leftovers.length) {
            const empty = document.createElement('div');
            empty.className = 'freezer-empty';
            empty.innerHTML = '<strong>Your freezer list is empty.</strong><span>Add a meal above when you freeze extra portions.</span>';
            list.appendChild(empty);
            return;
        }
        leftovers.forEach((item) => list.appendChild(buildLeftoverCard(item)));
    }

    async function loadLeftovers() {
        try {
            const response = await fetch(fetchUrl, {mode: 'cors'});
            if (!response.ok) throw new Error('Could not load freezer leftovers.');
            leftovers = (await response.json()).sort((left, right) => {
                const dateComparison = (left.frozenOn || '9999-12-31').localeCompare(right.frozenOn || '9999-12-31');
                return dateComparison || left.name.localeCompare(right.name);
            });
            render();
        } catch (error) {
            console.error(error);
            list.innerHTML = '<div class="freezer-empty"><strong>Could not load the freezer.</strong><span>Try refreshing this page.</span></div>';
            summary.textContent = 'Unavailable';
        }
    }

    async function addLeftover(name, quantity, button, frozenOn) {
        setBusy(button, true, 'Adding…');
        try {
            const response = await fetch(addUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name, quantity, frozenOn}),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not add this meal.');
            await loadLeftovers();
            showMessage(`${name} is now in the freezer.`);
            return true;
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Could not update the freezer.', true);
            return false;
        } finally {
            setBusy(button, false);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        const quantity = Number.parseInt(quantityInput.value, 10);
        const frozenOn = dateInput.value;
        if (!name || !frozenOn || !Number.isInteger(quantity) || quantity < 1) return;
        const saved = await addLeftover(name, quantity, form.querySelector('button[type="submit"]'), frozenOn);
        if (saved) {
            form.reset();
            quantityInput.value = '1';
            dateInput.value = todayLocalISO();
            nameInput.focus();
        }
    });

    list.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        const card = button?.closest('.freezer-card');
        const item = leftovers.find((candidate) => candidate.id === card?.dataset.id);
        if (!button || !item) return;

        if (button.dataset.action === 'add') {
            await addLeftover(item.name, 1, button, item.frozenOn);
            return;
        }

        setBusy(button, true, button.dataset.action === 'remove' ? 'Removing…' : 'Using…');
        try {
            const response = await fetch(useUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: item.id, quantity: 1, removeAll: button.dataset.action === 'remove'}),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Could not update this meal.');
            await loadLeftovers();
            showMessage(data.removed ? `${item.name} was removed.` : `Used one portion of ${item.name}.`);
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Could not update the freezer.', true);
            setBusy(button, false);
        }
    });

    fetch(fetchMealsUrl, {mode: 'cors'})
        .then((response) => response.ok ? response.json() : [])
        .then((meals) => meals.forEach((meal) => {
            const option = document.createElement('option');
            option.value = meal.name;
            mealOptions.appendChild(option);
        }))
        .catch((error) => console.warn('Saved meal suggestions unavailable', error));

    dateInput.value = todayLocalISO();
    loadLeftovers();
});
