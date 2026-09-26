/* ============================================================
   Family School Web — дитячий розклад
   Cloudflare Pages + KV варіант
   Оновлення:
     - вихідні (Сб/Нд): уроки заблоковані, гуртки доступні
     - кабінет — окремий бейдж у куті картки
     - вчитель/тренер — окреме поле
     - гуртки мають власний час (в самій клітинці)
   ============================================================ */
'use strict';

/* ---------- Константи ---------- */
const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const WEEKEND_DAYS = new Set(["sat","sun"]);
const DAY_FULL = {mon:"Понеділок",tue:"Вівторок",wed:"Середа",thu:"Четвер",fri:"П'ятниця",sat:"Субота",sun:"Неділя"};
const LS_DATA = "fsc.data.v1";
const LS_DIRTY = "fsc.dirty.v1";
const LS_PASSWORD = "fsc.password.v1";
const LS_UPDATED_AT = "fsc.updatedAt.v1";
const API_URL = "/api/schedule";

const SUBJECT_PALETTE = ["#ffcf44","#38c6f4","#c9a6f2","#ff8c42","#ff6b6b","#7ee081","#4c8df6","#ff9ff3","#2fbf71","#ffd32a","#ffa502","#eccc68"];
const DEFAULT_SUBJECT_COLOR = "#ffd166";

const LESSON_COUNT = 8;
const EXTRA_COUNT = 2;
const TOTAL_ROWS = LESSON_COUNT + EXTRA_COUNT;
const DEFAULT_EXTRA_START = "16:00";
const DEFAULT_EXTRA_END = "17:00";
/* ---------- Буфер обміну карток ---------- */
const clipboardState = {
  cell: null,          // копія об'єкта клітинки
  fromExtra: false     // тип джерела: гурток чи урок
};

/* ---------- Стан ---------- */
const state = {
  data: { version: 2, children: [] },
  activeChildId: null,
  hasLocalChanges: false,
  password: "",
  updatedAt: null,
  saving: false
};

/* ---------- Утиліти ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function esc(s){ return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function todayISO(){
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
}
function canEdit(){ return !!state.password; }
function isExtraRow(i){ return i >= LESSON_COUNT; }
function isWeekend(d){ return WEEKEND_DAYS.has(d); }
function isBlockedCell(day, slotIdx){ return isWeekend(day) && !isExtraRow(slotIdx); }

/* ---------- Кольори предметів ---------- */
function normSubject(s){ return String(s || "").trim().toLowerCase(); }
function getSubjectColor(child, subject){
  if (!child) return DEFAULT_SUBJECT_COLOR;
  if (!child.subjectColors) child.subjectColors = {};
  const key = normSubject(subject);
  if (key && child.subjectColors[key]) return child.subjectColors[key].color || DEFAULT_SUBJECT_COLOR;
  return DEFAULT_SUBJECT_COLOR;
}
function setSubjectColor(child, subject, color){
  if (!child || !subject || !color) return;
  if (!child.subjectColors) child.subjectColors = {};
  const key = normSubject(subject);
  child.subjectColors[key] = { name: String(subject).trim(), color };
}
function collectSubjects(child){
  const map = new Map();
  DAYS.forEach(d => {
    (child.days[d] || []).forEach(v => {
      if (v && v.subject){
        const k = normSubject(v.subject);
        if (k && !map.has(k)) map.set(k, v.subject.trim());
      }
    });
  });
  if (child.subjectColors) Object.values(child.subjectColors).forEach(e => {
    const k = normSubject(e.name);
    if (k && !map.has(k)) map.set(k, e.name);
  });
  return [...map.values()].sort((a,b) => a.localeCompare(b, "uk"));
}
function autoColorFor(child, subject){
  const key = normSubject(subject);
  if (child.subjectColors && child.subjectColors[key]) return child.subjectColors[key].color;
  const used = new Set(Object.values(child.subjectColors || {}).map(e => e.color));
  const free = SUBJECT_PALETTE.find(c => !used.has(c));
  return free || SUBJECT_PALETTE[Object.keys(child.subjectColors || {}).length % SUBJECT_PALETTE.length];
}

/* ---------- Дефолтні дзвінки ---------- */
function defaultLessonSlots(){
  return [
    { num: "1", label: "", start: "08:00", end: "08:45" },
    { num: "2", label: "", start: "08:55", end: "09:40" },
    { num: "3", label: "", start: "09:50", end: "10:35" },
    { num: "4", label: "", start: "10:45", end: "11:30" },
    { num: "5", label: "", start: "11:50", end: "12:35" },
    { num: "6", label: "", start: "12:55", end: "13:40" },
    { num: "7", label: "", start: "13:50", end: "14:35" },
    { num: "8", label: "", start: "14:45", end: "15:30" }
  ];
}
function defaultExtraSlots(){
  return [
    { num: "★1", label: "Гурток", start: "", end: "" },
    { num: "★2", label: "Гурток", start: "", end: "" }
  ];
}
function defaultSlots(){ return defaultLessonSlots().concat(defaultExtraSlots()); }

