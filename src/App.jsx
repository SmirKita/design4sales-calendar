import React, { useEffect, useMemo, useRef, useState } from "react";
import { telegramPlan } from "./data/telegramPlan.js";
import { loadCalendarState, normalizeState, readBackup, saveCalendarState, STORAGE_KEY, STORAGE_SCHEMA_VERSION } from "./storage.js";
import { makeManifest, isDate, isSchedulable, moscowInstant, PLATFORMS, SETTINGS_KEY, scheduledSlots, settingsFor, todayInMoscow, userPosts } from "./publicationSchedule.js";
import { dateLabel, NewPublication, PlacementEditor, ScheduleSettings } from "./Schedule.jsx";
import { planningTimeline, publicationEntry } from "./editorialPlan.js";
import { mac, nativeCall, downloadJSON } from "./macBridge.js";

function getRecord(state, post) {
  const saved = state[post.id] || {};
  return { ...saved, phases: { ...post.defaultPhases, ...saved.phases } };
}

const tabs = [["plan", "План"], ["ideas", "Темы"], ["archive", "Архив"], ["settings", "Настройки"]];
const metricLabels = { v24: "Просмотры · 24 ч", v72: "Просмотры · 72 ч", replies: "Ответы", subscriptions: "Подписки", workRequests: "Обращения", minutes: "Минуты", clicks: "Клики" };

