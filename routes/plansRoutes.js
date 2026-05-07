const express = require("express");
const routes = express.Router();
const { pool } = require("../db");

routes.get("/plans", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  try {
    const result = await pool.query(
      "SELECT plan_id, plan_name, start_date, end_date FROM meal_plans WHERE user_id = $1 ORDER BY start_date DESC",
      [userId] // ИСПРАВЛЕНО
    );
    res.render("meal_plans", { plans: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка сервера при загрузке планов.");
  }
});

// --- Б. Роут для создания нового плана (POST) ---
// app.post("/api/plans/new", ...)
routes.post("/plans/new", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).send("Необходима авторизация.");

  const { plan_name, start_date, end_date } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO Meal_Plans (user_id, plan_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING plan_id",
      [userId, plan_name, start_date, end_date] // ИСПРАВЛЕНО
    );
    res.redirect(`/api/plans/${result.rows[0].plan_id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при создании плана.");
  }
});

// --- В. Роут для просмотра деталей плана и добавления блюд ---
// app.get("/api/plans/:planId", ...)
routes.get("/plans/:planId", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  const planId = req.params.planId;
  try {
    // 1. Получаем детали плана
    const planResult = await pool.query(
      "SELECT * FROM Meal_Plans WHERE plan_id = $1 AND user_id = $2",
      [planId, userId] // ИСПРАВЛЕНО
    );
    if (planResult.rowCount === 0)
      return res.status(404).send("План не найден."); // 2. Получаем все блюда, привязанные к плану

    const mealsResult = await pool.query(
      `
            SELECT pm.plan_meal_id, pm.meal_date, pm.meal_type, r.title, r.recipe_id, pm.is_cooked
            FROM Plan_Meals pm
            JOIN Recipes r ON pm.recipe_id = r.recipe_id
            WHERE pm.plan_id = $1
            ORDER BY pm.meal_date, pm.meal_type
        `,
      [planId]
    ); // 3. Получаем список всех доступных рецептов для формы

    const recipesResult = await pool.query(
      "SELECT recipe_id, title FROM Recipes WHERE user_id = $1 OR user_id IS NULL ORDER BY title",
      [userId] // ИСПРАВЛЕНО
    );

    res.render("new_plan", {
      plan: planResult.rows[0],
      meals: mealsResult.rows,
      allRecipes: recipesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при загрузке деталей плана.");
  }
});

// --- Г. Роут для добавления блюда в план (POST) ---
routes.post("/plans/add_meal", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).send("Необходима авторизация.");

  const { plan_id, recipe_id, meal_date, meal_type } = req.body;
  try {
    // Проверка, что план принадлежит пользователю и получение дат
    const planResult = await pool.query("SELECT start_date, end_date FROM Meal_Plans WHERE plan_id = $1 AND user_id = $2", [plan_id, userId]);
    if (planResult.rowCount === 0) return res.status(404).send("План не найден или доступ запрещен.");

    const plan = planResult.rows[0];
    const mealDateObj = new Date(meal_date);
    
    // Сбрасываем время для корректного сравнения (игнорируя часы)
    const mealDateStr = mealDateObj.toISOString().split('T')[0];
    const startStr = plan.start_date.toISOString().split('T')[0];
    const endStr = plan.end_date.toISOString().split('T')[0];

    if (mealDateStr < startStr || mealDateStr > endStr) {
        return res.status(400).send(`Дата должна быть между ${startStr} и ${endStr}.`);
    }

    await pool.query(
      "INSERT INTO Plan_Meals (plan_id, recipe_id, meal_type, meal_date) VALUES ($1, $2, $3, $4)",
      [plan_id, recipe_id, meal_type, meal_date]
    );
    res.redirect(`/api/plans/${plan_id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при добавлении блюда.");
  }
});

// --- Г.1 Роут для приготовления блюда (вычитание из инвентаря) ---
routes.post("/plans/cook_meal", async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Необходима авторизация." });
    
    const { plan_meal_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        
        // 1. Проверяем принадлежность плана и статус блюда
        const mealResult = await client.query(`
            SELECT pm.recipe_id, pm.is_cooked
            FROM Plan_Meals pm
            JOIN Meal_Plans mp ON pm.plan_id = mp.plan_id
            WHERE pm.plan_meal_id = $1 AND mp.user_id = $2
        `, [plan_meal_id, userId]);

        if (mealResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Блюдо в плане не найдено." });
        }

        const meal = mealResult.rows[0];
        if (meal.is_cooked) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Блюдо уже приготовлено." });
        }

        // 2. Получаем ингредиенты рецепта
        const ingredientsResult = await client.query(`
            SELECT ingredient_id, quantity
            FROM Recipe_Ingredients
            WHERE recipe_id = $1
        `, [meal.recipe_id]);

        // 3. Проверяем наличие достаточного количества ингредиентов
        for (const item of ingredientsResult.rows) {
            const invResult = await client.query(`
                SELECT quantity FROM User_Inventory WHERE user_id = $1 AND ingredient_id = $2
            `, [userId, item.ingredient_id]);
            
            const available = invResult.rowCount > 0 ? parseFloat(invResult.rows[0].quantity) : 0;
            const required = parseFloat(item.quantity);
            
            if (available < required) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Недостаточно ингредиентов в инвентаре для приготовления этого блюда." });
            }
        }

        // 4. Вычитаем из инвентаря
        for (const item of ingredientsResult.rows) {
            await client.query(`
                UPDATE User_Inventory
                SET quantity = quantity - $1
                WHERE user_id = $2 AND ingredient_id = $3
            `, [item.quantity, userId, item.ingredient_id]);
        }

        // 4. Отмечаем как приготовленное
        await client.query("UPDATE Plan_Meals SET is_cooked = TRUE WHERE plan_meal_id = $1", [plan_meal_id]);
        
        await client.query("COMMIT");
        res.json({ success: true, message: "Приготовлено! Ингредиенты списаны." });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Ошибка при приготовлении блюда:", err);
        res.status(500).json({ error: "Ошибка при приготовлении блюда." });
    } finally {
        client.release();
    }
});

