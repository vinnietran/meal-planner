(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }

    root.GroceryListUtils = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_MEAL_FIELDS = [
        'momLunch',
        'cenzoBreakfast',
        'cenzoLunch',
        'dinner',
    ];

    function normalizeText(value) {
        return String(value || '').trim();
    }

    function normalizeIngredientItem(rawItem) {
        if (typeof rawItem === 'string') {
            const name = normalizeText(rawItem);
            if (!name) return null;

            return {
                name,
                quantity: '',
                unit: '',
                preparation: '',
                cartQuery: name,
                cartQuantity: 1,
                preferredBrand: '',
                preferredSize: '',
                department: '',
                allowSubstitutes: true,
                notes: '',
            };
        }

        if (!rawItem || typeof rawItem !== 'object') {
            return null;
        }

        const name = normalizeText(rawItem.name || rawItem.displayName || rawItem.ingredient);
        if (!name) return null;

        const cartQuantity = Number.parseInt(rawItem.cartQuantity ?? rawItem.count, 10);
        return {
            name,
            quantity: normalizeText(rawItem.quantity),
            unit: normalizeText(rawItem.unit),
            preparation: normalizeText(rawItem.preparation),
            cartQuery: normalizeText(rawItem.cartQuery || rawItem.searchQuery || rawItem.query) || name,
            cartQuantity: Number.isFinite(cartQuantity) && cartQuantity > 0 ? cartQuantity : 1,
            preferredBrand: normalizeText(rawItem.preferredBrand),
            preferredSize: normalizeText(rawItem.preferredSize),
            department: normalizeText(rawItem.department),
            allowSubstitutes: rawItem.allowSubstitutes !== false,
            notes: normalizeText(rawItem.notes),
        };
    }

    function getMealIngredientItems(meal) {
        if (!meal || typeof meal !== 'object') return [];

        if (Array.isArray(meal.ingredientItems) && meal.ingredientItems.length) {
            return meal.ingredientItems
                .map(normalizeIngredientItem)
                .filter(Boolean);
        }

        if (Array.isArray(meal.ingredients)) {
            return meal.ingredients
                .map(normalizeIngredientItem)
                .filter(Boolean);
        }

        return [];
    }

    function buildMealLookup(meals) {
        const lookup = new Map();
        (Array.isArray(meals) ? meals : []).forEach((meal) => {
            const mealName = normalizeText(meal && meal.name);
            if (!mealName) return;
            lookup.set(mealName, meal);
        });
        return lookup;
    }

    function buildAutomationQuery(item) {
        return [
            normalizeText(item.cartQuery || item.query || item.name),
            normalizeText(item.preferredBrand),
            normalizeText(item.preferredSize),
        ].filter(Boolean).join(' ');
    }

    function buildAggregationKey(item) {
        return [
            normalizeText(item.cartQuery || item.query || item.name).toLowerCase(),
            normalizeText(item.preferredBrand).toLowerCase(),
            normalizeText(item.preferredSize).toLowerCase(),
            normalizeText(item.department).toLowerCase(),
            normalizeText(item.notes).toLowerCase(),
            item.allowSubstitutes === false ? 'exact' : 'sub-ok',
        ].join('::');
    }

    function aggregateCartItems(items) {
        const aggregatedItems = new Map();

        (Array.isArray(items) ? items : []).forEach((rawItem) => {
            const item = normalizeIngredientItem(rawItem);
            if (!item) return;

            const key = buildAggregationKey(item);
            const existing = aggregatedItems.get(key) || {
                name: item.name,
                count: 0,
                query: item.cartQuery || item.name,
                searchText: buildAutomationQuery(item),
                preferredBrand: item.preferredBrand,
                preferredSize: item.preferredSize,
                department: item.department,
                allowSubstitutes: item.allowSubstitutes,
                notes: item.notes,
            };

            existing.count += item.cartQuantity || 1;
            aggregatedItems.set(key, existing);
        });

        return Array.from(aggregatedItems.values())
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    function buildGroceryList(mealPlan, meals, fields = DEFAULT_MEAL_FIELDS) {
        const mealLookup = buildMealLookup(meals);
        const rawItems = [];

        (Array.isArray(mealPlan) ? mealPlan : []).forEach((day) => {
            const mealNames = fields === DEFAULT_MEAL_FIELDS
                ? [
                    day && (day.momLunch || day.lunch),
                    day && day.cenzoBreakfast,
                    day && day.cenzoLunch,
                    day && (day.dinner || day.momDinner || day.cenzoDinner || day.Cenzo),
                ]
                : fields.map((field) => day && day[field]);

            mealNames.forEach((value) => {
                const mealName = normalizeText(value);
                if (!mealName) return;

                const meal = mealLookup.get(mealName);
                getMealIngredientItems(meal).forEach((ingredient) => {
                    rawItems.push(ingredient);
                });
            });
        });

        return aggregateCartItems(rawItems);
    }

    function buildNecessityList(necessities) {
        return aggregateCartItems(
            (Array.isArray(necessities) ? necessities : [])
                .filter((item) => item && item.isActive !== false && item.includeInCart !== false)
        );
    }

    function mergeCartLists(lists) {
        const rawItems = [];
        (Array.isArray(lists) ? lists : []).forEach((list) => {
            (Array.isArray(list) ? list : []).forEach((item) => {
                if (!item) return;
                rawItems.push({
                    name: item.name,
                    cartQuery: item.query || item.cartQuery || item.name,
                    cartQuantity: item.count || item.cartQuantity || 1,
                    preferredBrand: item.preferredBrand,
                    preferredSize: item.preferredSize,
                    department: item.department,
                    allowSubstitutes: item.allowSubstitutes,
                    notes: item.notes,
                });
            });
        });
        return aggregateCartItems(rawItems);
    }

    function buildItemLabel(item) {
        const metadata = [
            normalizeText(item.preferredBrand),
            normalizeText(item.preferredSize),
        ].filter(Boolean).join(', ');

        return metadata
            ? `${item.name} x${item.count} (${metadata})`
            : `${item.name} x${item.count}`;
    }

    function buildClipboardText(items) {
        return (Array.isArray(items) ? items : [])
            .map((item) => buildItemLabel(item))
            .join('\n');
    }

    function buildExportPayload(items) {
        return {
            generatedAt: new Date().toISOString(),
            source: 'meal-planner',
            itemCount: Array.isArray(items) ? items.length : 0,
            items: Array.isArray(items) ? items : [],
        };
    }

    return {
        DEFAULT_MEAL_FIELDS,
        buildAutomationQuery,
        buildClipboardText,
        buildExportPayload,
        buildNecessityList,
        buildGroceryList,
        buildItemLabel,
        getMealIngredientItems,
        mergeCartLists,
        normalizeIngredientItem,
    };
}));
