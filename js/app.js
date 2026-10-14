// =====================================================================
//  «Человек против ИИ» — логика сайта
//  Порядок: главная → анкета → два примера → 20 снимков → результат.
//  Нейросеть работает прямо в браузере (TensorFlow.js), сервер не нужен.
// =====================================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Всё, что происходит во время одного прохождения теста
const state = {
  testSet: [],        // [{file, label}] — снимки и правильные ответы
  order: [],          // в каком порядке показываем снимки этому участнику
  index: 0,           // номер текущего снимка
  answers: [],        // ответы человека
  shownAt: 0,         // когда показали текущий снимок (для замера времени)
  survey: {},         // ответы анкеты
  participant: null,  // случайный анонимный номер участника
  practiceSet: [],    // [{file, label, hint}] — тренировочные снимки с подсказками
  practiceOrder: [],  // в каком порядке показываем тренировку этому участнику
  practiceIndex: 0,
  practiceCorrect: 0, // сколько тренировочных снимков угадано (в таблицу уходит как есть)
};

let model = null;         // нейросеть
let modelInfo = null;     // её подписи классов и размер картинки
let modelPromise = null;

// ---------------------------------------------------------------------
// Переключение экранов
// ---------------------------------------------------------------------
function show(name) {
  $$(".screen").forEach((s) => (s.hidden = s.dataset.screen !== name));
  window.scrollTo(0, 0);
  const heading = $(`.screen[data-screen="${name}"] h1, .screen[data-screen="${name}"] h2`);
  if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
}

$$("[data-go]").forEach((el) =>
  el.addEventListener("click", () => {
    const target = el.dataset.go;
    // Во время теста не даём случайно уйти со страницы теста
    if (!$('.screen[data-screen="test"]').hidden && !confirmLeave()) return;
    show(target);
  })
);

function confirmLeave() {
  if (state.index >= state.order.length) return true;
  return confirm("Выйти из теста? Ответы на этот раз не сохранятся.");
}

// ---------------------------------------------------------------------
// Загрузка данных и модели
// ---------------------------------------------------------------------
async function loadTestSet() {
  const res = await fetch(CONFIG.TEST_SET_URL, { cache: "no-cache" });
  const data = await res.json();
  state.testSet = data.images;
  $$("[data-total]").forEach((el) => (el.textContent = data.images.length));
  if (data.demo) $$("[data-demo-note]").forEach((el) => (el.hidden = false));
}

async function loadPracticeSet() {
  const res = await fetch(CONFIG.PRACTICE_SET_URL, { cache: "no-cache" });
  state.practiceSet = (await res.json()).images;
  $$("[data-practice-total]").forEach((el) => (el.textContent = state.practiceSet.length));
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const meta = await (await fetch(CONFIG.MODEL_URL + "metadata.json", { cache: "no-cache" })).json();
      const m = await tf.loadLayersModel(CONFIG.MODEL_URL + "model.json");
      // Какой из классов означает «пневмония»: ищем по названию
      let pneumoniaIndex = meta.labels.findIndex((l) => /пневм|pneum/i.test(l));
      if (pneumoniaIndex === -1) pneumoniaIndex = 1;
      modelInfo = { labels: meta.labels, size: meta.imageSize || 224, pneumoniaIndex };
      model = m;
      return m;
    })();
  }
  return modelPromise;
}

// Подготовка картинки так же, как это делает Teachable Machine:
// вырезаем центральный квадрат, уменьшаем до 224×224, переводим пиксели в диапазон от −1 до 1: (x − 127,5) / 127,5.
const cropCanvas = document.createElement("canvas");
function toTensor(img) {
  const size = modelInfo.size;
  cropCanvas.width = cropCanvas.height = size;
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });
  const w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return tf.tidy(() => tf.browser.fromPixels(cropCanvas).toFloat().div(127.5).sub(1).expandDims(0));
}

