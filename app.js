/* ============================================================
   Family School Web - dziecy rozklad
   Statyczny serwis dla GitHub Pages + GitHub Gist synchronizacja
   ============================================================ */
'use strict';

/* ---------- Konstancje ---------- */
const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_SHORT = {mon:"Пн",tue:"Вт",wed:"Ср",thu:"Чт",fri:"Пт",sat:"Сб",sun:"Нд"};
const DAY_FULL  = {mon:"Понеділок",tue:"Вівторок",wed:"Середа",thu:"Четвер",fri:"П'ятниця",sat:"Субота",sun:"Неділя"};
const LS_DATA = "fsc.data.v1";
const LS_SETTINGS = "fsc.settings.v1";
const GIST_FILENAME = "schedule.json";
const GIST_API = "https://api.github.com";

/* Палітра предметів як на малюнку */
const SUBJECT_PALETTE = ["#ffcf44","#38c6f4","#c9a6f2","#ff8c42","#ff6b6b","#7ee081","#4c8df6","#ff9ff3","#2fbf71","#ffd32a","#ffa502","#eccc68"];
const DEFAULT_SUBJECT_COLOR = "#ffd166";

/* ---------- Нормалізація назв предметів ---------- */
function normSubject(s){ return String(s || "").trim().toLowerCase(); }
function getSubjectColor(child, subject){
  if (!child) return DEFAULT_SUBJECT_COLOR;
  if (!child.subjectColors) child.subjectColors = {};
  const key = normSubject(subject);
  if (key && child.subjectColors[key]) return child.subjectColors[key].color || DEFAULT_SUBJECT_COLOR;
  // зворотна сумісність: колір міг лежати в картці
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
  // призначити перший вільний колір з палітри
  const used = new Set(Object.values(child.subjectColors || {}).map(e => e.color));
  const free = SUBJECT_PALETTE.find(c => !used.has(c));
  return free || SUBJECT_PALETTE[Object.keys(child.subjectColors || {}).length % SUBJECT_PALETTE.length];
}

/* ---------- Stan aplikacji ---------- */
const state = {
  data: { version: 1, children: [] },
  settings: { token: "", gistId: "" },
  activeChildId: null
};

/* ---------- Pomocnicze ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function todayKey(){ const d = new Date(); return DAYS[(d.getDay() + 6) % 7]; }
function esc(s){ return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function todayISO(){ const d = new Date(); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate()); }

const LESSON_COUNT = 8;
const EXTRA_COUNT = 2;
const TOTAL_ROWS = LESSON_COUNT + EXTRA_COUNT;

function defaultLessonSlots(){
  return [
    { num: "1", label: "", start: "08:00", end: "08:45" },
    { num: "2", label: "", start: "08:55", end: "09:40" },
    { num: "3", label: "", start: "09:50", end: "10:35" },
    { num: "4", label: "", start: "10:50", end: "11:35" },
    { num: "5", label: "", start: "11:45", end: "12:30" },
    { num: "6", label: "", start: "12:40", end: "13:25" },
    { num: "7", label: "", start: "13:35", end: "14:20" },
    { num: "8", label: "", start: "14:30", end: "15:15" }
  ];
}
function defaultExtraSlots(){
  return [
    { num: "★1", label: "Гурток 1", start: "16:00", end: "17:00" },
    { num: "★2", label: "Гурток 2", start: "17:15", end: "18:15" }
  ];
}
function defaultSlots(){
  return defaultLessonSlots().concat(defaultExtraSlots());
}
function isExtraRow(i){ return i >= LESSON_COUNT; }
function normalizeSlots(slots){
  const list = Array.isArray(slots) ? slots.map(s => ({
    num: String(s && (s.num !== undefined && s.num !== null ? s.num : (s.label !== undefined && s.label !== null ? s.label : ""))),
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
    extras.push({ num: d.num, label: d.label, start: d.start, end: d.end });
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
function normalizeDay(arr){
  const out = Array.isArray(arr) ? arr.map(v => {
    if (v && typeof v === "object") return { subject: v.subject || "", room: v.room || "", color: v.color || "" };
    if (typeof v === "string") return { subject: v, room: "", color: "" };
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
/* ---------- Warstwy przechowywania ---------- */
function loadLocal(){
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) state.data = JSON.parse(raw);
    const s = localStorage.getItem(LS_SETTINGS);
    if (s) state.settings = JSON.parse(s);
    migrateSubjectColors();
  } catch (e) { console.error("local load", e); }
}
function migrateSubjectColors(){
  try {
    (state.data.children || []).forEach(ch => {
      if (!ch.subjectColors) ch.subjectColors = {};
      DAYS.forEach(d => {
        (ch.days[d] || []).forEach(v => {
          if (v && v.subject && v.color){
            const k = normSubject(v.subject);
            if (k && !ch.subjectColors[k]) ch.subjectColors[k] = { name: v.subject.trim(), color: v.color };
          }
        });
      });
    });
  } catch(_){}
}
function saveLocal(){
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(state.data));
    localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
  } catch (e) { console.error("local save", e); }
}

