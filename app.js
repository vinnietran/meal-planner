document.addEventListener('DOMContentLoaded', function() {
    const mealTable = document.getElementById('meal-table').querySelector('tbody');
    const mealSearch = document.getElementById('meal-search');
    const mealSuggestions = document.getElementById('meal-suggestions');
    const clearWeekButton = document.getElementById('clear-week');
    const saveButton = document.getElementById('save-week');
    const apiUrl = 'https://script.google.com/macros/s/AKfycbzokXx-NyG0Ufr4aHVyufSTq0HbL6-_eJjohu27OZKPjY4j9NdZ0HLe7HkD6fu4u4N-Eg/exec'; 
    let meals = [];
    let mealPlan = [];

    async function fetchMeals() {
        try {
            console.log('Fetching meals...');
            const response = await fetch(apiUrl, { mode: "cors" });
            meals = await response.json();
            console.log('Meals fetched:', meals);
            localStorage.setItem('mealList', JSON.stringify(meals));

            const mealPlanResponse = await fetch(`${apiUrl}?action=getMeals`, {mode: 'cors'});
            mealPlan = await mealPlanResponse.json();
            console.log('Meal plan fetched:', mealPlan);

            populateTableWithMealPlan();
        } catch (error) {
            console.error('Error fetching meals:', error);
            meals = JSON.parse(localStorage.getItem('mealList')) || [];
        }
    }

    function generateTable() {
        const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        mealTable.innerHTML = '';

        weekDays.forEach((day, index) => {
            const row = document.createElement('tr');

            const dateCell = document.createElement('td');
            dateCell.textContent = day;
            row.appendChild(dateCell);

            const lunchCell = document.createElement('td');
            lunchCell.setAttribute('contenteditable', 'true');
            lunchCell.addEventListener('focus', () => openMealSearch(lunchCell));
            row.appendChild(lunchCell);

            const dinnerCell = document.createElement('td');
            dinnerCell.setAttribute('contenteditable', 'true');
            dinnerCell.addEventListener('focus', () => openMealSearch(dinnerCell));
            row.appendChild(dinnerCell);

            mealTable.appendChild(row);
        });
    }

    function populateTableWithMealPlan() {
        const rows = mealTable.rows;
        mealPlan.forEach((meal, index) => {
            if (rows[index]) {
                rows[index].cells[1].textContent = meal.lunch || '';
                rows[index].cells[2].textContent = meal.dinner || '';
            }
        });
    }

    function openMealSearch(cell) {
        mealSearch.style.display = 'block';
        mealSearch.focus();
        mealSearch.oninput = function () {
            showSuggestions(mealSearch.value, cell);
        };
        mealSearch.onblur = function () {
            setTimeout(() => {
                mealSuggestions.style.display = 'none';
                mealSearch.style.display = 'none';
            }, 200);
        };
    }

    function showSuggestions(query, cell) {
        mealSuggestions.innerHTML = '';
        if (!query) return;

        const filteredMeals = meals.filter(meal => meal.name.toLowerCase().includes(query.toLowerCase()));
        filteredMeals.forEach(meal => {
            const suggestion = document.createElement('div');
            suggestion.textContent = meal.name;
            suggestion.classList.add('suggestion-item');
            suggestion.onclick = () => {
                cell.textContent = meal.name;
                mealSuggestions.innerHTML = '';
                mealSearch.value = '';
                mealSearch.style.display = 'none';
            };
            mealSuggestions.appendChild(suggestion);
        });
        mealSuggestions.style.display = 'block';
    }

    function saveMealPlan() {
        const data = Array.from(mealTable.rows).map(row => ({
            lunch: row.cells[1].textContent,
            dinner: row.cells[2].textContent
        }));

        fetch(`${apiUrl}?action=saveMeals`, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'saveMeals', data })
        })
        .then(() => showConfirmationMessage('Meal plan saved successfully!'))
        .catch(error => console.error('Error saving meal plan:', error));
    }

    function showConfirmationMessage(message) {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';

        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 3000);
    }

    clearWeekButton.addEventListener('click', function() {
        mealTable.querySelectorAll('td[contenteditable]').forEach(cell => cell.textContent = '');
    });

    saveButton.addEventListener('click', saveMealPlan);
    generateTable();
    fetchMeals();
});
