
require("dotenv").config();
const { pool } = require("./db");

async function setupDiets() {
    console.log("Starting diet table setup...");
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Create Dietary_Restrictions table
        await client.query(`
      CREATE TABLE IF NOT EXISTS Dietary_Restrictions (
        restriction_id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT
      );
    `);
        console.log("Created Dietary_Restrictions table.");

        // Create User_Diets table
        await client.query(`
      CREATE TABLE IF NOT EXISTS User_Diets (
        user_diet_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
        restriction_id INTEGER NOT NULL REFERENCES Dietary_Restrictions(restriction_id) ON DELETE CASCADE,
        UNIQUE (user_id, restriction_id)
      );
    `);
        console.log("Created User_Diets table.");

        // Seed data
        const restrictions = [
            { name: "Веганство", description: "Исключает мясо, рыбу, яйца и молочные продукты" },
            { name: "Вегетарианство", description: "Исключает мясо и рыбу" },
            { name: "Без глютена", description: "Исключает продукты, содержащие глютен" },
            { name: "Кето", description: "Низкоуглеводная диета" },
            { name: "Без сахара", description: "Исключает добавленный сахар" },
            { name: "Без лактозы", description: "Исключает молочные продукты с лактозой" },
            { name: "Без орехов", description: "Исключает все виды орехов" }
        ];

        for (const r of restrictions) {
            await client.query(`
        INSERT INTO Dietary_Restrictions (name, description)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING;
      `, [r.name, r.description]);
        }
        console.log("Seeded dietary restrictions.");

        await client.query("COMMIT");
        console.log("Setup complete!");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error setting up diets:", err);
    } finally {
        client.release();
        pool.end();
    }
}

setupDiets();