function setSync(cls, title){ const el = $("#sync-indicator"); if (!el) return; el.className = "sync-indicator sync-" + cls; el.title = title || ""; }

async function gistFetch(){
  if (!state.settings.gistId) return null;
  const h = { Accept: "application/vnd.github+json", "User-Agent": "fsc-web" };
  if (state.settings.token) h.Authorization = "Bearer " + state.settings.token;
  const r = await fetch(GIST_API + "/gists/" + state.settings.gistId, { headers: h });
  if (r.status === 404) return "missing";
  if (!r.ok) return null;
  const g = await r.json();
  const f = Object.values(g.files)[0];
  if (f && f.content){ try { return JSON.parse(f.content); } catch (e) { return "corrupt"; } }
  return null;
}

async function gistPush(data){
  const body = {
    description: "Family School Web - rozklad dzieci",
    public: false,
    files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } }
  };
  const h = { "Content-Type": "application/json", Accept: "application/vnd.github+json", "User-Agent": "fsc-web" };
  if (state.settings.token) h.Authorization = "Bearer " + state.settings.token;
  let url = GIST_API + "/gists", method = "POST";
  if (state.settings.gistId){ url += "/" + state.settings.gistId; method = "PATCH"; }
  const r = await fetch(url, { method, headers: h, body: JSON.stringify(body) });
  if (!r.ok) return null;
  const g = await r.json();
  return g.id;
}

async function loadAll(){
  loadLocal();
  let remote = null;
  if (state.settings.gistId){
    setSync("busy", "Завантаження з Gist…");
    remote = await gistFetch();
    if (remote && remote !== "missing" && remote !== "corrupt") state.data = remote;
  }
  if (!state.data.children) state.data.children = [];
  state.data.children.forEach(ch => {
    ch.slots = normalizeSlots(ch.slots);
    if (!ch.days) ch.days = emptyDayObject();
    DAYS.forEach(d => { ch.days[d] = normalizeDay(ch.days[d]); });
  });
  if (!state.activeChildId && state.data.children.length) state.activeChildId = state.data.children[0].id;
  syncIndicator();
  renderAll();
  if (remote === "corrupt") setSync("err", "Gist пошкоджено — дані завантажено локально");
  return remote;
}

async function saveAll(){
  saveLocal();
  if (state.settings.gistId){
    setSync("busy", "Збереження в Gist…");
    const id = await gistPush(state.data);
    if (id){ state.settings.gistId = id; saveLocal(); setSync("ok", "Синхронізація активна"); }
    else setSync("err", "Не вдалося зберегти — перевірте токен або Gist ID");
  } else {
    setSync("off", "Gist не налаштовано — дані лише локально");
  }
}

