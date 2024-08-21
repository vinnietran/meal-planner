document.addEventListener('DOMContentLoaded', function() {
    const mealTable = document.getElementById('meal-table').querySelector('tbody');
    const clearWeekButton = document.getElementById('clear-week');

    function formatDate(date) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
    }

    function getDayName(date) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    function getCurrentWeek() {
        const currentDate = new Date();
        const dayOfWeek = currentDate.getDay();
        const monday = new Date(currentDate.setDate(currentDate.getDate() - dayOfWeek + 1));

        const weekDays = [];
        for (let i = 0; i < 7; i++) {
            let day = new Date(monday);
            day.setDate(monday.getDate() + i);
            const formattedDate = formatDate(day);
            const dayName = getDayName(day);
            weekDays.push(`${formattedDate} - ${dayName}`);
        }
        return weekDays;
    }

    function generateTable() {
        const weekDays = getCurrentWeek();
        mealTable.innerHTML = ''; // Clear existing rows

        weekDays.forEach(day => {
            const row = document.createElement('tr');

            const dateCell = document.createElement('td');
            dateCell.textContent = day;
            row.appendChild(dateCell);

            const lunchCell = document.createElement('td');
            lunchCell.setAttribute('contenteditable', 'true');
            row.appendChild(lunchCell);

            const dinnerCell = document.createElement('td');
            dinnerCell.setAttribute('contenteditable', 'true');
            row.appendChild(dinnerCell);

            mealTable.appendChild(row);
        });
    }

    clearWeekButton.addEventListener('click', function() {
        mealTable.querySelectorAll('td[contenteditable]').forEach(cell => cell.textContent = '');
        // Add logic to clear the Google Sheet
    });

    generateTable();

    const saveButton = document.getElementById('save-week');
    const apiUrl = 'https://script.google.com/macros/s/AKfycbyrn2n0m2CIbvCLTngM5-PeKEnonF11Ck_qMmmJMQeRMUxLE2cL10ZBObYnKdeIoagR/exec'; // Replace with your Apps Script URL

    function loadMealPlan() {
        console.log('Loading meal plan...');
        fetch(apiUrl, {
            mode: "cors"
        })
            .then(response => response.json())
            .then(data => {
                console.log('Meal plan loaded');
                console.log(data);
                updateTable(data);
            })
            .catch(error => console.error('Error loading meal plan:', error));
    }

    function updateTable(data) {
        // Assumes data is in the same order as the table rows
        const rows = mealTable.rows;

        data.forEach((row, index) => {
            console.log(row);
            console.log(index);
            if (rows) {
                // Only update Lunch and Dinner columns (assumed to be the 2nd and 3rd cells)
                rows[index].cells[1].textContent = row[0]; // Lunch
                rows[index].cells[2].textContent = row[1]; // Dinner
            }
        });
    }

    function saveMealPlan() {
        const data = Array.from(mealTable.rows).map(row => {
            // Only send Lunch and Dinner data to the server
            return [
                row.cells[0].textContent, // Date (this will remain unchanged on the server)
                row.cells[1].textContent, // Lunch
                row.cells[2].textContent  // Dinner
            ];
        });

        fetch(apiUrl, {
            method: 'POST',
            contentType: "application/json",
            body: JSON.stringify(data)
        })
        .then(response => response.text())
        .then(result => {
            console.log('Meal plan saved:', result);
        })
        .catch(error => console.error('Error saving meal plan:', error));
    }

    saveButton.addEventListener('click', saveMealPlan);

    loadMealPlan();
});

//https://script.google.com/macros/s/AKfycby69G_2EaMBUHSrY2FVq8Xhcngll8NdmwxjcqP4hGn_gmLRiRvUiromeb5jWROwIKZH/exec