// --- Д. Роут для генерации списка покупок (POST) ---
// app.post("/api/shopping_list/generate", ...)
routes.post("/shopping_list/generate", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).send("Необходима авторизация.");
  const { plan_id } = req.body;

  if (!plan_id || isNaN(parseInt(plan_id))) {
    return res.status(400).send("Неверный ID плана.");
  }

  try {
    // --- 1. ОЧИСТКА СТАРЫХ СПИСКОВ ДЛЯ ЭТОГО ПЛАНА ---
    const planIdentifier = `(ПЛАН ID: ${plan_id})`;
    const oldLists = await pool.query(
      "SELECT list_id FROM Shopping_Lists WHERE user_id = $1 AND list_name LIKE $2",
      [userId, `%${planIdentifier}`] // ИСПРАВЛЕНО
    );

    if (oldLists.rows.length > 0) {
      const oldListIds = oldLists.rows.map((row) => row.list_id);
      await pool.query(
        "DELETE FROM Shopping_Lists WHERE list_id = ANY($1::int[])",
        [oldListIds]
      );
      console.log(
        `Удалено ${oldListIds.length} старых списков покупок для плана ID: ${plan_id}.`
      );
    } // --- 2. ВЫЧИСЛЕНИЕ ---

    const diffResult = await pool.query(
      `
            WITH Required_Ingredients AS (
                SELECT ri.ingredient_id, i.name AS ingredient_name, i.unit_of_measure, SUM(ri.quantity) AS total_needed
                FROM Plan_Meals pm
                JOIN Recipe_Ingredients ri ON pm.recipe_id = ri.recipe_id
                JOIN Ingredients i ON ri.ingredient_id = i.ingredient_id
                WHERE pm.plan_id = $1 AND pm.is_cooked = FALSE
                GROUP BY ri.ingredient_id, i.name, i.unit_of_measure
            ),
            Inventory AS (
                SELECT ingredient_id, SUM(quantity) AS total_stocked
                FROM User_Inventory
                WHERE user_id = $2
                GROUP BY ingredient_id
            )
            SELECT
                ri.ingredient_id,
                ri.ingredient_name,
                ri.unit_of_measure,
                (ri.total_needed - COALESCE(inv.total_stocked, 0)) AS quantity_to_buy
            FROM Required_Ingredients ri
            LEFT JOIN Inventory inv ON ri.ingredient_id = inv.ingredient_id
            WHERE (ri.total_needed - COALESCE(inv.total_stocked, 0)) > 0
            ORDER BY ri.ingredient_name
            `,
      [plan_id, userId] // ИСПРАВЛЕНО
    );

    const itemsToBuy = diffResult.rows;

    if (itemsToBuy.length === 0) {
      return res.redirect(
        `/api/plans/${plan_id}?message=Все ингредиенты уже есть в инвентаре!`
      );
    } // --- 3. СОЗДАНИЕ НОВОГО ЗАГОЛОВКА С УНИКАЛЬНЫМ ИМЕНЕМ ---

    const planNameResult = await pool.query(
      "SELECT plan_name FROM Meal_Plans WHERE plan_id = $1",
      [plan_id]
    );

    const planTitle = planNameResult.rows[0].plan_name;
    const listName = `Покупки для плана: ${planTitle} ${planIdentifier}`;

    const listResult = await pool.query(
      "INSERT INTO Shopping_Lists (user_id, list_name) VALUES ($1, $2) RETURNING list_id",
      [userId, listName] // ИСПРАВЛЕНО
    );
    const listId = listResult.rows[0].list_id; // 4. Добавление элементов списка покупок

    const itemInserts = itemsToBuy.map((item) =>
      pool.query(
        "INSERT INTO Shopping_List_Items (list_id, ingredient_id, item_name, quantity, unit_of_measure) VALUES ($1, $2, $3, $4, $5)",
        [
          listId,
          item.ingredient_id,
          item.ingredient_name,
          item.quantity_to_buy,
          item.unit_of_measure,
        ]
      )
    );

    await Promise.all(itemInserts); // 5. Перенаправление

    res.redirect(`/api/shopping_list/${listId}`);
  } catch (err) {
    console.error("Ошибка генерации списка покупок:", err);
    res.status(500).send("Ошибка при генерации списка покупок.");
  }
});