function syncIndicator(){ state.settings.gistId ? setSync("ok", "Синхронізація активна") : setSync("off", "Gist не налаштовано"); }
/* ============ Renderowanie ============ */
function activeChild(){ return state.data.children.find(c => c.id === state.activeChildId); }
function renderAll(){ renderChildTabs(); renderToolbar(); renderContent(); }

function mk(tag, cls, text, onClick){
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

function renderChildTabs(){
  const nav = $("#child-tabs"); nav.innerHTML = "";
  if (!state.data.children.length){ nav.appendChild(mk("span", "muted", "Ще немає дітей")); return; }
  state.data.children.forEach(c => {
    const b = document.createElement("button");
    b.className = "child-tab" + (c.id === state.activeChildId ? " active" : "");
    b.innerHTML = '<span class="dot" style="color:' + esc(c.color) + '"></span><span>' + esc(c.name) + "</span>";
    const x = mk("span", "x", "x");
    x.addEventListener("click", e => { e.stopPropagation(); delChild(c.id); });
    b.appendChild(x);
    b.addEventListener("click", () => { state.activeChildId = c.id; renderAll(); });
    nav.appendChild(b);
  });
}

function renderToolbar(){
  const t = $("#toolbar"); t.innerHTML = "";
  const child = activeChild();
  if (!child){ t.hidden = true; return; }
  t.hidden = false;
  const seg = mk("span", "muted", child.class ? child.name + " • " + child.class : child.name);
  seg.style.fontSize = "13px";
  const editSlots = mk("button", "tool-btn", "Розклад дзвінків", openSlotEditor);
  const addHw = mk("button", "tool-btn", "+ Домашка", () => openItemEditor("homework"));
  const addEx = mk("button", "tool-btn", "+ Контрольна", () => openItemEditor("exams"));
  const del = mk("button", "tool-btn", "Видалити"); del.style.color = "var(--err)";
  del.addEventListener("click", () => delChild(child.id));
  t.append(seg, editSlots, addHw, addEx, del);
}

function renderContent(){
  const child = activeChild(); const main = $("#content"); main.innerHTML = "";
  if (!child){
    const d = mk("div", "empty");
    d.textContent = "Натисніть «+» вгорі, щоб додати дитину та створити розклад.";
    main.appendChild(d); return;
  }
  const wrap = document.createElement("div");
  wrap.style.display = "flex"; wrap.style.flexDirection = "column"; wrap.style.gap = "14px";
  wrap.appendChild(renderSchedule(child));
  wrap.appendChild(renderListCard(child, "homework", "Домашні завдання"));
  wrap.appendChild(renderListCard(child, "exams", "Контрольні та іспити"));
  main.appendChild(wrap);
}
function renderSchedule(child){
  if (!child.subjectColors) child.subjectColors = {};
  const card = mk("div", "card");
  card.appendChild(mk("h3", null, "Розклад на тиждень — натисніть на картку для редагування, тягніть щоб перемістити"));
  if (!child.slots.length){ card.appendChild(mk("div", "empty", "Немає уроків. Натисніть «Розклад дзвінків», щоб задати час.")); return card; }
  const wrap = document.createElement("div"); wrap.className = "sched-table-wrapper";
  const table = document.createElement("table"); table.className = "sched-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "time-col-header"; corner.textContent = "№ уроку / години"; hr.appendChild(corner);
  DAYS.forEach(d => { const th = document.createElement("th"); th.textContent = DAY_FULL[d]; hr.appendChild(th); });
  thead.appendChild(hr); table.appendChild(thead);
  const tbody = document.createElement("tbody");

  child.slots = normalizeSlots(child.slots);
  DAYS.forEach(d => { child.days[d] = normalizeDay(child.days[d]); });

  for (let si = 0; si < TOTAL_ROWS; si++){
    const slot = child.slots[si] || {};
    const row = document.createElement("tr");
    if (isExtraRow(si)) row.classList.add("extra-row");

    const time = document.createElement("td");
    time.className = "time-cell" + (isExtraRow(si) ? " extra-time" : "");
    const numTxt = slot.num || String(si + 1);
    const kindTxt = slot.label ? esc(slot.label) : (isExtraRow(si) ? "Додаткове" : "Урок");
    time.innerHTML = '<span class="slot-num">' + esc(numTxt) + '</span><span class="slot-kind">' + kindTxt + '</span><span class="slot-hours">' + esc(slot.start) + ' – ' + esc(slot.end) + '</span>';
    row.appendChild(time);

    DAYS.forEach(d => {
      const td = document.createElement("td");
      const slotBox = document.createElement("div");
      slotBox.className = "cell-slot" + (isExtraRow(si) ? " extra-slot" : "");
      slotBox.dataset.day = d; slotBox.dataset.slot = String(si);
      const val = child.days[d] && child.days[d][si];
      if (val && (val.subject || val.room)){
        const color = val.color || getSubjectColor(child, val.subject);
        const lesson = document.createElement("div");
        lesson.className = "lesson-card" + (isExtraRow(si) ? " extra-card" : "");
        lesson.draggable = true;
        lesson.style.background = color;
        lesson.dataset.day = d; lesson.dataset.slot = String(si);
        lesson.title = (val.subject || "") + (val.room ? " • " + val.room : "") + " — тягніть щоб перемістити";
        const s1 = document.createElement("div"); s1.className = "lesson-subject"; s1.textContent = val.subject || "—";
        lesson.appendChild(s1);
        if (val.room){ const s2 = document.createElement("div"); s2.className = "lesson-room"; s2.textContent = "—" + val.room; lesson.appendChild(s2); }
        lesson.addEventListener("click", () => openCellEditor(child.id, d, si));
        lesson.addEventListener("dragstart", e => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ day: d, slot: si }));
          e.dataTransfer.effectAllowed = "move";
          dragSrc = { day: d, slot: si };
          setTimeout(() => lesson.classList.add("dragging"), 0);
        });
        lesson.addEventListener("dragend", () => { lesson.classList.remove("dragging"); clearDragOver(); dragSrc = null; });
        slotBox.appendChild(lesson);
      } else {
        const empty = document.createElement("button");
        empty.type = "button";
        empty.className = "lesson-empty" + (isExtraRow(si) ? " extra-add" : "");
        empty.textContent = isExtraRow(si) ? "+ Додати заняття" : "+ Додати урок";
        empty.addEventListener("click", () => openCellEditor(child.id, d, si));
        slotBox.appendChild(empty);
      }
      // drop-цілі
      slotBox.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; slotBox.classList.add("drag-over"); });
      slotBox.addEventListener("dragleave", () => slotBox.classList.remove("drag-over"));
      slotBox.addEventListener("drop", e => {
        e.preventDefault(); slotBox.classList.remove("drag-over");
        let src = dragSrc;
        try { const p = JSON.parse(e.dataTransfer.getData("text/plain") || "null"); if (p && p.day) src = p; } catch(_){}
        if (!src) return;
        moveLesson(child.id, src.day, +src.slot, d, si);
      });
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
  DAYS.forEach(d => { if (!Array.isArray(child.days[d])) child.days[d] = []; });
  const a = child.days[fromDay][fromSlot] || null;
  const b = child.days[toDay][toSlot] || null;
  child.days[toDay][toSlot] = a;
  child.days[fromDay][fromSlot] = b;
  saveAndRender();
}

