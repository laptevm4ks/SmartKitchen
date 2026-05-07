const express = require("express");
const routes = express.Router();
const { pool } = require("../db");
const OpenAI = require("openai");

// --- КОНФИГУРАЦИЯ ---
const OPENROUTER_API_KEY = "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"; 
// Для теста ПЛАТНЫХ расчетов убери ":free" из названия, если используешь платный аккаунт
const AI_MODEL = "google/gemini-2.5-flash-lite"; 

// Твои тарифы ($ за 1 000 000 токенов)
const PRICE_PER_1M_PROMPT = 0.1;    
const PRICE_PER_1M_COMPLETION = 0.4; 

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    "X-Title": "SmartKitchen App",
  },
});

// --- ФУНКЦИЯ РАСЧЕТА ---
function calculateCost(usage) {
  // Если usage пустой, возвращаем 0
  if (!usage || (!usage.prompt_tokens && !usage.completion_tokens)) return 0;

  const promptCost = (usage.prompt_tokens / 1000000) * PRICE_PER_1M_PROMPT;
  const completionCost = (usage.completion_tokens / 1000000) * PRICE_PER_1M_COMPLETION;
  
  return promptCost + completionCost;
}

// --- ФУНКЦИЯ ЛОГИРОВАНИЯ ---
async function logAIInteraction(userId, type, prompt, response = null, sourceRecipeId = null, usage = null) {
  if (!userId) return null;

  // Считаем стоимость
  const cost = calculateCost(usage);
  
  // Выводим в консоль ДЛЯ ПРОВЕРКИ (даже если БД упадет, мы увидим это в терминале)
  console.log(`\n--- [DEBUG BILLING] ---`);
  console.log(`Type: ${type}`);
  console.log(`Prompt Tokens: ${usage?.prompt_tokens || 0}`);
  console.log(`Completion Tokens: ${usage?.completion_tokens || 0}`);
  console.log(`Calculated Cost: $${cost.toFixed(8)}`);
  console.log(`-----------------------\n`);

  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO AI_Interactions 
      (user_id, interaction_type, prompt_text, response_text, recipe_id) 
      VALUES ($1, $2, $3, $4, $5)`;
    const responseText = response ? (typeof response === "object" ? JSON.stringify(response) : response) : null;
    await client.query(query, [userId, type, prompt, responseText, sourceRecipeId]);
  } catch (err) {
    console.error("❌ Ошибка записи в БД:", err.message);
  } finally {
    client.release();
  }
}

// --- СХЕМА РЕЦЕПТА ---
const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    instructions: { type: "string" },
    prep_time_min: { type: "number" },
    cook_time_min: { type: "number" },
    servings: { type: "number" },
    dietary_warning: { type: "string", description: "Предупреждение о соответствии диете, если необходимо" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "string" },
          unit_of_measure: { type: "string" },
        },
        required: ["name", "quantity"],
      },
    },
  },
  required: ["title", "instructions", "ingredients"],
};

// --- РОУТЫ ---

// 1. Стандартизация
routes.post("/ai/standardize_ingredient", async (req, res) => {
  const { rawInput } = req.body;
  const userId = req.session.userId;
  if (!userId) return res.status(401).send("Unauthorized");

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "Ты ассистент, нормализующий названия продуктов питания. Если введено нецензурное слово, бессмыслица или слово, явно не относящееся к еде/напиткам, верни в error сообщение: 'Это не похоже на продукт питания.' и оставь name и unit_of_measure пустыми. Иначе исправь опечатки (например 'яблко' -> 'яблоко'), приведи к нормальной форме (именительный падеж, ед.ч.) и верни name и unit_of_measure. В качестве unit_of_measure используй строго одну из мер: 'г', 'мл' или 'шт'. Выбери наиболее логичную меру для продукта." },
        { role: "user", content: rawInput }
      ],
      response_format: { type: "json_schema", json_schema: { name: "std", strict: true, schema: {
        type: "object",
        properties: { name: {type: "string"}, unit_of_measure: {type: "string"}, error: {type: "string"} },
        required: ["name", "unit_of_measure", "error"],
        additionalProperties: false
      }}}
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    
    // ВАЖНО: передаем именно completion.usage
    await logAIInteraction(userId, "STANDARDIZE", rawInput, parsed, null, completion.usage);
    
    res.json(parsed);
  } catch (e) {
    console.error("🛑 Ошибка:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 2. Генерация
routes.post("/ai/generate", async (req, res) => {
  const userId = req.session.userId;
  const { inventoryList } = req.body;
  if (!userId || !inventoryList) return res.status(400).send("No ingredients");

  try {
    // 1. Получаем диеты пользователя
    const dietResult = await pool.query(`
      SELECT dr.name, dr.description 
      FROM User_Diets ud
      JOIN Dietary_Restrictions dr ON ud.restriction_id = dr.restriction_id
      WHERE ud.user_id = $1
    `, [userId]);
    
    const userDiets = dietResult.rows;
    let dietConstraints = "";
    if (userDiets.length > 0) {
      dietConstraints = `
      ОГРАНИЧЕНИЯ ПО ДИЕТЕ (ОБЯЗАТЕЛЬНО К ИСПОЛНЕНИЮ):
      ${userDiets.map(d => `- ${d.name}: ${d.description}`).join("\n")}
      
      ВАЖНО: Если выбранные ингредиенты противоречат диете, постарайся найти компромисс или выведи предупреждение в поле dietary_warning. Если диета запрещает какой-то продукт из списка разрешенных, НЕ ИСПОЛЬЗУЙ его.`;
    }

    const promptText = `СПИСОК РАЗРЕШЕННЫХ ИНГРЕДИЕНТОВ: ${inventoryList.join(", ")}.
    ${dietConstraints}
    
    ЗАДАНИЕ: Составь рецепт, используя ТОЛЬКО ингредиенты из списка выше и строго соблюдая ограничения по диете. 
    
    КРИТИЧЕСКИЕ ПРАВИЛА:
    1. Если ингредиента нет в списке "СПИСОК РАЗРЕШЕННЫХ ИНГРЕДИЕНТОВ", его НЕЛЬЗЯ упоминать в составе или в инструкции.
    2. ЗАПРЕЩЕНО добавлять соль, перец, любые специи, воду, масло, бульон или соусы, если их нет в списке.
    3. Если в списке только "картофель", рецепт должен состоять только из картофеля (например, запеченный картофель).
    4. Твой ответ будет отклонен, если в поле "ingredients" окажется хотя бы один продукт, не входящий в разрешенный список.
    5. В инструкции (instructions) также запрещено упоминать использование сторонних продуктов.
    6. Если диета запрещает какой-то ингредиент из списка разрешенных, приоритет отдается диете (не используй его).`;
    
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "Ты — робот-повар, у которого физически нет доступа ни к каким продуктам, кроме тех, что предоставил пользователь. Ты не можешь использовать даже воду или соль из-под крана. Твой девиз: 'Только то, что есть в списке, и ничего больше'. Также ты строго соблюдаешь диетические ограничения пользователя." },
        { role: "user", content: promptText }
      ],
      response_format: { type: "json_schema", json_schema: { name: "gen", strict: true, schema: RECIPE_SCHEMA }}
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    // Передаем usage для расчета
    await logAIInteraction(userId, "GENERATE", promptText, result, null, completion.usage);
    
    res.json({ generatedRecipe: result });
  } catch (e) {
    console.error("🛑 Ошибка:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 3. Сканирование чека по фото
routes.post("/ai/scan_receipt", async (req, res) => {
  const userId = req.session.userId;
  const { base64Image } = req.body;
  if (!userId) return res.status(401).send("Unauthorized");
  if (!base64Image) {
      console.log("[AI SCAN] Ошибка: нет base64Image в теле запроса");
      return res.status(400).send("No image provided");
  }

  console.log(`[AI SCAN] Запрос от пользователя ${userId}, размер изображения: ${base64Image.length} символов`);

  try {
    const promptText = `Проанализируй фото чека или продуктов и верни JSON со списком ингредиентов в формате: {"items": [{"name": "Яблоко", "quantity": 2, "unit_of_measure": "шт"}]}.
ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Название продукта (name) должно быть базовым, кратким и очищенным от брендов, процентов жирности и лишних символов (например, пиши "Йогурт греческий" вместо "Йогурт ГРЕЧЕСКИЙ TEOS (манг/чиа)2,0%140г").
2. Внимательно ищи вес или объем в строке чека. Если указано "140г", "1.5л", "500мл", то запиши это число в 'quantity' (например, 140), а саму меру в 'unit_of_measure'.
3. ОЧЕНЬ ВАЖНО: Используй строго одну из мер: 'г', 'мл' или 'шт'. Все килограммы переводи в граммы (1.2 кг -> 1200 г), все литры в миллилитры (1 л -> 1000 мл).
4. Если вес/объем не указан вообще, используй 'quantity' для количества штук и 'unit_of_measure': 'шт'.
5. Верни ТОЛЬКО валидный JSON, без markdown-разметки (\`\`\`json) и лишнего текста.`;
    
    // Используем мультимодальный запрос
    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.5-flash-lite", // Надежно поддерживает Vision и стоит дешевле
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            {
              type: "image_url",
              image_url: {
                url: base64Image, // уже включает префикс data:image/...
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" }
    });

    const resultText = completion.choices[0].message.content;
    console.log("[AI SCAN] Ответ от нейросети получен:", resultText);
    const parsed = JSON.parse(resultText);
    
    await logAIInteraction(userId, "SCAN_RECEIPT", "Image upload", parsed, null, completion.usage);
    
    res.json(parsed);
  } catch (e) {
    console.error("🛑 Ошибка сканирования:", e.message);
    res.status(500).json({ error: e.message, details: "Если ошибка 413 Payload Too Large, значит сервер не смог принять размер фото" });
  }
});

module.exports = routes;