// Спрашиваем нейросеть про один снимок. Возвращает вероятность пневмонии и время ответа.
async function predict(img) {
  const input = toTensor(img);
  const t0 = performance.now();
  const output = model.predict(input);
  const probs = await output.data();
  const ms = performance.now() - t0;
  input.dispose(); output.dispose();
  const pPneumonia = probs[modelInfo.pneumoniaIndex];
  return { pPneumonia, answer: pPneumonia >= 0.5 ? "pneumonia" : "normal", ms };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---------------------------------------------------------------------
// Анкета
// ---------------------------------------------------------------------
const SURVEY_FIELDS = ["group", "age", "medical", "trustBefore"];

$$('.screen[data-screen="survey"] .choice input[type="radio"]').forEach((input) =>
  input.addEventListener("change", () => {
    state.survey[input.name] = input.value;
    $('[data-action="survey-next"]').disabled = !SURVEY_FIELDS.every((f) => state.survey[f]);
  })
);
$('[data-action="survey-next"]').addEventListener("click", () => show("learn"));

// ---------------------------------------------------------------------
// Тренировка: снимки с ответом сразу, чтобы научиться до настоящего теста
// ---------------------------------------------------------------------
const practiceImg = $("[data-practice-image]");
const practiceAnswers = $("[data-practice-answers]");
const practiceButtons = $$("[data-practice-answer]");
const practiceFeedback = $("[data-practice-feedback]");
const practiceDone = $("[data-practice-done]");

$('[data-action="start-practice"]').addEventListener("click", () => {
  if (!state.practiceSet.length) { startTest(); return; } // тренировка не загрузилась: не мешаем пройти тест
  state.practiceOrder = shuffle(state.practiceSet);
  state.practiceIndex = 0;
  state.practiceCorrect = 0;
  state.practiceOrder.forEach((item) => { const i = new Image(); i.src = item.file; });
  show("practice");
  showPracticeImage();
});

function showPracticeImage() {
  const item = state.practiceOrder[state.practiceIndex];
  $("[data-practice-current]").textContent = state.practiceIndex + 1;
  $("[data-practice-progress]").style.width = (state.practiceIndex / state.practiceOrder.length) * 100 + "%";
  practiceFeedback.hidden = true;
  practiceDone.hidden = true;
  practiceAnswers.hidden = false;
  practiceButtons.forEach((b) => (b.disabled = true));
  practiceImg.classList.add("is-loading");
  practiceImg.onload = () => {
    practiceImg.classList.remove("is-loading");
    practiceButtons.forEach((b) => (b.disabled = false));
  };
  practiceImg.src = item.file;
}

function practiceAnswer(value) {
  if (practiceButtons[0].disabled || !practiceFeedback.hidden) return;
  const item = state.practiceOrder[state.practiceIndex];
  const ok = value === item.label;
  if (ok) state.practiceCorrect++;
  practiceButtons.forEach((b) => (b.disabled = true));
  $("[data-practice-verdict]").textContent = ok
    ? `Верно: ${LABEL[item.label]}`
    : `Ошибка. На самом деле: ${LABEL[item.label]}`;
  $("[data-practice-hint]").textContent = item.hint;
  const last = state.practiceIndex === state.practiceOrder.length - 1;
  const next = $('[data-action="practice-next"]');
  next.textContent = last ? "Закончить тренировку" : "Дальше";
  practiceFeedback.hidden = false;
  next.focus({ preventScroll: true });
}

$('[data-action="practice-next"]').addEventListener("click", () => {
  state.practiceIndex++;
  if (state.practiceIndex < state.practiceOrder.length) { showPracticeImage(); return; }
  $("[data-practice-progress]").style.width = "100%";
  practiceFeedback.hidden = true;
  practiceAnswers.hidden = true;
  $("[data-practice-summary]").textContent =
    `Тренировка: верно ${state.practiceCorrect} из ${state.practiceOrder.length}`;
  practiceDone.hidden = false;
  $('[data-practice-done] [data-action="start-test"]').focus({ preventScroll: true });
});

practiceButtons.forEach((b) => b.addEventListener("click", () => practiceAnswer(b.dataset.practiceAnswer)));

// ---------------------------------------------------------------------
// Тест
// ---------------------------------------------------------------------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function startTest() {
  state.order = shuffle(state.testSet);
  state.index = 0;
  state.answers = [];
  state.participant = newId();
  state.startedAt = new Date().toISOString();
  state.order.forEach((item) => { const i = new Image(); i.src = item.file; }); // заранее загружаем все снимки
  show("test");
  showImage();
}
$('[data-action="start-test"]').addEventListener("click", startTest);

