const express = require("express");
const routes = express.Router();
const { pool } = require("../db");

// ВНИМАНИЕ: Для реальной работы замените заглушку mockAdaptedRecipe
// на вызов вашей функции, интегрирующей LLM (например, OpenAI или Gemini).
// const { adaptRecipeWithAI } = require('../ai-service/adaptator');

// Отображение списка всех рецептов (WEB VIEW)
routes.get("/", async (req, res) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  try {
    const query =
      "SELECT recipe_id AS id, title, description, created_at FROM recipes WHERE user_id = $1 ORDER BY created_at DESC";

    const result = await pool.query(query, [userId]);

    res.render("recipes_list", {
      title: "Список Всех Рецептов",
      recipes: result.rows,
    });
  } catch (error) {
    console.error("Ошибка при отображении списка рецептов:", error);
    res.status(500).send("Ошибка сервера при получении списка рецептов");
  }
});

routes.get("/available", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }

  // сложный SQL-запрос, имитирующий логику C. Поиск по Запасам.
  // Он находит все рецепты, для которых *нет* недостающих ингредиентов в инвентаре пользователя.
  try {
    const availableRecipesQuery = `
            SELECT r.recipe_id, r.title, r.instructions
            FROM Recipes r
            WHERE NOT EXISTS (
                SELECT ri.ingredient_id
                FROM Recipe_Ingredients ri
                LEFT JOIN User_Inventory ui
                    ON ui.ingredient_id = ri.ingredient_id AND ui.user_id = $1
                WHERE ri.recipe_id = r.recipe_id
                AND (ui.quantity IS NULL OR ui.quantity < ri.quantity OR ui.best_before_date < CURRENT_DATE)
            );
        `;
    const result = await pool.query(availableRecipesQuery, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при поиске доступных рецептов:", err);
    res
      .status(500)
      .json({ error: "Ошибка сервера при поиске доступных рецептов" });
  }
});

// Форма создания нового рецепта (WEB VIEW)
routes.get("/new", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");
  try {
    const ingredients = await pool.query(
      "SELECT ingredient_id AS id, name, unit_of_measure AS default_unit FROM ingredients ORDER BY name"
    );

    res.render("recipes_new", {
      title: "Создать Новый Рецепт",
      availableIngredients: ingredients.rows,
      userId: userId,
    });
  } catch (error) {
    console.error("Ошибка при загрузке формы:", error);
    res.status(500).send("Ошибка сервера при загрузке ингредиентов");
  }
});

// Создание нового рецепта (API)
routes.post("/", async (req, res) => {
  const {
    title,
    description,
    instructions,
    prep_time,
    cook_time,
    servings,
    ingredients,
  } = req.body;

  const userId = req.session.userId;

  if (
    !title ||
    !instructions ||
    !Array.isArray(ingredients) ||
    ingredients.length === 0
  ) {
    return res.status(400).json({ error: "Отсутствуют обязательные поля." });
  }

  try {
    const query =
      "INSERT INTO recipes (user_id, title, description, instructions, prep_time_min, cook_time_min, servings) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING recipe_id AS id";
    const recipeResult = await pool.query(query, [
      userId,
      title,
      description,
      instructions,
      prep_time,
      cook_time,
      servings,
    ]);

    const recipeId = recipeResult.rows[0].id; // Вставка связанных ингредиентов

    for (const item of ingredients) {
      const ingredientId = parseInt(item.ingredient_id);
      const quantity = parseFloat(item.quantity);

      if (isNaN(ingredientId) || isNaN(quantity) || quantity <= 0) {
        console.error(
          `Неверные данные ингредиента для рецепта ${recipeId}: ID ${item.ingredient_id} или количество ${item.quantity}.`
        );
        continue;
      }

      const query = `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, notes) 
                    VALUES ($1, $2, $3, $4)`;
      await pool.query(query, [
        recipeId,
        ingredientId,
        quantity,
        item.notes || "",
      ]);
    }

    return res.status(201).json({
      success: true,
      message: "Рецепт успешно создан.",
      recipe_id: recipeId,
    });
  } catch (error) {
    console.error("Ошибка транзакции при создании рецепта:", error);
    return res
      .status(500)
      .json({ success: false, error: "Ошибка сервера. Рецепт не сохранен." });
  }
});