function renderListCard(child, kind, title){
  const card = mk("div", "card");
  card.appendChild(mk("h3", null, title));
  const list = document.createElement("div"); list.className = "list";
  (child[kind] || []).forEach(it => {
    const row = mk("div", "list-item"); row.style.color = child.color;
    const bar = mk("span", "bar"); bar.style.background = child.color;
    const txt = mk("span", "txt"); const meta = mk("span", "meta");
    if (kind === "homework"){
      txt.textContent = (it.subject ? it.subject + " - " : "") + (it.text || "");
      meta.textContent = (it.date || "") + (it.class ? " . " + it.class : "");
      const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = !!it.done;
      toggle.addEventListener("change", () => { it.done = toggle.checked; saveAndRender(); });
      row.appendChild(toggle);
    } else {
      txt.textContent = (it.subject || "") + (it.text ? " - " + it.text : "");
      meta.textContent = (it.date || "") + (it.room ? " . " + it.room : "");
    }
    row.appendChild(bar); row.appendChild(txt); row.appendChild(meta);
    row.appendChild(mk("button", "btn ghost", "...", () => openItemEditor(kind, it)));
    list.appendChild(row);
  });
  card.appendChild(list);
  card.appendChild(mk("button", "add-btn", "+ Додати", () => openItemEditor(kind)));
  return card;
}

