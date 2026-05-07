const { pool } = require("./db");

async function checkDiets() {
    try {
        const res = await pool.query("SELECT * FROM Dietary_Restrictions");
        console.log("Count:", res.rowCount);
        console.log("Rows:", res.rows);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        pool.end();
    }
}

checkDiets();
