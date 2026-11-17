
/*
  Data: collection "words" (shared, only the owner/editors write), one document per word,
  id = slug of the English word: { en, ru, tr (transcription), ex (example), src (list), added (ms) }
  Old documents may still carry s: { er, re } — the owner's ratings before per-person progress.
  Progress is per person: data/users/<id>/p0..p7 (shard by word id),
    { [wordId]: { er: Pack, re: Pack } }   er = EN→RU, re = RU→EN
  Pack = [score 0..5, n, know, guess, fail, last ms]. Viewers who cannot write keep it in localStorage.
  Color: no stat = new; floor(score): 0 red, 1 orange, 2 yellow, 3 light green, 4–5 green.
*/
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const LEVELS = {
  "0":   { name: "Не запоминается", short: "Красные",  color: "var(--r0)" },
  "1":   { name: "Плохо",           short: "Оранжевые", color: "var(--r1)" },
  "2":   { name: "Средне",          short: "Жёлтые",   color: "var(--r2)" },
  "3":   { name: "Хорошо",          short: "Салатовые", color: "var(--r3)" },
  "4":   { name: "Запомнил",        short: "Зелёные",  color: "var(--r4)" },
  "new": { name: "Новое",           short: "Новые",    color: "var(--rnew)" },
};
const SCALE = ["0", "1", "2", "3", "4"];
const SORT_ORDER = ["0", "1", "2", "new", "3", "4"];
const DIRS = { er: "EN → RU", re: "RU → EN" };
const RES = { fail: "Не знал", guess: "Угадал", know: "Знал" };