// --- Е. Роут для отображения списка покупок (Оставлен без изменений) ---
// app.get("/api/shopping_list/:listId", ...)
routes.get("/shopping_list/:listId", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");

  const listId = req.params.listId; // Проверка, чтобы избежать ошибки "неверный синтаксис для типа integer: "generate""

  if (isNaN(parseInt(listId))) {
    return res.status(400).send("Неверный ID списка покупок в URL.");
  }

  try {
    const listResult = await pool.query(
      "SELECT * FROM Shopping_Lists WHERE list_id = $1 AND user_id = $2",
      [listId, userId] // ИСПРАВЛЕНО
    );
    if (listResult.rowCount === 0)
      return res.status(404).send("Список покупок не найден.");

    const itemsResult = await pool.query(
      "SELECT * FROM Shopping_List_Items WHERE list_id = $1 ORDER BY item_name",
      [listId]
    );

    res.render("shopping_list", {
      list: listResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при загрузке списка покупок.");
  }
});

// --- Ж. Роут для удаления плана меню (DELETE) ---
routes.delete("/plans/:planId", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId)
    return res.status(401).json({ error: "Необходима авторизация." });

  const planId = req.params.planId;
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN"); // Начинаем транзакцию

    // 1. Проверяем, что план принадлежит пользователю
    const checkResult = await client.query(
      "SELECT plan_id FROM Meal_Plans WHERE plan_id = $1 AND user_id = $2",
      [planId, userId]
    );
    if (checkResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "План не найден или не принадлежит пользователю." });
    }

    // 2. Удаляем связанные блюда из плана (Plan_Meals)
    await client.query("DELETE FROM Plan_Meals WHERE plan_id = $1", [planId]);

    // 3. Удаляем связанные списки покупок (если были сгенерированы)
    const planIdentifier = `(ПЛАН ID: ${planId})`;
    const oldLists = await client.query(
      "SELECT list_id FROM Shopping_Lists WHERE user_id = $1 AND list_name LIKE $2",
      [userId, `%${planIdentifier}`]
    );

    if (oldLists.rows.length > 0) {
      const oldListIds = oldLists.rows.map((row) => row.list_id);
      // Предполагаем, что Shopping_List_Items удалятся каскадно, удаляем только заголовки списков
      await client.query(
        "DELETE FROM Shopping_Lists WHERE list_id = ANY($1::int[])",
        [oldListIds]
      );
      console.log(
        `Удалено ${oldListIds.length} старых списков покупок для плана ${planId}.`
      );
    }

    // 4. Удаляем сам план
    await client.query("DELETE FROM Meal_Plans WHERE plan_id = $1", [planId]);

    await client.query("COMMIT"); // Завершаем транзакцию
    res.json({ message: "План меню успешно удален." });
  } catch (err) {
    if (client) await client.query("ROLLBACK"); // Откатываем в случае ошибки
    console.error("Ошибка транзакции при удалении плана:", err);
    res.status(500).json({ error: "Ошибка транзакции при удалении плана." });
  } finally {
    if (client) client.release();
  }
});

// --- З. Роут для удаления блюда из плана (DELETE) ---
routes.delete("/plans/remove_meal/:planMealId", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId)
    return res.status(401).json({ error: "Необходима авторизация." });

  const planMealId = req.params.planMealId;
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN"); // Начинаем транзакцию

    // 1. Получаем ID плана и проверяем его принадлежность пользователю (JOIN)
    const checkResult = await client.query(
      `
            SELECT mp.plan_id
            FROM Plan_Meals pm
            JOIN Meal_Plans mp ON pm.plan_id = mp.plan_id
            WHERE pm.plan_meal_id = $1 AND mp.user_id = $2
            `,
      [planMealId, userId]
    );

    if (checkResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Блюдо не найдено или план не принадлежит пользователю.",
      });
    }

    // 2. Удаляем блюдо из плана
    await client.query("DELETE FROM Plan_Meals WHERE plan_meal_id = $1", [
      planMealId,
    ]);

    await client.query("COMMIT"); // Завершаем транзакцию
    res.json({ message: "Блюдо успешно удалено из плана." });
  } catch (err) {
    if (client) await client.query("ROLLBACK"); // Откатываем в случае ошибки
    console.error("Ошибка транзакции при удалении блюда из плана:", err);
    res
      .status(500)
      .json({ error: "Ошибка сервера при удалении блюда из плана." });
  } finally {
    if (client) client.release();
  }
});

module.exports = routes;