function normalizeSlots(slots){
  const list = Array.isArray(slots) ? slots.map(s => ({
    num: String(s && (s.num !== undefined && s.num !== null ? s.num : "")),
    label: (s && s.label) ? String(s.label) : "",
    start: (s && s.start) || "",
    end: (s && s.end) || ""
  })) : [];
  const dL = defaultLessonSlots(), dE = defaultExtraSlots();
  const lessons = list.slice(0, LESSON_COUNT);
  const extras = list.slice(LESSON_COUNT, TOTAL_ROWS);
  while (lessons.length < LESSON_COUNT){
    const d = dL[lessons.length];
    lessons.push({ num: String(lessons.length + 1), label: "", start: d.start, end: d.end });
  }
  while (extras.length < EXTRA_COUNT){
    const d = dE[extras.length];
    extras.push({ num: d.num, label: d.label, start: "", end: "" });
  }
  lessons.forEach((s, i) => { if (!s.num) s.num = String(i + 1); });
  extras.forEach((s, i) => { if (!s.num) s.num = "★" + (i + 1); });
  return lessons.concat(extras).slice(0, TOTAL_ROWS);
}
function emptyDaySlots(){
  const arr = [];
  for (let i = 0; i < TOTAL_ROWS; i++) arr.push(null);
  return arr;
}
function emptyDayObject(){
  const o = {};
  DAYS.forEach(d => { o[d] = emptyDaySlots(); });
  return o;
}
function normalizeCell(v){
  if (!v || typeof v !== "object") return null;
  return {
    subject: v.subject || "",
    teacher: v.teacher || "",
    room: v.room || "",
    color: v.color || "",
    start: v.start || "",
    end: v.end || ""
  };
}
function normalizeDay(arr){
  const out = Array.isArray(arr) ? arr.map(v => {
    if (v && typeof v === "object") return normalizeCell(v);
    if (typeof v === "string") return { subject: v, teacher: "", room: "", color: "", start: "", end: "" };
    return null;
  }) : [];
  while (out.length < TOTAL_ROWS) out.push(null);
  return out.slice(0, TOTAL_ROWS);
}
function newChild(name){
  const palette = ["#4c8df6","#f97072","#2fbf71","#e6a23c","#9b59b6","#23b6a9","#f06292"];
  return {
    id: uid(), name: name || "Нова дитина", class: "", color: palette[Math.floor(Math.random()*palette.length)],
    slots: defaultSlots(),
    days: emptyDayObject(),
    subjectColors: {},
    homework: [], exams: []
  };
}
function normalizeData(data){
  if (!data || typeof data !== "object") data = { version: 2, children: [] };
  if (!Array.isArray(data.children)) data.children = [];
  data.children.forEach(ch => {
    if (!ch.subjectColors) ch.subjectColors = {};
    ch.slots = normalizeSlots(ch.slots);
    if (!ch.days) ch.days = emptyDayObject();
    DAYS.forEach(d => { ch.days[d] = normalizeDay(ch.days[d]); });
    // Автозаповнення subjectColors з даних (для сумісності)
    DAYS.forEach(d => {
      (ch.days[d] || []).forEach(v => {
        if (v && v.subject && v.color){
          const k = normSubject(v.subject);
          if (k && !ch.subjectColors[k]) ch.subjectColors[k] = { name: v.subject.trim(), color: v.color };
        }
      });
    });
    // Прибираємо уроки з вихідних (безпечно, якщо колись з'явились)
    ["sat","sun"].forEach(wd => {
      for (let i = 0; i < LESSON_COUNT; i++){
        if (ch.days[wd] && ch.days[wd][i]) ch.days[wd][i] = null;
      }
    });
    if (!Array.isArray(ch.homework)) ch.homework = [];
    if (!Array.isArray(ch.exams)) ch.exams = [];
  });
  return data;
}

/* ---------- Індикатор ---------- */
function setSync(cls, title){
  const el = $("#sync-indicator");
  if (!el) return;
  el.className = "sync-indicator sync-" + cls;
  el.title = title || "";
}
function refreshIndicator(){
  if (state.saving){ setSync("busy", "Збереження на сервер…"); return; }
  if (state.hasLocalChanges){
    setSync("local", canEdit()
      ? "Є локальні зміни — натисніть «Зберегти на сервер»"
      : "Є локальні зміни (без права публікації — режим перегляду)");
    return;
  }
  if (!canEdit()){ setSync("readonly", "Режим перегляду"); return; }
  setSync("ok", "Синхронізовано з сервером" + (state.updatedAt ? " (" + fmtDate(state.updatedAt) + ")" : ""));
}
function fmtDate(iso){
  try {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, "0");
    return p(d.getDate()) + "." + p(d.getMonth()+1) + "." + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch { return iso; }
}

/* ---------- Тости ---------- */
let toastTimer = null;
function showToast(msg, kind){
  const cls = "toast toast-" + (kind || "info");
  let el = $("#toast");
  if (!el){
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.className = cls;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el) el.remove(); }, 3200);
}

/* ---------- Сховище ---------- */
function loadLocal(){
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) state.data = normalizeData(JSON.parse(raw));
    state.hasLocalChanges = localStorage.getItem(LS_DIRTY) === "1";
    state.password = localStorage.getItem(LS_PASSWORD) || "";
    state.updatedAt = localStorage.getItem(LS_UPDATED_AT) || null;
  } catch (e) {
    console.error("Помилка читання localStorage:", e);
  }
}
function saveLocal(markDirty){
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(state.data));
    if (markDirty){
      state.hasLocalChanges = true;
      localStorage.setItem(LS_DIRTY, "1");
    }
  } catch (e) {
    console.error("Помилка запису localStorage:", e);
  }
}
function clearDirty(){
  state.hasLocalChanges = false;
  localStorage.removeItem(LS_DIRTY);
}

/* ---------- API ---------- */
async function fetchRemote(){
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = await res.json();
    if (parsed && parsed.updatedAt){
      state.updatedAt = parsed.updatedAt;
      localStorage.setItem(LS_UPDATED_AT, parsed.updatedAt);
    }
    return normalizeData(parsed);
  } catch (e) {
    console.warn("Не вдалося прочитати " + API_URL + ":", e);
    return null;
  }
}
async function pushRemote(){
  if (!canEdit()){ showToast("Спершу увімкніть режим редагування", "err"); return false; }
  state.saving = true; refreshIndicator();
  try {
    const res = await fetch(API_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Edit-Password": state.password
      },
      body: JSON.stringify(state.data)
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401){
      showToast("Невірний пароль редагування", "err");
      state.saving = false; refreshIndicator();
      return false;
    }
    if (!res.ok){
      showToast("Не вдалося зберегти: " + (body.error || res.status), "err");
      state.saving = false; refreshIndicator();
      return false;
    }
    if (body.updatedAt){
      state.updatedAt = body.updatedAt;
      localStorage.setItem(LS_UPDATED_AT, body.updatedAt);
    }
    clearDirty();
    state.saving = false;
    refreshIndicator();
    renderFooter();
    showToast("Зміни збережено на сервер ✔", "ok");
    return true;
  } catch (e){
    state.saving = false;
    refreshIndicator();
    showToast("Помилка мережі: " + e.message, "err");
    return false;
  }
}