const prefs = {
  get(k, d) { try { const v = localStorage.getItem("slovar:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("slovar:" + k, JSON.stringify(v)); } catch (e) {} },
};
function usePref(k, d) {
  const [v, setV] = useState(() => prefs.get(k, d));
  useEffect(() => { prefs.set(k, v); }, [k, v]);
  return [v, setV];
}

function levelOf(st) {
  if (!st || !st.n) return "new";
  return String(Math.max(0, Math.min(4, Math.floor(st.score || 0))));
}
function overallLevel(w) {
  const done = [w.s && w.s.er, w.s && w.s.re].filter(st => st && st.n);
  if (!done.length) return "new";
  return levelOf(done.reduce((a, b) => (a.score <= b.score ? a : b)));
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
function weight(st) {
  if (!st || !st.n) return 4;
  const base = [12, 8, 5, 3, 1.2, 0.6][Math.max(0, Math.min(5, Math.floor(st.score || 0)))];
  const days = st.last ? (Date.now() - st.last) / 864e5 : 0;
  return base * (1 + Math.min(Math.max(days, 0), 14) / 4);
}
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
function readRoute() {
  const h = location.hash.slice(1);
  return ["train", "words", "add"].includes(h) ? h : "train";
}

const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
function speak(text) {
  if (!canSpeak) return;
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
function SpeakBtn({ text }) {
  if (!canSpeak) return null;
  return (
    <button type="button" className="icon-btn" aria-label={"Произнести " + text} title="Произнести"
      onClick={e => { e.stopPropagation(); speak(text); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  );
}
function Highlight({ text, word }) {
  if (!text) return null;
  const w = (word || "").trim();
  if (!w) return text;
  const stem = w.includes(" ") ? w : (w.length > 4 ? w.replace(/e$/i, "") : w);
  const parts = text.split(new RegExp("\\b(" + escapeRe(stem) + "[a-z'’]*)", "gi"));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}
function Dot({ lvl }) { return <i className="dot" style={{ "--c": LEVELS[lvl].color }} />; }
function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>
      ))}
    </div>
  );
}
const sourcesOf = words => [...new Set(words.map(w => w.src).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));

const SHARDS = 8;
function shardOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return "p" + (Math.abs(h) % SHARDS);
}
const pack = st => [st.score || 0, st.n || 0, st.know || 0, st.guess || 0, st.fail || 0, st.last || 0];
const unpack = a => (Array.isArray(a) ? { score: a[0], n: a[1], know: a[2], guess: a[3], fail: a[4], last: a[5] } : null);

/* ---------------- Training ---------------- */
function Train({ words, onRate, canEditWords }) {
  const [dir, setDir] = usePref("dir", "er");
  const [mode, setMode] = usePref("mode", "flip");
  const [srcPref, setSrc] = usePref("src", "");
  const [noGreen, setNoGreen] = usePref("noGreen", false);
  const [cur, setCur] = useState(null);
  const [phase, setPhase] = useState("front");
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [last, setLast] = useState(null);
  const [session, setSession] = useState({ know: 0, guess: 0, fail: 0 });
  const recent = useRef([]);
  const inputRef = useRef(null);

  const sources = useMemo(() => sourcesOf(words), [words]);
  const src = sources.includes(srcPref) ? srcPref : "";

  const pool = useMemo(() => {
    const dirs = dir === "mix" ? ["er", "re"] : [dir];
    const out = [];
    for (const w of words) {
      if (src && w.src !== src) continue;
      for (const d of dirs) {
        const st = w.s && w.s[d];
        if (noGreen && ["3", "4"].includes(levelOf(st))) continue;
        out.push({ id: w.id, dir: d, st });
      }
    }
    return out;
  }, [words, dir, src, noGreen]);

  const pick = useCallback(() => {
    if (!pool.length) { setCur(null); return; }
    let cands = pool.filter(p => !recent.current.includes(p.id));
    if (!cands.length) cands = pool;
    const ws = cands.map(c => weight(c.st));
    let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
    for (; i < cands.length - 1; i++) { r -= ws[i]; if (r <= 0) break; }
    setCur({ id: cands[i].id, dir: cands[i].dir });
    setPhase("front"); setTyped(""); setVerdict(null);
  }, [pool]);

  const valid = !!cur && pool.some(p => p.id === cur.id && p.dir === cur.dir);
  useEffect(() => { if (!valid) pick(); }, [valid, pick]);

  const w = cur ? words.find(x => x.id === cur.id) : null;

  useEffect(() => {
    if (mode === "type" && phase === "front" && inputRef.current) inputRef.current.focus({ preventScroll: true });
  }, [cur, mode, phase]);

  const reveal = () => setPhase("back");
  const check = () => {
    setVerdict(isCorrect(typed, cur.dir === "er" ? w.ru : w.en));
    setPhase("back");
    if (inputRef.current) inputRef.current.blur();
  };
  const rate = res => {
    if (!w || !cur) return;
    const before = w.s && w.s[cur.dir];
    const after = nextStat(before, res);
    onRate(w.id, cur.dir, after);
    setLast({ key: Date.now(), en: w.en, dir: cur.dir, from: levelOf(before), to: levelOf(after) });
    setSession(s => ({ ...s, [res]: s[res] + 1 }));
    const uniq = new Set(pool.map(p => p.id)).size;
    recent.current = [w.id, ...recent.current].slice(0, Math.max(0, Math.min(5, uniq - 1)));
    pick();
  };

  useEffect(() => {
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey || !w) return;
      const tag = (e.target.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || tag === "select";
      if (phase === "front") {
        if (mode === "flip" && !inField && (e.key === " " || e.key === "Enter")) { e.preventDefault(); reveal(); }
      } else if (!inField && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault(); rate(["fail", "guess", "know"][+e.key - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!words.length) return <EmptyState canEditWords={canEditWords} />;

  const controls = (
    <div className="controls">
      <Seg label="Направление" value={dir} onChange={setDir}
        options={[["er", "EN → RU"], ["re", "RU → EN"], ["mix", "Вперемешку"]]} />
      <Seg label="Режим" value={mode} onChange={setMode} options={[["flip", "Карточки"], ["type", "Писать ответ"]]} />
      {sources.length > 0 && (
        <select id="train-src" aria-label="Источник" value={src} onChange={e => setSrc(e.target.value)}>
          <option value="">Все источники</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <label className="check"><input id="train-nogreen" type="checkbox" checked={noGreen}
        onChange={e => setNoGreen(e.target.checked)} />Без зелёных</label>
    </div>
  );

  const total = session.know + session.guess + session.fail;
  const footer = (
    <>
      {last && (
        <div className="after pop" key={last.key}>
          <b>{last.en}</b><span className="dirlabel">{DIRS[last.dir]}</span>
          {last.from === last.to
            ? <span className="lvl"><Dot lvl={last.to} />остаётся «{LEVELS[last.to].name}»</span>
            : <><span className="lvl"><Dot lvl={last.from} />{LEVELS[last.from].name}</span>→
               <span className="lvl"><Dot lvl={last.to} />{LEVELS[last.to].name}</span></>}
        </div>
      )}
      {total > 0 && (
        <div className="session">За эту тренировку: {total} {plural(total, "карточка", "карточки", "карточек")} ·
          знал {session.know} · угадал {session.guess} · не знал {session.fail}</div>
      )}
    </>
  );

  if (!pool.length || !w) {
    return (
      <>
        {controls}
        <div className="empty">
          <h2>Под эти настройки слов нет</h2>
          <p>{noGreen ? "Все слова здесь уже зелёные. Сними галочку «Без зелёных» или выбери другой источник." : "Выбери другой источник или добавь слова."}</p>
        </div>
        {footer}
      </>
    );
  }

  const st = w.s && w.s[cur.dir];
  const lvl = levelOf(st);
  const er = cur.dir === "er";
  const suggest = mode === "type" && verdict !== null ? (verdict ? "know" : "fail") : null;

  return (
    <>
      {controls}
      <div className="card" style={{ "--lvl": LEVELS[lvl].color }}>
        <div className="card-meta">
          <span className="dirlabel">{DIRS[cur.dir]}</span>
          <span className="lvl"><Dot lvl={lvl} />{LEVELS[lvl].name}</span>
          {w.src && <span className="src">{w.src}</span>}
        </div>
        <div className="word-row">
          <div className="prompt" lang={er ? "en" : "ru"}>{er ? w.en : w.ru}</div>
          {er && <SpeakBtn text={w.en} />}
        </div>
        {er && w.tr && <div className="tr">{fmtTr(w.tr)}</div>}

        {phase === "front" ? (
          mode === "flip" ? (
            <button type="button" className="btn primary big" onClick={reveal}>Показать ответ <kbd>Пробел</kbd></button>
          ) : (
            <form className="typeform" onSubmit={e => { e.preventDefault(); check(); }}>
              <input id="answer" ref={inputRef} value={typed} onChange={e => setTyped(e.target.value)}
                placeholder={er ? "Перевод на русский" : "Слово на английском"} lang={er ? "ru" : "en"}
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <button type="submit" className="btn primary">Проверить</button>
            </form>
          )
        ) : (
          <div className="back">
            {mode === "type" && (
              <div className={"verdict " + (verdict ? "ok" : "bad")}>
                {verdict ? "Верно" : "Неверно"}
                {!verdict && <span> · {typed.trim() ? <>ты написал «{typed.trim()}»</> : "ответа не было"}</span>}
              </div>
            )}
            <div className="word-row">
              <div className="answer" lang={er ? "ru" : "en"}>{er ? w.ru : w.en}</div>
              {!er && <SpeakBtn text={w.en} />}
            </div>
            {!er && w.tr && <div className="tr">{fmtTr(w.tr)}</div>}
            {w.ex && <p className="example" lang="en"><Highlight text={w.ex} word={w.en} /></p>}
          </div>
        )}

        {phase === "back" && (
          <div className="rate">
            {["fail", "guess", "know"].map((r, i) => (
              <button key={r} type="button" className={"rb " + r + (suggest === r ? " suggest" : "")} onClick={() => rate(r)}>
                {RES[r]}<small><kbd>{i + 1}</kbd></small>
              </button>
            ))}
          </div>
        )}
      </div>
      {footer}
    </>
  );
}

function EmptyState({ canEditWords }) {
  if (!canEditWords) {
    return (
      <div className="empty">
        <h2>Слов пока нет</h2>
        <p>Владелец словаря ещё не добавил слова. Загляни позже.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>Слов пока нет</h2>
      <p>Добавь слова на вкладке «Добавить» или пришли Claude в чате список слов из книги. Он добавит их сюда с переводом, транскрипцией и примером.</p>
      <p>Каждое слово начинает серым и по ходу тренировки получает цвет:</p>
      <div className="scale-demo">
        {SCALE.map(k => <span key={k}><Dot lvl={k} />{LEVELS[k].name}</span>)}
      </div>
      <div><a className="btn primary" href="#add">Добавить слова</a></div>
    </div>
  );
}

/* ---------------- Word list ---------------- */
function Words({ words, db, notify, canEditWords, onReset, localMode }) {
  const [q, setQ] = useState("");
  const [srcSel, setSrc] = useState("");
  const [lvl, setLvl] = useState("all");
  const [sort, setSort] = usePref("sort", "worst");
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const sources = useMemo(() => sourcesOf(words), [words]);
  const src = sources.includes(srcSel) ? srcSel : "";
  const base = useMemo(() => words.filter(w => !src || w.src === src).map(w => ({ ...w, lvl: overallLevel(w) })), [words, src]);
  const counts = useMemo(() => {
    const c = { new: 0, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    base.forEach(w => c[w.lvl]++);
    return c;
  }, [base]);
  const shown = useMemo(() => {
    let list = base;
    if (lvl !== "all") list = list.filter(w => w.lvl === lvl);
    const n = q.trim().toLowerCase();
    if (n) list = list.filter(w => w.en.toLowerCase().includes(n) || w.ru.toLowerCase().includes(n));
    const cmp = {
      worst: (a, b) => SORT_ORDER.indexOf(a.lvl) - SORT_ORDER.indexOf(b.lvl) || a.en.localeCompare(b.en),
      recent: (a, b) => (b.added || 0) - (a.added || 0),
      az: (a, b) => a.en.localeCompare(b.en),
    }[sort] || ((a, b) => 0);
    return [...list].sort(cmp);
  }, [base, lvl, q, sort]);

  if (!words.length) return <EmptyState canEditWords={canEditWords} />;

  const write = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) notify(okMsg); }
    catch (e) { notify("Не получилось сохранить. Проверь связь и попробуй ещё раз."); }
    finally { setBusy(false); }
  };
  const del = w => write(async () => { await db.doc("words/" + w.id).delete(); setConfirm(null); setOpen(null); }, "Удалено: " + w.en);
  const reset = w => { onReset(w.id); notify("Прогресс сброшен: " + w.en); };
  const delSource = () => write(async () => {
    const list = words.filter(w => w.src === src);
    for (const w of list) await db.doc("words/" + w.id).delete();
    setConfirm(null); setSrc("");
  }, "Источник удалён");

  return (
    <>
      <div className="summary">
        <div className="bar" aria-hidden="true">
          {[...SCALE, "new"].map(k => counts[k] ? <i key={k} style={{ "--c": LEVELS[k].color, width: (counts[k] / base.length * 100) + "%" }} /> : null)}
        </div>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={lvl === "all"} onClick={() => setLvl("all")}>Все <em>{base.length}</em></button>
          {[...SCALE, "new"].map(k => (
            <button key={k} type="button" className="chip" aria-pressed={lvl === k} onClick={() => setLvl(lvl === k ? "all" : k)}>
              <Dot lvl={k} />{LEVELS[k].short} <em>{counts[k]}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <input id="words-search" type="search" placeholder="Поиск по слову или переводу" value={q} onChange={e => setQ(e.target.value)} />
        {sources.length > 0 && (
          <select id="words-src" aria-label="Источник" value={src} onChange={e => { setSrc(e.target.value); setConfirm(null); }}>
            <option value="">Все источники</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select id="words-sort" aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="worst">Сначала трудные</option>
          <option value="recent">Сначала новые</option>
          <option value="az">По алфавиту</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="empty"><p>Ничего не найдено.</p></div>
      ) : (
        <div className="list">
          {shown.map(w => (
            <div className="item" key={w.id}>
              <button type="button" className="row" aria-expanded={open === w.id}
                onClick={() => { setOpen(open === w.id ? null : w.id); setEditing(null); setConfirm(null); }}>
                <span style={{ minWidth: 0 }}>
                  <span className="w" lang="en">{w.en}{w.tr && <span className="tr">{fmtTr(w.tr)}</span>}</span><br />
                  <span className="t">{w.ru}</span>
                </span>
                <span className="dirdots">
                  {["er", "re"].map(d => {
                    const l = levelOf(w.s && w.s[d]);
                    return <span key={d} title={DIRS[d] + ": " + LEVELS[l].name}><Dot lvl={l} />{d === "er" ? "EN" : "RU"}</span>;
                  })}
                </span>
              </button>
              {open === w.id && (
                <div className="detail">
                  {editing === w.id ? (
                    <WordForm idPrefix={"edit-" + w.id} initial={w} sources={sources} submitLabel="Сохранить"
                      onCancel={() => setEditing(null)}
                      onSubmit={async vals => { await db.doc("words/" + w.id).update(vals); setEditing(null); notify("Сохранено: " + vals.en); }} />
                  ) : (
                    <>
                      {w.ex && <p className="example" lang="en"><Highlight text={w.ex} word={w.en} /></p>}
                      {w.src && <div className="stats">Источник: {w.src}</div>}
                      <div className="stats">
                        {["er", "re"].map(d => {
                          const st = w.s && w.s[d]; const l = levelOf(st);
                          return (
                            <div key={d}><span className="dirlabel">{DIRS[d]}</span><Dot lvl={l} />{LEVELS[l].name}
                              {st && st.n ? ` · знал ${st.know || 0}, угадал ${st.guess || 0}, не знал ${st.fail || 0}` : ""}</div>
                          );
                        })}
                      </div>
                      <div className="actions">
                        <SpeakBtn text={w.en} />
                        {canEditWords && <button type="button" className="btn" onClick={() => setEditing(w.id)}>Изменить</button>}
                        <button type="button" className="btn" onClick={() => reset(w)}>Сбросить мой прогресс</button>
                        {!canEditWords ? null : confirm === w.id ? (
                          <>
                            <span className="ask">Удалить «{w.en}»?</span>
                            <button type="button" className="btn danger" disabled={busy} onClick={() => del(w)}>Удалить</button>
                            <button type="button" className="btn" onClick={() => setConfirm(null)}>Отмена</button>
                          </>
                        ) : (
                          <button type="button" className="btn quiet-danger" onClick={() => setConfirm(w.id)}>Удалить</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="legend">Точки справа: EN — узнаёшь английское слово, RU — вспоминаешь его по-русски. Общий цвет слова — по более слабому направлению. Цвета у каждого свои.</p>
      {localMode && <p className="legend">Твой прогресс сохраняется только в этом браузере.</p>}

      {src && canEditWords && (
        <div className="actions" style={{ marginTop: 16 }}>
          {confirm === "src" ? (
            <>
              <span className="ask">Удалить все {base.length} {plural(base.length, "слово", "слова", "слов")} из «{src}»?</span>
              <button type="button" className="btn danger" disabled={busy} onClick={delSource}>Удалить</button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>Отмена</button>
            </>
          ) : (
            <button type="button" className="btn quiet-danger" onClick={() => setConfirm("src")}>Удалить все слова из «{src}»</button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------------- Forms ---------------- */
const BLANK = { en: "", ru: "", tr: "", ex: "", src: "" };
function WordForm({ initial, sources, submitLabel, onSubmit, onCancel, idPrefix, resetOnSuccess }) {
  const [v, setV] = useState(() => ({ ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map(k => [k, (initial && initial[k]) || ""])) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = k => e => setV(s => ({ ...s, [k]: e.target.value }));
  const submit = async e => {
    e.preventDefault();
    const vals = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]));
    if (!vals.en || !vals.ru) { setErr("Нужны английское слово и перевод."); return; }
    setBusy(true); setErr("");
    try {
      await onSubmit(vals);
      if (resetOnSuccess) setV({ ...BLANK, src: vals.src });
    } catch (x) {
      setErr((x && x.userMessage) || "Не получилось сохранить. Проверь связь и попробуй ещё раз.");
    } finally { setBusy(false); }
  };
  const f = (k, label, extra = {}) => (
    <div className={"field" + (extra.full ? " full" : "")}>
      <label htmlFor={idPrefix + "-" + k}>{label}</label>
      <input id={idPrefix + "-" + k} value={v[k]} onChange={set(k)} placeholder={extra.ph || ""}
        list={extra.list} lang={extra.lang} autoComplete="off" autoCapitalize="off" />
    </div>
  );
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="fields">
        {f("en", "Английское слово или фраза *", { ph: "reluctant", lang: "en" })}
        {f("ru", "Перевод *", { ph: "неохотный, нехотя" })}
        {f("tr", "Транскрипция", { ph: "rɪˈlʌktənt" })}
        {f("src", "Источник", { ph: "Книга, глава", list: idPrefix + "-sources" })}
        {f("ex", "Пример из текста", { full: true, ph: "She was reluctant to leave.", lang: "en" })}
      </div>
      <datalist id={idPrefix + "-sources"}>{sources.map(s => <option key={s} value={s} />)}</datalist>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Сохраняю…" : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Отмена</button>}
        {err && <span className="err">{err}</span>}
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

function Add({ words, db, notify }) {
  const sources = useMemo(() => sourcesOf(words), [words]);
  const existing = useMemo(() => new Set(words.map(w => w.en.trim().toLowerCase())), [words]);
  const taken = () => new Set(words.map(w => w.id));
  const [bulk, setBulk] = useState("");
  const [bulkSrc, setBulkSrc] = useState("");
  const [prog, setProg] = useState(null);
  const parsed = useMemo(() => parseBulk(bulk, existing), [bulk, existing]);
  const ready = parsed.filter(p => !p.error);
  const skipped = parsed.filter(p => p.error);

  const addOne = async vals => {
    if (existing.has(vals.en.toLowerCase())) {
      const e = new Error("dup"); e.userMessage = "«" + vals.en + "» уже есть в словаре."; throw e;
    }
    await db.doc("words/" + makeId(vals.en, taken())).set({ ...vals, added: Date.now() });
    notify("Добавлено: " + vals.en);
  };
  const addBulk = async () => {
    const ids = taken();
    const src = bulkSrc.trim();
    let done = 0;
    setProg({ done, total: ready.length });
    try {
      for (const p of ready) {
        await db.doc("words/" + makeId(p.en, ids)).set({ en: p.en, ru: p.ru, tr: p.tr || "", ex: "", src, added: Date.now() + done });
        done++; setProg({ done, total: ready.length });
      }
      notify("Добавлено " + done + " " + plural(done, "слово", "слова", "слов"));
      setBulk(skipped.filter(s => s.error === "нет перевода").map(s => s.raw).join("\n"));
    } catch (e) {
      notify("Добавлено " + done + " из " + ready.length + ". Остальные не сохранились: проверь связь и нажми ещё раз.");
    } finally { setProg(null); }
  };

  return (
    <>
      <div className="chat-tip">
        Слова, добавленные здесь, сохраняются только на этом устройстве. Чтобы слово появилось у всех, пришли его Claude: он добавит его в общий словарь с переводом и транскрипцией.
      </div>

      <section className="panel">
        <h2>Одно слово</h2>
        <WordForm idPrefix="add" sources={sources} submitLabel="Добавить" onSubmit={addOne} resetOnSuccess />
      </section>

      <section className="panel">
        <h2>Списком</h2>
        <p className="hint">Одна строка — одно слово: <code>слово — перевод</code>. Транскрипцию можно дописать после слова в квадратных скобках: <code>glimpse [ɡlɪmps] — мельком увидеть</code>.</p>
        <div className="field">
          <label htmlFor="bulk-text">Слова</label>
          <textarea id="bulk-text" rows={7} value={bulk} onChange={e => setBulk(e.target.value)}
            placeholder={"reluctant — неохотный\nglimpse — мельком увидеть\nwander — бродить"} />
        </div>
        <div className="field">
          <label htmlFor="bulk-src">Источник для всех слов</label>
          <input id="bulk-src" value={bulkSrc} onChange={e => setBulkSrc(e.target.value)} list="bulk-sources" placeholder="Книга, глава" />
          <datalist id="bulk-sources">{sources.map(s => <option key={s} value={s} />)}</datalist>
        </div>
        {parsed.length > 0 && (
          <div className="preview">
            <span>Готово к добавлению: {ready.length}{skipped.length ? ` · пропущу: ${skipped.length}` : ""}</span>
            {skipped.slice(0, 5).map((s, i) => <span key={i}><code>{s.raw}</code> — {s.error}</span>)}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={!ready.length || !!prog} onClick={addBulk}>
            {prog ? `Добавляю ${prog.done} из ${prog.total}…` : `Добавить ${ready.length || ""} ${plural(ready.length, "слово", "слова", "слов")}`}
          </button>
        </div>
      </section>
    </>
  );
}

