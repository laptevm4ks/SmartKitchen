require("dotenv").config();
const { pool } = require("../db");

async function run() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'recipes'
        `);
        console.log("Columns in 'recipes' table:");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