async function loadAll(){
  loadLocal();
  if (state.hasLocalChanges && state.data.children.length){
    if (!state.activeChildId) state.activeChildId = state.data.children[0].id;
    refreshIndicator();
    renderAll();
    return;
  }
  setSync("busy", "Завантаження розкладу…");
  const remote = await fetchRemote();
  if (remote){
    state.data = remote;
    saveLocal(false);
  }
  if (!state.data.children) state.data.children = [];
  if (!state.activeChildId && state.data.children.length) state.activeChildId = state.data.children[0].id;
  refreshIndicator();
  renderAll();
}

async function reloadFromRemote(){
  const doIt = async () => {
    setSync("busy", "Завантаження…");
    const remote = await fetchRemote();
    if (remote){
      state.data = remote;
      state.activeChildId = state.data.children.length ? state.data.children[0].id : null;
      clearDirty();
      saveLocal(false);
      refreshIndicator();
      renderAll();
      showToast("Дані оновлено з сервера", "ok");
    } else {
      setSync("err", "Не вдалося завантажити з сервера");
      setTimeout(refreshIndicator, 2500);
      showToast("Не вдалося завантажити", "err");
    }
  };
  if (state.hasLocalChanges){
    confirmAsync("Оновити дані з сервера? Ваші локальні незбережені зміни буде втрачено.", doIt);
  } else {
    doIt();
  }
}

function markChanged(){
  saveLocal(true);
  refreshIndicator();
  renderFooter();
}
function saveAndRender(){
  markChanged();
  renderAll();
}

/* ============ Рендеринг ============ */
function activeChild(){ return state.data.children.find(c => c.id === state.activeChildId); }
function renderAll(){ renderReadonlyBanner(); renderChildTabs(); renderToolbar(); renderContent(); renderFooter(); }

