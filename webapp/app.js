/* ============================================================
   Family School Web - dziecy rozklad
   Statyczny serwis dla GitHub Pages + GitHub Gist synchronizacja
   ============================================================ */
'use strict';

/* ---------- Konstancje ---------- */
const DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const DAY_SHORT = {mon:"Пн",tue:"Вт",wed:"Ср",thu:"Чт",fri:"Пт",sat:"Сб",sun:"Нд"};
const DAY_FULL  = {mon:"Понеділок",tue:"Вівторник",wed:"Середа",thu:"Четверг",fri:"Пятниця",sat:"Субота",sun:"Неділя"};
const LS_DATA = "fsc.data.v1";
const LS_SETTINGS = "fsc.settings.v1";
const GIST_FILENAME = "schedule.json";
const GIST_API = "https://api.github.com";

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

function defaultSlots(){
  const t = [["08:00","08:45"],["08:55","09:40"],["09:50","10:35"],["10:45","11:30"],["11:40","12:25"],["12:35","13:20"]];
  return t.map((p, i) => ({ label: String(i + 1), start: p[0], end: p[1] }));
}
function newChild(name){
  const palette = ["#4c8df6","#f97072","#2fbf71","#e6a23c","#9b59b6","#23b6a9","#f06292"];
  return {
    id: uid(), name: name || "Нова дитяча", class: "", color: palette[Math.floor(Math.random()*palette.length)],
    slots: defaultSlots(),
    days: Object.fromEntries(DAYS.map(d => [d, []])),
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
  } catch (e) { console.error("local load", e); }
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
    setSync("busy", "Читаю Gist…");
    remote = await gistFetch();
    if (remote && remote !== "missing" && remote !== "corrupt") state.data = remote;
  }
  if (!state.activeChildId && state.data.children.length) state.activeChildId = state.data.children[0].id;
  syncIndicator();
  renderAll();
  if (remote === "corrupt") setSync("err", "Gist пошківаний — дані локально");
  return remote;
}

async function saveAll(){
  saveLocal();
  if (state.settings.gistId){
    setSync("busy", "Зберігаю в Gist…");
    const id = await gistPush(state.data);
    if (id){ state.settings.gistId = id; saveLocal(); setSync("ok", "Синхронизація активна"); }
    else setSync("err", "Не вдалось записать — перевірь token/Gist ID");
  } else {
    setSync("off", "Gist не налашов — данi тільки локально");
  }
}

