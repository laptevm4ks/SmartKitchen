const express = require("express");
const routes = express.Router();
const { pool } = require("../db");

routes.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT ingredient_id, name, unit_of_measure FROM Ingredients ORDER BY name",
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении ингредиентов:", err);
    res
      .status(500)
      .json({ error: "Ошибка сервера при получении справочника Ingredients" });
  }
});

routes.post("/add_from_ai", async (req, res) => {
  const { name, unit_of_measure } = req.body;

  if (!name) {
    return res.status(400).json({
      error: "Отсутствует обязательное поле: name.",
    });
  }

  const finalUnit = unit_of_measure || "шт";

  try {
    const queryText = `
            INSERT INTO Ingredients (name, unit_of_measure)
            VALUES ($1, $2)
            ON CONFLICT (name) DO UPDATE 
            SET name = EXCLUDED.name 
            RETURNING ingredient_id, (xmax = 0) AS was_inserted;
        `;
    const result = await pool.query(queryText, [name, finalUnit]);
    const { ingredient_id, was_inserted } = result.rows[0];

    if (was_inserted) {
      console.log(`Ингредиент "${name}" добавлен с ID: ${ingredient_id}`);
      res.status(201).json({
        // 201 Created
        message: `Ингредиент "${name}" успешно добавлен.`,
        ingredient_id: ingredient_id,
      });
    } else {
      console.log(
        `Ингредиент "${name}" уже существует. Возвращаем его ID: ${ingredient_id}.`,
      );
      res.status(200).json({
        // 200 OK
        message: `Ингредиент "${name}" уже существовал. Возвращен существующий ID.`,
        ingredient_id: ingredient_id,
      });
    }
  } catch (err) {
    console.error(
      "Ошибка при добавлении/получении ингредиента в БД:",
      err.stack,
    );
    res
      .status(500)
      .json({ error: "Ошибка сервера при обработке таблицы Ingredients" });
  }
});

module.exports = routes;
