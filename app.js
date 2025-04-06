document.addEventListener('DOMContentLoaded', function() {
    const mealTable = document.getElementById('meal-table').querySelector('tbody');
    const mealSearch = document.getElementById('meal-search');
    const mealSuggestions = document.getElementById('meal-suggestions');
    const clearWeekButton = document.getElementById('clear-week');
    const saveButton = document.getElementById('save-week');
    const apiUrl = 'https://script.google.com/macros/s/AKfycbxQFuB_PQ43mj86SkfveF6se8anpocPUMOPxV2uUii0d7ipJVdFtvmiq6fLKJ7-K_rKcw/exec'; 
    let meals = [];
    let mealPlan = [];

    async function fetchMeals() {
        try {
            const mealPlanResponse = await fetch(`${apiUrl}?action=getMeals`, {mode: 'cors'});
            mealPlan = await mealPlanResponse.json();
            console.log('Meal plan fetched:', mealPlan);

            console.log('Fetching meals...');
            const response = await fetch(apiUrl, { mode: "cors" });
            meals = await response.json();
            console.log('Meals fetched:', meals);
            localStorage.setItem('mealList', JSON.stringify(meals));

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
            // Trigger meal search on double-click, allowing free text input on single click
            lunchCell.addEventListener('dblclick', () => openMealSearch(lunchCell));
            row.appendChild(lunchCell);

            const dinnerCell = document.createElement('td');
            dinnerCell.setAttribute('contenteditable', 'true');
            // Trigger meal search on double-click, allowing free text input on single click
            dinnerCell.addEventListener('dblclick', () => openMealSearch(dinnerCell));
            row.appendChild(dinnerCell);

            const cenzoCell = document.createElement('td');
            cenzoCell.setAttribute('contenteditable', 'true');
            row.appendChild(cenzoCell);

            mealTable.appendChild(row);
        });
    }

    function populateTableWithMealPlan() {
        const rows = mealTable.rows;
        const storedMeals = JSON.parse(localStorage.getItem('mealList')) || [];
    
        mealPlan.forEach((meal, index) => {
            if (rows[index]) {
                // Find the matching lunch meal from stored meals
                const lunchMeal = storedMeals.find(item => item.name === meal.lunch);
                const lunchDisplay = lunchMeal ? `${meal.lunch}<br><small>${lunchMeal.sides}</small>` : meal.lunch || '';
    
                // Find the matching dinner meal from stored meals
                const dinnerMeal = storedMeals.find(item => item.name === meal.dinner);
                const dinnerDisplay = dinnerMeal ? `${meal.dinner}<br><small>${dinnerMeal.sides}</small>` : meal.dinner || '';
    
                rows[index].cells[1].innerHTML = lunchDisplay;
                rows[index].cells[2].innerHTML = dinnerDisplay;

                if (rows[index].cells.length > 3) {
                    rows[index].cells[3].textContent = meal.Cenzo || '';
                }
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
            dinner: row.cells[2].textContent,
            Cenzo: row.cells[3].textContent
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