function tint(hex, alpha){
  try {
    const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return "rgba(" + r + "," + g + "," + b + "," + (alpha || 0.28) + ")";
  } catch (e) { return hex; }
}
/* ============ Edytory (modale) ============ */
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
  const child = state.data.children.find(c => c.id === childId);
  if (!child) return;
  if (!child.subjectColors) child.subjectColors = {};
  cellCtx = { childId, day, slotIdx };
  const slot = child.slots[slotIdx];
  const val = child.days[day][slotIdx] || {};
  $("#cell-title").textContent = DAY_FULL[day] + " • " + (slot.start) + "–" + (slot.end);
  $("#cell-subject").value = val.subject || "";
  $("#cell-room").value = val.room || "";
  // datalist існуючих предметів
  const dl = $("#subjects-datalist"); if (dl){ dl.innerHTML = ""; collectSubjects(child).forEach(n => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); }); }
  const cur = val.color || (val.subject ? getSubjectColor(child, val.subject) : autoColorFor(child, $("#cell-subject").value));
  buildPalette(child, cur);
  // якщо користувач вводить відомий предмет — підставити його колір
  $("#cell-subject").oninput = e => {
    const name = e.target.value;
    const k = normSubject(name);
    if (child.subjectColors[k]){ cellColorSel = child.subjectColors[k].color; const cc=$("#cell-color"); if(cc) cc.value=cellColorSel;
      document.querySelectorAll("#cell-palette .color-swatch").forEach(x => x.classList.toggle("active", x.title === cellColorSel)); }
  };
  show("modal-cell"); focusField("cell-subject");
}
function commitCell(){
  if (!cellCtx) return;
  const child = state.data.children.find(c => c.id === cellCtx.childId);
  if (!child){ hide("modal-cell"); cellCtx = null; return; }
  const subject = $("#cell-subject").value.trim();
  const room = $("#cell-room").value.trim();
  const color = cellColorSel || $("#cell-color").value;
  if (subject) setSubjectColor(child, subject, color); // наслідування: всі картки тижня з цим предметом стануть цього кольору
  child.days[cellCtx.day][cellCtx.slotIdx] = (subject || room) ? { subject, room, color } : null;
  hide("modal-cell"); cellCtx = null; saveAndRender();
}
function clearCell(){
  if (!cellCtx) return;
  const child = state.data.children.find(c => c.id === cellCtx.childId);
  if (child) child.days[cellCtx.day][cellCtx.slotIdx] = null;
  hide("modal-cell"); cellCtx = null; saveAndRender();
}

