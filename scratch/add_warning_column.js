require("dotenv").config();
const { pool } = require("../db");

async function run() {
    try {
        await pool.query(`
            ALTER TABLE recipes 
            ADD COLUMN IF NOT EXISTS dietary_warning TEXT
        `);
        console.log("Column 'dietary_warning' added successfully.");
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
