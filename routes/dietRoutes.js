const express = require("express");
const routes = express.Router();
const { pool } = require("../db");

// GET /api/diets - Страница выбора диет
routes.get("/", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
        return res.redirect("/login");
    }

    try {
        const client = await pool.connect();

        // Получаем все возможные ограничения
        const restrictionsResult = await client.query("SELECT * FROM Dietary_Restrictions ORDER BY name");
        const restrictions = restrictionsResult.rows;

        // Получаем ограничения, выбранные пользователем
        const userDietsResult = await client.query("SELECT restriction_id FROM User_Diets WHERE user_id = $1", [userId]);
        const userDietIds = userDietsResult.rows.map(row => row.restriction_id);

        client.release();

        res.render("user_diets", {
            title: "Мои Диеты",
            restrictions: restrictions,
            userDietIds: userDietIds,
            success: null,
            error: null
        });

    } catch (err) {
        console.error("Error fetching diets:", err);
        res.status(500).send("Server Error");
    }
});

// POST /api/diets - Сохранение выбора
routes.post("/", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
        return res.redirect("/login");
    }

    // selectedRestrictions будет массивом ID (или undefined, если ничего не выбрано)
    let { selectedRestrictions } = req.body;

    // Если выбран только один элемент, это может быть не массив. Преобразуем в массив.
    if (selectedRestrictions && !Array.isArray(selectedRestrictions)) {
        selectedRestrictions = [selectedRestrictions];
    }
    if (!selectedRestrictions) {
        selectedRestrictions = [];
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Удаляем старые привязки
        await client.query("DELETE FROM User_Diets WHERE user_id = $1", [userId]);

        // Добавляем новые
        for (const restrictionId of selectedRestrictions) {
            await client.query(
                "INSERT INTO User_Diets (user_id, restriction_id) VALUES ($1, $2)",
                [userId, parseInt(restrictionId)]
            );
        }

        await client.query("COMMIT");

        // Получаем данные заново для рендеринга
        const restrictionsResult = await client.query("SELECT * FROM Dietary_Restrictions ORDER BY name");
        const restrictions = restrictionsResult.rows;
        const userDietIds = selectedRestrictions.map(id => parseInt(id));

        res.render("user_diets", {
            title: "Мои Диеты",
            restrictions: restrictions,
            userDietIds: userDietIds,
            success: "Настройки диеты успешно обновлены!",
            error: null
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error saving diets:", err);
        res.render("user_diets", {
            title: "Мои Диеты",
            restrictions: [],
            userDietIds: [],
            success: null,
            error: "Не удалось сохранить настройки. Попробуйте позже."
        });
    } finally {
        client.release();
    }
});

// POST /api/diets/add - Добавление новой диеты
routes.post("/add", async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Необходима авторизация" });

    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Название диеты обязательно" });
    }

    try {
        const client = await pool.connect();
        try {
            await client.query(
                "INSERT INTO Dietary_Restrictions (name, description) VALUES ($1, $2)",
                [name, description || ""]
            );
            res.json({ success: true });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Error adding diet:", err);
        res.status(500).json({ error: "Ошибка при добавлении диеты" });
    }
});

// DELETE /api/diets/:id - Удаление диеты
routes.delete("/:id", async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Необходима авторизация" });

    const restrictionId = parseInt(req.params.id);
    if (isNaN(restrictionId)) {
        return res.status(400).json({ error: "Неверный ID диеты" });
    }

    try {
        const client = await pool.connect();
        try {
            await client.query("DELETE FROM Dietary_Restrictions WHERE restriction_id = $1", [restrictionId]);
            res.json({ success: true });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Error deleting diet:", err);
        res.status(500).json({ error: "Ошибка при удалении диеты" });
    }
});

module.exports = routes;
