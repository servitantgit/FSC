/* ============================================================
   Тест логіки «зараз» у розкладі — без зовнішніх залежностей.
   Запуск: node tools/now-markers.test.js

   Перевіряє:
     - timeToMinutes() / minutesToClock() — розбір і форматування часу
     - todayKey() / todayLabel()          — реальна дата → день тижня
     - pickCurrentLesson()                — поточний і наступний урок
     - renderSchedule() + updateNowMarkers() — фактичну розстановку
       підсвіток (день тижня, клітинка з часом, картка уроку/гуртка)
       на мінімальному DOM-стенді.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- Мінімальний DOM ---------- */
function makeEl(tag, classes, dataset){
  const cls = new Set((classes || []).filter(Boolean));
  const el = {
    tagName: String(tag || '').toUpperCase(),
    dataset: Object.assign({}, dataset || {}),
    style: {},
    children: [],
    parent: null,
    textContent: '',
    innerHTML: '',
    title: '',
    type: '',
    draggable: false,
    disabled: false,
    hidden: false
  };
  Object.defineProperty(el, 'className', {
    get(){ return [...cls].join(' '); },
    set(v){ cls.clear(); String(v || '').split(/\s+/).forEach(c => { if (c) cls.add(c); }); }
  });
  Object.defineProperty(el, 'firstChild', { get(){ return el.children[0] || null; } });
  el._cls = cls;
  el.classList = {
    add(...names){ names.forEach(n => cls.add(n)); },
    remove(...names){ names.forEach(n => cls.delete(n)); },
    contains(n){ return cls.has(n); }
  };
  el.appendChild = ch => { ch.parent = el; el.children.push(ch); return ch; };
  el.insertBefore = (ch, ref) => {
    ch.parent = el;
    const i = el.children.indexOf(ref);
    if (i < 0) el.children.unshift(ch); else el.children.splice(i, 0, ch);
    return ch;
  };
  el.remove = () => {
    if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el);
    el.parent = null;
  };
  el.addEventListener = () => {};
  el.querySelector = sel => descendants(el).find(x => matches(x, sel)) || null;
  el.closest = sel => {
    let cur = el;
    while (cur){ if (matchesSimple(cur, sel)) return cur; cur = cur.parent; }
    return null;
  };
  return el;
}

function descendants(el){
  const out = [];
  (el.children || []).forEach(ch => { out.push(ch); out.push(...descendants(ch)); });
  return out;
}

/* Підтримує лише ті селектори, які використовує застосунок:
   тег, класи, [data-*], і один рівень «предок нащадок». */
function datasetKey(name){
  return String(name).replace(/^data-/, '').replace(/-([a-z])/g, (m, c) => c.toUpperCase());
}