/* --- Godziny lekcji --- */
let slotCtx = null;
function openSlotEditor(){
  const child = activeChild(); if (!child) return;
  slotCtx = child;
  child.slots = normalizeSlots(child.slots);
  $("#slot-title").textContent = "Розклад дзвінків: " + child.name;

  const lessons = child.slots.slice(0, LESSON_COUNT);
  const extras = child.slots.slice(LESSON_COUNT, TOTAL_ROWS);

  const lessonsHtml = lessons.map((s, i) => `
    <div class="slot-row" data-kind="lesson" data-idx="${i}">
      <span class="slot-row-num">${i + 1}</span>
      <input type="time" class="slot-start" value="${esc(s.start || '08:00')}">
      <span class="slot-dash">–</span>
      <input type="time" class="slot-end" value="${esc(s.end || '08:45')}">
    </div>
  `).join("");

  const extrasHtml = extras.map((s, i) => `
    <div class="slot-row extra" data-kind="extra" data-idx="${i}">
      <span class="slot-row-num">★${i + 1}</span>
      <input type="text" class="slot-label" placeholder="Назва (напр. Гурток / Футбол)" value="${esc(s.label || '')}">
      <input type="time" class="slot-start" value="${esc(s.start || '16:00')}">
      <span class="slot-dash">–</span>
      <input type="time" class="slot-end" value="${esc(s.end || '17:00')}">
    </div>
  `).join("");

  const lList = $("#slot-lessons-list");
  if (lList) lList.innerHTML = lessonsHtml;
  const eList = $("#slot-extras-list");
  if (eList) eList.innerHTML = extrasHtml;

  show("modal-slots");
}
function commitSlots(){
  if (!slotCtx) return;
  const newSlots = [];

  const lessonRows = document.querySelectorAll("#slot-lessons-list .slot-row");
  lessonRows.forEach((row, i) => {
    const st = row.querySelector(".slot-start");
    const en = row.querySelector(".slot-end");
    newSlots.push({
      num: String(i + 1),
      label: "",
      start: (st && st.value) || "08:00",
      end: (en && en.value) || "08:45"
    });
  });

  const extraRows = document.querySelectorAll("#slot-extras-list .slot-row");
  extraRows.forEach((row, i) => {
    const lbl = row.querySelector(".slot-label");
    const st = row.querySelector(".slot-start");
    const en = row.querySelector(".slot-end");
    newSlots.push({
      num: "★" + (i + 1),
      label: (lbl && lbl.value.trim()) || ("Гурток " + (i + 1)),
      start: (st && st.value) || (i === 0 ? "16:00" : "17:15"),
      end: (en && en.value) || (i === 0 ? "17:00" : "18:15")
    });
  });

  slotCtx.slots = normalizeSlots(newSlots);
  DAYS.forEach(d => { slotCtx.days[d] = normalizeDay(slotCtx.days[d]); });
  hide("modal-slots"); slotCtx = null; saveAndRender();
}
/* --- Element (praca domowa / sprawdzian) --- */
let itemCtx = { kind: null, childId: null, item: null };
function openItemEditor(kind, item){
  const child = activeChild(); if (!child) return;
  itemCtx = { kind, childId: child.id, item: item || null };
  const isHw = kind === "homework";
  $("#item-title").textContent = (item ? "Редагувати" : "Додати") + (isHw ? " домашнє завдання" : " контрольну / іспит");
  $("#item-subject").value = (item && item.subject) || "";
  $("#item-text").value = (item && item.text) || "";
  $("#item-date").value = (item && item.date) || todayISO();
  $("#item-extra").value = (item && isHw ? item.class : item.room) || (isHw ? "" : "");
  $("#item-extra").placeholder = isHw ? "Клас / примітка" : "Кабінет";
  $("#item-extra-label").textContent = isHw ? "Клас або примітка (необов'язково)" : "Кабінет (необов'язково)";
  $("#item-extra").hidden = false;
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

/* --- Dodawanie / usuwanie dziecka --- */
function openChildModal(){
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
  hide("modal-child"); saveAll(); renderAll();
}
function delChild(id){
  const c = state.data.children.find(x => x.id === id) || {};
  confirmAsync("Видалити дитину «" + c.name + "» та весь її розклад?", () => {
    state.data.children = state.data.children.filter(x => x.id !== id);
    if (state.activeChildId === id) state.activeChildId = state.data.children.length ? state.data.children[0].id : null;
    saveAndRender();
  });
}

/* --- Potwierdzenie --- */
let confirmCb = null;
function confirmAsync(msg, onOk){
  $("#confirm-msg").textContent = msg;
  confirmCb = onOk;
  show("modal-confirm");
}
/* ============ Ustawienia Gist ============ */
function openSettings(){
  $("#set-gist-id").value = state.settings.gistId || "";
  $("#set-token").value = state.settings.token || "";
  $("#settings-status").textContent = state.settings.gistId ? "Gist налаштовано (…" + state.settings.gistId.slice(-8) + ")" : "Gist не налаштовано — дані лише локально";
  show("modal-settings");
}
function saveSettings(){
  state.settings.gistId = $("#set-gist-id").value.trim();
  state.settings.token = $("#set-token").value.trim();
  saveLocal(); saveAll();
  $("#settings-status").textContent = "Збережено. Синхронізація…";
}

/* ============ Eksport / import ============ */
function doExport(){
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "family-schedule.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function doImport(file){
  if (!file) return;
  file.text().then(text => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.children)){ state.data = parsed; saveAndRender(); alert("Імпорт успішно завершено ✔"); }
      else alert("Некоректний формат файлу — відсутнє поле «children».");
    } catch (e){ alert("Помилка читання JSON: " + e.message); }
  }).catch(e => alert("Помилка: " + e.message));
}

