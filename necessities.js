document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('necessity-form');
    const messageEl = document.getElementById('message');
    const libraryEl = document.getElementById('necessity-library');

    const addNecessityUrl = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net/addNecessity';
    const updateNecessityUrl = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net/updateNecessity';
    const fetchNecessitiesUrl = 'https://us-central1-fork-cast-f19a9.cloudfunctions.net/fetchNecessities?includeInactive=true';

    async function fetchNecessities() {
        try {
            const response = await fetch(fetchNecessitiesUrl, { mode: 'cors' });
            const necessities = await response.json();
            renderNecessities(necessities);
        } catch (error) {
            console.error('Failed to load necessities', error);
            libraryEl.innerHTML = '<div class="helper-note">Could not load saved necessities.</div>';
        }
    }

    function renderNecessities(items) {
        libraryEl.innerHTML = '';
        if (!Array.isArray(items) || !items.length) {
            libraryEl.innerHTML = '<div class="helper-note">No necessities saved yet.</div>';
            return;
        }

        items.forEach((item) => {
            const chip = document.createElement('div');
            chip.className = 'necessity-chip';
            const includeInCart = item.includeInCart !== false;
            chip.innerHTML = `
                <strong>${item.name}</strong>
                <span>${item.category || item.department || 'General'}</span>
                <span>${item.isActive ? 'Saved' : 'Inactive'} • ${includeInCart ? 'Included in cart' : 'Excluded from cart'} • x${item.cartQuantity || 1}</span>
                <label class="inline-toggle necessity-chip-toggle">
                    <input type="checkbox" ${includeInCart ? 'checked' : ''}>
                    <span>Include in grocery cart</span>
                </label>
            `;

            const checkbox = chip.querySelector('input');
            checkbox.addEventListener('change', async () => {
                await updateNecessitySelection(item, checkbox.checked, checkbox);
            });
            libraryEl.appendChild(chip);
        });
    }

    async function updateNecessitySelection(item, includeInCart, checkbox) {
        if (!item.id) return;

        const previousValue = !includeInCart;
        checkbox.disabled = true;

        try {
            const response = await fetch(updateNecessityUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    ...item,
                    includeInCart,
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to update necessity');
            }

            showMessage(`${item.name} ${includeInCart ? 'included' : 'excluded'} from grocery runs.`, false);
            fetchNecessities();
        } catch (error) {
            console.error(error);
            checkbox.checked = previousValue;
            showMessage(error.message || 'Failed to update necessity', true);
        } finally {
            checkbox.disabled = false;
        }
    }

    function collectPayload() {
        const name = document.getElementById('necessity-name').value.trim();
        const cartQuery = document.getElementById('necessity-cart-query').value.trim() || name;

        return {
            name,
            category: document.getElementById('necessity-category').value.trim(),
            cartQuery,
            cartQuantity: Math.max(1, Number.parseInt(document.getElementById('necessity-cart-quantity').value, 10) || 1),
            preferredBrand: document.getElementById('necessity-brand').value.trim(),
            preferredSize: document.getElementById('necessity-size').value.trim(),
            department: document.getElementById('necessity-department').value.trim(),
            notes: document.getElementById('necessity-notes').value.trim(),
            allowSubstitutes: document.getElementById('necessity-allow-substitutes').checked,
            includeInCart: document.getElementById('necessity-is-active').checked,
        };
    }

    async function saveNecessity(event) {
        event.preventDefault();
        const payload = collectPayload();
        if (!payload.name) {
            showMessage('Necessity name is required.', true);
            return;
        }

        try {
            const response = await fetch(addNecessityUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to save necessity');
            }

            form.reset();
            document.getElementById('necessity-cart-quantity').value = 1;
            document.getElementById('necessity-allow-substitutes').checked = true;
            document.getElementById('necessity-is-active').checked = true;
            showMessage('Necessity saved.', false);
            fetchNecessities();
        } catch (error) {
            console.error(error);
            showMessage(error.message || 'Failed to save necessity', true);
        }
    }

    function showMessage(message, isError) {
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

    form.addEventListener('submit', saveNecessity);
    fetchNecessities();
});