function mk(tag, cls, text, onClick){
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

function renderReadonlyBanner(){
  // Банер видалено: перегляд/редагування керується через бічне меню
  const existing = document.getElementById("readonly-banner");
  if (existing) existing.remove();
}

function renderChildTabs(){
  const nav = $("#topbar-children"); if (!nav) return;
  nav.innerHTML = "";
  if (!state.data.children.length) return;
  state.data.children.forEach(c => {
    const b = document.createElement("button");
    b.className = "child-tab" + (c.id === state.activeChildId ? " active" : "");
    b.innerHTML = '<span class="dot" style="color:' + esc(c.color) + '"></span><span>' + esc(c.name) + "</span>";
    if (canEdit()){
      const x = mk("span", "x", "×");
      x.addEventListener("click", e => { e.stopPropagation(); delChild(c.id); });
      b.appendChild(x);
    }
    b.addEventListener("click", () => { state.activeChildId = c.id; renderAll(); });
    nav.appendChild(b);
  });
}

function renderToolbar(){
  // Тулбар прибрано. Кнопку "Розклад дзвінків" рендеримо в топбарі.
  const t = $("#topbar-tools"); if (!t) return;
  t.innerHTML = "";
  const child = activeChild();
  if (!child || !canEdit()) return;
  t.append(mk("button", "tool-btn", "Розклад дзвінків", openSlotEditor));
}

function renderContent(){
  const child = activeChild(); const main = $("#content"); main.innerHTML = "";
  if (!child){
    const d = mk("div", "empty");
    d.textContent = canEdit()
      ? "Натисніть «+» вгорі, щоб додати дитину та створити розклад."
      : "Розклад ще не створено.";
    main.appendChild(d); return;
  }
  const wrap = document.createElement("div");
  wrap.style.display = "flex"; wrap.style.flexDirection = "column"; wrap.style.gap = "14px";
  wrap.appendChild(renderSchedule(child));
  wrap.appendChild(renderListCard(child, "homework", "Домашні завдання"));
  wrap.appendChild(renderListCard(child, "exams", "Контрольні та іспити"));
  main.appendChild(wrap);
}

function renderFooter(){
  const btnSave = $("#btn-save-remote");
  const btnLogout = $("#btn-logout-footer");
  if (btnSave){
    if (canEdit()){
      btnSave.hidden = false;
      btnSave.disabled = !state.hasLocalChanges || state.saving;
      btnSave.classList.toggle("pending", state.hasLocalChanges && !state.saving);
      btnSave.textContent = state.saving ? "Збереження…" : (state.hasLocalChanges ? "💾 Зберегти на сервер" : "✓ Синхронізовано");
    } else {
      btnSave.hidden = true;
    }
  }
  if (btnLogout){
    btnLogout.hidden = !canEdit();
  }
}

function renderSchedule(child){
  if (!child.subjectColors) child.subjectColors = {};
  const card = mk("div", "card");
  card.appendChild(mk("h3", null, canEdit()
    ? "Розклад на тиждень — натисніть на картку для редагування, тягніть щоб перемістити"
    : "Розклад на тиждень"));
  if (!child.slots.length){ card.appendChild(mk("div", "empty", "Немає уроків.")); return card; }
  const wrap = document.createElement("div"); wrap.className = "sched-table-wrapper";
  const table = document.createElement("table"); table.className = "sched-table";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "time-col-header"; corner.textContent = "№ / години"; hr.appendChild(corner);
  DAYS.forEach(d => {
    const th = document.createElement("th");
    th.textContent = DAY_FULL[d];
    if (isWeekend(d)) th.classList.add("weekend-th");
    hr.appendChild(th);
  });
  thead.appendChild(hr); table.appendChild(thead);

  const tbody = document.createElement("tbody");
  child.slots = normalizeSlots(child.slots);
  DAYS.forEach(d => { child.days[d] = normalizeDay(child.days[d]); });
  const editable = canEdit();

  for (let si = 0; si < TOTAL_ROWS; si++){
    const slot = child.slots[si] || {};
    const row = document.createElement("tr");
    const isExtra = isExtraRow(si);
    if (isExtra) row.classList.add("extra-row");

    // Ліва колонка часу
    const time = document.createElement("td");
    time.className = "time-cell" + (isExtra ? " extra-time" : "");
    const numTxt = slot.num || String(si + 1);
    if (isExtra){
      // Для гуртків час у лівій колонці НЕ показуємо (він у самій картці)
      const kindTxt = "Гурток";
      time.innerHTML = '<span class="slot-num">' + esc(numTxt) + '</span><span class="slot-kind">' + kindTxt + '</span>';
    } else {
      time.innerHTML = '<span class="slot-num">' + esc(numTxt) + '</span><span class="slot-kind">Урок</span><span class="slot-hours">' + esc(slot.start) + ' – ' + esc(slot.end) + '</span>';
    }
    row.appendChild(time);

    // Клітинки по днях
    DAYS.forEach(d => {
      const td = document.createElement("td");
      const slotBox = document.createElement("div");
      slotBox.className = "cell-slot" + (isExtra ? " extra-slot" : "");
      slotBox.dataset.day = d; slotBox.dataset.slot = String(si);

      const blocked = isBlockedCell(d, si);

      if (blocked){
        // Уроки у Сб/Нд — заблоковано
        const bl = mk("div", "cell-blocked", "—");
        bl.title = "Уроків у вихідні немає";
        slotBox.appendChild(bl);
      } else {
        const val = child.days[d] && child.days[d][si];
        if (val && (val.subject || val.room || val.teacher)){
          const color = val.color || getSubjectColor(child, val.subject);
          const lesson = document.createElement("div");
          lesson.className = "lesson-card" + (isExtra ? " extra-card" : "") + (editable ? "" : " readonly");
          lesson.draggable = editable;
          lesson.style.background = color;
          lesson.dataset.day = d; lesson.dataset.slot = String(si);
          const tt = [];
          if (val.subject) tt.push(val.subject);
          if (val.teacher) tt.push(val.teacher);
          if (val.room) tt.push("каб. " + val.room);
          if (isExtra && val.start && val.end) tt.push(val.start + "–" + val.end);
          lesson.title = tt.join(" • ") + (editable ? " — тягніть щоб перемістити" : "");

          // Час зверху (тільки для гуртків, якщо заданий)
          if (isExtra && val.start && val.end){
            const t = document.createElement("div");
            t.className = "time-badge";
            t.textContent = val.start + " – " + val.end;
            lesson.appendChild(t);
          }
          // Назва предмета
          const s1 = document.createElement("div"); s1.className = "lesson-subject";
          s1.textContent = val.subject || "—";
          lesson.appendChild(s1);
          // Вчитель / тренер
          if (val.teacher){
            const s2 = document.createElement("div"); s2.className = "lesson-teacher";
            s2.textContent = val.teacher;
            lesson.appendChild(s2);
          }
          // Бейдж кабінету у куті
          if (val.room){
            const b = document.createElement("div");
            b.className = "room-badge";
            b.textContent = val.room;
            b.title = "Кабінет / аудиторія: " + val.room;
            lesson.appendChild(b);
          }

          if (editable){
            lesson.addEventListener("click", () => openCellEditor(child.id, d, si));
            lesson.addEventListener("dragstart", e => {
              const copy = e.ctrlKey || e.metaKey;
              e.dataTransfer.setData("text/plain", JSON.stringify({ day: d, slot: si, copy }));
              e.dataTransfer.effectAllowed = copy ? "copy" : "move";
              dragSrc = { day: d, slot: si, copy };
              setTimeout(() => lesson.classList.add(copy ? "copy-drag" : "dragging"), 0);
            });
            lesson.addEventListener("dragend", () => {
              lesson.classList.remove("dragging");
              lesson.classList.remove("copy-drag");
              clearDragOver();
              dragSrc = null;
            });
          }
          slotBox.appendChild(lesson);
        } else {
          const empty = document.createElement("button");
          empty.type = "button";
          empty.className = "lesson-empty" + (isExtra ? " extra-add" : "") + (editable ? "" : " readonly");
          empty.textContent = editable ? (isExtra ? "+ Додати заняття" : "+ Додати урок") : "—";
          if (editable){
            empty.addEventListener("click", () => openCellEditor(child.id, d, si));
          } else {
            empty.disabled = true;
          }
          slotBox.appendChild(empty);
        }
        if (editable){
          slotBox.addEventListener("dragover", e => {
            e.preventDefault();
            const copy = e.ctrlKey || e.metaKey || (dragSrc && dragSrc.copy);
            e.dataTransfer.dropEffect = copy ? "copy" : "move";
            slotBox.classList.add("drag-over");
          });
          slotBox.addEventListener("dragleave", () => slotBox.classList.remove("drag-over"));
          slotBox.addEventListener("drop", e => {
            e.preventDefault(); slotBox.classList.remove("drag-over");
            let src = dragSrc;
            try {
              const p = JSON.parse(e.dataTransfer.getData("text/plain") || "null");
              if (p && p.day) src = p;
            } catch(_){}
            if (!src) return;
            if (isBlockedCell(d, si)){
              showToast("Уроків у вихідні немає", "err");
              return;
            }
            const fromExtra = isExtraRow(+src.slot);
            const toExtra = isExtraRow(si);
            if (fromExtra !== toExtra){
              showToast(toExtra
                ? (src.copy ? "Не можна копіювати урок у місце гуртка" : "Не можна переносити урок у місце гуртка")
                : (src.copy ? "Не можна копіювати гурток у місце уроку" : "Не можна переносити гурток у місце уроку"), "err");
              return;
            }
            // Ctrl/Cmd → копіювання, без — переміщення (як раніше)
            const isCopy = (e.ctrlKey || e.metaKey || src.copy);
            if (isCopy){
              cloneLesson(child.id, src.day, +src.slot, d, si);
            } else {
              moveLesson(child.id, src.day, +src.slot, d, si);
            }
          });
        }
      }

      td.appendChild(slotBox); row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody); wrap.appendChild(table); card.appendChild(wrap);
  return card;
}

let dragSrc = null;
function clearDragOver(){ document.querySelectorAll(".cell-slot.drag-over").forEach(el => el.classList.remove("drag-over")); }
function moveLesson(childId, fromDay, fromSlot, toDay, toSlot){
  const child = state.data.children.find(c => c.id === childId);
  if (!child) return;
  if (fromDay === toDay && fromSlot === toSlot) return;
  if (isBlockedCell(toDay, toSlot)) return;
  DAYS.forEach(d => { if (!Array.isArray(child.days[d])) child.days[d] = []; });
  const a = child.days[fromDay][fromSlot] || null;
  const b = child.days[toDay][toSlot] || null;
  child.days[toDay][toSlot] = a;
  child.days[fromDay][fromSlot] = b;
  saveAndRender();
}

/* ============ Копіювання / вставка карток ============ */

function copyCell(day, slotIdx){
  const child = activeChild();
  if (!child) return;
  const val = child.days[day][slotIdx];
  if (!val || (!val.subject && !val.teacher && !val.room)){
    showToast("Клітинка порожня — нічого копіювати", "err");
    return;
  }
  clipboardState.cell = JSON.parse(JSON.stringify(val)); // глибока копія
  clipboardState.fromExtra = isExtraRow(slotIdx);
  renderClipboardHint();
  markClipboardCard(day, slotIdx);
  showToast("Скопійовано: " + (val.subject || "заняття"), "ok");
}

function pasteCell(day, slotIdx, opts){
  opts = opts || {};
  if (!clipboardState.cell){
    showToast("Буфер порожній", "err");
    return;
  }
  if (isBlockedCell(day, slotIdx)){
    showToast("Уроків у вихідні немає", "err");
    return;
  }
  const toExtra = isExtraRow(slotIdx);
  if (toExtra !== clipboardState.fromExtra){
    showToast(toExtra
      ? "Не можна вставляти урок у місце гуртка"
      : "Не можна вставляти гурток у місце уроку", "err");
    return;
  }
  const child = activeChild();
  if (!child) return;
  const target = child.days[day][slotIdx];
  const hasContent = target && (target.subject || target.teacher || target.room);
  const doIt = () => {
    child.days[day][slotIdx] = JSON.parse(JSON.stringify(clipboardState.cell));
    saveAndRender();
    renderClipboardHint(); // залишаємо буфер — можна вставити ще раз
    showToast("Вставлено ✔", "ok");
  };
  if (hasContent && !opts.force){
    confirmAsync("Клітинка зайнята. Замінити її вміст?", doIt);
  } else {
    doIt();
  }
}

function clearClipboard(){
  clipboardState.cell = null;
  clipboardState.fromExtra = false;
  renderClipboardHint();
  document.querySelectorAll(".lesson-card.in-clipboard").forEach(el => el.classList.remove("in-clipboard"));
}

function markClipboardCard(day, slotIdx){
  document.querySelectorAll(".lesson-card.in-clipboard").forEach(el => el.classList.remove("in-clipboard"));
  const sel = '.cell-slot[data-day="' + day + '"][data-slot="' + slotIdx + '"] .lesson-card';
  const el = document.querySelector(sel);
  if (el) el.classList.add("in-clipboard");
}

function renderClipboardHint(){
  const existing = $("#clipboard-hint");
  const has = !!clipboardState.cell;
  document.body.classList.toggle("has-clipboard", has);
  if (!has){
    if (existing) existing.remove();
    return;
  }
  const label = clipboardState.cell.subject || (clipboardState.fromExtra ? "гурток" : "урок");
  const type = clipboardState.fromExtra ? "гурток" : "урок";
  if (existing){
    const txt = existing.querySelector(".cb-text");
    if (txt) txt.innerHTML = "📋 У буфері (" + type + "): <b>" + esc(label) + "</b>";
    return;
  }
  const hint = document.createElement("div");
  hint.id = "clipboard-hint";
  hint.className = "clipboard-hint";
  hint.innerHTML = '<span class="cb-text">📋 У буфері (' + type + '): <b>' + esc(label) + '</b></span>';
  const btn = document.createElement("button");
  btn.className = "cb-clear";
  btn.title = "Очистити буфер (Esc)";
  btn.textContent = "✕";
  btn.addEventListener("click", clearClipboard);
  hint.appendChild(btn);
  document.body.appendChild(hint);
}

function cloneLesson(childId, fromDay, fromSlot, toDay, toSlot){
  const child = state.data.children.find(c => c.id === childId);
  if (!child) return;
  if (isBlockedCell(toDay, toSlot)) return;
  if (isExtraRow(fromSlot) !== isExtraRow(toSlot)){
    showToast("Не можна копіювати між уроками й гуртками", "err");
    return;
  }
  const src = child.days[fromDay][fromSlot];
  if (!src) return;
  const target = child.days[toDay][toSlot];
  const hasContent = target && (target.subject || target.teacher || target.room);
  const doIt = () => {
    child.days[toDay][toSlot] = JSON.parse(JSON.stringify(src));
    saveAndRender();
    showToast("Скопійовано ✔", "ok");
  };
  if (hasContent){
    confirmAsync("Клітинка зайнята. Замінити її вміст?", doIt);
  } else {
    doIt();
  }
}

function renderListCard(child, kind, title){
  const card = mk("div", "card");
  card.appendChild(mk("h3", null, title));
  const list = document.createElement("div"); list.className = "list";
  const editable = canEdit();
  (child[kind] || []).forEach(it => {
    const row = mk("div", "list-item"); row.style.color = child.color;
    const bar = mk("span", "bar"); bar.style.background = child.color;
    const txt = mk("span", "txt"); const meta = mk("span", "meta");
    if (kind === "homework"){
      txt.textContent = (it.subject ? it.subject + " — " : "") + (it.text || "");
      meta.textContent = (it.date || "") + (it.class ? " • " + it.class : "");
      const toggle = document.createElement("input");
      toggle.type = "checkbox"; toggle.checked = !!it.done;
      toggle.disabled = !editable;
      if (editable) toggle.addEventListener("change", () => { it.done = toggle.checked; saveAndRender(); });
      row.appendChild(toggle);
    } else {
      txt.textContent = (it.subject || "") + (it.text ? " — " + it.text : "");
      meta.textContent = (it.date || "") + (it.room ? " • " + it.room : "");
    }
    row.appendChild(bar); row.appendChild(txt); row.appendChild(meta);
    if (editable) row.appendChild(mk("button", "btn ghost", "…", () => openItemEditor(kind, it)));
    list.appendChild(row);
  });
  card.appendChild(list);
  if (editable) card.appendChild(mk("button", "add-btn", "+ Додати", () => openItemEditor(kind)));
  return card;
}

/* ============ Модальні вікна ============ */
function show(id){ const m = $("#" + id); if (m) m.hidden = false; }
function hide(id){ const m = $("#" + id); if (m) m.hidden = true; }
function focusField(id){ const f = $("#" + id); if (f && f.select) f.select(); }

/* --- Комірка розкладу --- */
let cellCtx = null;
let cellColorSel = DEFAULT_SUBJECT_COLOR;
function buildPalette(child, current){
  const pal = $("#cell-palette"); if (!pal) return;
  pal.innerHTML = "";
  cellColorSel = current || DEFAULT_SUBJECT_COLOR;
  SUBJECT_PALETTE.forEach(c => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "color-swatch" + (c === cellColorSel ? " active" : "");
    b.style.background = c; b.title = c;
    b.addEventListener("click", () => {
      cellColorSel = c;
      const cc = $("#cell-color"); if (cc) cc.value = c;
      pal.querySelectorAll(".color-swatch").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    pal.appendChild(b);
  });
  const cc = $("#cell-color");
  if (cc){ cc.value = cellColorSel; cc.oninput = () => {
    cellColorSel = cc.value;
    pal.querySelectorAll(".color-swatch").forEach(x => x.classList.toggle("active", x.title === cellColorSel));
  }; }
}
function openCellEditor(childId, day, slotIdx){
  if (!canEdit()) return;
  const child = state.data.children.find(c => c.id === childId);
  if (!child) return;
  if (isBlockedCell(day, slotIdx)) return;
  if (!child.subjectColors) child.subjectColors = {};
  cellCtx = { childId, day, slotIdx };
  const slot = child.slots[slotIdx];
  const val = child.days[day][slotIdx] || {};
  const isExtra = isExtraRow(slotIdx);

  // Заголовок і мітки
  if (isExtra){
    $("#cell-title").textContent = DAY_FULL[day] + " • Гурток " + (slotIdx - LESSON_COUNT + 1);
    $("#cell-teacher-label").textContent = "Тренер / керівник (необов'язково)";
    $("#cell-teacher").placeholder = "Наприклад: тр. Іваненко";
    $("#cell-subject").placeholder = "Наприклад: Плавання";
  } else {
    $("#cell-title").textContent = DAY_FULL[day] + " • " + (slot.start) + "–" + (slot.end);
    $("#cell-teacher-label").textContent = "Вчитель (необов'язково)";
    $("#cell-teacher").placeholder = "Наприклад: Гриценко О.В.";
    $("#cell-subject").placeholder = "Наприклад: Математика";
  }

  // Поля значень
  $("#cell-subject").value = val.subject || "";
  $("#cell-teacher").value = val.teacher || "";
  $("#cell-room").value = val.room || "";

  // Час — тільки для гуртків
  const timeField = $("#cell-time-field");
  if (isExtra){
    timeField.hidden = false;
    $("#cell-start").value = val.start || DEFAULT_EXTRA_START;
    $("#cell-end").value = val.end || DEFAULT_EXTRA_END;
  } else {
    timeField.hidden = true;
    $("#cell-start").value = "";
    $("#cell-end").value = "";
  }

  // Datalist існуючих предметів
  const dl = $("#subjects-datalist");
  if (dl){ dl.innerHTML = ""; collectSubjects(child).forEach(n => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); }); }

  // Колір
  const cur = val.color || (val.subject ? getSubjectColor(child, val.subject) : autoColorFor(child, $("#cell-subject").value));
  buildPalette(child, cur);

  // Автопідстановка кольору при введенні відомого предмета
  $("#cell-subject").oninput = e => {
    const name = e.target.value;
    const k = normSubject(name);
    if (child.subjectColors[k]){
      cellColorSel = child.subjectColors[k].color;
      const cc = $("#cell-color"); if (cc) cc.value = cellColorSel;
      document.querySelectorAll("#cell-palette .color-swatch").forEach(x => x.classList.toggle("active", x.title === cellColorSel));
    }
  };
  // Показуємо кнопку «Вставити» лише коли в буфері є щось сумісного типу
  const pasteBtn = $("#btn-paste-cell");
  if (pasteBtn){
    const canPaste = !!clipboardState.cell && (clipboardState.fromExtra === isExtra);
    pasteBtn.hidden = !canPaste;
  }
  show("modal-cell"); focusField("cell-subject");
}
function commitCell(){
  if (!cellCtx) return;
  const child = state.data.children.find(c => c.id === cellCtx.childId);
  if (!child){ hide("modal-cell"); cellCtx = null; return; }
  const isExtra = isExtraRow(cellCtx.slotIdx);
  const subject = $("#cell-subject").value.trim();
  const teacher = $("#cell-teacher").value.trim();
  const room = $("#cell-room").value.trim();
  const color = cellColorSel || $("#cell-color").value;
  const start = isExtra ? ($("#cell-start").value || DEFAULT_EXTRA_START) : "";
  const end = isExtra ? ($("#cell-end").value || DEFAULT_EXTRA_END) : "";

  if (subject) setSubjectColor(child, subject, color);

  const cell = (subject || teacher || room)
    ? { subject, teacher, room, color, start, end }
    : null;
  child.days[cellCtx.day][cellCtx.slotIdx] = cell;

  const ctx = cellCtx;
  hide("modal-cell"); cellCtx = null; saveAndRender();
  // Якщо в буфері була саме ця картка — оновимо її
  if (clipboardState.cell) markClipboardCard(ctx.day, ctx.slotIdx);
}
function clearCell(){
  if (!cellCtx) return;
  const child = state.data.children.find(c => c.id === cellCtx.childId);
  if (child) child.days[cellCtx.day][cellCtx.slotIdx] = null;
  hide("modal-cell"); cellCtx = null; saveAndRender();
}

/* --- Дзвінки (тільки уроки 1–8) --- */
let slotCtx = null;
function openSlotEditor(){
  if (!canEdit()) return;
  const child = activeChild(); if (!child) return;
  slotCtx = child;
  child.slots = normalizeSlots(child.slots);
  $("#slot-title").textContent = "Розклад дзвінків: " + child.name;
  const lessons = child.slots.slice(0, LESSON_COUNT);
  const lessonsHtml = lessons.map((s, i) => `
    <div class="slot-row" data-idx="${i}">
      <span class="slot-row-num">${i + 1}</span>
      <input type="time" class="slot-start" value="${esc(s.start || '08:00')}">
      <span class="slot-dash">–</span>
      <input type="time" class="slot-end" value="${esc(s.end || '08:45')}">
    </div>
  `).join("");
  const lList = $("#slot-lessons-list"); if (lList) lList.innerHTML = lessonsHtml;
  show("modal-slots");
}
function commitSlots(){
  if (!slotCtx) return;
  const newLessons = [];
  document.querySelectorAll("#slot-lessons-list .slot-row").forEach((row, i) => {
    const st = row.querySelector(".slot-start");
    const en = row.querySelector(".slot-end");
    newLessons.push({
      num: String(i + 1), label: "",
      start: (st && st.value) || "08:00",
      end: (en && en.value) || "08:45"
    });
  });
  // Гуртки в slots залишаємо як є (для сумісності структури, час у клітинках)
  const oldExtras = slotCtx.slots.slice(LESSON_COUNT, TOTAL_ROWS);
  const extras = [
    { num: "★1", label: (oldExtras[0] && oldExtras[0].label) || "Гурток", start: "", end: "" },
    { num: "★2", label: (oldExtras[1] && oldExtras[1].label) || "Гурток", start: "", end: "" }
  ];
  slotCtx.slots = normalizeSlots(newLessons.concat(extras));
  DAYS.forEach(d => { slotCtx.days[d] = normalizeDay(slotCtx.days[d]); });
  hide("modal-slots"); slotCtx = null; saveAndRender();
}

/* --- Домашка / контрольна --- */
let itemCtx = { kind: null, childId: null, item: null };
function openItemEditor(kind, item){
  if (!canEdit()) return;
  const child = activeChild(); if (!child) return;
  itemCtx = { kind, childId: child.id, item: item || null };
  const isHw = kind === "homework";
  $("#item-title").textContent = (item ? "Редагувати" : "Додати") + (isHw ? " домашнє завдання" : " контрольну / іспит");
  $("#item-subject").value = (item && item.subject) || "";
  $("#item-text").value = (item && item.text) || "";
  $("#item-date").value = (item && item.date) || todayISO();
  $("#item-extra").value = (item && (isHw ? item.class : item.room)) || "";
  $("#item-extra").placeholder = isHw ? "Клас / примітка" : "Кабінет";
  $("#item-extra-label").textContent = isHw ? "Клас або примітка (необов'язково)" : "Кабінет (необов'язково)";
  const delBtn = $("#btn-delete-item");
  if (delBtn) delBtn.hidden = !item;
  show("modal-item"); focusField("item-subject");
}
function commitItem(){
  if (!itemCtx || !itemCtx.childId) return;
  const child = state.data.children.find(c => c.id === itemCtx.childId);
  if (!child){ hide("modal-item"); itemCtx = { kind: null, childId: null, item: null }; return; }
  const isHw = itemCtx.kind === "homework";
  const subject = $("#item-subject").value.trim();
  const text = $("#item-text").value.trim();
  const date = $("#item-date").value;
  const extra = $("#item-extra").value.trim();
  if (itemCtx.item){
    const it = itemCtx.item;
    it.subject = subject; it.text = text; it.date = date;
    if (isHw) it.class = extra; else it.room = extra;
  } else {
    const it = { id: uid(), subject, text, date };
    if (isHw){ it.done = false; it.class = extra; } else { it.room = extra; }
    (child[itemCtx.kind] || (child[itemCtx.kind] = [])).push(it);
  }
  hide("modal-item"); itemCtx = { kind: null, childId: null, item: null }; saveAndRender();
}
function deleteItem(){
  if (!itemCtx || !itemCtx.item || !itemCtx.childId) return;
  const child = state.data.children.find(c => c.id === itemCtx.childId);
  if (!child){ hide("modal-item"); return; }
  const kind = itemCtx.kind;
  const targetId = itemCtx.item.id;
  confirmAsync("Видалити цей запис безповоротно?", () => {
    child[kind] = (child[kind] || []).filter(x => x.id !== targetId);
    hide("modal-item"); itemCtx = { kind: null, childId: null, item: null }; saveAndRender();
  });
}

/* --- Діти --- */
function openChildModal(){
  if (!canEdit()){ showToast("Спершу увімкніть режим редагування", "err"); return; }
  $("#modal-child-title").textContent = "Нова дитина";
  $("#child-name").value = ""; $("#child-class").value = ""; $("#child-color").value = "#4c8df6";
  show("modal-child"); focusField("child-name");
}
function saveChild(){
  const c = newChild($("#child-name").value.trim());
  c.class = $("#child-class").value.trim();
  c.color = $("#child-color").value;
  state.data.children.push(c);
  state.activeChildId = c.id;
  hide("modal-child"); saveAndRender();
}
function delChild(id){
  const c = state.data.children.find(x => x.id === id) || {};
  confirmAsync("Видалити дитину «" + c.name + "» та весь її розклад?", () => {
    state.data.children = state.data.children.filter(x => x.id !== id);
    if (state.activeChildId === id) state.activeChildId = state.data.children.length ? state.data.children[0].id : null;
    saveAndRender();
  });
}

/* --- Підтвердження --- */
let confirmCb = null;
function confirmAsync(msg, onOk){
  $("#confirm-msg").textContent = msg;
  confirmCb = onOk;
  show("modal-confirm");
}

/* ============ Налаштування ============ */
function openSettings(){
  $("#set-password").value = state.password || "";
  const s = $("#settings-status");
  if (s){
    if (canEdit()){ s.textContent = "✓ Режим редагування увімкнено"; s.className = "status ok"; }
    else { s.textContent = "Режим перегляду"; s.className = "status"; }
  }
  show("modal-settings"); focusField("set-password");
}
async function saveSettings(){
  const pw = $("#set-password").value.trim();
  if (!pw){ showToast("Введіть пароль", "err"); return; }
  const oldPw = state.password;
  state.password = pw;
  const ok = await verifyPassword();
  if (ok){
    localStorage.setItem(LS_PASSWORD, pw);
    const s = $("#settings-status");
    if (s){ s.textContent = "✓ Пароль прийнято. Тепер ви можете редагувати."; s.className = "status ok"; }
    hide("modal-settings");
    refreshIndicator();
    renderAll();
    showToast("Режим редагування увімкнено ✔", "ok");
  } else {
    state.password = oldPw;
    const s = $("#settings-status");
    if (s){ s.textContent = "✗ Невірний пароль"; s.className = "status err"; }
  }
}
async function verifyPassword(){
  try {
    const res = await fetch(API_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Edit-Password": state.password
      },
      body: JSON.stringify(state.data)
    });
    if (res.status === 401) return false;
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    if (body.updatedAt){
      state.updatedAt = body.updatedAt;
      localStorage.setItem(LS_UPDATED_AT, body.updatedAt);
    }
    if (state.hasLocalChanges) clearDirty();
    return true;
  } catch (e){
    return false;
  }
}
function doLogout(){
  state.password = "";
  localStorage.removeItem(LS_PASSWORD);
  hide("modal-settings");
  refreshIndicator();
  renderAll();
  showToast("Режим редагування вимкнено", "info");
}

