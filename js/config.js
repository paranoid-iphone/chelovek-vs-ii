// Настройки сайта. Обычно меняется только SHEET_URL.
window.CONFIG = {
  // Адрес веб-приложения Google Apps Script, куда сохраняются ответы.
  // Пока строка пустая, сайт работает, но ответы никуда не отправляет (режим проверки).
  SHEET_URL: "https://script.google.com/macros/s/AKfycbz9QneMXB1z7MolZIHRWricaDUPflZVFMa3lHd-iPZvAlvrsaa2k9nmpb1t2yOIkretsA/exec",

  // Где лежит модель, экспортированная из Teachable Machine (model.json, weights.bin, metadata.json).
  MODEL_URL: "model/",

  // Список тестовых снимков с правильными ответами (его создаёт tools/prepare_data.py).
  TEST_SET_URL: "data/test-set.json",

  // Версия модели: попадает в таблицу, чтобы потом не перепутать результаты разных моделей.
  MODEL_VERSION: "v2",
};
