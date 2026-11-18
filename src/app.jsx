/*
  Словарь из книг — standalone web app.
  Shared words: words.json (Claude adds new ones there). Everything personal is on the device
  (localStorage, prefix "slovar:"):
    progress — { [wordId]: { er: Pack, re: Pack } }  Pack = [score 0..5, n, know, guess, fail, last ms]
    custom   — { [wordId]: word }   words added on this device or local edits of shared words
    hidden   — [wordId]             shared words deleted on this device
    settings — { dir: "mix"|"er"|"re", mode: "flip"|"type", newPerDay, autoSpeak }
    day      — { date, newDone, reviewed }   days — ["YYYY-MM-DD", ...] for the streak
  Scheduling: the colour sets when a card comes back — red now, orange 1 d, yellow 3 d, light green 7 d, green 21 d.
*/
const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* ---------- storage ---------- */
const prefs = {
  get(k, d) { try { const v = localStorage.getItem("slovar:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("slovar:" + k, JSON.stringify(v)); } catch (e) {} },
};
function useStored(key, init) {
  const [v, setV] = useState(() => prefs.get(key, init));
  useEffect(() => { prefs.set(key, v); }, [key, v]);
  return [v, setV];
}

/* ---------- levels & scheduling ---------- */
const LEVELS = {
  "0": { name: "Не помню", color: "var(--r0)" },
  "1": { name: "Плохо", color: "var(--r1)" },
  "2": { name: "Средне", color: "var(--r2)" },
  "3": { name: "Хорошо", color: "var(--r3)" },
  "4": { name: "Выучено", color: "var(--r4)" },
  "new": { name: "Новое", color: "var(--rnew)" },
};
const SCALE = ["0", "1", "2", "3", "4"];
const DAY = 864e5;
const INTERVALS = [0, 1, 3, 7, 21];
const DIRS = { er: "EN → RU", re: "RU → EN" };
const SESSION = 20;

const pack = st => [st.score || 0, st.n || 0, st.know || 0, st.guess || 0, st.fail || 0, st.last || 0];
const unpack = a => (Array.isArray(a) ? { score: a[0], n: a[1], know: a[2], guess: a[3], fail: a[4], last: a[5] } : null);
function levelOf(st) {
  if (!st || !st.n) return "new";
  return String(Math.max(0, Math.min(4, Math.floor(st.score || 0))));
}
function overallLevel(p) {
  const done = [unpack(p && p.er), unpack(p && p.re)].filter(st => st && st.n);
  if (!done.length) return "new";
  return levelOf(done.reduce((a, b) => (a.score <= b.score ? a : b)));
}
const dueAt = st => (st.last || 0) + INTERVALS[+levelOf(st)] * DAY;
function intervalLabel(st) {
  const d = INTERVALS[+levelOf(st)];
  return d === 0 ? "снова" : d === 1 ? "завтра" : "через " + d + " дн";
}
function nextStat(st, res) {
  const n = (st && st.n) || 0;
  let sc = (st && st.score) || 0;
  if (n === 0) sc = res === "know" ? 3 : res === "guess" ? 1.5 : 0;
  else if (res === "know") sc = Math.min(5, sc + 1);
  else if (res === "guess") sc = sc < 3 ? sc + 0.5 : sc - 0.5;
  else sc = Math.max(0, sc - 2);
  return {
    score: Math.round(sc * 2) / 2, n: n + 1,
    know: ((st && st.know) || 0) + (res === "know" ? 1 : 0),
    guess: ((st && st.guess) || 0) + (res === "guess" ? 1 : 0),
    fail: ((st && st.fail) || 0) + (res === "fail" ? 1 : 0),
    last: Date.now(),
  };
}
const byWeak = (a, b) => (a.st.score - b.st.score) || (a.st.last - b.st.last);

/* ---------- text helpers ---------- */
const norm = s => (s || "").toLowerCase().replace(/ё/g, "е").replace(/\(.*?\)/g, " ")
  .replace(/^\s*to\s+/, "").replace(/[^\p{L}\p{N}\s'’-]/gu, " ").replace(/\s+/g, " ").trim();
function isCorrect(input, target) {
  const a = norm(input);
  if (!a) return false;
  return String(target).split(/[,;\/]/).map(norm).filter(Boolean).includes(a);
}
function slugify(s) {
  return s.toLowerCase().trim().replace(/['’]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}
function makeId(en, taken) {
  const base = slugify(en) || ("w-" + Date.now().toString(36));
  let id = base, i = 2;
  while (taken.has(id)) id = base + "-" + i++;
  taken.add(id);
  return id;
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fmtTr = t => (/^[\[\/]/.test(t) ? t : "/" + t + "/");
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const words_ = n => n + " " + plural(n, "слово", "слова", "слов");
const cards_ = n => n + " " + plural(n, "карточка", "карточки", "карточек");
const dateKey = (t = new Date()) => t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
const todayTitle = () => new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, c => c.toUpperCase());
function streakOf(days) {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(dateKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dateKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function Highlight({ text, word }) {
  if (!text) return null;
  const w = (word || "").trim();
  if (!w) return text;
  const stem = w.includes(" ") ? w : (w.length > 4 ? w.replace(/e$/i, "") : w);
  const parts = text.split(new RegExp("\\b(" + escapeRe(stem) + "[a-z'’]*)", "gi"));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

/* ---------- lists ---------- */
const UNIT_ICONS = ["", "users", "heart", "hand-stop", "shirt", "user", "first-aid-kit", "mood-smile", "message-circle", "messages",
  "apple", "tools-kitchen-2", "bed", "armchair", "briefcase", "school", "mail", "device-mobile", "beach", "shopping-bag",
  "shopping-cart", "building", "coffee", "ball-football", "movie", "home", "music", "world", "cloud", "building-community",
  "trees", "paw", "plane", "crown", "shield", "news", "tool", "alert-triangle", "hand-grab"];
function listInfo(src) {
  const m = /^EVU (\d+) · (.+)$/.exec(src || "");
  if (m) return { title: m[2], meta: "Юнит " + (+m[1]), icon: UNIT_ICONS[+m[1]] || "book" };
  if (/глагол/i.test(src)) return { title: src, meta: "Подборка", icon: "bolt" };
  const t = /^Текст · (.+)$/.exec(src || "");
  if (t) return { title: t[1], meta: "Из текста", icon: /сказк/i.test(t[1]) ? "wand" : "file-text" };
  return { title: src || "Без списка", meta: "Мои слова", icon: "book" };
}
const sourcesOf = words => [...new Set(words.map(w => w.src || ""))].sort((a, b) => a.localeCompare(b, "ru"));
function levelCounts(words, progress) {
  const c = { new: 0, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const w of words) c[overallLevel(progress[w.id])]++;
  return c;
}
function Bar({ counts, total, thick }) {
  return (
    <div className={"bar" + (thick ? " thick" : "")} aria-hidden="true">
      {SCALE.slice().reverse().map(k => counts[k] ? <i key={k} style={{ width: (counts[k] / total * 100) + "%", background: LEVELS[k].color }} /> : null)}
    </div>
  );
}
const Dot = ({ lvl }) => <i className="dot" style={{ "--c": LEVELS[lvl].color }} />;
const Icon = ({ n, className, ...p }) => <i className={"ti ti-" + n + (className ? " " + className : "")} aria-hidden="true" {...p} />;

/* ---------- speech ---------- */
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
function speak(text) {
  if (!canSpeak || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = 0.9;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(v => /^en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

/* ---------- session building ---------- */
function dirsFor(setting) { return setting === "mix" ? ["er", "re"] : [setting]; }
function freshFor(items, progress, setting) {
  return items.filter(i => !(i.st && i.st.n)).filter(i => {
    if (i.dir === "er" || setting !== "mix") return true;
    const er = unpack(progress[i.id] && progress[i.id].er);
    return !!(er && er.n);
  }).sort((a, b) => (a.w.added || 0) - (b.w.added || 0) || (a.dir === "er" ? -1 : 1));
}
function spread(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  for (let i = 1; i < out.length; i++) {
    if (out[i].id === out[i - 1].id) {
      const k = out.findIndex((x, j) => j > i && x.id !== out[i - 1].id);
      if (k > 0) [out[i], out[k]] = [out[k], out[i]];
    }
  }
  return out;
}
function buildQueue(kind, items, progress, settings, newLeft) {
  const now = Date.now();
  const practiced = items.filter(i => i.st && i.st.n);
  const due = practiced.filter(i => dueAt(i.st) <= now).sort(byWeak);
  const fresh = freshFor(items, progress, settings.dir);
  let q;
  if (kind === "today") {
    q = due.slice(0, SESSION);
    q = q.concat(fresh.slice(0, Math.max(0, Math.min(newLeft, SESSION - q.length))));
  } else if (kind === "list") {
    // The whole list, one card per word. With both directions on, each word gets the direction
    // it needs more: an unseen word starts EN → RU, otherwise the weaker (or due) direction.
    const byWord = new Map();
    for (const i of items) { if (!byWord.has(i.id)) byWord.set(i.id, []); byWord.get(i.id).push(i); }
    const rank = i => !(i.st && i.st.n) ? (i.dir === "er" ? 2 : 3) : (dueAt(i.st) <= now ? 0 : 1);
    q = [...byWord.values()].map(list => list.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.st && b.st) ? byWeak(a, b) : 0;
    })[0]);
  } else {
    q = practiced.slice().sort(byWeak).slice(0, SESSION);
    if (!q.length) q = fresh.slice(0, SESSION);
  }
  return spread(q).map(i => i.key);
}

/* ================= screens ================= */

function TodayScreen({ stats, streak, continueLists, onStart, onOpenList, onAllLists }) {
  const { due, newToday, learned, total } = stats;
  const todo = due + newToday;
  return (
    <>
      <div className="head">
        <div><div className="date">{todayTitle()}</div><h1 className="title">Сегодня</h1></div>
        <span className="chip-btn" title="Дней подряд"><Icon n="flame" className="flame" />{streak} {plural(streak, "день", "дня", "дней")}</span>
      </div>
      <section className="hero">
        {todo > 0 ? (
          <>
            <div className="lbl">Карточек на сегодня</div>
            <div className="big-num">{todo}</div>
            <div className="sub">≈ {Math.max(1, Math.round(todo * 0.25))} мин</div>
          </>
        ) : (
          <>
            <div className="lbl">На сегодня</div>
            <div className="hero-done">Всё повторено</div>
            <div className="sub">Новые карточки появятся завтра. Можно позаниматься ещё.</div>
          </>
        )}
        <div className="pills">
          <div className="pill"><b>{due}</b><span>повторить</span></div>
          <div className="pill"><b>{newToday}</b><span>новых</span></div>
          <div className="pill"><b>{learned}</b><span>выучено</span></div>
        </div>
      </section>
      {continueLists.length > 0 && (
        <>
          <div className="sec">Продолжить <button type="button" className="link" onClick={onAllLists}>Все списки</button></div>
          <div className="card-list">
            {continueLists.map(l => <ListRow key={l.src} l={l} onClick={() => onOpenList(l.src)} />)}
          </div>
        </>
      )}
      <div className="sec" style={{ marginTop: 28 }}>Весь словарь <span className="lbl">{words_(total)}</span></div>
      <div className="card-list" style={{ padding: "14px 16px" }}>
        <Bar counts={stats.counts} total={total} thick />
        <Legend counts={stats.counts} />
      </div>
      <button type="button" className="cta" onClick={onStart}>
        <Icon n="player-play" />{todo > 0 ? "Начать · " + cards_(Math.min(SESSION, todo)) : "Позаниматься ещё"}
      </button>
    </>
  );
}

function Legend({ counts }) {
  return (
    <div className="legend">
      {[...SCALE.slice().reverse(), "new"].map(k => <span key={k}><Dot lvl={k} />{LEVELS[k].name} <b>{counts[k]}</b></span>)}
    </div>
  );
}

function ListRow({ l, onClick }) {
  const info = listInfo(l.src);
  return (
    <button type="button" className="li" onClick={onClick}>
      <div className="ic"><Icon n={info.icon} /></div>
      <div className="li-body">
        <div className="li-t">{info.title}</div>
        <div className="li-m">{info.meta} · {words_(l.words.length)}{l.due ? " · повторить " + l.due : ""}</div>
        <Bar counts={l.counts} total={l.words.length} />
      </div>
      <Icon n="chevron-right" className="chev" />
    </button>
  );
}

function ListsScreen({ lists, onOpen }) {
  return (
    <>
      <div className="head"><div><div className="date">{lists.length} {plural(lists.length, "список", "списка", "списков")}</div><h1 className="title">Списки</h1></div></div>
      <div className="card-list">{lists.map(l => <ListRow key={l.src} l={l} onClick={() => onOpen(l.src)} />)}</div>
    </>
  );
}

function ListDetail({ list, progress, onBack, onTrain, onWord }) {
  const info = listInfo(list.src);
  const sorted = useMemo(() => {
    const order = { "0": 0, "1": 1, "2": 2, "new": 3, "3": 4, "4": 5 };
    return list.words.slice().sort((a, b) => order[overallLevel(progress[a.id])] - order[overallLevel(progress[b.id])] || (a.added || 0) - (b.added || 0));
  }, [list, progress]);
  return (
    <>
      <div className="backbar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад"><Icon n="chevron-left" /></button>
        <div style={{ minWidth: 0 }}><div className="date">{info.meta}</div><h1 className="title" style={{ fontSize: 26 }}>{info.title}</h1></div>
      </div>
      <div className="card-list" style={{ padding: "14px 16px" }}>
        <Bar counts={list.counts} total={list.words.length} thick />
        <Legend counts={list.counts} />
      </div>
      <div className="sec">{words_(list.words.length)}</div>
      <div className="card-list">
        {sorted.map(w => <WordRow key={w.id} w={w} p={progress[w.id]} onClick={() => onWord(w.id)} />)}
      </div>
      <button type="button" className="cta" onClick={onTrain}><Icon n="player-play" />Весь список · {cards_(list.words.length)}</button>
    </>
  );
}

function WordRow({ w, p, onClick }) {
  return (
    <button type="button" className="wrow" onClick={onClick}>
      <div className="li-body">
        <div className="w" lang="en">{w.en}</div>
        <div className="t">{w.ru}</div>
      </div>
      <div className="dots2" title="EN → RU · RU → EN">
        <Dot lvl={levelOf(unpack(p && p.er))} /><Dot lvl={levelOf(unpack(p && p.re))} />
      </div>
    </button>
  );
}

function WordsScreen({ words, progress, onWord, onAdd }) {
  const [q, setQ] = useState("");
  const [lvl, setLvl] = useState("all");
  const counts = useMemo(() => levelCounts(words, progress), [words, progress]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    let list = words;
    if (lvl !== "all") list = list.filter(w => overallLevel(progress[w.id]) === lvl);
    if (n) list = list.filter(w => w.en.toLowerCase().includes(n) || w.ru.toLowerCase().includes(n));
    return list.slice().sort((a, b) => a.en.localeCompare(b.en));
  }, [words, progress, q, lvl]);
  const LIMIT = 150;
  return (
    <>
      <div className="head">
        <div><div className="date">{words_(words.length)}</div><h1 className="title">Слова</h1></div>
        <button type="button" className="icon-btn accent" onClick={onAdd} aria-label="Добавить слово"><Icon n="plus" /></button>
      </div>
      <div className="search"><Icon n="search" /><input id="search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Найти слово или перевод" autoComplete="off" autoCapitalize="off" autoCorrect="off" /></div>
      <div className="filters">
        <button type="button" className={"fchip" + (lvl === "all" ? " on" : "")} onClick={() => setLvl("all")}>Все <em>{words.length}</em></button>
        {[...SCALE, "new"].map(k => (
          <button type="button" key={k} className={"fchip" + (lvl === k ? " on" : "")} onClick={() => setLvl(lvl === k ? "all" : k)}>
            <Dot lvl={k} />{LEVELS[k].name} <em>{counts[k]}</em>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <div className="empty"><h2>Ничего не нашлось</h2><p>Попробуй другое слово или сними фильтр.</p></div> : (
        <div className="card-list">
          {shown.slice(0, LIMIT).map(w => <WordRow key={w.id} w={w} p={progress[w.id]} onClick={() => onWord(w.id)} />)}
        </div>
      )}
      {shown.length > LIMIT && <div className="note">Показаны первые {LIMIT} из {shown.length}. Уточни поиск, чтобы найти остальные.</div>}
    </>
  );
}

function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, t]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

function ProfileScreen({ settings, setSettings, stats, streak, onAdd, backup }) {
  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  return (
    <>
      <div className="head"><div><div className="date">Настройки и данные</div><h1 className="title">Профиль</h1></div></div>
      <div className="pills" style={{ marginTop: 0 }}>
        <div className="pill" style={{ boxShadow: "var(--shadow)" }}><b>{streak}</b><span>{plural(streak, "день", "дня", "дней")} подряд</span></div>
        <div className="pill" style={{ boxShadow: "var(--shadow)" }}><b>{stats.learned}</b><span>выучено</span></div>
        <div className="pill" style={{ boxShadow: "var(--shadow)" }}><b>{stats.started}</b><span>в работе</span></div>
      </div>

      <div className="sec">Тренировка</div>
      <div className="group">
        <div className="set">
          <div className="set-t">Направление</div>
          <Seg label="Направление" value={settings.dir} onChange={v => set("dir", v)} options={[["mix", "Оба"], ["er", "EN → RU"], ["re", "RU → EN"]]} />
        </div>
        <div className="set">
          <div className="set-t">Как отвечать</div>
          <Seg label="Как отвечать" value={settings.mode} onChange={v => set("mode", v)} options={[["flip", "Переворачивать"], ["type", "Писать"]]} />
        </div>
        <div className="set">
          <div className="set-t">Новых карточек в день</div>
          <Seg label="Новых в день" value={settings.newPerDay} onChange={v => set("newPerDay", v)} options={[[5, "5"], [10, "10"], [20, "20"], [30, "30"]]} />
        </div>
        <div className="set set-row">
          <div><div className="set-t" style={{ margin: 0 }}>Произносить слово сразу</div><div className="lbl">Озвучка английского при показе карточки</div></div>
          <button type="button" className="switch" role="switch" aria-checked={settings.autoSpeak} aria-label="Произносить слово сразу" onClick={() => set("autoSpeak", !settings.autoSpeak)} />
        </div>
      </div>

      <div className="sec">Слова</div>
      <div className="card-list">
        <button type="button" className="li" onClick={onAdd}><div className="ic"><Icon n="plus" /></div><div className="li-body"><div className="li-t">Добавить слова</div><div className="li-m">Одно слово или сразу списком</div></div><Icon n="chevron-right" className="chev" /></button>
      </div>

      <div className="sec">Резервная копия</div>
      {backup}
      <p className="note">Новые слова в общий словарь добавляет Claude: они появятся здесь сами при следующем открытии.</p>
    </>
  );
}

function Backup({ progress, custom, hidden, onRestore, onCode, notify }) {
  const fileRef = useRef(null);
  const [code, setCode] = useState("");
  const save = () => {
    const data = { app: "slovar", version: 1, savedAt: new Date().toISOString(), progress, custom, hidden };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "slovar-backup-" + dateKey() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const load = e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || d.app !== "slovar") throw new Error("bad");
        onRestore(d); notify("Копия загружена");
      } catch (x) { notify("Это не файл копии словаря"); }
    };
    r.readAsText(f);
  };
  return (
    <div className="group">
      <div className="set">
        <p className="hint-t" style={{ margin: "0 0 10px" }}>Прогресс и свои слова хранятся только на этом устройстве. Сохрани копию, чтобы не потерять их.</p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn small" onClick={save}><Icon n="download" />Сохранить</button>
          <button type="button" className="btn small" onClick={() => fileRef.current && fileRef.current.click()}><Icon n="upload" />Загрузить</button>
          <input id="backup-file" ref={fileRef} type="file" accept="application/json,.json" hidden onChange={load} />
        </div>
      </div>
      <form className="set" onSubmit={e => { e.preventDefault(); const c = code.trim(); if (c) { onCode(c); setCode(""); } }}>
        <div className="set-t">Перенос по коду</div>
        <div className="type-row">
          <input id="restore-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Код переноса" aria-label="Код переноса прогресса"
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ height: 46, fontSize: 15, boxShadow: "none" }} />
          <button type="submit" className="btn small" style={{ height: 46 }}>Перенести</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- add / edit ---------- */
const BLANK = { en: "", ru: "", tr: "", ex: "", src: "" };
function WordForm({ initial, sources, submitLabel, onSubmit, onCancel, idPrefix, resetOnSuccess }) {
  const [v, setV] = useState(() => Object.fromEntries(Object.keys(BLANK).map(k => [k, (initial && initial[k]) || ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = k => e => { setV(s => ({ ...s, [k]: e.target.value })); setErr(""); };
  const submit = async e => {
    e.preventDefault();
    const vals = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]));
    if (!vals.en || !vals.ru) { setErr("Нужны слово и перевод"); return; }
    setBusy(true);
    try {
      await onSubmit(vals);
      if (resetOnSuccess) setV({ ...BLANK, src: vals.src });
    } catch (x) { setErr((x && x.userMessage) || "Не получилось сохранить"); }
    finally { setBusy(false); }
  };
  const f = (k, label, ph, extra = {}) => (
    <div className="field">
      <label htmlFor={idPrefix + "-" + k}>{label}</label>
      <input id={idPrefix + "-" + k} value={v[k]} onChange={set(k)} placeholder={ph} list={extra.list} lang={extra.lang}
        autoComplete="off" autoCapitalize="off" autoCorrect="off" />
    </div>
  );
  return (
    <form onSubmit={submit}>
      {f("en", "Слово или фраза по-английски", "reluctant", { lang: "en" })}
      {f("ru", "Перевод", "неохотный, нехотя")}
      {f("tr", "Транскрипция", "rɪˈlʌktənt")}
      {f("ex", "Пример", "She was reluctant to leave.", { lang: "en" })}
      {f("src", "Список", "Книга, глава", { list: idPrefix + "-sources" })}
      <datalist id={idPrefix + "-sources"}>{sources.filter(Boolean).map(s => <option key={s} value={s} />)}</datalist>
      {err && <div className="err">{err}</div>}
      <div className="actions" style={{ marginTop: 4 }}>
        <button type="submit" className="cta plain" style={{ flex: 1 }} disabled={busy}>{busy ? "Сохраняю…" : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Отмена</button>}
      </div>
    </form>
  );
}

function parseBulk(text, existing) {
  const seen = new Set();
  return text.split("\n").map(line => {
    const t = line.trim();
    if (!t) return null;
    const m = t.match(/^(.+?)(?:\t+|\s+[—–-]\s+|\s*=\s*)(.+)$/);
    if (!m) return { raw: t, error: "нет перевода" };
    let en = m[1].trim(), tr = "";
    const trm = en.match(/^(.*?)\s*([\[\/].+[\]\/])$/);
    if (trm) { en = trm[1].trim(); tr = trm[2].trim(); }
    const ru = m[2].trim();
    const key = en.toLowerCase();
    if (existing.has(key) || seen.has(key)) return { raw: t, en, error: "уже есть" };
    seen.add(key);
    return { raw: t, en, ru, tr };
  }).filter(Boolean);
}

function AddScreen({ words, sources, onAddWords, onBack, notify }) {
  const existing = useMemo(() => new Set(words.map(w => w.en.trim().toLowerCase())), [words]);
  const [bulk, setBulk] = useState("");
  const [bulkSrc, setBulkSrc] = useState("");
  const parsed = useMemo(() => parseBulk(bulk, existing), [bulk, existing]);
  const ready = parsed.filter(p => !p.error);
  const skipped = parsed.filter(p => p.error);
  const addOne = async vals => {
    if (existing.has(vals.en.toLowerCase())) { const e = new Error("dup"); e.userMessage = "«" + vals.en + "» уже есть в словаре"; throw e; }
    onAddWords([vals]);
    notify("Добавлено: " + vals.en);
  };
  const addBulk = () => {
    onAddWords(ready.map(p => ({ en: p.en, ru: p.ru, tr: p.tr || "", ex: "", src: bulkSrc.trim() })));
    notify("Добавлено " + words_(ready.length));
    setBulk(skipped.filter(s => s.error === "нет перевода").map(s => s.raw).join("\n"));
  };
  return (
    <>
      <div className="backbar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад"><Icon n="chevron-left" /></button>
        <h1 className="title" style={{ fontSize: 26 }}>Добавить слова</h1>
      </div>
      <p className="hint-t">Слова, добавленные здесь, сохраняются на этом устройстве. Чтобы слово появилось в общем словаре, пришли его Claude.</p>
      <div className="sec" style={{ marginTop: 8 }}>Одно слово</div>
      <div className="group" style={{ padding: "16px" }}>
        <WordForm idPrefix="add" sources={sources} submitLabel="Добавить" onSubmit={addOne} resetOnSuccess />
      </div>
      <div className="sec">Списком</div>
      <div className="group" style={{ padding: "16px" }}>
        <p className="hint-t">Одна строка — одно слово: <code>слово — перевод</code>. Транскрипцию можно дописать в скобках: <code>glimpse [ɡlɪmps] — мельком увидеть</code>.</p>
        <div className="field"><label htmlFor="bulk-text">Слова</label>
          <textarea id="bulk-text" value={bulk} onChange={e => setBulk(e.target.value)} placeholder={"reluctant — неохотный\nglimpse — мельком увидеть"} /></div>
        <div className="field"><label htmlFor="bulk-src">Список для всех слов</label>
          <input id="bulk-src" value={bulkSrc} onChange={e => setBulkSrc(e.target.value)} list="bulk-sources" placeholder="Книга, глава" autoComplete="off" />
          <datalist id="bulk-sources">{sources.filter(Boolean).map(s => <option key={s} value={s} />)}</datalist></div>
        {parsed.length > 0 && (
          <div className="preview">
            <span>Готово к добавлению: {ready.length}{skipped.length ? " · пропущу: " + skipped.length : ""}</span>
            {skipped.slice(0, 4).map((s, i) => <span key={i}>{s.raw} — {s.error}</span>)}
          </div>
        )}
        <button type="button" className="cta plain" disabled={!ready.length} style={!ready.length ? { opacity: .5 } : null} onClick={addBulk}>
          {ready.length ? "Добавить " + words_(ready.length) : "Добавить"}
        </button>
      </div>
    </>
  );
}

/* ---------- word sheet ---------- */
function WordSheet({ w, p, sources, onClose, onSave, onReset, onDelete }) {
  const [mode, setMode] = useState("view");
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={w.en}>
        <div className="grab" />
        {mode === "edit" ? (
          <WordForm idPrefix={"edit-" + w.id} initial={w} sources={sources} submitLabel="Сохранить"
            onCancel={() => setMode("view")} onSubmit={async vals => { onSave(vals); setMode("view"); }} />
        ) : (
          <>
            <div className="sheet-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sheet-word" lang="en">{w.en}</div>
                {w.tr && <div className="tr" style={{ marginTop: 4 }}>{fmtTr(w.tr)}</div>}
              </div>
              {canSpeak && <button type="button" className="say" style={{ marginTop: 0 }} onClick={() => speak(w.en)} aria-label={"Произнести " + w.en}><Icon n="volume" /></button>}
            </div>
            <div className="ans-main" style={{ marginTop: 14, fontSize: 20 }}>{w.ru}</div>
            {w.ex && <div className="ex" lang="en"><Highlight text={w.ex} word={w.en} /></div>}
            <div className="lbl" style={{ marginTop: 10 }}>{listInfo(w.src).title}</div>
            <div className="group" style={{ marginTop: 16, boxShadow: "none" }}>
              {["er", "re"].map(d => {
                const st = unpack(p && p[d]); const l = levelOf(st);
                return (
                  <div className="dir-line" key={d}>
                    <span className="k">{DIRS[d]}</span><Dot lvl={l} />
                    <span className="v">{LEVELS[l].name}</span>
                    {st && st.n ? <span className="when">{dueAt(st) <= Date.now() ? "пора повторить" : intervalLabel(st)}</span> : null}
                  </div>
                );
              })}
            </div>
            {mode === "confirm" ? (
              <div className="actions">
                <span style={{ flexBasis: "100%", fontSize: 14 }}>Удалить «{w.en}» с этого устройства?</span>
                <button type="button" className="btn small solid-danger" onClick={() => { onDelete(); onClose(); }}>Удалить</button>
                <button type="button" className="btn small" onClick={() => setMode("view")}>Отмена</button>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="btn small" onClick={() => setMode("edit")}><Icon n="pencil" />Изменить</button>
                <button type="button" className="btn small" onClick={onReset}><Icon n="refresh" />Сбросить прогресс</button>
                <button type="button" className="btn small danger" onClick={() => setMode("confirm")}><Icon n="trash" />Удалить</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- training ---------- */
function Training({ session, itemMap, settings, onRate, onClose }) {
  const key = session.queue[0];
  const item = key ? itemMap.get(key) : null;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [out, setOut] = useState(null);
  const cardRef = useRef(null);
  const drag = useRef(null);
  const inputRef = useRef(null);
  const done = session.answered;
  const total = done + session.queue.length;

  useEffect(() => { setOpen(false); setTyped(""); setVerdict(null); setOut(null); }, [session.serial]);
  useEffect(() => {
    if (!item) return;
    if (settings.autoSpeak && item.dir === "er") speak(item.w.en);
    if (settings.mode === "type" && inputRef.current) inputRef.current.focus({ preventScroll: true });
  }, [session.serial]);

  if (!item) return null;
  const { w, dir, st } = item;
  const er = dir === "er";
  const lvl = levelOf(st);
  const previews = { fail: nextStat(st, "fail"), guess: nextStat(st, "guess"), know: nextStat(st, "know") };
  const suggest = verdict === null ? null : verdict ? "know" : "fail";

  const reveal = () => { if (!open) { setOpen(true); if (!er) speak(w.en); } };
  const answer = res => {
    if (out) return;
    buzz(res === "know" ? 12 : 20);
    setOut(res === "fail" ? "l" : "r");
    setTimeout(() => onRate(item, res), 260);
  };
  const check = () => {
    setVerdict(isCorrect(typed, er ? w.ru : w.en));
    setOpen(true);
    if (inputRef.current) inputRef.current.blur();
    if (!er) speak(w.en);
  };

  const onDown = e => {
    if (out || e.target.closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, moved: false };
  };
  const onMove = e => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x;
    if (!d.moved && Math.abs(d.dx) > 8 && Math.abs(d.dx) > Math.abs(e.clientY - d.y)) d.moved = true;
    if (!d.moved) return;
    const el = cardRef.current;
    el.style.transition = "none";
    el.style.transform = `translateX(${d.dx}px) rotate(${d.dx / 22}deg)`;
    const tl = el.querySelector(".swipe-tag.l"), tr = el.querySelector(".swipe-tag.r");
    if (tl) tl.style.opacity = Math.min(1, Math.max(0, -d.dx / 90));
    if (tr) tr.style.opacity = Math.min(1, Math.max(0, d.dx / 90));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const el = cardRef.current;
    if (!d.moved) { reveal(); return; }
    el.style.transition = ""; el.style.transform = "";
    el.querySelectorAll(".swipe-tag").forEach(t => { t.style.opacity = 0; });
    if (Math.abs(d.dx) > 100) answer(d.dx > 0 ? "know" : "fail");
  };

  return (
    <div className="train">
      <div className="wash" />
      <div className="train-in">
        <div className="top">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закончить тренировку"><Icon n="x" /></button>
          <div className="prog"><i style={{ width: (total ? done / total * 100 : 0) + "%" }} /></div>
          <div className="cnt">{done}/{total}</div>
        </div>
        <div className="deck">
          <div className="ghost g2" /><div className="ghost g1" />
          <div ref={cardRef} key={session.serial} className={"card" + (out ? " out-" + out : "")}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <span className="lvl-chip"><Dot lvl={lvl} />{LEVELS[lvl].name}</span>
            <span className="dir-chip">{DIRS[dir]}</span>
            <span className="swipe-tag l">Не знал</span><span className="swipe-tag r">Знал</span>
            <div className={"word" + (er ? "" : " ru")} lang={er ? "en" : "ru"}>{er ? w.en : w.ru}</div>
            {er && w.tr && <div className="tr">{fmtTr(w.tr)}</div>}
            {er && canSpeak && <button type="button" className="say" onClick={() => speak(w.en)} aria-label="Произнести"><Icon n="volume" /></button>}
            {open && (
              <div className="ans">
                {settings.mode === "type" && verdict !== null && (
                  <div className={"verdict " + (verdict ? "ok" : "bad")}>{verdict ? "Верно" : "Не совсем"}
                    {!verdict && <small>{typed.trim() ? "Ты написал: " + typed.trim() : "Ответа не было"}</small>}</div>
                )}
                <div className="ans-main" lang={er ? "ru" : "en"}>{er ? w.ru : w.en}</div>
                {!er && w.tr && <div className="ans-tr">{fmtTr(w.tr)}</div>}
                {!er && canSpeak && <button type="button" className="say" style={{ margin: "12px auto 0" }} onClick={() => speak(w.en)} aria-label="Произнести"><Icon n="volume" /></button>}
                {w.ex && <div className="ex" lang="en"><Highlight text={w.ex} word={w.en} /></div>}
              </div>
            )}
            {!open && settings.mode === "flip" && <div className="hint">Нажми, чтобы увидеть ответ · свайп — оценка</div>}
          </div>
        </div>
        {!open && settings.mode === "type" ? (
          <form className="type-row" onSubmit={e => { e.preventDefault(); check(); }}>
            <input id="answer" ref={inputRef} value={typed} onChange={e => setTyped(e.target.value)} lang={er ? "ru" : "en"}
              placeholder={er ? "Перевод" : "По-английски"} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button type="submit" className="cta plain">Проверить</button>
          </form>
        ) : !open ? (
          <button type="button" className="cta plain reveal" onClick={reveal}>Показать ответ</button>
        ) : (
          <div className="rate">
            <button type="button" className={"rb no" + (suggest && suggest !== "fail" ? " dim" : "")} onClick={() => answer("fail")}>Не знал<small>{intervalLabel(previews.fail)}</small></button>
            <button type="button" className={"rb mid" + (suggest ? " dim" : "")} onClick={() => answer("guess")}>Почти<small>{intervalLabel(previews.guess)}</small></button>
            <button type="button" className={"rb yes" + (suggest === "fail" ? " dim" : "")} onClick={() => answer("know")}>Знал<small>{intervalLabel(previews.know)}</small></button>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ summary, canMore, onMore, onHome }) {
  const r = summary.results;
  const cnt = k => r.filter(x => x.res === k).length;
  const order = { new: -1, 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
  const per = new Map();
  for (const x of r) { const m = per.get(x.key); per.set(x.key, m ? { ...m, to: x.to } : { en: x.en, from: x.from, to: x.to }); }
  const all = [...per.values()].map(m => ({ ...m, up: order[m.to] - order[m.from] }));
  const moves = [...all.filter(m => m.up > 0).sort((a, b) => b.up - a.up), ...all.filter(m => m.up < 0)].slice(0, 6);
  return (
    <div className="train">
      <div className="wash" />
      <div className="train-in">
        <div className="sum">
          <div className="sum-badge"><Icon n="sparkles" /></div>
          <h1 className="title" style={{ fontSize: 30 }}>Готово</h1>
          <div className="sub">{cards_(r.length)} за {Math.max(1, Math.round((summary.end - summary.start) / 60000))} мин</div>
          <div className="pills">
            <div className="pill" style={{ boxShadow: "var(--shadow)" }}><b>{cnt("know")}</b><span>знал</span></div>
            <div className="pill" style={{ boxShadow: "var(--shadow)" }}><b>{cnt("guess")}</b><span>почти</span></div>
            <div className="pill" style={{ boxShadow: "var(--shadow)" }}><b>{cnt("fail")}</b><span>не знал</span></div>
          </div>
          {moves.length > 0 && (
            <div className="card-list moves">
              {moves.map((m, i) => (
                <div className="move" key={i}>
                  <b lang="en">{m.en}</b><Dot lvl={m.from} /><span className="arr">→</span><Dot lvl={m.to} />
                  <span className="lbl" style={{ minWidth: 70, textAlign: "right" }}>{LEVELS[m.to].name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sum-actions">
          {canMore && <button type="button" className="cta plain" onClick={onMore}><Icon n="player-play" />{summary.kind === "list" ? "Пройти список ещё раз" : "Ещё " + SESSION}</button>}
          <button type="button" className="btn" onClick={onHome}>На главную</button>
        </div>
      </div>
    </div>
  );
}

/* ================= app ================= */
function readTab() {
  const h = location.hash.slice(1);
  return ["today", "lists", "words", "profile"].includes(h) ? h : "today";
}

function App() {
  const [shared, setShared] = useState([]);
  const [status, setStatus] = useState("loading");
  const [custom, setCustom] = useStored("custom", {});
  const [hidden, setHidden] = useStored("hidden", []);
  const [progress, setProgress] = useStored("progress", {});
  const [settings, setSettings] = useStored("settings", { dir: "mix", mode: "flip", newPerDay: 10, autoSpeak: false });
  const [dayRaw, setDay] = useStored("day", { date: "", newDone: 0, reviewed: 0 });
  const [days, setDays] = useStored("days", []);
  const [lastSrc, setLastSrc] = useStored("lastSrc", "");
  const [tab, setTab] = useState(readTab);
  const [listSrc, setListSrc] = useState(null);
  const [adding, setAdding] = useState(false);
  const [sheetId, setSheetId] = useState(null);
  const [session, setSession] = useState(null);
  const [summary, setSummary] = useState(null);
  const [toast, setToast] = useState(null);
  const [tick, setTick] = useState(0);

  const today = dateKey();
  const day = dayRaw.date === today ? dayRaw : { date: today, newDone: 0, reviewed: 0 };

  const notify = useCallback(msg => setToast({ msg, key: Date.now() }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const on = () => { setTab(readTab()); setListSrc(null); setAdding(false); };
    window.addEventListener("hashchange", on);
    const vis = () => { if (!document.hidden) setTick(t => t + 1); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("hashchange", on); document.removeEventListener("visibilitychange", vis); };
  }, []);
  const goTab = t => { setListSrc(null); setAdding(false); if (location.hash !== "#" + t) location.hash = t; setTab(t); window.scrollTo(0, 0); };

  useEffect(() => {
    let cancelled = false;
    fetch("words.json", { cache: "no-cache" })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(list => { if (!cancelled) { setShared(Array.isArray(list) ? list.filter(w => w && w.id && w.en && w.ru) : []); setStatus("ready"); } })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  const restoreFromCode = code => {
    if (!/^[a-z0-9]{8,64}$/i.test(code)) { notify("Код не похож на код переноса"); return Promise.resolve(); }
    return fetch("restore/" + code + ".json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(data => { setProgress(p => ({ ...p, ...data })); notify("Прогресс перенесён: " + words_(Object.keys(data).length)); })
      .catch(() => notify("Не получилось перенести: проверь код и интернет"));
  };
  useEffect(() => {
    const m = location.hash.match(/^#restore=([a-z0-9]{8,64})$/i);
    if (!m) return;
    restoreFromCode(m[1]).finally(() => { history.replaceState(null, "", location.pathname + location.search + "#today"); setTab("today"); });
  }, []);

  /* words */
  const sharedIds = useMemo(() => new Set(shared.map(w => w.id)), [shared]);
  const words = useMemo(() => {
    const hid = new Set(hidden);
    const out = [];
    for (const w of shared) { if (!hid.has(w.id)) out.push(custom[w.id] ? { ...w, ...custom[w.id], id: w.id } : w); }
    for (const [id, w] of Object.entries(custom)) if (!sharedIds.has(id) && !hid.has(id) && w && w.en && w.ru) out.push({ ...w, id });
    return out;
  }, [shared, custom, hidden, sharedIds]);
  const wordMap = useMemo(() => new Map(words.map(w => [w.id, w])), [words]);
  const sources = useMemo(() => sourcesOf(words), [words]);

  /* cards */
  const items = useMemo(() => {
    const out = [];
    for (const w of words) for (const d of dirsFor(settings.dir)) {
      out.push({ key: w.id + "|" + d, id: w.id, dir: d, w, st: unpack(progress[w.id] && progress[w.id][d]) });
    }
    return out;
  }, [words, progress, settings.dir]);
  const itemMap = useMemo(() => new Map(items.map(i => [i.key, i])), [items]);
  const newLeft = Math.max(0, settings.newPerDay - day.newDone);

  const stats = useMemo(() => {
    const now = Date.now();
    const due = items.filter(i => i.st && i.st.n && dueAt(i.st) <= now).length;
    const freshCount = freshFor(items, progress, settings.dir).length;
    const counts = levelCounts(words, progress);
    return { due, newToday: Math.min(newLeft, freshCount), learned: counts["4"], started: words.length - counts.new, counts, total: words.length };
  }, [items, words, progress, settings.dir, newLeft, tick]);

  const lists = useMemo(() => {
    const now = Date.now();
    const by = new Map();
    for (const w of words) { const s = w.src || ""; if (!by.has(s)) by.set(s, []); by.get(s).push(w); }
    return sources.map(src => {
      const ws = by.get(src) || [];
      let due = 0;
      for (const w of ws) for (const d of dirsFor(settings.dir)) {
        const st = unpack(progress[w.id] && progress[w.id][d]);
        if (st && st.n && dueAt(st) <= now) due++;
      }
      return { src, words: ws, counts: levelCounts(ws, progress), due };
    });
  }, [words, sources, progress, settings.dir, tick]);
  const continueLists = useMemo(() => {
    const pick = [];
    const last = lists.find(l => l.src === lastSrc);
    if (last) pick.push(last);
    const next = lists.filter(l => l !== last && l.counts.new > 0 && l.counts.new < l.words.length)
      .concat(lists.filter(l => l !== last && l.counts.new === l.words.length));
    for (const l of next) { if (pick.length >= 2) break; if (!pick.includes(l)) pick.push(l); }
    return pick;
  }, [lists, lastSrc]);

  /* actions */
  const db = useMemo(() => ({
    add: list => setCustom(c => {
      const taken = new Set([...sharedIds, ...Object.keys(c)]);
      const n = { ...c };
      list.forEach((v, i) => { n[makeId(v.en, taken)] = { ...v, added: Date.now() + i }; });
      return n;
    }),
    save: (id, vals) => setCustom(c => ({ ...c, [id]: { ...(c[id] || {}), ...vals } })),
    remove: id => {
      setCustom(c => { const n = { ...c }; delete n[id]; return n; });
      if (sharedIds.has(id)) setHidden(h => (h.includes(id) ? h : [...h, id]));
    },
  }), [sharedIds]);

  const startSession = (kind, src) => {
    const pool = kind === "list" ? items.filter(i => (i.w.src || "") === src) : items;
    let queue = buildQueue(kind, pool, progress, settings, newLeft);
    if (!queue.length && kind === "today") queue = buildQueue("extra", pool, progress, settings, newLeft);
    if (!queue.length) { notify("Здесь пока нечего повторять"); return; }
    if (kind === "list") setLastSrc(src);
    setSummary(null);
    setSession({ kind, src, queue, answered: 0, results: [], serial: 1, start: Date.now() });
  };

  const rate = (item, res) => {
    const before = item.st;
    const after = nextStat(before, res);
    setProgress(p => ({ ...p, [item.id]: { ...(p[item.id] || {}), [item.dir]: pack(after) } }));
    setDay(d0 => {
      const d = d0.date === today ? d0 : { date: today, newDone: 0, reviewed: 0 };
      return { ...d, reviewed: d.reviewed + 1, newDone: d.newDone + (before && before.n ? 0 : 1) };
    });
    setDays(ds => (ds.includes(today) ? ds : [...ds.slice(-120), today]));
    if (item.w.src) setLastSrc(item.w.src);
    setSession(s => {
      const rest = s.queue.slice(1);
      if (res === "fail") rest.splice(Math.min(3, rest.length), 0, item.key);
      const from = levelOf(before), to = levelOf(after);
      const order = { new: -1, 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
      const results = [...s.results, { key: item.key, en: item.w.en, res, from, to, up: order[to] - order[from] }];
      if (!rest.length) {
        setSummary({ kind: s.kind, src: s.src, results, start: s.start, end: Date.now() });
        return null;
      }
      return { ...s, queue: rest, answered: s.answered + 1, results, serial: s.serial + 1 };
    });
  };

  const closeSession = () => {
    if (session && session.results.length) setSummary({ kind: session.kind, src: session.src, results: session.results, start: session.start, end: Date.now() });
    setSession(null);
  };

  const sheetWord = sheetId ? wordMap.get(sheetId) : null;
  const currentList = listSrc !== null ? lists.find(l => l.src === listSrc) : null;
  const ctaShown = (tab === "today" && !adding) || (tab === "lists" && currentList && !adding);

  let screen;
  if (status === "loading") screen = <p className="loading">Загружаю словарь…</p>;
  else if (adding) screen = <AddScreen words={words} sources={sources} onAddWords={db.add} onBack={() => setAdding(false)} notify={notify} />;
  else if (tab === "today") screen = (
    <TodayScreen stats={stats} streak={streakOf(days)} continueLists={continueLists}
      onStart={() => startSession("today")} onOpenList={src => { setTab("lists"); location.hash = "lists"; setListSrc(src); }} onAllLists={() => goTab("lists")} />
  );
  else if (tab === "lists") screen = currentList
    ? <ListDetail list={currentList} progress={progress} onBack={() => setListSrc(null)} onTrain={() => startSession("list", currentList.src)} onWord={setSheetId} />
    : <ListsScreen lists={lists} onOpen={src => { setListSrc(src); window.scrollTo(0, 0); }} />;
  else if (tab === "words") screen = <WordsScreen words={words} progress={progress} onWord={setSheetId} onAdd={() => setAdding(true)} />;
  else screen = (
    <ProfileScreen settings={settings} setSettings={setSettings} stats={stats} streak={streakOf(days)} onAdd={() => setAdding(true)}
      backup={<Backup progress={progress} custom={custom} hidden={hidden} notify={notify} onCode={restoreFromCode}
        onRestore={d => { setProgress(d.progress || {}); setCustom(d.custom || {}); setHidden(Array.isArray(d.hidden) ? d.hidden : []); }} />} />
  );

  const tabs = [["today", "Сегодня", "sparkles"], ["lists", "Списки", "stack-2"], ["words", "Слова", "search"], ["profile", "Профиль", "user-circle"]];

  return (
    <>
      <div className="wash" />
      <main className={"app" + (ctaShown ? "" : " no-cta")}>
        {status === "error" && (
          <div className="empty" style={{ marginBottom: 16 }}><h2>Не получилось загрузить слова</h2><p>Проверь интернет и открой приложение ещё раз.</p></div>
        )}
        {screen}
      </main>
      <nav className="tabbar" aria-label="Разделы">
        {tabs.map(([id, t, ic]) => (
          <button key={id} type="button" className={"tab" + (tab === id ? " on" : "")} aria-current={tab === id ? "page" : undefined} onClick={() => goTab(id)}>
            <Icon n={ic} />{t}
          </button>
        ))}
      </nav>
      {sheetWord && (
        <WordSheet w={sheetWord} p={progress[sheetWord.id]} sources={sources} onClose={() => setSheetId(null)}
          onSave={vals => { db.save(sheetWord.id, vals); notify("Сохранено"); }}
          onReset={() => { setProgress(p => { const n = { ...p }; delete n[sheetWord.id]; return n; }); notify("Прогресс сброшен"); }}
          onDelete={() => { db.remove(sheetWord.id); notify("Удалено: " + sheetWord.en); }} />
      )}
      {session && <Training session={session} itemMap={itemMap} settings={settings} onRate={rate} onClose={closeSession} />}
      {!session && summary && (
        <Summary summary={summary}
          canMore={buildQueue(summary.kind === "list" ? "list" : "today", summary.kind === "list" ? items.filter(i => (i.w.src || "") === summary.src) : items, progress, settings, newLeft).length > 0 || summary.kind !== "list"}
          onMore={() => startSession(summary.kind === "list" ? "list" : "today", summary.src)}
          onHome={() => { setSummary(null); goTab("today"); }} />
      )}
      {toast && <div className="toast" role="status" key={toast.key}>{toast.msg}</div>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