/* ============ Експорт / імпорт ============ */
function doExport(){
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "schedule.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function doImport(file){
  if (!canEdit()){ showToast("Спершу увімкніть режим редагування", "err"); return; }
  if (!file) return;
  file.text().then(text => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.children)){
        state.data = normalizeData(parsed);
        state.activeChildId = state.data.children.length ? state.data.children[0].id : null;
        saveAndRender();
        showToast("Імпорт успішно завершено ✔", "ok");
      } else {
        showToast("Некоректний формат файлу", "err");
      }
    } catch (e){
      showToast("Помилка JSON: " + e.message, "err");
    }
  }).catch(e => showToast("Помилка: " + e.message, "err"));
}

/* ============ Бічне меню ============ */
function buildSidebar(){
  const nav = $("#sidebar-nav"); nav.innerHTML = "";
  const links = [
    ["Додати дитину", openChildModal],
    ["Розклад дзвінків", openSlotEditor],
    ["Оновити з сервера", reloadFromRemote],
    ["Режим редагування", openSettings],
    ["Експорт JSON", doExport],
    ["Імпорт JSON", () => $("#import-file").click()]
  ];
  links.forEach(l => { const b = mk("button", "side-link", l[0], () => { closeSidebar(); l[1](); }); nav.appendChild(b); });
}
function openSidebar(){ $("#scrim").hidden = false; const s = $("#sidebar"); s.hidden = false; setTimeout(() => s.classList.add("open"), 10); }
function closeSidebar(){ const s = $("#sidebar"); s.classList.remove("open"); setTimeout(() => { $("#scrim").hidden = true; if (s) s.hidden = true; }, 200); }

