require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    connectionTimeoutMillis: 5000,
});

async function run() {
    console.log("Attempting connect...");
    try {
        const client = await pool.connect();
        console.log("Connected!");
        const res = await client.query('SELECT NOW()');
        console.log("Query result:", res.rows[0]);

        // Check existing tables
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log("Tables:", tables.rows.map(r => r.table_name));

        client.release();
    } catch (e) {
        console.error("Connection failed:", e);
    } finally {
        await pool.end();
        console.log("Pool ended");
    }
}
run();