/* ============ Sidebar ============ */
function buildSidebar(){
  const nav = $("#sidebar-nav"); nav.innerHTML = "";
  const links = [
    ["Додати дитину", openChildModal],
    ["Розклад дзвінків", openSlotEditor],
    ["Налаштування Gist", openSettings],
    ["Експорт JSON", doExport],
    ["Імпорт JSON", () => $("#import-file").click()]
  ];
  links.forEach(l => { const b = mk("button", "side-link", l[0], () => { closeSidebar(); l[1](); }); nav.appendChild(b); });
}
function openSidebar(){ $("#scrim").hidden = false; const s = $("#sidebar"); s.hidden = false; setTimeout(() => s.classList.add("open"), 10); }
function closeSidebar(){ const s = $("#sidebar"); s.classList.remove("open"); setTimeout(() => { $("#scrim").hidden = true; if (s) s.hidden = true; }, 200); }

/* ============ Zapis + render ============ */
function saveAndRender(){ saveAll(); renderAll(); }

/* ============ Podlaczenie przyciskow ============ */
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
  c("btn-cancel-item", () => hide("modal-item"));

  c("btn-confirm-ok", () => { hide("modal-confirm"); const cb = confirmCb; confirmCb = null; if (cb) cb(); });
  c("btn-confirm-no", () => { hide("modal-confirm"); confirmCb = null; });

  c("btn-save-settings", saveSettings);
  c("btn-clear-sync", () => {
    confirmAsync("Відключити Gist-синхронизацію? Дані на пристройці залишаться, але синхронизація миж пристроями припиниться.", () => {
      state.settings.gistId = ""; state.settings.token = ""; saveLocal(); saveAll();
      $("#settings-status").textContent = "Gist відключено.";
    });
  });

  c("btn-export", doExport);
  c("btn-import", () => $("#import-file").click());
  c("btn-menu", openSidebar);
  c("btn-sidebar-close", closeSidebar);
  const scrim = $("#scrim"); if (scrim) scrim.addEventListener("click", closeSidebar);
  const importFile = $("#import-file"); if (importFile) importFile.addEventListener("change", e => doImport(e.target.files[0]));
}

window.addEventListener("DOMContentLoaded", () => { wireEvents(); buildSidebar(); loadAll(); });