const testImg = $("[data-test-image]");
const answerButtons = $$("[data-answer]");

function setAnswersEnabled(on) { answerButtons.forEach((b) => (b.disabled = !on)); }

const imageError = $("[data-image-error]");

function showImage() {
  const item = state.order[state.index];
  $("[data-current]").textContent = state.index + 1;
  $("[data-progress]").style.width = (state.index / state.order.length) * 100 + "%";
  setAnswersEnabled(false);
  imageError.hidden = true;
  testImg.classList.add("is-loading");
  testImg.onload = () => {
    testImg.classList.remove("is-loading");
    state.shownAt = performance.now(); // время считаем с момента, когда снимок появился
    setAnswersEnabled(true);
  };
  testImg.onerror = () => { imageError.hidden = false; }; // без этого тест молча зависал бы на пустом экране
  testImg.src = item.file;
}

$('[data-action="retry-image"]').addEventListener("click", showImage);

function answer(value) {
  if (answerButtons[0].disabled) return;
  const item = state.order[state.index];
  state.answers.push({
    image: item.file.split("/").pop(),
    truth: item.label,
    human: value,
    timeSec: (performance.now() - state.shownAt) / 1000,
  });
  state.index++;
  if (state.index < state.order.length) showImage();
  else finishTest();
}

answerButtons.forEach((b) => b.addEventListener("click", () => answer(b.dataset.answer)));
document.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return; // зажатая клавиша не должна отвечать на несколько снимков
  const testing = !$('.screen[data-screen="test"]').hidden;
  const practising = !$('.screen[data-screen="practice"]').hidden;
  if (!testing && !practising) return;
  const value = e.key === "1" ? "normal" : e.key === "2" ? "pneumonia" : null;
  if (!value) return;
  if (testing) answer(value); else practiceAnswer(value);
});

// ---------------------------------------------------------------------
// Результат
// ---------------------------------------------------------------------
const LABEL = { normal: "здоров", pneumonia: "пневмония" };
const fmtSec = (s) => s.toLocaleString("ru-RU", { maximumFractionDigits: s < 0.1 ? 3 : 1 }) + " с";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

const shareBtn = $('[data-action="share"]');
const shareLabel = shareBtn.textContent;

// Возвращаем экран результата в исходное состояние, чтобы при втором прохождении не остались старые цифры
function resetResultScreen() {
  $("[data-verdict]").textContent = "Считаем результат…";
  $("[data-human-score]").textContent = "–";
  $("[data-human-time]").textContent = "–";
  $("[data-ai-score]").textContent = "–";
  $("[data-ai-status]").textContent = "проверяет снимки…";
  $$("[data-stat]").forEach((el) => (el.textContent = "–"));
  $("[data-review-human]").textContent = "–";
  $("[data-review-ai]").textContent = "–";
  $$('[name="trustAfter"]').forEach((r) => (r.checked = false));
  $("[data-trust-status]").textContent = "";
  $("[data-trust-status]").classList.remove("is-error");
  state.trustAfter = "";
  const status = $("[data-save-status]");
  status.textContent = "";
  status.classList.remove("is-error");
  shareBtn.textContent = shareLabel;
}

// «Нашёл пневмоний» и «ложные тревоги» для одного ответчика (who = "human" или "ai")
function confusion(answers, who) {
  const sick = answers.filter((a) => a.truth === "pneumonia");
  const healthy = answers.filter((a) => a.truth === "normal");
  return {
    found: sick.filter((a) => a[who] === "pneumonia").length, sick: sick.length,
    falseAlarms: healthy.filter((a) => a[who] === "pneumonia").length, healthy: healthy.length,
  };
}