/* ============ Обробники ============ */
function wireEvents(){
  const c = (id, fn) => { const el = $("#" + id); if (el) el.addEventListener("click", fn); };
  c("btn-add-child", openChildModal);
  c("btn-save-child", saveChild);
  c("btn-cancel-child", () => hide("modal-child"));
  c("btn-save-cell", commitCell);
  c("btn-clear-cell", clearCell);
  c("btn-cancel-cell", () => hide("modal-cell"));
  c("btn-save-slots", commitSlots);
  c("btn-cancel-slots", () => hide("modal-slots"));
  c("btn-save-item", commitItem);
  c("btn-delete-item", deleteItem);
  c("btn-cancel-item", () => hide("modal-item"));
  c("btn-confirm-ok", () => { hide("modal-confirm"); const cb = confirmCb; confirmCb = null; if (cb) cb(); });
  c("btn-confirm-no", () => { hide("modal-confirm"); confirmCb = null; });
  c("btn-save-settings", saveSettings);
  c("btn-logout", doLogout);
  c("btn-save-remote", pushRemote);
  c("btn-logout-footer", doLogout);
  c("btn-reload-remote", reloadFromRemote);
  c("btn-export", doExport);
  c("btn-import", () => $("#import-file").click());
  c("btn-menu", openSidebar);
  c("btn-sidebar-close", closeSidebar);
  const scrim = $("#scrim"); if (scrim) scrim.addEventListener("click", closeSidebar);
  const importFile = $("#import-file"); if (importFile) importFile.addEventListener("change", e => doImport(e.target.files[0]));
  c("btn-copy-cell", () => {
    if (!cellCtx) return;
    copyCell(cellCtx.day, cellCtx.slotIdx);
  });
  c("btn-paste-cell", () => {
    if (!cellCtx) return;
    const ctx = cellCtx;
    hide("modal-cell"); cellCtx = null;
    pasteCell(ctx.day, ctx.slotIdx);
  });
  window.addEventListener("keydown", e => {
    if (!canEdit()) return;
    // Ctrl+S — зберегти на сервер
    if ((e.ctrlKey || e.metaKey) && e.key === "s"){
      e.preventDefault();
      if (state.hasLocalChanges) pushRemote();
      return;
    }
    // Esc — очистити буфер
    if (e.key === "Escape" && clipboardState.cell){
      clearClipboard();
      showToast("Буфер очищено", "info");
      return;
    }
    // Ctrl+C / Ctrl+V працюють ТІЛЬКИ коли відкрита модалка клітинки
    // (щоб не заважати звичайному копіюванню тексту зі сторінки)
    const modalOpen = cellCtx && !$("#modal-cell").hidden;
    if (!modalOpen) return;
    // Не перехоплюємо, якщо фокус у полі вводу
    const inField = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c"){
      e.preventDefault();
      copyCell(cellCtx.day, cellCtx.slotIdx);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v"){
      e.preventDefault();
      const ctx = cellCtx;
      hide("modal-cell"); cellCtx = null;
      pasteCell(ctx.day, ctx.slotIdx);
    }
  });
  window.addEventListener("beforeunload", e => {
    if (state.hasLocalChanges && canEdit()){
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  buildSidebar();
  loadAll();
});