// Получение деталей рецепта (API)
routes.get("/:id", async (req, res) => {
  const userId = req.session?.userId;
  const recipeId = parseInt(req.params.id);

  if (!userId) {
    return res
      .status(401)
      .json({ error: "Необходима авторизация для просмотра рецепта." });
  }

  if (isNaN(recipeId)) {
    return res.status(400).json({ error: "Неверный идентификатор рецепта." });
  }

  try {
    // 1. Получаем основные данные рецепта
    const recipeQuery = `
        SELECT
            r.recipe_id, r.title, r.description, r.instructions,
            r.prep_time_min, r.cook_time_min, r.servings, r.dietary_warning
        FROM recipes r
        WHERE r.recipe_id = $1 AND r.user_id = $2
    `;
    const recipeResult = await pool.query(recipeQuery, [recipeId, userId]);

    if (recipeResult.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Рецепт не найден или доступ запрещен." });
    }
    const recipe = recipeResult.rows[0]; // 2. Получаем ингредиенты для этого рецепта

    const ingredientsQuery = `
        SELECT
            ri.quantity, ri.notes, i.name AS ingredient_name, i.unit_of_measure AS unit_of_measure
        FROM recipe_ingredients ri
        JOIN ingredients i ON ri.ingredient_id = i.ingredient_id
        WHERE ri.recipe_id = $1
    `;
    const ingredientsResult = await pool.query(ingredientsQuery, [recipeId]);
    recipe.ingredients = ingredientsResult.rows; // 3. Отправляем данные в формате JSON

    return res.status(200).json(recipe);
  } catch (error) {
    console.error("Ошибка при получении рецепта:", error);
    return res
      .status(500)
      .json({ error: "Ошибка сервера при загрузке рецепта." });
  }
});

// АДАПТАЦИЯ РЕЦЕПТА С ПОМОЩЬЮ ИИ (API)
routes.post("/ai/adapt/:recipeId", async (req, res) => {
  const userId = req.session?.userId;
  const recipeId = parseInt(req.params.recipeId);
  const { restriction } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  if (isNaN(recipeId) || !restriction) {
    return res.status(400).json({
      error: "Неверный ID рецепта или отсутствует диетическое ограничение.",
    });
  }

  try {
    // 1. Получаем оригинальный рецепт
    const recipeQuery = `
        SELECT
            r.recipe_id, r.title, r.description, r.instructions,
            r.prep_time_min, r.cook_time_min, r.servings
        FROM recipes r
        WHERE r.recipe_id = $1 AND r.user_id = $2
    `;
    const recipeResult = await pool.query(recipeQuery, [recipeId, userId]);

    if (recipeResult.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Оригинальный рецепт не найден или доступ запрещен." });
    }
    const originalRecipe = recipeResult.rows[0]; // 2. Получаем ингредиенты

    const ingredientsQuery = `
        SELECT
            ri.quantity, i.unit_of_measure, i.name
        FROM recipe_ingredients ri
        JOIN ingredients i ON ri.ingredient_id = i.ingredient_id
        WHERE ri.recipe_id = $1
    `;
    const ingredientsResult = await pool.query(ingredientsQuery, [recipeId]);
    originalRecipe.ingredients = ingredientsResult.rows; // --- 3. Вызов функции адаптации ИИ (ЗАГЛУШКА!) --- // В реальном приложении замените этот мок на реальный вызов LLM.

    const mockAdaptedRecipe = {
      title: `${originalRecipe.title} (Адаптированный: ${restriction})`,
      description: `Адаптация оригинального рецепта с учетом ограничения: "${restriction}".`,
      instructions: `ИНСТРУКЦИИ ИИ: Теперь готовим по-другому, учитывая ограничение "${restriction}". 
Это тестовый ответ, который нужно заменить на вывод LLM.`,
      servings: originalRecipe.servings,
      prep_time_min: originalRecipe.prep_time_min,
      cook_time_min: originalRecipe.cook_time_min,
      ingredients: [
        { name: "Замена Ингредиента", quantity: 150, unit_of_measure: "г" },
        { name: "Новый Ингредиент", quantity: 1, unit_of_measure: "шт" },
      ],
    }; // 4. Отправляем адаптированный рецепт на фронтенд
    return res.status(200).json({
      restriction: restriction,
      adaptedRecipe: mockAdaptedRecipe,
    });
  } catch (error) {
    console.error("Ошибка при адаптации рецепта ИИ:", error);
    return res.status(500).json({
      error: "Ошибка сервера при обработке запроса ИИ.",
      details: error.message,
    });
  }
});

// Отображение страницы просмотра рецепта (WEB VIEW)
routes.get("/view/:id", async (req, res) => {
  const userId = req.session?.userId;
  const recipeId = parseInt(req.params.id);

  if (!userId) {
    return res.redirect("/login");
  }

  if (isNaN(recipeId)) {
    return res.status(400).send("Неверный идентификатор рецепта.");
  }

  try {
    const titleQuery =
      "SELECT title FROM recipes WHERE recipe_id = $1 AND user_id = $2";
    const titleResult = await pool.query(titleQuery, [recipeId, userId]);

    const title =
      titleResult.rows.length > 0
        ? titleResult.rows[0].title
        : "Рецепт не найден"; // ИСПРАВЛЕНО: Передача реального userId в шаблон

    res.render("recipe_view", {
      recipeId: recipeId,
      title: title,
      userId: userId,
    });
  } catch (error) {
    console.error("Ошибка при рендеринге страницы просмотра рецепта:", error);
    res.status(500).send("Ошибка сервера при загрузке страницы рецепта.");
  }
});