function App({ initial }) {
  const [state, setState] = useState(() => mac ? normalizeState(initial?.state) : loadCalendarState());
  const current = useRef(state);
  const [sync, setSync] = useState(initial?.sync || {});
  const [saveError, setSaveError] = useState(initial?.error || "");
  const [revision, setRevision] = useState(initial?.revision || 0);
  const rev = useRef(revision);
  const queue = useRef(Promise.resolve());
  const pendingSave = useRef(null);
  const blocked = Boolean(initial?.error);
  const flush = () => queue.current.then(() => pendingSave.current === null);
  const syncText = saveError || (!mac ? "Apple: подключение доступно в приложении на Mac"
    : sync.busy ? "Apple: проверяю список и обновляю задачи"
      : sync.error || (sync.connected && sync.syncedRevision === revision && sync.lastSuccess ? "Apple: задачи обновлены на Mac"
        : sync.connected ? "Apple: список подключён"
          : sync.configured ? "Apple: проверка подключения ещё не завершена" : "Apple: подключение не настроено"));
  useEffect(() => {
    const onStatus = (event) => setSync(event.detail);
    window.addEventListener("d4s-sync", onStatus);
    if (mac) {
      window.d4sFlush = flush;
      nativeCall("status").then(setSync, () => {});
    }
    return () => {
      window.removeEventListener("d4s-sync", onStatus);
      if (mac) delete window.d4sFlush;
    };
  }, []);
  const [tab, setTab] = useState("plan");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [now, setNow] = useState(Date.now);
  const importRef = useRef(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const allPosts = useMemo(() => [...telegramPlan, ...userPosts(state)].sort((a, b) => a.date.localeCompare(b.date)), [state]);
  const settings = settingsFor(state);

  const enqueueSave = (payload, retry = false) => {
    queue.current = queue.current.then(async () => {
      if (retry && (pendingSave.current?.revision !== payload.revision || payload.revision !== rev.current)) return false;
      const save = { ...payload, backup: payload.backup || pendingSave.current?.backup === true };
      try {
        await nativeCall("save", save);
        pendingSave.current = null;
        setSaveError("");
        return true;
      } catch (error) {
        pendingSave.current = save;
        setSaveError("Изменения пока не записаны на Mac. " + error.message);
        return false;
      }
    });
    return queue.current;
  };

  const persist = (next, backup = false, recover = false) => {
    if (blocked && !recover) return Promise.resolve(false);
    let saved = Promise.resolve(true);
    if (!mac) {
      try {
        if (backup) localStorage.setItem(STORAGE_KEY + "-before-restore", JSON.stringify({ version: STORAGE_SCHEMA_VERSION, state: current.current }));
        saveCalendarState(next);
        setSaveError("");
      } catch {
        setSaveError("Не удалось сохранить изменения в браузере. Освободи место или разреши локальное хранилище.");
        saved = Promise.resolve(false);
      }
    } else {
      const number = ++rev.current;
      setRevision(number);
      const manifest = makeManifest([...telegramPlan, ...userPosts(next)], next);
      saved = enqueueSave({ state: next, manifest, revision: number, backup, recover });
    }
    current.current = next;
    setState(next);
    return saved;
  };

  const retrySave = async () => {
    await queue.current;
    const pending = pendingSave.current;
    if (pending && await enqueueSave(pending, true) && pending.recover) window.location.reload();
  };

  const changePreparation = (post, ready) => {
    const record = getRecord(current.current, post);
    const phases = { ...record.phases, preparation: ready ? "ready" : "planned" };
    persist({ ...current.current, [post.id]: { ...record, phases } });
  };

  const changePlacement = (post, platform, patch) => {
    const record = getRecord(current.current, post);
    const placements = { ...record.placements, [platform]: { ...record.placements?.[platform], ...patch } };
    const phases = platform === "tg" && patch.status && placements.tg.enabled
      ? { ...record.phases, publication: patch.status === "cancelled" ? "skip" : patch.status } : record.phases;
    persist({ ...current.current, [post.id]: { ...record, phases, placements } });
    if (patch.enabled === true && tab === "ideas") {
      setTab("plan");
      setQuery("");
      setSelectedTopic(post.id);
      setNotice("Выход запланирован");
      requestAnimationFrame(() => document.getElementById("post-" + post.id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    } else if (patch.status === "published" || patch.status === "cancelled") {
      const name = PLATFORMS.find((entry) => entry.id === platform).name;
      setNotice(patch.status === "published" ? `${name} · выход отмечен` : `${name} · выход отменён`);
    } else setNotice("");
  };

  const create = ({ title, date, platform, time, usesDefault, reminder }) => {
    if (blocked) return "Хранилище недоступно.";
    if (!title || !isDate(date)) return "Укажи тему и корректную дату.";
    if (!Number.isFinite(moscowInstant(date, time)) || moscowInstant(date, time) <= Date.now()) return "Это время уже прошло. Выбери будущий выход.";
    const clean = (value) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
    if (allPosts.some((post) => post.date === date && clean(post.title) === clean(title))) return "Такая тема уже есть на эту дату.";
    const id = "user-" + [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, "0")).join("");
    persist({ ...current.current, [id]: {
      customPost: { title, date },
      placements: { [platform]: { enabled: true, date, reminder, ...(usesDefault ? {} : { mode: "custom", time }) } },
    } });
    setTab("plan");
    setCreating(false);
    setQuery("");
    setNotice("Публикация запланирована");
    requestAnimationFrame(() => document.getElementById("post-" + id)?.scrollIntoView({ block: "nearest" }));
    return "";
  };

  const syncAction = async (action) => {
    if (blocked || !await flush()) return;
    try { setSync(await nativeCall(action)); }
    catch (error) { setSync((old) => ({ ...old, error: error.message })); }
  };

  const entries = allPosts.filter((post) => post.kind === "publication").map((post) =>
    publicationEntry(post, getRecord(state, post), settings, now));
  const agenda = planningTimeline(entries, todayInMoscow(new Date(now)))
    .filter((entry) => entry.post.title.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  const visible = entries.filter(({ post, section }) => section === tab && post.title.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  if (tab === "plan") visible.sort((a, b) => a.next - b.next || a.post.date.localeCompare(b.post.date));
  if (tab === "ideas") visible.sort((a, b) => (a.targetDate < todayInMoscow(new Date(now))) - (b.targetDate < todayInMoscow(new Date(now))) || a.targetDate.localeCompare(b.targetDate));
  if (tab === "archive") visible.sort((a, b) => b.post.date.localeCompare(a.post.date));


  const exportProgress = async () => {
    const data = { exportedAt: new Date().toISOString(), schemaVersion: STORAGE_SCHEMA_VERSION, state };
    if (!mac) downloadJSON(data);
    else {
      try { await nativeCall("export", { data }); }
      catch (error) { alert(error.message); }
    }
  };

  const importProgress = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const next = readBackup(JSON.parse(await file.text()));
      if (window.confirm("Восстановить прогресс из этого файла? Текущее состояние будет сохранено отдельно.")) {
        const saved = await persist(next, true, blocked);
        if (blocked && saved) window.location.reload();
      }
    } catch {
      alert("Не удалось прочитать файл прогресса.");
    }
  };

  const restoreLastGood = async () => {
    if (!window.confirm("Восстановить предыдущую сохранённую версию плана? Повреждённый файл будет сохранён отдельно.")) return;
    try {
      await nativeCall("restoreLastGood");
      window.location.reload();
    } catch (error) {
      setSaveError(error.message);
    }
  };

  const openTab = (value) => {
    setTab(value);
    setCreating(false);
    setQuery("");
    setNotice("");
    setSelectedTopic("");
  };

  const openFromAgenda = (entry) => {
    setTab(entry.tentative ? "ideas" : "plan");
    setCreating(false);
    setQuery("");
    setSelectedTopic(entry.post.id);
    requestAnimationFrame(() => document.getElementById("post-" + entry.post.id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const changeTargetDate = (post, targetDate) => {
    if (!isDate(targetDate)) return;
    persist({ ...current.current, [post.id]: { ...getRecord(current.current, post), targetDate } });
  };

  return <main>
    <header className="appHeader">
      <div><p className="brand">DESIGN4SALES</p><h1>Публикации</h1><p className="muted">План, готовность и напоминания</p></div>
      <button className="button primary" disabled={blocked} onClick={() => {
        openTab("plan");
        setCreating(true);
      }}>＋ Новая публикация</button>
    </header>

    {saveError && <section className="panel errorPanel">
      <p role="alert">{saveError}</p>
      <div className="slotTools">
        {mac && pendingSave.current && <button className="button secondary" onClick={retrySave}>Повторить сохранение</button>}
        {blocked && initial?.canRecover && <button className="button secondary" onClick={restoreLastGood}>Восстановить предыдущую версию</button>}
        {blocked && <button className="button secondary" onClick={() => importRef.current?.click()}>Импортировать резервный JSON</button>}
      </div>
    </section>}

    <nav className="viewTabs" aria-label="Разделы календаря">
      {tabs.map(([value, label]) => <button key={value} className="button" aria-current={tab === value ? "page" : undefined} onClick={() => openTab(value)}>{label}</button>)}
    </nav>
    {notice && <p className="notice" role="status">{notice}</p>}
    {creating && <NewPublication settings={settings} create={create} close={() => setCreating(false)} />}

    {tab === "settings" ? <>
      <ScheduleSettings settings={settings} change={(patch) => persist({ ...current.current, [SETTINGS_KEY]: { ...settings, ...patch } })}
        native={Boolean(mac)} sync={sync} syncText={syncText} syncAction={syncAction} />
      <section className="panel settingsPanel">
        <h2>Резервная копия</h2>
        <p className="muted">{mac ? "План хранится на этом Mac." : "План хранится в этом браузере."} JSON включает расписание и сохранённую историю.</p>
        <div className="slotTools"><button className="button secondary" onClick={exportProgress} disabled={blocked && !pendingSave.current}>Экспорт прогресса</button>
          <button className="button secondary" onClick={() => importRef.current?.click()}>Импорт JSON</button></div>
      </section>
    </> : <>
      {tab === "plan" && mac && settings.enabled && !sync.connected && <div className="connectionBanner">
        <span>Для сигналов на Mac и iPhone подключи Apple «Напоминания».</span>
        <button className="button secondary" onClick={() => openTab("settings")}>Настроить</button>
      </div>}
      <div className="listHeader">
        <div>
          <h2>{tab === "plan" ? "График публикаций" : tab === "ideas" ? "Темы и подсказки" : "История выходов"}</h2>
          <p className="muted">{tab === "plan" ? "Ближайшие темы и выходы · время по Москве"
            : tab === "ideas" ? "Открой тему, чтобы прочитать замысел и план подготовки." : "Опубликованные и отменённые выходы."}</p>
        </div>
        {(entries.some(({ section }) => section === tab) || (tab === "plan" && agenda.length > 0)) && <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск по темам" placeholder="Найти тему" />}
      </div>

      {tab === "plan" && <PlanningTimeline items={agenda.slice(0, 8)} open={openFromAgenda} all={() => openTab("ideas")} />}
      {tab === "plan" && visible.length > 0 && <h2 className="scheduledHeading">Выходы по площадкам</h2>}
      <div className="calendarList">
        {visible.map(({ post, record, section, targetDate }) => <PublicationCard key={post.id} post={post} record={record} section={section} settings={settings}
          now={now} targetDate={targetDate} selected={selectedTopic === post.id} changeTarget={(date) => changeTargetDate(post, date)} disabled={blocked} prepare={(ready) => changePreparation(post, ready)} change={(platform, patch) => changePlacement(post, platform, patch)} />)}
      </div>
      {!visible.length && !(tab === "plan" && agenda.length) && <div className="panel empty">
        <h3>{query ? "Темы не найдены" : tab === "plan" ? "Пока нет запланированных выходов" : "Здесь пока пусто"}</h3>
        {!query && tab === "plan" && <p className="muted">Создай публикацию или выбери готовую идею во вкладке «Темы».</p>}
        {!query && tab === "plan" && <button className="button secondary" onClick={() => openTab("ideas")}>Открыть темы</button>}
      </div>}
    </>}
    <input ref={importRef} type="file" accept="application/json,.json" onChange={importProgress} hidden />
  </main>;
}

function PlanningTimeline({ items, open, all }) {
  if (!items.length) return null;
  return <section className="panel planningTimeline" aria-label="Ближайший график">
    <p className="muted timelineHint">Дата-ориентир помогает спланировать подготовку. Напоминание появится после выбора площадки и времени.</p>
    <ol>{items.map((entry) => <li key={entry.id}><button className="timelineRow" onClick={() => open(entry)}>
      <span className="timelineDate">{dateLabel(entry.date)}{entry.time && <small>{entry.time} МСК</small>}</span>
      <span className="timelineTopic"><strong>{entry.post.title}</strong><small>{entry.tentative ? "Дата-ориентир · открыть тему" : entry.platform + " · запланировано"}</small></span>
      <span aria-hidden="true" className="timelineArrow">→</span>
    </button></li>)}</ol>
    <button className="button quiet" onClick={all}>Все темы и даты</button>
  </section>;
}

function PublicationCard({ post, record, section, targetDate, selected, changeTarget, settings, now, disabled, prepare, change }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [placementsOpen, setPlacementsOpen] = useState(section === "plan");
  useEffect(() => {
    if (selected) setDetailsOpen(true);
  }, [selected]);
  const historical = section === "archive" && !scheduledSlots(post, record, settings).length;
  const ready = ["ready", "skip"].includes(record.phases.preparation);
  return <article className="panel publicationCard" id={"post-" + post.id}>
    <div className="cardHeader">
      <div>
        {historical && <p className="muted archiveDate">{record.publicationConfirmation ? "Опубликовано · подтверждено тобой" : dateLabel(post.date) + " · " + post.date.slice(0, 4) + " · Опубликовано"}</p>}
        {section === "ideas" && <p className="topicDate">{dateLabel(targetDate)} · дата-ориентир{targetDate < todayInMoscow(new Date(now)) ? " прошла" : ""}</p>}
        <h3><button className="topicTitle" aria-expanded={detailsOpen} aria-controls={"brief-" + post.id} onClick={() => setDetailsOpen(!detailsOpen)}>{post.title}</button></h3>
        {section === "ideas" && post.thought && !detailsOpen && <p className="muted ideaDescription">{post.thought}</p>}
      </div>
      {section !== "archive" && (section === "plan" || detailsOpen) && <label className="checkbox readyToggle">
        <input type="checkbox" checked={ready} disabled={disabled} onChange={(e) => prepare(e.target.checked)} /> Готово к выходу
      </label>}
    </div>
    <button className="button quiet briefToggle" aria-expanded={detailsOpen} aria-controls={"brief-" + post.id} onClick={() => setDetailsOpen(!detailsOpen)}>
      {detailsOpen ? "Свернуть подсказки" : "О чём пост и как подготовить"}
    </button>
    {detailsOpen && <section className="editorialBrief" id={"brief-" + post.id}>
      {section === "ideas" && <div className="targetDate">
        <label>Ориентир выхода<input type="date" value={targetDate} disabled={disabled} onChange={(event) => changeTarget(event.target.value)} /></label>
        <p className="muted">Можно менять по ходу подготовки.</p>
      </div>}
      <EditorialBrief post={post} />
    </section>}
    {section === "plan" && <PlacementEditor post={post} record={record} settings={settings} change={change} now={now} disabled={disabled} />}
    {section === "ideas" && detailsOpen && isSchedulable(post) && <div className="topicSchedule">
      <h4>Запланировать выход</h4>
      <PlacementEditor post={{ ...post, date: targetDate }} record={record} settings={settings} change={change} now={now} disabled={disabled} />
    </div>}
    {section === "archive" && !historical && isSchedulable(post) && <>
      <button className="button secondary" aria-expanded={placementsOpen} onClick={() => setPlacementsOpen(!placementsOpen)}>
        {placementsOpen ? "Свернуть выходы" : "Открыть выходы"}
      </button>
      {placementsOpen && <PlacementEditor post={post} record={record} settings={settings} change={change} now={now} disabled={disabled} />}
    </>}
    {section === "archive" && <ArchiveDetails record={record} />}
  </article>;
}

function EditorialBrief({ post }) {
  const fields = [
    ["Главная мысль", post.thought],
    ["Для кого", post.audience],
    ["Как раскрыть тему", post.textVisual],
    ["Что показать", post.visual],
    ["План подготовки", post.scenario],
    ["Что подготовить", post.materials],
    ["Действие читателя", post.engagement || post.cta],
    ["Формат", post.format],
  ].filter(([, text]) => text && text !== "—" && text !== "Не требуется.");
  return fields.length ? <dl className="briefFields">{fields.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
    : <p className="muted">Описание этой темы пока не заполнено.</p>;
}

function ArchiveDetails({ record }) {
  const metrics = Object.entries(metricLabels).filter(([key]) => record.metrics?.[key] !== undefined && record.metrics[key] !== "");
  const note = record.resultNote || record.note;
  const link = record.links?.post;
  if (!metrics.length && !note && !link) return null;
  return <details className="archiveDetails">
    <summary>Сохранённые данные</summary>
    {note && <p>{note}</p>}
    {link && <p className="muted archiveLink">{link}</p>}
    {metrics.length > 0 && <dl>{metrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{record.metrics[key]}</dd></div>)}</dl>}
  </details>;
}

export default App;
