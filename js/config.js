// Настройки сайта. Обычно меняется только SHEET_URL.
window.CONFIG = {
  // Адрес веб-приложения Google Apps Script, куда сохраняются ответы.
  // Пока строка пустая, сайт работает, но ответы никуда не отправляет (режим проверки).
  SHEET_URL: "https://script.google.com/macros/s/AKfycbyeGQIEf7vI2yLm3wTVIjDxe_PjBbY7YsUqjtJB8eWZieJTSKG_VP6iXZgGQKxIFlS9BQ/exec",

  // Где лежит модель, экспортированная из Teachable Machine (model.json, weights.bin, metadata.json).
  MODEL_URL: "model/",

  // Список тестовых снимков с правильными ответами (его создаёт tools/prepare_data.py).
  TEST_SET_URL: "data/test-set.json",

  // Тренировочные снимки с подсказками (их создаёт tools/pick_learning_images.py, подсказки написаны вручную).
  PRACTICE_SET_URL: "data/practice.json",

  // Версия модели: попадает в таблицу, чтобы потом не перепутать результаты разных моделей.
  MODEL_VERSION: "v2",

  // Версия теста (обучение, анкета): результаты разных версий нельзя смешивать.
  // 1 — два примера без тренировки; 2 — признаки, тренировка на 4 снимках, расширенная анкета.
  TEST_VERSION: "2",
};