function showStats(answers, aiOk) {
  const h = confusion(answers, "human");
  $('[data-stat="human-found"]').textContent = `${h.found} из ${h.sick}`;
  $('[data-stat="human-false"]').textContent = `${h.falseAlarms} из ${h.healthy}`;
  if (!aiOk) return;
  const a = confusion(answers, "ai");
  $('[data-stat="ai-found"]').textContent = `${a.found} из ${a.sick}`;
  $('[data-stat="ai-false"]').textContent = `${a.falseAlarms} из ${a.healthy}`;
}

async function finishTest() {
  $("[data-progress]").style.width = "100%";
  resetResultScreen();
  show("result");

  const answers = state.answers;
  state.attempt = attemptNumber(); // считаем один раз: повторная отправка не должна увеличивать номер попытки
  const humanCorrect = answers.filter((a) => a.human === a.truth).length;
  const humanAvg = answers.reduce((s, a) => s + a.timeSec, 0) / answers.length;
  $("[data-human-score]").textContent = humanCorrect;
  $("[data-human-time]").textContent = fmtSec(humanAvg);

  // Таблица разбора: строка = снимок, рядом ответ человека и ответ нейросети. Сначала без ответа нейросети
  const list = $("[data-review]");
  list.innerHTML = "";
  answers.forEach((a, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <th scope="row" class="review__shot">
        <img src="images/test/${a.image}" alt="Снимок ${i + 1}">
        <span><span class="review__num">${i + 1}.</span> ${LABEL[a.truth]}</span>
      </th>
      <td class="${cellClass(a.human, a.truth)}">${LABEL[a.human]} ${mark(a.human === a.truth)}</td>
      <td data-ai-cell>…</td>`;
    list.appendChild(tr);
  });
  $("[data-review-human]").textContent = `${humanCorrect} из ${answers.length}`;

  // Нейросеть проходит те же снимки, в том же порядке. Считаем сразу все, без пауз,
  // чтобы ответы можно было отправить, не дожидаясь анимации.
  let aiOk = false;
  try {
    await withTimeout(loadModel(), 15000);
    // Первый запуск всегда медленнее (браузер готовит вычисления), поэтому делаем «разминку»
    await predict(await loadImage(`images/test/${answers[0].image}`));
    for (const a of answers) {
      const res = await predict(await loadImage(`images/test/${a.image}`));
      a.ai = res.answer;
      a.aiPneumonia = res.pPneumonia;
      a.aiMs = res.ms;
    }
    aiOk = true;
  } catch (err) {
    console.error(err);
    $("[data-ai-status]").textContent = "не загрузилась. Обновите страницу.";
    $$("[data-ai-cell]").forEach((cell) => (cell.textContent = "нет ответа"));
  }

  state.savePromise = saveResults(); // сразу, пока участник не закрыл вкладку

  // Показываем, как ИИ «идёт» по снимкам
  if (aiOk) {
    const items = Array.from(list.children);
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i];
      items[i].classList.add("is-scanning");
      const conf = Math.round((a.ai === "pneumonia" ? a.aiPneumonia : 1 - a.aiPneumonia) * 100);
      const cell = items[i].querySelector("[data-ai-cell]");
      cell.className = cellClass(a.ai, a.truth);
      cell.innerHTML = `${LABEL[a.ai]} ${mark(a.ai === a.truth)} <small class="review__conf">${conf}%</small>`;
      $("[data-ai-score]").textContent = answers.slice(0, i + 1).filter((x) => x.ai === x.truth).length;
      await wait(60); // небольшая пауза, чтобы было видно, как ИИ идёт по снимкам
      items[i].classList.remove("is-scanning");
    }
    $("[data-review-ai]").textContent = `${answers.filter((x) => x.ai === x.truth).length} из ${answers.length}`;
    const aiAvgMs = answers.reduce((s, a) => s + a.aiMs, 0) / answers.length;
    $("[data-ai-status]").textContent = `в среднем ${fmtSec(aiAvgMs / 1000)} на снимок`;
  }

  // Итог
  const aiCorrect = aiOk ? answers.filter((a) => a.ai === a.truth).length : null;
  let verdict = "Нейросеть не смогла ответить";
  if (aiOk) {
    if (humanCorrect > aiCorrect) verdict = "Вы обошли нейросеть!";
    else if (humanCorrect < aiCorrect) verdict = "Нейросеть оказалась точнее";
    else verdict = "Ничья: вы и нейросеть ответили одинаково точно";
  }
  $("[data-verdict]").textContent = verdict;
  showStats(answers, aiOk);
}

// Цвет ячейки разбора: верно, ошибка, или пропущенная пневмония (самая опасная ошибка)
function cellClass(given, truth) {
  if (given === truth) return "is-right";
  return truth === "pneumonia" ? "is-wrong is-missed" : "is-wrong";
}

function mark(ok) {
  return ok ? '<span class="yes">✓<span class="sr-only"> верно</span></span>' : '<span class="no">✗<span class="sr-only"> ошибка</span></span>';
}

// ---------------------------------------------------------------------
// Сохранение результатов в Google Таблицу
// ---------------------------------------------------------------------
function attemptNumber() {
  try {
    const n = Number(localStorage.getItem("attempts") || 0) + 1;
    localStorage.setItem("attempts", String(n));
    return n;
  } catch { return 0; } // 0 = неизвестно (например, приватный режим браузера)
}

// Отправляет данные и честно говорит, что получилось: "confirmed" — таблица ответила «ok»,
// "sent" — браузер не дал прочитать ответ (CORS), поэтому знаем только, что запрос ушёл.
async function sendPayload(payload) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain — чтобы Google принял запрос без лишних проверок
    body: JSON.stringify(payload),
    keepalive: true, // запрос дойдёт, даже если участник закроет вкладку
  };
  try {
    const res = await fetch(CONFIG.SHEET_URL, init);
    const text = (await res.text()).trim();
    if (!res.ok || text !== "ok") throw new Error("Таблица ответила: " + text);
    return "confirmed";
  } catch (err) {
    if (!(err instanceof TypeError)) throw err; // TypeError = сеть или CORS: пробуем ещё раз без чтения ответа
  }
  // Если первый запрос всё-таки дошёл, дубль отсекает Code.gs по номеру участника
  await fetch(CONFIG.SHEET_URL, { ...init, mode: "no-cors" });
  return "sent";
}

async function saveResults() {
  const status = $("[data-save-status]");
  const payload = {
    participant: state.participant,
    attempt: state.attempt,
    group: state.survey.group,
    age: state.survey.age,
    medical: state.survey.medical,
    trustBefore: state.survey.trustBefore,
    practiceCorrect: state.practiceSet.length ? state.practiceCorrect : "",
    testVersion: CONFIG.TEST_VERSION,
    device: /Mobi|Android/i.test(navigator.userAgent) ? "phone" : "computer",
    startedAt: state.startedAt,
    modelVersion: CONFIG.MODEL_VERSION,
    answers: state.answers.map((a, i) => ({
      position: i + 1,
      image: a.image,
      truth: a.truth,
      human: a.human,
      humanTimeSec: Number(a.timeSec.toFixed(2)),
      ai: a.ai ?? "",
      aiPneumonia: a.aiPneumonia === undefined ? "" : Number(a.aiPneumonia.toFixed(4)),
      aiTimeMs: a.aiMs === undefined ? "" : Number(a.aiMs.toFixed(1)),
    })),
  };

  if (!CONFIG.SHEET_URL) {
    console.info("SHEET_URL не задан, результаты не отправлены:", payload);
    status.textContent = "Режим проверки: результат не сохраняется.";
    return;
  }
  status.classList.remove("is-error");
  status.textContent = "Сохраняем результат…";
  state.saving = true;
  try {
    const outcome = await sendPayload(payload);
    status.textContent = (outcome === "confirmed" ? "Результат сохранён" : "Результат отправлен") +
      ". Спасибо за участие в исследовании!";
  } catch (err) {
    console.error(err);
    status.classList.add("is-error");
    status.innerHTML = 'Не получилось сохранить результат. Проверьте интернет и <button class="btn btn--ghost" type="button">попробуйте ещё раз</button>';
    status.querySelector("button").addEventListener("click", saveResults, { once: true });
  } finally {
    state.saving = false;
  }
}

// Ответ «а после теста?»: отправляем отдельным запросом, основной результат уже ушёл (или уходит)
async function saveTrustAfter() {
  const status = $("[data-trust-status]");
  status.classList.remove("is-error");
  if (!CONFIG.SHEET_URL) {
    console.info("SHEET_URL не задан, ответ не отправлен:", state.trustAfter);
    status.textContent = "Режим проверки: ответ не сохраняется.";
    return;
  }
  status.textContent = "Записываем ответ…";
  state.saving = true;
  try {
    await state.savePromise; // строки участника должны уже лежать в таблице
    await sendPayload({ type: "trustAfter", participant: state.participant, trustAfter: state.trustAfter });
    status.textContent = "Ответ записан, спасибо!";
  } catch (err) {
    console.error(err);
    status.classList.add("is-error");
    status.innerHTML = 'Не получилось записать ответ. <button class="btn btn--ghost" type="button">Попробовать ещё раз</button>';
    status.querySelector("button").addEventListener("click", saveTrustAfter, { once: true });
  } finally {
    state.saving = false;
  }
}

$$('[name="trustAfter"]').forEach((input) =>
  input.addEventListener("change", () => {
    state.trustAfter = input.value;
    saveTrustAfter();
  })
);

// Не даём случайно закрыть вкладку посреди теста или пока уходит результат
window.addEventListener("beforeunload", (e) => {
  const testing = !$('.screen[data-screen="test"]').hidden && state.answers.length > 0;
  if (testing || state.saving) { e.preventDefault(); e.returnValue = ""; }
});

// ---------------------------------------------------------------------
// Поделиться
// ---------------------------------------------------------------------
shareBtn.addEventListener("click", async (e) => {
  const url = location.href.split("#")[0];
  const text = "Попробуй найти пневмонию на рентгене точнее нейросети:";
  if (navigator.share) {
    try { await navigator.share({ title: document.title, text, url }); } catch { /* пользователь передумал */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    e.target.textContent = "Ссылка скопирована";
    setTimeout(() => { e.target.textContent = shareLabel; }, 2000);
  } catch {
    prompt("Скопируйте ссылку:", url);
  }
});

// ---------------------------------------------------------------------
// «Проверьте нейросеть сами»: загрузка своего снимка
// ---------------------------------------------------------------------
$("[data-upload]").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const out = $("[data-upload-result]");
  const img = $("[data-upload-image]");
  out.textContent = "Нейросеть смотрит на снимок…";
  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  $("[data-upload-box]").hidden = false;
  try {
    // onload/onerror ставим до src, иначе быстрый снимок может загрузиться раньше, чем мы начнём ждать
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("not-an-image"));
      img.src = URL.createObjectURL(file);
    });
    await loadModel();
    const res = await predict(img);
    const p = Math.round(res.pPneumonia * 100);
    out.innerHTML =
      bar("Пневмония", p) + bar("Здоров", 100 - p) +
      `<p class="meta">Ответ нейросети: <strong>${LABEL[res.answer]}</strong>. Это не диагноз: нейросеть училась только на детских рентгенах грудной клетки и может ошибаться.</p>`;
  } catch (err) {
    console.error(err);
    out.textContent = err.message === "not-an-image"
      ? "Не получилось открыть файл как картинку. Выберите снимок в формате JPG или PNG."
      : "Нейросеть не загрузилась. Обновите страницу и попробуйте снова.";
  }
});

function bar(name, pct) {
  return `<div class="bar"><span>${name}</span><span class="bar__track"><span class="bar__fill" style="display:block;width:${pct}%"></span></span><span class="bar__value">${pct}%</span></div>`;
}

// ---------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------
loadTestSet().catch((err) => {
  console.error(err);
  $('[data-go="survey"]').disabled = true;
  $("[data-demo-note]").hidden = false;
  $("[data-demo-note]").textContent = "Не удалось загрузить снимки. Обновите страницу.";
});
loadPracticeSet().catch((err) => console.error("Тренировка не загрузилась:", err));
loadModel().catch((err) => console.error("Модель не загрузилась:", err));