function matchesSimple(el, simple){
  const s = String(simple).trim();
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(s);
  if (tagMatch && el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
  for (const m of s.matchAll(/\.([\w-]+)/g)){
    if (!el._cls.has(m[1])) return false;
  }
  for (const m of s.matchAll(/\[([\w-]+)(?:=("[^"]*"|'[^']*'|[^\]]*))?\]/g)){
    const key = datasetKey(m[1]);
    if (!(key in el.dataset)) return false;
    if (m[2] !== undefined && el.dataset[key] !== m[2].replace(/^["']|["']$/g, '')) return false;
  }
  return true;
}

function matches(el, selector){
  const parts = String(selector).trim().split(/\s+/);
  const target = parts.pop();
  if (!matchesSimple(el, target)) return false;
  if (parts.length){
    let cur = el.parent;
    while (cur){
      if (matchesSimple(cur, parts[0])) return true;
      cur = cur.parent;
    }
    return false;
  }
  return true;
}

const stubDocument = {
  title: '',
  visibilityState: 'visible',
  _root: null,
  createElement(tag){ return makeEl(tag); },
  addEventListener(){},
  getElementById(){ return null; },
  querySelector(sel){
    const root = this._root;
    if (!root) return null;
    if (matches(root, sel)) return root;
    return descendants(root).find(x => matches(x, sel)) || null;
  },
  querySelectorAll(sel){
    const root = this._root;
    if (!root) return [];
    return descendants(root).filter(x => matches(x, sel));
  }
};

/* ---------- Контекст vm зі справжнім app.js ---------- */
const sandbox = {
  console, JSON, Math, Object, Array, String, Number, RegExp, Set, Map, Date, Promise, Error,
  setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  fetch: () => Promise.reject(new Error('offline')),
  Blob: class Blob {},
  URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  matchMedia: () => ({ matches: false }),
  addEventListener(){}, removeEventListener(){},
  document: stubDocument
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });

/* Доступ до функцій застосунку (оголошені у global scope) */
function fn(name){ return vm.runInContext(name, sandbox); }

/* Підміна «зараз»: фіксуємо системний час для перевірок */
function setNow(iso){
  const fixed = new Date(iso).getTime();
  class FakeDate extends Date {
    constructor(...args){ super(...(args.length ? args : [fixed])); }
    static now(){ return fixed; }
  }
  sandbox.Date = FakeDate;
}

/* ---------- Перевірки ---------- */
let passed = 0, failed = 0;
function ok(cond, msg){
  if (cond){ passed++; return; }
  failed++;
  console.error('  ✗ ' + msg);
}
function eq(actual, expected, msg){
  ok(Object.is(actual, expected), msg + ' → отримано ' + JSON.stringify(actual) + ', очікували ' + JSON.stringify(expected));
}

/* ---------- 1. Час: розбір і форматування ---------- */
const timeToMinutes = fn('timeToMinutes');
const minutesToClock = fn('minutesToClock');
const todayKey = fn('todayKey');
const todayLabel = fn('todayLabel');
const pickCurrentLesson = fn('pickCurrentLesson');

eq(timeToMinutes('09:50'), 590, "timeToMinutes('09:50')");
eq(timeToMinutes('8:05'), 485, "timeToMinutes('8:05')");
eq(timeToMinutes(' 16:00 '), 960, "timeToMinutes(' 16:00 ')");
eq(timeToMinutes(''), null, "timeToMinutes('')");
eq(timeToMinutes(null), null, 'timeToMinutes(null)');
eq(timeToMinutes('24:00'), null, "timeToMinutes('24:00') — поза добою");
eq(timeToMinutes('10:75'), null, "timeToMinutes('10:75') — некоректні хвилини");
eq(minutesToClock(590), '09:50', 'minutesToClock(590)');
eq(minutesToClock(0), '00:00', 'minutesToClock(0)');
eq(minutesToClock(1445), '00:05', 'minutesToClock(1445) — через добу');

/* ---------- 2. Реальна дата → день тижня ---------- */
setNow('2026-09-26T10:00:00');
eq(todayKey(), 'sat', 'todayKey() для 26.09.2026 (субота)');
eq(todayLabel(), 'субота, 26 вересня 2026', 'todayLabel() для 26.09.2026');
setNow('2026-03-02T08:05:00');
eq(todayKey(), 'mon', 'todayKey() для 02.03.2026 (понеділок)');
eq(todayLabel(), 'понеділок, 2 березня 2026', 'todayLabel() для 02.03.2026');
eq(minutesToClock(fn('nowMinutes')()), '08:05', 'nowMinutes() → 08:05');

/* ---------- 3. Поточний / наступний урок ---------- */
const lessons = [
  { name: '1', start: timeToMinutes('08:00'), end: timeToMinutes('08:45') },
  { name: '2', start: timeToMinutes('09:50'), end: timeToMinutes('10:35') },
  { name: '3', start: timeToMinutes('11:50'), end: timeToMinutes('12:35') }
];
eq(pickCurrentLesson(lessons, timeToMinutes('10:00')).current.name, '2', '10:00 — триває 2 урок');
eq(pickCurrentLesson(lessons, timeToMinutes('09:00')).current, null, '09:00 — поточного уроку немає (перерва)');
eq(pickCurrentLesson(lessons, timeToMinutes('09:00')).next.name, '2', '09:00 — наступний 2 урок');
eq(pickCurrentLesson(lessons, timeToMinutes('08:45')).current, null, 'межа кінця уроку виключна (08:45)');
eq(pickCurrentLesson(lessons, timeToMinutes('08:45')).next.name, '2', '08:45 — уже наступний урок');
eq(pickCurrentLesson(lessons, timeToMinutes('08:00')).current.name, '1', 'початок уроку входить у заняття');
eq(pickCurrentLesson(lessons, timeToMinutes('23:00')).current, null, 'після всіх уроків — немає поточного');
eq(pickCurrentLesson(lessons, timeToMinutes('23:00')).next, null, 'після всіх уроків — немає наступного');
eq(pickCurrentLesson([{ start: null, end: null }], 600).current, null, 'заняття без часу ігнорується');
eq(pickCurrentLesson([{ start: 600, end: 600 }], 600).current, null, 'нульова тривалість ігнорується');

/* ---------- 4. Розклад: підсвітка дня й актуального заняття ---------- */
function buildChild(){
  const child = fn('newChild')('Тестова дитина');
  child.slots = fn('normalizeSlots')(child.slots); // дзвінки за замовчуванням: 1) 08:00–08:45, 2) 08:55–09:40, 3) 09:50–10:35
  child.days.mon[0] = { subject: 'Математика', teacher: 'Гриценко О.В.', room: '203', color: '', start: '', end: '' };
  child.days.mon[1] = { subject: 'Українська мова', teacher: '', room: '', color: '', start: '', end: '' };
  child.days.mon[2] = { subject: 'Фізика', teacher: '', room: '', color: '', start: '', end: '' };
  // Гурток у суботу: власний час у картці
  child.days.sat[8] = { subject: 'Плавання', teacher: 'тр. Іваненко', room: '', color: '', start: '16:00', end: '17:00' };
  return child;
}
function render(child){
  const card = fn('renderSchedule')(child);
  stubDocument._root = card;
  return card;
}
const q = sel => stubDocument.querySelector(sel);
const qa = sel => stubDocument.querySelectorAll(sel);
const slotsText = sel => qa(sel).map(el => el.dataset.slot).join(',');

/* 4.1 Структура шапки та шапки таблиць */
setNow('2026-09-28T10:00:00');
render(buildChild());
const head = q('.sched-head');
ok(!!head, 'шапка розкладу існує');
eq(head.children.length, 4, 'шапка — 4 елементи в одному рядку (заголовок, дні, «сьогодні», стан)');
eq(head.children[0].className, 'sched-head__title', 'шапка: заголовок');
eq(head.children[0].textContent, 'Розклад на тиждень', 'шапка: «Розклад на тиждень»');
eq(head.children[1].className, 'sched-head__week', 'шапка: діапазон днів у тому ж рядку');
eq(head.children[1].textContent, "Понеділок – П'ятниця", "шапка: текст «Понеділок – П'ятниця»");
eq(head.children[2].className, 'today-badge', 'шапка: бейдж «Сьогодні»');
eq(head.children[3].className, 'now-status', 'шапка: плашка стану «Зараз/Далі»');
eq(qa('.sched-section__title').filter(el => el.textContent.indexOf('Понеділок') !== -1).length, 0,
  'окремого підпису «Понеділок – П’ятниця» над таблицею більше немає');
eq(qa('.sched-table').length, 2, 'дві таблиці: Пн–Пт і вихідні');
eq(qa('.sched-table th[data-day]').length, 7, 'усі 7 днів мають data-day у шапці');
eq(qa('.sched-table th[data-day].weekend-th').length, 2, 'субота й неділя позначені weekend-th');

/* 4.2 Понеділок, 10:00 — триває 3 урок (Фізика, 09:50–10:35) */
fn('updateNowMarkers')();
eq(q('.today-badge').children.map(c => c.textContent).join(' | '),
  'Сьогодні | понеділок, 28 вересня 2026 | 10:00',
  'бейдж: «Сьогодні» + реальна дата + поточний час');
eq(qa('.sched-table th.today-th').length, 1, 'підсвічено рівно одну клітинку дня тижня');
eq(qa('.sched-table th.today-th')[0].dataset.day, 'mon', 'підсвічено понеділок');
eq(qa('.sched-table th.today-th .th-today')[0].textContent, 'Сьогодні', 'у клітинці дня є мітка «Сьогодні»');
eq(qa('.today-col').length, 10, 'стовпець понеділка підсвічено в усіх 10 рядках');
eq(qa('.today-col')[0].dataset.col, 'mon', 'стовпець — понеділок');
ok(qa('.today-col').every(el => el.dataset.col === 'mon'), 'підсвічено лише стовпець понеділка');
eq(qa('.lesson-card.is-now').length, 1, 'підсвічено одну картку поточного уроку');
eq(slotsText('.lesson-card.is-now'), '2', 'підсвічено саме 3-й урок (слот 2)');
eq(qa('.lesson-card.is-now')[0].parent.dataset.subject, 'Фізика', 'картка поточного уроку — Фізика');
eq(qa('.now-flag').length, 1, 'у картці є бейдж «Зараз»');
eq(qa('.lesson-card.is-now')[0].firstChild.className, 'now-flag', 'бейдж «Зараз» стоїть першим у картці');
eq(qa('.time-cell--now').length, 1, 'клітинку з часом уроку підсвічено');
eq(qa('.time-cell--now')[0].dataset.slot, '2', 'підсвічено рядок 3-го уроку');
eq(qa('.time-cell--now')[0].dataset.start, '09:50', 'клітинка з часом: початок 09:50');
eq(qa('.time-cell--now')[0].dataset.end, '10:35', 'клітинка з часом: кінець 10:35');
eq(qa('.lesson-card.is-next').length, 0, 'наступного заняття немає, бо триває поточний');
eq(q('.now-status').textContent, 'Зараз: 3 урок · Фізика · 09:50–10:35', 'стан: «Зараз: 3 урок …»');
eq(q('.now-status').className, 'now-status is-now', 'стан позначено класом is-now');
eq(qa('.cell-slot[data-day="mon"]').length, 10, 'клітинки понеділка мають data-day/data-slot');
ok(!!qa('.cell-slot[data-day="mon"]').find(el => el.dataset.start === '09:50' && el.dataset.end === '10:35'),
  'клітинка уроку має data-start/data-end зі «Розкладу дзвінків»');

/* 4.3 Понеділок, 08:50 — перерва, наступний 2 урок */
setNow('2026-09-28T08:50:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.lesson-card.is-now').length, 0, 'перерва: поточного уроку немає');
eq(qa('.lesson-card.is-next').length, 1, 'перерва: підсвічено наступний урок');
eq(slotsText('.lesson-card.is-next'), '1', 'наступний — 2-й урок (слот 1)');
eq(qa('.time-cell--next').length, 1, 'клітинку з часом наступного уроку підсвічено');
eq(q('.now-status').textContent, 'Далі: 2 урок · Українська мова · 08:55–09:40', 'стан: «Далі: 2 урок …»');
eq(q('.now-status').className, 'now-status is-next', 'стан позначено класом is-next');
eq(q('.today-badge .tb-clock').textContent, '08:50', 'годинник у бейджі оновлено');

/* 4.4 Понеділок, 08:45 — рівно кінець 1 уроку → уже перерва */
setNow('2026-09-28T08:45:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.lesson-card.is-now').length, 0, '08:45 — перший урок уже закінчився');
eq(q('.now-status').textContent, 'Далі: 2 урок · Українська мова · 08:55–09:40', 'стан: далі 2 урок');

/* 4.5 Понеділок, 18:00 — заняття завершено */
setNow('2026-09-28T18:00:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.lesson-card.is-now').length + qa('.lesson-card.is-next').length, 0, 'після занять підсвіток уроків немає');
eq(q('.now-status').textContent, 'Заняття на сьогодні завершено', 'стан: заняття завершено');
eq(q('.now-status').className, 'now-status is-idle', 'стан позначено класом is-idle');

/* 4.6 Субота, 10:00 — уроків немає, гурток о 16:00 ще попереду */
setNow('2026-09-26T10:00:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.sched-table th.today-th')[0].dataset.day, 'sat', 'підсвічено суботу');
eq(qa('.today-col').length, 2, 'стовпець суботи — 2 рядки таблиці вихідних');
eq(qa('.today-col')[0].dataset.col, 'sat', 'стовпець — субота');
ok(qa('.today-col').every(el => el.dataset.col === 'sat'), 'підсвічено лише стовпець суботи');
eq(qa('.lesson-card.is-now').length, 0, 'у суботу вранці урок не триває');
eq(qa('.lesson-card.is-next').length, 1, 'наступний — суботній гурток');
eq(qa('.lesson-card.is-next')[0].parent.dataset.subject, 'Плавання', 'наступне заняття — Плавання');
eq(q('.now-status').textContent, 'Далі: гурток · Плавання · 16:00–17:00', 'стан: далі гурток');

/* 4.7 Субота, 16:30 — триває гурток */
setNow('2026-09-26T16:30:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.lesson-card.is-now').length, 1, 'гурток підсвічено як поточний');
eq(qa('.lesson-card.is-now')[0].parent.dataset.subject, 'Плавання', 'поточний гурток — Плавання');
eq(q('.now-status').textContent, 'Зараз: гурток · Плавання · 16:00–17:00', 'стан: «Зараз: гурток …»');
eq(qa('.time-cell--now').length, 0, 'у гуртка ліва колонка часу не підсвічується (час у картці)');
eq(qa('.now-flag')[0].textContent, 'Зараз', 'бейдж «Зараз» у картці гуртка');

/* 4.8 Неділя — занять немає */
setNow('2026-09-27T10:00:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.sched-table th.today-th')[0].dataset.day, 'sun', 'підсвічено неділю');
eq(q('.now-status').textContent, 'Сьогодні занять немає', 'стан: у неділю занять немає');
eq(qa('.lesson-card.is-now').length + qa('.lesson-card.is-next').length, 0, 'підсвіток занять немає');

