const express = require("express");
const routes = express.Router();
const { pool } = require("../db");

routes.get("/", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  try {
    const queryText = `
            SELECT 
                ui.inventory_id, 
                ui.ingredient_id, 
                ui.quantity, 
                ui.best_before_date,
                i.name AS ingredient_name,
                i.unit_of_measure
            FROM User_Inventory ui
            JOIN Ingredients i ON ui.ingredient_id = i.ingredient_id
            WHERE ui.user_id = $1
            ORDER BY i.name;
        `;
    const result = await pool.query(queryText, [userId]); // Используем userId из сессии
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении инвентаря:", err);
    res
      .status(500)
      .json({ error: "Ошибка сервера при получении User_Inventory" });
  }
});

routes.post("/add", async (req, res) => {
  const { ingredient_id, quantity, best_before_date } = req.body;
  const user_id = req.session.userId;

  if (!user_id) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  if (!ingredient_id || !quantity) {
    return res.status(400).json({
      error: "Отсутствуют обязательные поля: ingredient_id, quantity",
    });
  }

  try {
    const queryText = `
            INSERT INTO User_Inventory (user_id, ingredient_id, quantity, best_before_date)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, ingredient_id)
            DO UPDATE SET 
                quantity = User_Inventory.quantity + EXCLUDED.quantity, -- Добавляем количество
                best_before_date = COALESCE(EXCLUDED.best_before_date, User_Inventory.best_before_date); -- Обновляем дату, если она предоставлена
        `;
    await pool.query(queryText, [
      user_id, // Используем user_id из сессии
      ingredient_id,
      parseFloat(quantity),
      best_before_date || null,
    ]);
    res.status(201).json({ message: "Запас успешно добавлен/обновлен." });
  } catch (err) {
    console.error("Ошибка UPSERT в User_Inventory:", err);
    res
      .status(500)
      .json({ error: "Ошибка сервера при обновлении User_Inventory" });
  }
});

routes.put("/update_batch", async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  try {
    const { changes } = req.body;

    for (const change of changes) {
      await pool.query(
        `UPDATE user_inventory 
         SET quantity = $1, best_before_date = $2
         WHERE inventory_id = $3 AND user_id = $4`,
        [change.quantity, change.best_before_date, change.inventory_id, userId],
      );
    }

    res.json({ message: "Изменения сохранены успешно" });
  } catch (error) {
    console.error("Ошибка при обновлении инвентаря:", error);
    res.status(500).json({ error: "Ошибка сервера при обновлении инвентаря" });
  }
});

routes.delete("/:inventory_id", async (req, res) => {
  const user_id = req.session.userId;

  if (!user_id) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  try {
    const { inventory_id } = req.params;
    await pool.query(
      "DELETE FROM user_inventory WHERE inventory_id = $1 AND user_id = $2",
      [inventory_id, user_id],
    );

    res.json({ message: "Элемент инвентаря удален" });
  } catch (error) {
    console.error("Ошибка при удалении ингредиента:", error);
    res.status(500).json({ error: "Ошибка сервера при удалении ингредиента" });
  }
});

routes.post("/add_scanned", async (req, res) => {
  const user_id = req.session.userId;
  const { items } = req.body;

  if (!user_id) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Ожидается массив items." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let addedCount = 0;
    for (const item of items) {
      if (!item.name || !item.quantity) continue;

      // Ищем ингредиент
      let ingRes = await client.query("SELECT ingredient_id FROM Ingredients WHERE name = $1", [item.name]);
      let ingredient_id;

      if (ingRes.rows.length > 0) {
        ingredient_id = ingRes.rows[0].ingredient_id;
      } else {
        // Создаем ингредиент
        let newIngRes = await client.query(
          "INSERT INTO Ingredients (name, unit_of_measure) VALUES ($1, $2) RETURNING ingredient_id",
          [item.name, item.unit_of_measure || "шт"]
        );
        ingredient_id = newIngRes.rows[0].ingredient_id;
      }

      // Добавляем в инвентарь
      const queryText = `
          INSERT INTO User_Inventory (user_id, ingredient_id, quantity)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, ingredient_id)
          DO UPDATE SET quantity = User_Inventory.quantity + EXCLUDED.quantity
      `;
      await client.query(queryText, [user_id, ingredient_id, parseFloat(item.quantity)]);
      addedCount++;
    }

    await client.query("COMMIT");
    res.json({ message: `Успешно добавлено продуктов: ${addedCount}` });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка при добавлении отсканированных продуктов:", error);
    res.status(500).json({ error: "Ошибка сервера при добавлении продуктов" });
  } finally {
    client.release();
  }
});

routes.get("/manager", (req, res) => {
  if (!req.session?.userId) return res.redirect("/login");
  res.render("inventory_manager", {
    title: "Запасы",
  });
});

module.exports = routes;
