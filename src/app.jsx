/* ---------------- App (standalone web app) ----------------
  Shared words come from words.json (published with the site; Claude adds new ones there).
  Everything personal lives on the device (localStorage, prefix "slovar:"):
    progress — { [wordId]: { er: Pack, re: Pack } }   Pack = [score, n, know, guess, fail, last]
    custom   — { [wordId]: word } words added on this device, or local edits of shared words
    hidden   — [wordId] shared words deleted on this device
  #restore=<code> imports restore/<code>.json into progress once.
*/

function Backup({ progress, custom, hidden, onRestore, notify }) {
  const fileRef = useRef(null);
  const save = () => {
    const data = { app: "slovar", version: 1, savedAt: new Date().toISOString(), progress, custom, hidden };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "slovar-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
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
        onRestore(d);
        notify("Копия загружена");
      } catch (x) {
        notify("Это не файл копии словаря.");
      }
    };
    r.readAsText(f);
  };
  return (
    <section className="panel" style={{ marginTop: 24 }}>
      <h2>Резервная копия</h2>
      <p className="hint">Прогресс и слова, добавленные на этом устройстве, хранятся только здесь. Сохрани копию в файл, чтобы не потерять их или перенести на другое устройство.</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={save}>Сохранить копию</button>
        <button type="button" className="btn" onClick={() => fileRef.current && fileRef.current.click()}>Загрузить копию</button>
        <input id="backup-file" ref={fileRef} type="file" accept="application/json,.json" hidden onChange={load} />
      </div>
    </section>
  );
}

function App() {
  const [shared, setShared] = useState([]);
  const [status, setStatus] = useState("loading");
  const [custom, setCustom] = useState(() => prefs.get("custom", {}));
  const [hidden, setHidden] = useState(() => prefs.get("hidden", []));
  const [progress, setProgress] = useState(() => prefs.get("progress", {}));
  const [toast, setToast] = useState(null);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => { prefs.set("custom", custom); }, [custom]);
  useEffect(() => { prefs.set("hidden", hidden); }, [hidden]);
  useEffect(() => { prefs.set("progress", progress); }, [progress]);

  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const notify = useCallback(msg => setToast({ msg, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    fetch("words.json", { cache: "no-cache" })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(list => {
        if (cancelled) return;
        setShared(Array.isArray(list) ? list.filter(w => w && w.id && w.en && w.ru) : []);
        setStatus("ready");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const m = location.hash.match(/^#restore=([a-z0-9]{8,64})$/i);
    if (!m) return;
    fetch("restore/" + m[1] + ".json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(data => {
        setProgress(p => ({ ...p, ...data }));
        const n = Object.keys(data).length;
        notify("Прогресс перенесён: " + n + " " + plural(n, "слово", "слова", "слов"));
      })
      .catch(() => notify("Не получилось загрузить прогресс по этой ссылке."))
      .finally(() => {
        history.replaceState(null, "", location.pathname + location.search + "#train");
        setRoute("train");
      });
  }, []);

  const sharedIds = useMemo(() => new Set(shared.map(w => w.id)), [shared]);
  const sharedIdsRef = useRef(sharedIds);
  sharedIdsRef.current = sharedIds;

  const words = useMemo(() => {
    const hid = new Set(hidden);
    const out = [];
    for (const w of shared) {
      if (hid.has(w.id)) continue;
      out.push(custom[w.id] ? { ...w, ...custom[w.id], id: w.id } : w);
    }
    for (const [id, w] of Object.entries(custom)) {
      if (!sharedIds.has(id) && !hid.has(id) && w && w.en && w.ru) out.push({ ...w, id });
    }
    return out;
  }, [shared, custom, hidden, sharedIds]);

  // Same interface the components use for the claude.ai database, backed by this device.
  const db = useMemo(() => ({
    doc(path) {
      const id = path.split("/")[1];
      return {
        set: async data => {
          setCustom(c => ({ ...c, [id]: { ...data } }));
          setHidden(h => h.filter(x => x !== id));
        },
        update: async data => { setCustom(c => ({ ...c, [id]: { ...(c[id] || {}), ...data } })); },
        delete: async () => {
          setCustom(c => { const n = { ...c }; delete n[id]; return n; });
          if (sharedIdsRef.current.has(id)) setHidden(h => (h.includes(id) ? h : [...h, id]));
        },
      };
    },
  }), []);

  const saveStat = (wordId, dir, stat) =>
    setProgress(p => ({ ...p, [wordId]: { ...(p[wordId] || {}), [dir]: pack(stat) } }));
  const resetStat = wordId => setProgress(p => { const n = { ...p }; delete n[wordId]; return n; });
  const restoreBackup = d => {
    setProgress(d.progress && typeof d.progress === "object" ? d.progress : {});
    setCustom(d.custom && typeof d.custom === "object" ? d.custom : {});
    setHidden(Array.isArray(d.hidden) ? d.hidden : []);
  };

  const view = useMemo(() => words.map(w => {
    const p = progress[w.id] || {};
    return { ...w, s: { er: unpack(p.er), re: unpack(p.re) } };
  }), [words, progress]);

  const tabs = [["train", "Тренировка"], ["words", "Слова"], ["add", "Добавить"]];
  const page = route;

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">Словарь из книг
          <small>{words.length} {plural(words.length, "слово", "слова", "слов")}</small>
        </div>
        <nav className="tabs" aria-label="Разделы">
          {tabs.map(([id, t]) => <a key={id} href={"#" + id} aria-current={page === id ? "page" : undefined}>{t}</a>)}
        </nav>
      </header>

      {status === "error" && (
        <div className="banner"><strong>Не получилось загрузить слова.</strong> Проверь интернет и открой приложение ещё раз. Слова, добавленные на этом устройстве, показаны.</div>
      )}
      {status === "loading" && <p className="loading">Загружаю словарь…</p>}
      {status !== "loading" && page === "train" && <Train words={view} onRate={saveStat} canEditWords={true} />}
      {status !== "loading" && page === "words" && (
        <>
          <Words words={view} db={db} notify={notify} canEditWords={true} onReset={resetStat} localMode={false} />
          <Backup progress={progress} custom={custom} hidden={hidden} onRestore={restoreBackup} notify={notify} />
        </>
      )}
      {status !== "loading" && page === "add" && <Add words={words} db={db} notify={notify} />}

      {toast && <div className="toast" role="status" key={toast.key}>{toast.msg}</div>}
    </div>
  );
}

createRootAndRender();
function createRootAndRender() {
  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
}