/* 4.9 Перехід дня без ре-рендеру: підсвітки перераховуються з data-атрибутів */
setNow('2026-09-28T10:00:00');
render(buildChild());
fn('updateNowMarkers')();
eq(qa('.lesson-card.is-now').length, 1, 'початково: урок триває');
eq(qa('.now-flag').length, 1, 'початково: бейдж «Зараз» один');
setNow('2026-09-26T16:30:00');
fn('updateNowMarkers')();
eq(qa('.lesson-card.is-now').length, 1, 'після зміни дня/часу підсвітка переїхала');
eq(qa('.lesson-card.is-now')[0].dataset.day, 'sat', 'тепер підсвічено суботній гурток');
eq(qa('.time-cell--now').length, 0, 'підсвітку клітинки з часом з понеділка прибрано');
eq(qa('.now-flag').length, 1, 'бейдж «Зараз» не дублюється');
eq(qa('.sched-table th.today-th')[0].dataset.day, 'sat', 'муар дня тижня переїхав на суботу');
eq(qa('.today-col').length, 2, 'стовпець підсвічено рівно в одному стовпці (2 рядки вихідних)');
ok(qa('.today-col').every(el => el.dataset.col === 'sat'), 'старого стовпця (понеділок) більше немає');

/* ---------- Підсумок ---------- */
console.log('Перевірок пройдено: ' + passed + (failed ? ', провалено: ' + failed : ''));
process.exit(failed ? 1 : 0);
