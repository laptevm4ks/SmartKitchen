const express = require("express");
const routes = express.Router();
const { pool } = require("../db");

const isAdmin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  try {
    const query = "SELECT is_admin FROM Users WHERE user_id = $1";
    const result = await pool.query(query, [req.session.userId]);

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      // Если не админ, отправляем 403 или на главную
      return res
        .status(403)
        .send("Доступ запрещен. У вас нет прав администратора.");
    }
    next(); // Пользователь является администратором
  } catch (error) {
    console.error("Admin check failed:", error);
    res.status(500).send("Внутренняя ошибка проверки прав.");
  }
};

routes.get("/", isAdmin, async (req, res) => {
  try {
    const reportsQuery = `
            SELECT 
                r.report_id, 
                r.subject, 
                r.message, 
                r.status, 
                r.admin_response, 
                r.created_at, 
                r.updated_at,
                u.username,
                u.email
            FROM Feedback_Reports r
            JOIN Users u ON r.user_id = u.user_id
            ORDER BY 
                CASE r.status
                    WHEN 'Новый' THEN 1  -- Приоритет Новым
                    WHEN 'В работе' THEN 2
                    ELSE 3
                END,
                r.created_at ASC;
        `;
    const result = await pool.query(reportsQuery);

    const reports = result.rows.map((report) => ({
      ...report,
      created_at: report.created_at.toISOString(),
      updated_at: report.updated_at.toISOString(),
    }));

    res.render("admin_feedback_list", { reports: reports, error: null });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.render("admin_feedback_list", {
      reports: [],
      error: "Ошибка загрузки отчетов.",
    });
  }
});

// Отображение формы редактирования/ответа
routes.get("/:report_id/edit", isAdmin, async (req, res) => {
  const { report_id } = req.params;

  try {
    // Запрос отчета с данными пользователя
    const query = `
            SELECT 
                r.*, 
                u.username,
                u.email
            FROM Feedback_Reports r
            JOIN Users u ON r.user_id = u.user_id
            WHERE r.report_id = $1;
        `;
    const result = await pool.query(query, [report_id]);

    if (result.rows.length === 0) {
      return res.status(404).send("Отчет не найден.");
    }

    const report = result.rows[0];

    res.render("admin_edit_feedback", {
      report: report,
      success: null,
      error: null,
    });
  } catch (error) {
    console.error("Error fetching report for admin edit:", error);
    res.status(500).send("Внутренняя ошибка сервера при загрузке отчета.");
  }
});

// Обработка изменений статуса и ответа
routes.post("/:report_id/edit", isAdmin, async (req, res) => {
  const { report_id } = req.params;
  const { status, admin_response } = req.body;

  // Преобразование пустой строки в NULL или чистый текст
  const responseToSave = admin_response ? admin_response.trim() : null;

  try {
    // Обновление отчета
    const updateQuery = `
            UPDATE Feedback_Reports 
            SET 
                status = $1, 
                admin_response = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE report_id = $3;
        `;
    await pool.query(updateQuery, [status, responseToSave, report_id]);

    // Повторный запрос отчета для обновления данных на странице
    const fetchQuery = `
            SELECT 
                r.*, 
                u.username,
                u.email
            FROM Feedback_Reports r
            JOIN Users u ON r.user_id = u.user_id
            WHERE r.report_id = $1;
        `;
    const fetchResult = await pool.query(fetchQuery, [report_id]);
    const report = fetchResult.rows[0];

    // Успешный ответ
    res.render("admin_edit_feedback", {
      report: report,
      success: "Отчет успешно обновлен!",
      error: null,
    });
  } catch (error) {
    console.error("Error updating feedback report:", error);
    res.redirect(
      `/admin_dashboard/feedback/${report_id}/edit?error=Ошибка при сохранении.`,
    );
  }
});

module.exports = routes;
