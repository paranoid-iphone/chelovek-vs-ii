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
$$('.choice input[type="radio"]').forEach((input) =>
  input.addEventListener("change", () => {
    state.survey[input.name] = input.value;
    $('[data-action="survey-next"]').disabled = !(state.survey.group && state.survey.medical);
  })
);
$('[data-action="survey-next"]').addEventListener("click", () => show("learn"));

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

$('[data-action="start-test"]').addEventListener("click", () => {
  state.order = shuffle(state.testSet);
  state.index = 0;
  state.answers = [];
  state.participant = newId();
  state.startedAt = new Date().toISOString();
  state.order.forEach((item) => { const i = new Image(); i.src = item.file; }); // заранее загружаем все снимки
  show("test");
  showImage();
});

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
  if ($('.screen[data-screen="test"]').hidden) return;
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return; // зажатая клавиша не должна отвечать на несколько снимков
  if (e.key === "1") answer("normal");
  if (e.key === "2") answer("pneumonia");
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

  // Карточки разбора: сначала без ответа нейросети
  const list = $("[data-review]");
  list.innerHTML = "";
  answers.forEach((a, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <img src="images/test/${a.image}" alt="Снимок ${i + 1}">
      <div>
        <p class="truth">${i + 1}. На самом деле: ${LABEL[a.truth]}</p>
        <p>Вы: ${LABEL[a.human]} ${mark(a.human === a.truth)}</p>
        <p data-ai-row>ИИ: …</p>
      </div>`;
    if (a.truth === "pneumonia" && a.human === "normal") li.classList.add("is-missed");
    list.appendChild(li);
  });

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
  }

  saveResults(); // сразу, пока участник не закрыл вкладку

  // Показываем, как ИИ «идёт» по снимкам
  if (aiOk) {
    const items = Array.from(list.children);
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i];
      items[i].classList.add("is-scanning");
      const conf = Math.round((a.ai === "pneumonia" ? a.aiPneumonia : 1 - a.aiPneumonia) * 100);
      items[i].querySelector("[data-ai-row]").innerHTML =
        `ИИ: ${LABEL[a.ai]} (уверен на ${conf}%) ${mark(a.ai === a.truth)}`;
      $("[data-ai-score]").textContent = answers.slice(0, i + 1).filter((x) => x.ai === x.truth).length;
      await wait(60); // небольшая пауза, чтобы было видно, как ИИ идёт по снимкам
      items[i].classList.remove("is-scanning");
    }
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
    medical: state.survey.medical,
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
loadModel().catch((err) => console.error("Модель не загрузилась:", err));