function syncIndicator(){ state.settings.gistId ? setSync("ok", "Gist активна") : setSync("off", "Gist не налашов"); }
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
  const seg = mk("span", "muted", child.class ? child.name + " . " + child.class : child.name);
  seg.style.fontSize = "13px";
  const editSlots = mk("button", "tool-btn", "Часі уроків", openSlotEditor);
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
    d.textContent = "Натисніть «+» вверху, щоб додати першу дитячу і завести розклад.";
    main.appendChild(d); return;
  }
  const wrap = document.createElement("div");
  wrap.style.display = "flex"; wrap.style.flexDirection = "column"; wrap.style.gap = "14px";
  wrap.appendChild(renderSchedule(child));
  wrap.appendChild(renderListCard(child, "homework", "Домашні задавання"));
  wrap.appendChild(renderListCard(child, "exams", "Контрольні / екзамени"));
  main.appendChild(wrap);
}
function renderSchedule(child){
  const card = mk("div", "card");
  card.appendChild(mk("h3", null, "Розклад на тиждень — натисніть на кліточку"));
  if (!child.slots.length){ card.appendChild(mk("div", "empty", "Нет жодного часу. Натисніть «Часі уроків», щоб задати часлаганало.")); return card; }
  const table = document.createElement("div"); table.className = "sched"; table.style.overflow = "auto";
  const head = document.createElement("div"); head.className = "sched-row"; head.style.fontWeight = "700"; head.style.color = "var(--muted)";
  head.appendChild(mk("span", "time", "час"));
  const hc = document.createElement("div"); hc.className = "cells";
  DAYS.forEach(d => { const c = mk("span", "cell", DAY_SHORT[d]); c.style.cssText = "flex:0 0 64px;border-style:dashed;background:transparent;cursor:default"; hc.appendChild(c); });
  head.appendChild(hc); table.appendChild(head);

  child.slots.forEach((slot, si) => {
    const row = mk("div", "sched-row");
    const time = mk("span", "time"); time.textContent = slot.label + "\n" + slot.start + "-" + slot.end; time.style.whiteSpace = "pre-wrap";
    row.appendChild(time);
    const cw = document.createElement("div"); cw.className = "cells";
    DAYS.forEach(d => {
      const cell = document.createElement("button"); cell.className = "cell"; cell.type = "button";
      const val = child.days[d] && child.days[d][si];
      if (val && (val.subject || val.room)){
        cell.className += " has"; cell.style.background = tint(child.color);
        cell.innerHTML = "<span>" + esc(val.subject) + "</span>" + (val.room ? '<span class="room">' + esc(val.room) + "</span>" : "");
      } else { cell.className += " empty-slot"; cell.textContent = "+"; }
      cell.addEventListener("click", () => openCellEditor(child.id, d, si));
      cw.appendChild(cell);
    });
    row.appendChild(cw); table.appendChild(row);
  });
  card.appendChild(table);
  return card;
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

/* --- Komorka rozkladu --- */
let cellCtx = null;
function openCellEditor(childId, day, slotIdx){
  const child = state.data.children.find(c => c.id === childId);
  if (!child) return;
  cellCtx = { childId, day, slotIdx };
  const slot = child.slots[slotIdx];
  const val = child.days[day][slotIdx] || {};
  $("#cell-title").textContent = DAY_FULL[day] + " . " + (slot.start) + "-" + (slot.end);
  $("#cell-subject").value = val.subject || "";
  $("#cell-room").value = val.room || "";
  show("modal-cell"); focusField("cell-subject");
}
function commitCell(){
  if (!cellCtx) return;
  const child = state.data.children.find(c => c.id === cellCtx.childId);
  if (!child){ hide("modal-cell"); cellCtx = null; return; }
  const subject = $("#cell-subject").value.trim();
  const room = $("#cell-room").value.trim();
  child.days[cellCtx.day][cellCtx.slotIdx] = (subject || room) ? { subject, room } : null;
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
  $("#slot-title").textContent = "Часі уроків: " + child.name;
  $("#slot-textarea").value = child.slots.map(s => s.label + "|" + s.start + "-" + s.end).join("\n");
  show("modal-slots");
}
function commitSlots(){
  if (!slotCtx) return;
  const slots = [];
  $("#slot-textarea").value.split(/\r?\n+/).map(s => s.trim()).filter(Boolean).forEach(line => {
    const parts = line.split("|");
    const pp = (parts[1] || "08:00-08:45").split("-");
    slots.push({ label: (parts[0] || "").trim(), start: (pp[0] || "08:00").trim(), end: (pp[1] || "08:45").trim() });
  });
  slotCtx.slots = slots;
  DAYS.forEach(d => { slotCtx.days[d] = slotCtx.days[d].slice(0, slots.length); });
  hide("modal-slots"); slotCtx = null; saveAndRender();
}
/* --- Element (praca domowa / sprawdzian) --- */
let itemCtx = { kind: null, childId: null, item: null };
function openItemEditor(kind, item){
  const child = activeChild(); if (!child) return;
  itemCtx = { kind, childId: child.id, item: item || null };
  const isHw = kind === "homework";
  $("#item-title").textContent = (item ? "Редакт" : "Додати") + (isHw ? " домашку" : " контрольную");
  $("#item-subject").value = (item && item.subject) || "";
  $("#item-text").value = (item && item.text) || "";
  $("#item-date").value = (item && item.date) || todayISO();
  $("#item-extra").value = (item && isHw ? item.class : item.room) || (isHw ? "" : "");
  $("#item-extra").placeholder = isHw ? "Клас" : "Сала";
  $("#item-extra-label").textContent = isHw ? "Клас (опціонально)" : "Сала (опціонально)";
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
  $("#modal-child-title").textContent = "Нова дитяча";
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
  confirmAsync("Видалити дитячу «" + c.name + "» і весь її розклад?", () => {
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
  $("#settings-status").textContent = state.settings.gistId ? "Gist налашов (вЂ¦" + state.settings.gistId.slice(-8) + ")" : "Gist не налашов — данi тільки локально";
  show("modal-settings");
}
function saveSettings(){
  state.settings.gistId = $("#set-gist-id").value.trim();
  state.settings.token = $("#set-token").value.trim();
  saveLocal(); saveAll();
  $("#settings-status").textContent = "Збережено. Синхронизирую…";
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
      if (parsed && Array.isArray(parsed.children)){ state.data = parsed; saveAndRender(); alert("Імпорт завершено ✔"); }
      else alert("Файл не схож — нема поля «children».");
    } catch (e){ alert("Помилка читання JSON: " + e.message); }
  }).catch(e => alert("Помилка: " + e.message));
}

/* ============ Sidebar ============ */
function buildSidebar(){
  const nav = $("#sidebar-nav"); nav.innerHTML = "";
  const links = [
    ["Додати дитячу", openChildModal],
    ["Часі уроків", openSlotEditor],
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