// Удаление рецепта (API)
routes.delete("/delete/:id", async (req, res) => {
  // Обновил путь на /delete/:id
  const userId = req.session?.userId;
  const recipeId = parseInt(req.params.id);
  // ... (Проверки авторизации и ID) ...

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Проверяем существование рецепта и принадлежность пользователю
    const checkQuery =
      "SELECT 1 FROM recipes WHERE recipe_id = $1 AND user_id = $2";
    const checkResult = await client.query(checkQuery, [recipeId, userId]);

    if (checkResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Рецепт не найден или доступ запрещен.",
      });
    }

    // =======================================================
    // НОВЫЙ ШАГ: Удаление ссылок из таблицы plan_meals
    // =======================================================
    const deletePlanMealsQuery = "DELETE FROM plan_meals WHERE recipe_id = $1";
    await client.query(deletePlanMealsQuery, [recipeId]);

    // 2. Удаление связанных ингредиентов (из таблицы recipe_ingredients)
    const deleteIngredientsQuery =
      "DELETE FROM recipe_ingredients WHERE recipe_id = $1";
    await client.query(deleteIngredientsQuery, [recipeId]);

    // 3. Удаление самого рецепта
    const deleteRecipeQuery =
      "DELETE FROM recipes WHERE recipe_id = $1 AND user_id = $2";
    await client.query(deleteRecipeQuery, [recipeId, userId]);

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Рецепт успешно удален вместе с планами питания.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка транзакции при удалении рецепта:", error);
    return res.status(500).json({
      success: false,
      error: "Ошибка сервера. Рецепт не удален.",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// Сохранение сгенерированного рецепта (API)
routes.post("/save_generated", async (req, res) => {
  const { recipe } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  if (
    !recipe ||
    !recipe.title ||
    !recipe.instructions ||
    !Array.isArray(recipe.ingredients)
  ) {
    return res.status(400).json({
      error:
        "Отсутствуют обязательные поля: title, instructions или ingredients.",
    });
  }

  const {
    title,
    description,
    instructions,
    prep_time_min,
    cook_time_min,
    servings,
  } = recipe;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertRecipeQuery = `
        INSERT INTO recipes (user_id, title, description, instructions, prep_time_min, cook_time_min, servings, dietary_warning) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING recipe_id AS id
      `;
    const recipeResult = await client.query(insertRecipeQuery, [
      userId,
      title,
      description || "Сгенерированный рецепт",
      instructions,
      prep_time_min || 0,
      cook_time_min || 0,
      servings || 1,
      recipe.dietary_warning || null,
    ]);

    const recipeId = recipeResult.rows[0].id;

    for (const item of recipe.ingredients) {
      // Поиск Ingredient ID по имени
      const ingredientSearchQuery =
        "SELECT ingredient_id FROM ingredients WHERE name = $1";
      let ingredientIdResult = await client.query(ingredientSearchQuery, [
        item.name,
      ]);

      let ingredientId;

      if (ingredientIdResult.rows.length === 0) {
        // Если ингредиента нет в базе, вставим его
        const insertIngredientQuery = `
            INSERT INTO ingredients (name, unit_of_measure) VALUES ($1, $2) 
            RETURNING ingredient_id
        `;
        const unitOfMeasure = item.unit_of_measure || "шт";
        ingredientIdResult = await client.query(insertIngredientQuery, [
          item.name,
          unitOfMeasure,
        ]);
        ingredientId = ingredientIdResult.rows[0].ingredient_id;
      } else {
        ingredientId = ingredientIdResult.rows[0].ingredient_id;
      }

      const insertRelationQuery = `
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, notes) 
            VALUES ($1, $2, $3, $4)
        `;
      await client.query(insertRelationQuery, [
        recipeId,
        ingredientId,
        parseFloat(item.quantity) || 0,
        item.notes || item.name,
      ]);
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Рецепт успешно сохранен в PostgreSQL.",
      id: recipeId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Ошибка сохранения сгенерированного рецепта в PostgreSQL:",
      error
    );

    return res.status(500).json({
      error: "Внутренняя ошибка сервера при сохранении рецепта.",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// Форма редактирования существующего рецепта (WEB VIEW)
routes.get("/edit/:id", async (req, res) => {
  const userId = req.session?.userId;
  const recipeId = parseInt(req.params.id);

  if (!userId) {
    return res.redirect("/login");
  }

  if (isNaN(recipeId)) {
    return res.status(400).send("Неверный идентификатор рецепта.");
  }

  try {
    // 1. Получаем детали рецепта (включая проверку принадлежности!)
    const recipeQuery = `
        SELECT recipe_id, title, description, instructions, prep_time_min, cook_time_min, servings
        FROM recipes 
        WHERE recipe_id = $1 AND user_id = $2
    `;
    const recipeResult = await pool.query(recipeQuery, [recipeId, userId]);

    if (recipeResult.rows.length === 0) {
      return res.status(404).send("Рецепт не найден или доступ запрещен.");
    }
    const recipeData = recipeResult.rows[0];

    // 2. Получаем текущие ингредиенты рецепта
    const currentIngredientsQuery = `
        SELECT ri.ingredient_id, ri.quantity, ri.notes, i.name AS ingredient_name, i.unit_of_measure
        FROM recipe_ingredients ri
        JOIN ingredients i ON ri.ingredient_id = i.ingredient_id
        WHERE ri.recipe_id = $1
    `;
    const currentIngredientsResult = await pool.query(currentIngredientsQuery, [
      recipeId,
    ]);
    recipeData.ingredients = currentIngredientsResult.rows;

    // 3. Получаем список всех доступных ингредиентов для формы
    const availableIngredients = await pool.query(
      "SELECT ingredient_id AS id, name, unit_of_measure AS default_unit FROM ingredients ORDER BY name"
    );

    res.render("recipes_edit", {
      title: `Редактирование: ${recipeData.title}`,
      recipe: recipeData,
      availableIngredients: availableIngredients.rows,
      userId: userId,
    });
  } catch (error) {
    console.error("Ошибка при загрузке формы редактирования:", error);
    res
      .status(500)
      .send("Ошибка сервера при загрузке данных для редактирования.");
  }
});

// Б. Роут PUT/PATCH: Сохранение изменений (API)
routes.put("/:id", async (req, res) => {
  const {
    title,
    description,
    instructions,
    prep_time,
    cook_time,
    servings,
    ingredients, // Массив новых/обновленных ингредиентов
  } = req.body;

  const userId = req.session.userId;
  const recipeId = parseInt(req.params.id);

  if (
    !title ||
    !instructions ||
    isNaN(recipeId) ||
    !Array.isArray(ingredients)
  ) {
    return res
      .status(400)
      .json({ error: "Отсутствуют обязательные поля или неверный ID." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Проверяем, существует ли рецепт и принадлежит ли он пользователю
    const checkQuery =
      "SELECT 1 FROM recipes WHERE recipe_id = $1 AND user_id = $2";
    const checkResult = await client.query(checkQuery, [recipeId, userId]);

    if (checkResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Рецепт не найден или доступ запрещен." });
    }

    // 2. Обновление основных данных рецепта
    const updateRecipeQuery = `
        UPDATE recipes SET 
            title = $1, description = $2, instructions = $3, 
            prep_time_min = $4, cook_time_min = $5, servings = $6
        WHERE recipe_id = $7 AND user_id = $8
      `;
    await client.query(updateRecipeQuery, [
      title,
      description,
      instructions,
      prep_time,
      cook_time,
      servings,
      recipeId,
      userId,
    ]);

    // 3. Удаление старых ингредиентов (проще удалить все и вставить заново)
    const deleteIngredientsQuery =
      "DELETE FROM recipe_ingredients WHERE recipe_id = $1";
    await client.query(deleteIngredientsQuery, [recipeId]);

    // 4. Вставка новых связанных ингредиентов
    for (const item of ingredients) {
      const ingredientId = parseInt(item.ingredient_id);
      const quantity = parseFloat(item.quantity);

      if (isNaN(ingredientId) || isNaN(quantity) || quantity <= 0) {
        console.warn(
          `Неверные данные ингредиента пропущены: ${item.ingredient_id} / ${item.quantity}`
        );
        continue;
      }

      const insertIngredientQuery = `
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, notes) 
            VALUES ($1, $2, $3, $4)
          `;
      await client.query(insertIngredientQuery, [
        recipeId,
        ingredientId,
        quantity,
        item.notes || "",
      ]);
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Рецепт успешно обновлен.",
      recipe_id: recipeId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка транзакции при обновлении рецепта:", error);
    return res
      .status(500)
      .json({ success: false, error: "Ошибка сервера. Рецепт не обновлен." });
  } finally {
    client.release();
  }
});

module.exports = routes;
