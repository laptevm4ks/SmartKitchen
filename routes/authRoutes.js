const express = require("express");
const routes = express.Router();
const bcrypt = require("bcryptjs");
const { pool } = require("../db");

function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect("/login");
}

routes.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  // Валидация полей
  const errors = [];

  // Проверка на пустые поля
  if (!username || !email || !password) {
    return res.render("register", {
      error: "Пожалуйста, заполните все поля.",
      username: username || "",
      email: email || "",
    });
  }

  // Валидация email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    errors.push("Введите корректный email адрес.");
  }

  // Валидация имени пользователя
  if (username.length < 3 || username.length > 30) {
    errors.push("Имя пользователя должно быть от 3 до 30 символов.");
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    errors.push(
      "Имя пользователя может содержать только буквы, цифры и символ подчеркивания.",
    );
  }

  // Валидация пароля
  if (password.length < 8) {
    errors.push("Пароль должен содержать минимум 8 символов.");
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
  if (!passwordRegex.test(password)) {
    errors.push(
      "Пароль должен содержать хотя бы одну заглавную букву, одну строчную букву и одну цифру.",
    );
  }

  // Если есть ошибки валидации
  if (errors.length > 0) {
    return res.render("register", {
      error: errors.join(" "),
      username: username,
      email: email,
    });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const query = `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id`;
    const result = await pool.query(query, [username, email, password_hash]);
    const userId = result.rows[0].user_id;

    req.session.userId = userId;
    req.session.username = username;

    res.redirect("/dashboard");
  } catch (error) {
    console.error("Registration error:", error);
    if (error.code === "23505") {
      return res.render("register", {
        error: "Пользователь с таким email или именем уже существует.",
        username: username,
        email: email,
      });
    }
    res.render("register", {
      error: "Произошла внутренняя ошибка сервера. Попробуйте позже.",
      username: username,
      email: email,
    });
  }
});

routes.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render("login", {
      error: "Пожалуйста, заполните все поля.",
      email: email,
    });
  }

  try {
    const query = `SELECT user_id, username, password_hash, is_admin FROM users WHERE email = $1`;
    const result = await pool.query(query, [email]);
    const user = result.rows[0];

    if (!user) {
      return res.render("login", {
        error: "Неверный email или пароль.",
        email: email,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.render("login", {
        error: "Неверный email или пароль.",
        email: email,
      });
    }

    req.session.userId = user.user_id;
    req.session.username = user.username;

    if (user.is_admin === true) {
      res.redirect("/admin_dashboard");
    } else {
      res.redirect("/dashboard");
    }
  } catch (error) {
    console.error("Login error:", error);
    res.render("login", {
      error: "Произошла внутренняя ошибка сервера. Попробуйте позже.",
      email: email,
    });
  }
});

routes.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect("/dashboard");
    }
    res.redirect("/login");
  });
});

routes.get("/login", (req, res) => {
  res.render("login");
});

routes.get("/register", (req, res) => {
  res.render("register");
});

routes.get("/dashboard", isAuthenticated, (req, res) => {
  res.render("dashboard", { username: req.session.username, title: "Главная" });
});

routes.get("/admin_dashboard", isAuthenticated, (req, res) => {
  res.render("admin_dashboard", { username: req.session.username });
});

module.exports = routes;
