require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const session = require("express-session");
const path = require("path");

const app = express();
const port = 3000;

const { pool } = require("./db");

app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 часа
  }),
);
app.set("view engine", "ejs");

const authRoutes = require("./routes/authRoutes");
app.use("/", authRoutes);
const recipesRoutes = require("./routes/recipesRoutes");
app.use("/api/recipes", recipesRoutes);
const ingredientsRoutes = require("./routes/ingredientsRoutes");
app.use("/api/ingredients", ingredientsRoutes);
const inventoryRoutes = require("./routes/inventoryRoutes");
app.use("/api/inventory", inventoryRoutes);
const AiRoutes = require("./routes/AiRoutes");
app.use("/api/", AiRoutes);
const adminRoutes = require("./routes/adminRoutes");
app.use("/admin_dashboard/feedback/", adminRoutes);
const plansRoutes = require("./routes/plansRoutes");
app.use("/api/", plansRoutes);
const dietRoutes = require("./routes/dietRoutes");
app.use("/api/diets", dietRoutes);

app.get("/api/generate_recipe", (req, res) => {
  if (!req.session?.userId) return res.redirect("/login");
  res.render("generate_recipe", {
    title: "Генератор Рецептов",
  });
});



// Страница с деталями рецепта
app.get("/api/recipe_detail/:id", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.redirect("/login");
  res.render("recipe_detail", {
    title: "Детали Рецепта",
    recipeId: req.params.id,
    userId: userId,
  });
});

app.get("/api/create_feedback", (req, res) => {
  // Проверка аутентификации
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  // Рендеринг формы
  res.render("create_feedback", {
    error: null,
    success: null,
    subject: "",
    message: "",
  });
});

// Обработка отправки отчета (POST)
app.post("/api/create_feedback", async (req, res) => {
  // 1. Проверка аутентификации
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const { subject, message } = req.body;
  const userId = req.session.userId;

  // 2. Проверка на пустые поля
  if (!subject || !message) {
    return res.render("create_feedback", {
      error: "Пожалуйста, заполните и тему, и сообщение.",
      success: null,
      subject: subject,
      message: message,
    });
  }

  // 3. Сохранение отчета в БД
  try {
    const query = `
            INSERT INTO Feedback_Reports (user_id, subject, message)
            VALUES ($1, $2, $3)
            RETURNING report_id;
        `;
    await pool.query(query, [userId, subject, message]);

    // 4. Успешный ответ
    res.render("create_feedback", {
      success: "Ваш отчет успешно отправлен Администратору!",
      error: null,
      subject: "", // Очищаем поля после успешной отправки
      message: "",
    });
  } catch (error) {
    console.error("Error creating feedback report:", error);

    // 5. Ошибка сервера
    res.render("create_feedback", {
      error:
        "Произошла внутренняя ошибка сервера. Попробуйте отправить отчет позже.",
      success: null,
      subject: subject,
      message: message,
    });
  }
});

app.get("/api/feedback_history", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  try {
    const result = await pool.query(
      `SELECT report_id, subject, message, status, admin_response, 
              created_at, updated_at 
       FROM Feedback_Reports 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.session.userId],
    );

    // Важно: преобразуем даты в строки для EJS
    const reports = result.rows.map((report) => ({
      ...report,
      // Оставляем как строки, EJS сам преобразует в объекты Date
      created_at: report.created_at,
      updated_at: report.updated_at,
    }));

    res.render("user_feedback_history", { reports: reports });
  } catch (error) {
    console.error("Error fetching feedback history:", error);
    res.render("user_feedback_history", {
      reports: [],
      error: "Не удалось загрузить историю отчетов",
    });
  }
});

app.use("/api/", (req, res) => {
  res.status(404).json({
    error: "Endpoint Not Found",
    message: `API-роут ${req.method} ${req.originalUrl} не найден. Проверьте URL и метод запроса.`,
  });
  console.log(
    `API-роут ${req.method} ${req.originalUrl} не найден. Проверьте URL и метод запроса.`,
  );
});

app.listen(port, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let localIP = 'не определён';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log(`Сервер запущен на http://localhost:${port}`);
  console.log(`📱 Для доступа с телефона: http://${localIP}:${port}`);
});
