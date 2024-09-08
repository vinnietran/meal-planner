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
            weekDays.push(`${dayName}`);
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

        addLunchCopyLogic(); // Add the event listeners for lunch columns
        addUrlDetection(); // Add URL detection to all lunch and dinner cells
    }

    clearWeekButton.addEventListener('click', function() {
        mealTable.querySelectorAll('td[contenteditable]').forEach(cell => cell.textContent = '');
    });

    generateTable();

    const saveButton = document.getElementById('save-week');
    const apiUrl = 'https://script.google.com/macros/s/AKfycbyWV-bYxWJwg4O9QzL2CFqEBHQ72XPPUm_7AJIjrGLNJBJFor-G_AQC29O9hLFN2nK-/exec'; // Replace with your Apps Script URL

    function loadMealPlan() {
        fetch(apiUrl, { mode: "cors" })
            .then(response => response.json())
            .then(data => updateTable(data))
            .catch(error => console.error('Error loading meal plan:', error));
    }

    function updateTable(data) {
        const rows = mealTable.rows;
        data.forEach((row, index) => {
            if (rows) {
                rows[index].cells[1].textContent = row.lunch; // Lunch
                rows[index].cells[2].textContent = row.dinner; // Dinner
            }
        });
    }

    function saveMealPlan() {
        const data = Array.from(mealTable.rows).map(row => {
            return {
                lunch: row.cells[1].textContent,
                dinner: row.cells[2].textContent
            }
        });

        fetch(apiUrl, {
            method: 'POST',
            mode: "no-cors",
            contentType: "application/json",
            body: JSON.stringify(data)
        })
        .then(response => response.text())
        .then(result => showConfirmationMessage("Meal plan saved successfully!"))
        .catch(error => console.error('Error saving meal plan:', error));
    }

    saveButton.addEventListener('click', saveMealPlan);
    loadMealPlan();

    function showConfirmationMessage(message) {
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';
    
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 3000);
    }

    // Function to copy lunch entries from Monday to Wednesday/Friday and from Tuesday to Thursday
    function addLunchCopyLogic() {
        const rows = Array.from(mealTable.rows);

        // Listen for changes in Monday's lunch
        const mondayLunchCell = rows[0].cells[1]; // Monday is row 0, lunch is column 1
        mondayLunchCell.addEventListener('input', function() {
            const wednesdayLunchCell = rows[2].cells[1]; // Wednesday is row 2
            const fridayLunchCell = rows[4].cells[1]; // Friday is row 4
            wednesdayLunchCell.textContent = mondayLunchCell.textContent;
            fridayLunchCell.textContent = mondayLunchCell.textContent;
        });

        // Listen for changes in Tuesday's lunch
        const tuesdayLunchCell = rows[1].cells[1]; // Tuesday is row 1, lunch is column 1
        tuesdayLunchCell.addEventListener('input', function() {
            const thursdayLunchCell = rows[3].cells[1]; // Thursday is row 3
            thursdayLunchCell.textContent = tuesdayLunchCell.textContent;
        });
    }

    // Function to detect and format URLs in lunch and dinner columns
    function addUrlDetection() {
        const rows = Array.from(mealTable.rows);
        
        rows.forEach(row => {
            const lunchCell = row.cells[1];
            const dinnerCell = row.cells[2];

            lunchCell.addEventListener('blur', function() {
                formatUrlIfPresent(lunchCell);
            });

            dinnerCell.addEventListener('blur', function() {
                formatUrlIfPresent(dinnerCell);
            });
        });
    }

    // Function to format the text as a hyperlink if a URL is detected
    function formatUrlIfPresent(cell) {
        const urlPattern = new RegExp('^(https?:\\/\\/)?' + // protocol
            '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.?)+[a-z]{2,}|' + // domain name
            '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
            '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
            '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
            '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
        
        const text = cell.textContent.trim();

        if (urlPattern.test(text)) {
            cell.innerHTML = `<a href="${text.startsWith('http') ? text : 'http://' + text}" target="_blank">${text}</a>`;
        }
    }
});
