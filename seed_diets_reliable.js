require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function seed() {
    console.log("Starting seed...");
    try {
        const client = await pool.connect();

        // Check if table exists
        const checkTable = await client.query(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'dietary_restrictions'
        );
    `);

        if (!checkTable.rows[0].exists) {
            console.log("Table dietary_restrictions does not exist! Creating...");
            await client.query(`
            CREATE TABLE dietary_restrictions (
                restriction_id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                description TEXT
            );
        `);
        }

        const countRes = await client.query("SELECT COUNT(*) FROM dietary_restrictions");
        const count = parseInt(countRes.rows[0].count);
        console.log(`Current count: ${count}`);

        if (count === 0) {
            console.log("Seeding data...");
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
                INSERT INTO dietary_restrictions (name, description)
                VALUES ($1, $2)
                ON CONFLICT (name) DO NOTHING;
            `, [r.name, r.description]);
            }
            console.log("Seeding complete.");
        } else {
            console.log("Table already has data.");
        }

        const finalRes = await client.query("SELECT * FROM dietary_restrictions");
        console.log("Final data:", finalRes.rows);

        client.release();
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
        console.log("Done.");
    }
}

seed();
