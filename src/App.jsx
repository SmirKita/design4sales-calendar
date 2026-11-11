import React, { useEffect, useMemo, useRef, useState } from "react";
import { contentTypes, telegramPlan } from "./data/telegramPlan.js";
import { telegramBacklog } from "./data/telegramBacklog.js";
import { loadCalendarState, normalizeState, readBackup, saveCalendarState, STORAGE_KEY, STORAGE_SCHEMA_VERSION } from "./storage.js";
import { makeManifest, isDate, isSchedulable, moscowInstant, PLATFORMS, SETTINGS_KEY, settingsFor, todayInMoscow, userPosts } from "./publicationSchedule.js";
import { dateLabel, NewPublication, PlacementEditor, ScheduleSettings } from "./Schedule.jsx";
import { addDays, nextFreeWednesday, planningTimeline, preparationFor, publicationEntry, STAGES, weekday, weekStart, weeksCovered } from "./editorialPlan.js";
import { mac, nativeCall, downloadJSON } from "./macBridge.js";
import { Icon } from "./icons.jsx";

function getRecord(state, post) {
  const saved = state[post.id] || {};
  return { ...saved, phases: { ...post.defaultPhases, ...saved.phases } };
}

const tabs = [
  ["plan", "Сегодня", "rocket"], ["calendar", "Календарь", "calendar"], ["board", "Подготовка", "text"],
  ["ideas", "Банк тем", "bank"], ["archive", "Итоги", "chart"], ["settings", "Настройки", "gear"],
];
const metricFields = [["v24", "24 часа"], ["v72", "72 часа"], ["replies", "Ответы"], ["workRequests", "Обращения"]];
const metricLabels = { v24: "Просмотры · 24 ч", v72: "Просмотры · 72 ч", replies: "Ответы", subscriptions: "Подписки", workRequests: "Обращения", minutes: "Минуты", clicks: "Клики" };
const weekdays = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const DAY = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / DAY);
const lower = (value) => value.trim().toLocaleLowerCase("ru");

function relative(date, today) {
  const days = daysBetween(today, date);
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === -1) return "вчера";
  return days > 0 ? `через ${days} дн.` : `${-days} дн. назад`;
}

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
  const syncText = saveError || (!mac ? "Напоминания Apple подключаются в приложении на Mac"
    : sync.busy ? "Проверяю список и обновляю напоминания"
      : sync.error || (sync.connected && sync.syncedRevision === revision && sync.lastSuccess ? "Напоминания обновлены"
        : sync.connected ? "Список «Напоминаний» подключён"
          : sync.configured ? "Подключение ещё проверяется" : "Список «Напоминаний» не подключён"));
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
  const [notice, setNotice] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [bankFilter, setBankFilter] = useState("all");
  const [month, setMonth] = useState(() => todayInMoscow().slice(0, 7));
  const [now, setNow] = useState(Date.now);
  const importRef = useRef(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const allPosts = useMemo(() => [...telegramPlan, ...userPosts(state)].sort((a, b) => a.date.localeCompare(b.date)), [state]);
  const settings = settingsFor(state);
  const today = todayInMoscow(new Date(now));

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

  // Правка одной записи с возможностью отменить её из уведомления.
  const update = (post, change, message) => {
    if (blocked) return;
    const before = current.current;
    const record = getRecord(before, post);
    persist({ ...before, [post.id]: change(record) });
    if (message) setNotice({ text: message, undo: () => persist(before) });
  };

  const retrySave = async () => {
    await queue.current;
    const pending = pendingSave.current;
    if (pending && await enqueueSave(pending, true) && pending.recover) window.location.reload();
  };

  const changePreparation = (post, ready) => update(post, (record) => ({ ...record, phases: { ...record.phases, preparation: ready ? "ready" : "planned" } }));

  const changePlacement = (post, platform, patch) => {
    const record = getRecord(current.current, post);
    const placements = { ...record.placements, [platform]: { ...record.placements?.[platform], ...patch } };
    const phases = platform === "tg" && patch.status && placements.tg.enabled
      ? { ...record.phases, publication: patch.status === "cancelled" ? "skip" : patch.status } : record.phases;
    persist({ ...current.current, [post.id]: { ...record, phases, placements, shelved: false } });
    if (patch.status === "published" || patch.status === "cancelled") {
      const name = PLATFORMS.find((entry) => entry.id === platform).name;
      setNotice({ text: patch.status === "published" ? `${name} · выход отмечен` : `${name} · выход отменён` });
    } else if (patch.enabled === true) setNotice({ text: "Выход запланирован" });
  };

  const markPublished = (post) => update(post, (record) => {
    const placements = Object.fromEntries(Object.entries(record.placements || {}).map(([id, slot]) => [id,
      slot.enabled && !["published", "cancelled"].includes(slot.status) ? { ...slot, status: "published", publishedAt: new Date().toISOString() } : slot]));
    return { ...record, placements, shelved: false, phases: { ...record.phases, preparation: "ready", publication: "published" },
      publicationConfirmation: { confirmedOn: today, source: "user" } };
  }, "Выход отмечен. Цифры можно внести в «Итогах»");

  const setStage = (post, stage) => {
    if (stage === "published") return markPublished(post);
    const name = STAGES.find((row) => row.id === stage).name;
    update(post, (record) => ({ ...record, phases: { ...record.phases, preparation: preparationFor(stage),
      ...(record.phases.publication === "published" && !isArchiveTopic(post) ? { publication: "planned" } : {}) } }), "Этап: " + name);
  };

  const reschedule = (post, date) => {
    if (!isDate(date)) return;
    update(post, (record) => ({ ...record, targetDate: date, shelved: false }), "Перенесено на " + dateLabel(date));
  };
  const shelve = (post, value) => update(post, (record) => ({ ...record, shelved: value }), value ? "Тема убрана в банк без даты" : "Тема вернулась в план");
  const changeRecord = (post, patch) => update(post, (record) => ({ ...record, ...patch }));
  const changeMetric = (post, key, value) => update(post, (record) => ({ ...record, metrics: { ...record.metrics, [key]: value.replace(/[^\d]/g, "") } }));
  const changeLink = (post, value) => update(post, (record) => ({ ...record, links: { ...record.links, post: value } }));
  const toggleCheck = (post, index) => update(post, (record) => ({ ...record, checklist: { ...record.checklist, [index]: !record.checklist?.[index] } }));

  const create = ({ title, date, platform, time, usesDefault, reminder }) => {
    if (blocked) return "Хранилище недоступно.";
    if (!title || !isDate(date)) return "Укажи тему и корректную дату.";
    if (!Number.isFinite(moscowInstant(date, time)) || moscowInstant(date, time) <= Date.now()) return "Это время уже прошло. Выбери будущий выход.";
    const clean = (value) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
    if (allPosts.some((post) => post.date === date && clean(post.title) === clean(title))) return "Такая тема уже есть на эту дату.";
    const id = newId();
    persist({ ...current.current, [id]: {
      customPost: { title, date },
      placements: { [platform]: { enabled: true, date, reminder, ...(usesDefault ? {} : { mode: "custom", time }) } },
    } });
    setTab("plan");
    setCreating(false);
    setSelectedTopic("");
    setQuery("");
    setNotice({ text: "Публикация запланирована" });
    requestAnimationFrame(() => document.getElementById("post-" + id)?.scrollIntoView({ block: "nearest" }));
    return "";
  };

  const adoptIdea = (title, date) => {
    if (blocked) return;
    const before = current.current;
    persist({ ...before, [newId()]: { customPost: { title, date } } });
    setNotice({ text: "Тема поставлена на " + dateLabel(date), undo: () => persist(before) });
  };

  const syncAction = async (action) => {
    if (blocked || !await flush()) return;
    try { setSync(await nativeCall(action)); }
    catch (error) { setSync((old) => ({ ...old, error: error.message })); }
  };

  const entries = allPosts.filter((post) => post.kind === "publication").map((post) =>
    publicationEntry(post, getRecord(state, post), settings, now));
  const workItems = allPosts.filter((post) => post.kind !== "publication");
  const matches = (post) => !query.trim() || post.title.toLocaleLowerCase("ru").includes(lower(query));
  const agenda = planningTimeline(entries, today).filter((item) => matches(item.post));
  const scheduled = entries.filter((entry) => entry.section === "plan" && matches(entry.post)).sort((a, b) => a.next - b.next || a.post.date.localeCompare(b.post.date));
  const overdue = entries.filter((entry) => entry.overdue).sort((a, b) => b.targetDate.localeCompare(a.targetDate));
  const published = entries.filter((entry) => entry.section === "archive").sort((a, b) => publishedOn(b).localeCompare(publishedOn(a)));
  const freeWednesday = nextFreeWednesday(entries, today);
  const selected = selectedTopic && entries.find((entry) => entry.post.id === selectedTopic);

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

  const openTab = (value, filter) => {
    setTab(value);
    setCreating(false);
    setQuery("");
    setSelectedTopic("");
    if (filter) setBankFilter(filter);
    document.querySelector(".workspace")?.scrollTo?.(0, 0);
  };
  const openTopic = (id) => {
    setSelectedTopic(id);
    setCreating(false);
    document.querySelector(".workspace")?.scrollTo?.(0, 0);
  };

  const actions = { openTopic, openTab, setStage, reschedule, shelve, markPublished, changeMetric, changeLink, changeRecord, toggleCheck,
    adoptIdea, change: changePlacement, prepare: changePreparation };
  const common = { entries, today, settings, now, disabled: blocked, freeWednesday, actions };
  const counts = { plan: overdue.length, ideas: entries.filter((entry) => entry.section === "ideas").length };

  let body;
  if (selected) body = <TopicView entry={selected} {...common} back={() => setSelectedTopic("")} />;
  else if (tab === "settings") body = <>
    <PageHead eyebrow="Напоминания, время и копии" title="Настройки" />
    <div className="settingsGrid">
      <div className="settingsColumn">
        <ScheduleSettings settings={settings} change={(patch) => persist({ ...current.current, [SETTINGS_KEY]: { ...settings, ...patch } })}
          native={Boolean(mac)} sync={sync} syncText={syncText} syncAction={syncAction} />
      </div>
      <section className="tile settingsPanel backupTile">
        <Icon name="bank" size={84} className="tileArt" />
        <h2>Резервная копия</h2>
        <p className="muted">{mac ? "План хранится на этом Mac." : "План хранится в этом браузере."} Файл JSON включает расписание, этапы, цифры и историю.</p>
        <div className="slotTools"><button className="button secondary" onClick={exportProgress} disabled={blocked && !pendingSave.current}>Экспорт прогресса</button>
          <button className="button secondary" onClick={() => importRef.current?.click()}>Импорт JSON</button></div>
      </section>
    </div>
  </>;
  else if (tab === "calendar") body = <CalendarView {...common} month={month} setMonth={setMonth} workItems={workItems} />;
  else if (tab === "board") body = <BoardView {...common} overdue={overdue} published={published} />;
  else if (tab === "ideas") body = <BankView {...common} filter={bankFilter} setFilter={setBankFilter} matches={matches} query={query} setQuery={setQuery} />;
  else if (tab === "archive") body = <ResultsView {...common} published={published.filter((entry) => matches(entry.post))} query={query} setQuery={setQuery} />;
  else body = <TodayView {...common} agenda={agenda} overdue={overdue} published={published} scheduled={scheduled}
    creating={creating} closeCreate={() => setCreating(false)} create={create} query={query} setQuery={setQuery} />;

  return <div className="app">
    <nav className="viewTabs rail" aria-label="Разделы календаря">
      <div className="logo" aria-hidden="true">d4s</div>
      {tabs.map(([value, label, icon]) => <button key={value} className={"railItem" + (value === "settings" ? " railBottom" : "")}
        aria-current={tab === value && !selected ? "page" : undefined} aria-label={label} title={label} onClick={() => openTab(value)}>
        <Icon name={icon} size={value === "board" ? 30 : 36} />
        <span className="railLabel">{label}</span>
        {counts[value] > 0 && value === "plan" && <span className="badge">{counts[value]}</span>}
      </button>)}
    </nav>
    <main className="workspace">
      <header className="appHeader">
        <div className="appHeaderText"><p className="eyebrow">{weekdays[weekday(today)]} · #design4sales</p></div>
        <div className="headerActions">
          <button className="button primary" disabled={blocked} onClick={() => {
            setTab("plan");
            setSelectedTopic("");
            setCreating(true);
          }}>＋ Новая публикация</button>
        </div>
      </header>

      {saveError && <section className="tile errorPanel">
        <p role="alert">{saveError}</p>
        <div className="slotTools">
          {mac && pendingSave.current && <button className="button secondary" onClick={retrySave}>Повторить сохранение</button>}
          {blocked && initial?.canRecover && <button className="button secondary" onClick={restoreLastGood}>Восстановить предыдущую версию</button>}
          {blocked && <button className="button secondary" onClick={() => importRef.current?.click()}>Импортировать резервный JSON</button>}
        </div>
      </section>}
      {tab === "plan" && !selected && mac && settings.enabled && !sync.connected && <div className="connectionBanner">
        <Icon name="bell" size={40} />
        <span>Чтобы напоминания приходили на Mac и iPhone, подключи список «Напоминаний».</span>
        <button className="button secondary" onClick={() => openTab("settings")}>Подключить</button>
      </div>}
      {body}
    </main>
    {notice && <div className="toast" role="status">{notice.text}{notice.undo && <button onClick={() => { notice.undo(); setNotice(null); }}>Отменить</button>}</div>}
    <input ref={importRef} type="file" accept="application/json,.json" onChange={importProgress} hidden />
  </div>;
}

function newId() {
  return "user-" + [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function isArchiveTopic(post) {
  return post.cycle === "archive";
}
function publishedOn(entry) {
  const slot = entry.slots.filter((row) => row.status === "published").map((row) => row.date).sort().pop();
  return slot || (entry.post.cycle === "archive" ? entry.post.date : entry.record.publicationConfirmation?.confirmedOn) || entry.targetDate;
}
function publishedCaption(entry) {
  if (entry.record.publicationConfirmation && !entry.slots.some((row) => row.status === "published")) return "отмечено " + dateLabel(entry.record.publicationConfirmation.confirmedOn);
  return dateLabel(publishedOn(entry));
}
const hasNumbers = (entry) => metricFields.some(([key]) => String(entry.record.metrics?.[key] ?? "") !== "");

function PageHead({ eyebrow, title, children }) {
  return <div className="pageHead">
    <div><p className="eyebrow">{eyebrow}</p><h1 className="display">{title}</h1></div>
    {children && <div className="headerActions">{children}</div>}
  </div>;
}

function Search({ query, setQuery }) {
  return <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск по темам" placeholder="Найти тему" />;
}

function StageBar({ stage, light }) {
  const index = STAGES.findIndex((row) => row.id === stage);
  return <div className={"stageBar" + (light ? " light" : "")} aria-label={"Этап: " + STAGES[index].name}>
    <div className="stageTrack">{STAGES.map((row, i) => <span key={row.id} className={i <= index ? "on" : ""} />)}</div>
    <div className="stageNames">{STAGES.map((row, i) => <span key={row.id} className={i === index ? "current" : ""}>{row.name}</span>)}</div>
  </div>;
}

function TodayView({ entries, today, agenda, overdue, published, scheduled, creating, closeCreate, create, settings, now, disabled, freeWednesday, actions, query, setQuery }) {
  const hero = agenda[0];
  const rest = agenda.filter((item) => item.post.id !== hero?.post.id).filter((item, index, list) => list.findIndex((row) => row.post.id === item.post.id) === index).slice(0, 4);
  const covered = weeksCovered(entries, today);
  const days = hero ? daysBetween(today, hero.date) : 0;
  return <>
    <PageHead eyebrow={hero ? (days === 0 ? "Сегодня выход" : "Следующий выход " + relative(hero.date, today)) : "Ближайших выходов нет"}
      title={"Сегодня, " + dateLabel(today)}><Search query={query} setQuery={setQuery} /></PageHead>
    {creating && <NewPublication settings={settings} create={create} close={closeCreate} />}
    <div className="bento today">
      {hero ? <section className="tile hero" aria-label="Ближайший выход">
        <div className="heroGlow" aria-hidden="true" />
        <Icon name="rocket" size={210} className="heroArt" />
        <div className="chips">
          <span className="chip accent">{days === 0 ? "Сегодня" : dateLabel(hero.date)}{hero.time ? " · " + hero.time : ""}</span>
          {hero.platform && <span className="chip">{hero.platform}</span>}
          {contentTypes[hero.post.type] && <span className="chip">{contentTypes[hero.post.type]}</span>}
        </div>
        <h2 className="display heroTitle">{hero.post.title}</h2>
        {hero.post.thought && <p className="heroThought">{hero.post.thought}</p>}
        <div className="heroBottom">
          <StageBar stage={hero.entry.stage} light />
          <div className="slotTools">
            <button className="button accent" onClick={() => actions.openTopic(hero.post.id)}>Открыть бриф</button>
            {hero.entry.stage !== "ready" && hero.entry.stage !== "published"
              ? <button className="button ghostLight" disabled={disabled} onClick={() => actions.setStage(hero.post, STAGES[STAGES.findIndex((row) => row.id === hero.entry.stage) + 1].id)}>
                Дальше: {STAGES[STAGES.findIndex((row) => row.id === hero.entry.stage) + 1].name.toLowerCase()}</button>
              : <button className="button ghostLight" disabled={disabled} onClick={() => actions.markPublished(hero.post)}>Отметить выход</button>}
          </div>
        </div>
      </section> : <section className="tile hero empty">
        <Icon name="bank" size={150} className="heroArt" />
        <h2 className="display heroTitle">Пока ничего не запланировано</h2>
        <p className="heroThought">Возьми тему из банка или создай новую публикацию.</p>
        <div className="heroBottom"><button className="button accent" onClick={() => actions.openTab("ideas")}>Открыть банк тем</button></div>
      </section>}

      <section className={"tile decide" + (overdue.length ? "" : " calm")} aria-label="Нужно решить">
        <Icon name={overdue.length ? "bell" : "ready"} size={128} className="tileArt" />
        <p className="tileLabel">Нужно решить</p>
        <p className="bigNumber">{overdue.length}</p>
        <div className="tileFoot">
          <span>{overdue.length ? "тем с прошедшей датой" : "хвостов нет"}</span>
          {overdue.length > 0 && <button className="button dark small" onClick={() => actions.openTab("ideas", "late")}>Разобрать</button>}
        </div>
      </section>

      <section className="tile rhythm" aria-label="Ритм">
        <Icon name="trophy" size={118} className="tileArt" />
        <p className="tileLabel muted">Ритм · раз в неделю</p>
        <p className="bigNumber">{covered.filter(Boolean).length}<span className="dim">/{covered.length}</span></p>
        <p className="tileText">недели вперёд заняты</p>
        <div className="weekBars">{covered.map((busy, index) => <span key={index} className={busy ? "on" : ""} />)}</div>
      </section>

      <section className="tile upcoming" aria-label="Дальше по плану">
        <div className="tileHead"><p className="tileLabel muted">Дальше по плану</p><button className="linkButton" onClick={() => actions.openTab("calendar")}>Календарь →</button></div>
        {rest.length ? <ol className="rows">{rest.map((item) => <li key={item.id}><button className="row" onClick={() => actions.openTopic(item.post.id)}>
          <Icon name={item.entry.stage} size={34} />
          <span className="rowText"><b>{item.post.title}</b><small>{dateLabel(item.date)}{item.platform ? " · " + item.platform : ""}</small></span>
        </button></li>)}</ol> : <p className="muted">Дальше пусто. Ближайшая свободная среда · {dateLabel(freeWednesday)}.</p>}
      </section>

      <section className="tile done" aria-label="Недавно вышло">
        <Icon name="chart" size={96} className="tileArt" />
        <p className="tileLabel">Недавно вышло</p>
        <div className="doneList">{published.slice(0, 3).map((entry) => <button key={entry.post.id} className="doneCard" onClick={() => actions.openTopic(entry.post.id)}>
          <Icon name="rocket" size={30} />
          <b>{entry.post.title}</b>
          <small>{publishedCaption(entry)}{hasNumbers(entry) ? " · цифры есть" : ""}</small>
        </button>)}</div>
        <div className="tileFoot">
          <span>Цифры внесены у {published.filter(hasNumbers).length} из {published.length}</span>
          <button className="button dark small" onClick={() => actions.openTab("archive")}>Внести просмотры</button>
        </div>
      </section>
    </div>

    {scheduled.length > 0 && <>
      <h2 className="sectionTitle">Выходы по площадкам</h2>
      <div className="calendarList">
        {scheduled.map((entry) => <PublicationCard key={entry.post.id} entry={entry} settings={settings} now={now} disabled={disabled} actions={actions} />)}
      </div>
    </>}
  </>;
}

function PublicationCard({ entry, settings, now, disabled, actions }) {
  const { post, record } = entry;
  const ready = ["ready", "skip"].includes(record.phases.preparation);
  return <article className="tile publicationCard" id={"post-" + post.id}>
    <div className="cardHeader">
      <Icon name={entry.stage} size={44} />
      <div className="cardTitle">
        <h3><button className="topicTitle" onClick={() => actions.openTopic(post.id)}>{post.title}</button></h3>
        <StageBar stage={entry.stage} />
      </div>
      <label className="checkbox readyToggle">
        <input type="checkbox" checked={ready} disabled={disabled} onChange={(e) => actions.prepare(post, e.target.checked)} /> Готово к выходу
      </label>
    </div>
    <PlacementEditor post={post} record={record} settings={settings} change={(platform, patch) => actions.change(post, platform, patch)} now={now} disabled={disabled} />
  </article>;
}

function TopicView({ entry, today, settings, now, disabled, freeWednesday, actions, back }) {
  const { post, record, section, targetDate } = entry;
  const prep = (post.materials || "").replace(/\.$/, "").split(";").map((text) => text.trim()).filter(Boolean)
    .map((text) => text[0].toLocaleUpperCase("ru") + text.slice(1));
  const steps = (post.scenario || "").includes("→") ? post.scenario.replace(/\.$/, "").split("→").map((text) => text.trim()) : null;
  const ask = [post.engagement, post.cta].find((text) => text && text !== "Нет" && text !== "Не требуется.");
  const done = prep.filter((_, index) => record.checklist?.[index]).length;
  const archive = section === "archive";
  const freeDate = freeWednesday;
  return <>
    <div className="pageHead">
      <div className="topicNav">
        <button className="iconButton" onClick={back} aria-label="Назад">‹</button>
        <div><p className="eyebrow">{archive ? "Вышло" : section === "plan" ? "Запланированный выход" : entry.shelved ? "Банк тем · без даты" : "Тема · " + relative(targetDate, today)}</p>
          <p className="display small">{archive ? publishedCaption(entry) : dateLabel(targetDate) + ", " + weekdays[weekday(targetDate)]}</p></div>
      </div>
      <div className="headerActions">
        {!archive && section === "ideas" && !entry.shelved && <button className="button secondary" disabled={disabled} onClick={() => actions.shelve(post, true)}>Убрать в банк</button>}
        {!archive && entry.shelved && <button className="button secondary" disabled={disabled} onClick={() => actions.reschedule(post, freeDate)}>Поставить на {dateLabel(freeDate)}</button>}
        {!archive && <button className="button primary" disabled={disabled} onClick={() => actions.markPublished(post)}>Отметить выход</button>}
      </div>
    </div>

    <div className="bento topic">
      <section className="tile hero topicHero" aria-label="Тема">
        <div className="heroGlow" aria-hidden="true" />
        <div className="chips">
          {!archive && <span className="chip accent">{entry.overdue ? "дата прошла" : entry.shelved ? "без даты" : relative(targetDate, today)}</span>}
          {contentTypes[post.type] && <span className="chip">{contentTypes[post.type]}</span>}
          {post.timeBudget && post.timeBudget !== "—" && <span className="chip">{post.timeBudget}</span>}
        </div>
        <h1 className="display heroTitle">{post.title}</h1>
        {post.thought && <p className="heroThought">{post.thought}</p>}
        {post.audience && post.audience !== "—" && <p className="heroMeta">Для кого: {post.audience}</p>}
      </section>

      <section className="tile where" aria-label="Где и когда">
        <p className="tileLabel muted">{archive ? "Где вышло" : "Где и когда"}</p>
        {!archive && section !== "plan" && <label className="dateField">Дата выхода<input type="date" value={targetDate} disabled={disabled} onChange={(e) => actions.reschedule(post, e.target.value)} /></label>}
        {isSchedulable(post) || entry.slots.length ? <PlacementEditor post={{ ...post, date: targetDate }} record={record} settings={settings}
          change={(platform, patch) => actions.change(post, platform, patch)} now={now} disabled={disabled} />
          : <p className="muted">Выходы этой темы не планируются.</p>}
      </section>

      <section className="tile stages" aria-label="Этап подготовки">
        <p className="tileLabel muted">Этап · нажми, чтобы продвинуть</p>
        <div className="stageButtons">{STAGES.map((row) => <button key={row.id} className={entry.stage === row.id ? "current" : ""} disabled={disabled}
          aria-pressed={entry.stage === row.id} onClick={() => actions.setStage(post, row.id)} title={row.hint}>
          <Icon name={row.id} size={46} />{row.name}</button>)}</div>
      </section>

      {archive ? <section className="tile ask results" aria-label="Цифры">
        <Icon name="chart" size={96} className="tileArt" />
        <p className="tileLabel">Как сработало</p>
        <div className="metricGrid">{metricFields.map(([key, label]) => <label key={key}>{label}
          <input inputMode="numeric" value={record.metrics?.[key] ?? ""} placeholder="—" disabled={disabled} onChange={(e) => actions.changeMetric(post, key, e.target.value)} /></label>)}</div>
        <label className="linkField">Ссылка на пост<input value={record.links?.post || ""} placeholder="t.me/…" disabled={disabled} onChange={(e) => actions.changeLink(post, e.target.value)} /></label>
      </section> : <section className="tile ask" aria-label="Вопрос читателю">
        <Icon name="plane" size={110} className="tileArt" />
        <p className="tileLabel">Вопрос читателю</p>
        <p className="display askText">{ask || "Вопрос пока не сформулирован"}</p>
      </section>}

      <section className="tile how" aria-label="Как раскрыть">
        <p className="tileLabel muted">Как раскрыть</p>
        {post.textVisual && <p className="tileText">{post.textVisual}</p>}
        {post.visual && post.visual !== "Не требуется." && <p className="muted"><b>Что показать.</b> {post.visual}</p>}
        {steps ? <ol className="flow">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          : post.scenario && <p className="muted"><b>План.</b> {post.scenario}</p>}
        {post.format && <p className="muted"><b>Формат.</b> {post.format}</p>}
      </section>

      <section className="tile collect" aria-label="Что собрать">
        <div className="tileHead"><p className="tileLabel muted">Что собрать</p>{prep.length > 0 && <b>{done} из {prep.length}</b>}</div>
        {prep.length ? <div className="checks">{prep.map((text, index) => <label key={index} className={"check" + (record.checklist?.[index] ? " done" : "")}>
          <input type="checkbox" checked={Boolean(record.checklist?.[index])} disabled={disabled} onChange={() => actions.toggleCheck(post, index)} />{text}</label>)}</div>
          : <p className="muted">Список материалов пока пустой.</p>}
        {archive && <ArchiveDetails record={record} />}
      </section>
    </div>
  </>;
}

function CalendarView({ entries, today, month, setMonth, workItems, disabled, actions }) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = month + "-01";
  const last = new Date(Date.UTC(year, monthIndex, 0, 12)).toISOString().slice(0, 10);
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const [dropDay, setDropDay] = useState("");
  const byDay = new Map();
  const put = (date, item) => byDay.set(date, [...(byDay.get(date) || []), item]);
  for (const entry of entries) {
    if (entry.section === "ideas" && !entry.shelved) put(entry.targetDate, { key: entry.post.id, entry, kind: entry.overdue ? "late" : "idea", drag: "idea:" + entry.post.id });
    if (entry.section === "plan") entry.active.forEach((slot) => put(slot.date, { key: entry.post.id + slot.platform.id, entry, kind: "slot", slot, drag: `slot:${entry.post.id}:${slot.platform.id}` }));
    if (entry.section === "archive") put(publishedOn(entry), { key: entry.post.id, entry, kind: "done" });
  }
  workItems.forEach((post) => put(post.date, { key: post.id, work: post, kind: "work" }));
  const shift = (step) => {
    const next = new Date(Date.UTC(year, monthIndex - 1 + step, 1));
    setMonth(next.toISOString().slice(0, 7));
  };
  const drop = (event, date) => {
    event.preventDefault();
    setDropDay("");
    const [kind, id, platform] = (event.dataTransfer.getData("text/plain") || "").split(":");
    const entry = entries.find((row) => row.post.id === id);
    if (!entry || disabled) return;
    if (kind === "idea") actions.reschedule(entry.post, date);
    if (kind === "slot") {
      const slot = entry.active.find((row) => row.platform.id === platform);
      if (slot && moscowInstant(date, slot.time) <= Date.now()) return;
      actions.change(entry.post, platform, { date, status: "moved" });
    }
  };
  const days = [];
  for (let date = start; date <= end; date = addDays(date, 1)) days.push(date);
  const bank = entries.filter((entry) => entry.shelved).slice(0, 4);
  const overdue = entries.filter((entry) => entry.overdue).length;
  const monthTopics = entries.filter((entry) => entry.section === "ideas" && !entry.shelved && entry.targetDate.startsWith(month)).length
    + entries.filter((entry) => entry.section === "plan" && entry.active.some((slot) => slot.date.startsWith(month))).length;
  return <>
    <div className="pageHead">
      <div><p className="eyebrow">Перетащи тему на другой день</p>
        <div className="monthNav"><button className="iconButton" aria-label="Предыдущий месяц" onClick={() => shift(-1)}>‹</button>
          <h1 className="display">{monthNames[monthIndex - 1]} {year}</h1>
          <button className="iconButton" aria-label="Следующий месяц" onClick={() => shift(1)}>›</button></div></div>
      <div className="headerActions"><button className="button secondary" onClick={() => setMonth(today.slice(0, 7))}>Сегодня</button></div>
    </div>
    <div className="bento calendarLayout">
      <section className="tile month" aria-label="Месяц">
        <div className="monthScroll">
          <div className="monthGrid">
            {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((day) => <span key={day} className="dow">{day}</span>)}
            {days.map((date) => <div key={date} className={["day", date.slice(0, 7) !== month && "out", date === today && "today", dropDay === date && "drop"].filter(Boolean).join(" ")}
              onDragOver={(e) => { e.preventDefault(); setDropDay(date); }} onDragLeave={() => setDropDay("")} onDrop={(e) => drop(e, date)}>
              <span className="dayNumber">{Number(date.slice(8))}</span>
              {(byDay.get(date) || []).map((item) => item.work
                ? <span key={item.key} className="event work">{item.work.title}</span>
                : <button key={item.key} className={"event " + item.kind} draggable={Boolean(item.drag) && !disabled}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", item.drag)} onClick={() => actions.openTopic(item.entry.post.id)}
                  title={item.entry.post.title}>
                  <Icon name={item.kind === "done" ? "rocket" : item.entry.stage} size={18} />
                  <span>{item.slot ? item.slot.time + " · " : ""}{item.entry.post.title}</span>
                </button>)}
            </div>)}
          </div>
        </div>
      </section>
      <section className="tile bankSide" aria-label="Банк тем">
        <Icon name="bank" size={104} className="tileArt" />
        <p className="tileLabel muted">Банк тем</p>
        <p className="bigNumber">{entries.filter((entry) => entry.shelved).length}</p>
        <p className="tileText">тем без даты</p>
        <div className="miniList">{bank.map((entry) => <button key={entry.post.id} className="mini" draggable={!disabled}
          onDragStart={(e) => e.dataTransfer.setData("text/plain", "idea:" + entry.post.id)} onClick={() => actions.openTopic(entry.post.id)}>{entry.post.title}</button>)}</div>
        <p className="muted small">{bank.length ? "Перетащи тему на свободный день" : "Убери тему в банк, если она пока не нужна"}</p>
      </section>
      <section className="tile decide compact" aria-label="Нужно решить">
        <Icon name={overdue ? "bell" : "ready"} size={90} className="tileArt" />
        <p className="tileLabel">Нужно решить</p>
        <p className="bigNumber">{overdue}</p>
        <p className="tileText">{overdue ? "в календаре они красные" : "хвостов нет"}</p>
      </section>
      <section className="tile done compact" aria-label="Месяц">
        <Icon name="trophy" size={90} className="tileArt" />
        <p className="tileLabel">{monthNames[monthIndex - 1]}</p>
        <p className="bigNumber">{monthTopics}</p>
        <p className="tileText">тем в этом месяце</p>
      </section>
    </div>
  </>;
}

function BoardView({ entries, today, overdue, published, disabled, actions }) {
  const [dropStage, setDropStage] = useState("");
  const active = entries.filter((entry) => !entry.shelved && !entry.overdue && entry.section !== "archive")
    .sort((a, b) => (a.section === "plan" ? a.next : Date.parse(a.targetDate)) - (b.section === "plan" ? b.next : Date.parse(b.targetDate)));
  const recent = published.filter((entry) => daysBetween(publishedOn(entry), today) <= 31);
  const hints = { text: "Перетащи сюда тему, когда начнёшь писать", visual: "Здесь темы, для которых готовится картинка", ready: "Готовые к выходу. Календарь напомнит о времени" };
  const drop = (event, stage) => {
    event.preventDefault();
    setDropStage("");
    const entry = entries.find((row) => row.post.id === event.dataTransfer.getData("text/plain"));
    if (entry && !disabled) actions.setStage(entry.post, stage);
  };
  return <>
    <PageHead eyebrow="Перетаскивай карточки, когда тема продвигается" title="Подготовка">
      {overdue.length > 0 && <div className="pillNotice"><span>{overdue.length} тем с прошедшей датой не на доске</span>
        <button className="button dark small" onClick={() => actions.openTab("ideas", "late")}>Разобрать</button></div>}
    </PageHead>
    <div className="board">
      {STAGES.map((stage) => {
        const items = stage.id === "published" ? recent : active.filter((entry) => entry.stage === stage.id);
        return <section key={stage.id} className={"tile column" + (stage.id === "published" ? " doneColumn" : "") + (dropStage === stage.id ? " drop" : "")} aria-label={stage.name}
          onDragOver={(e) => { e.preventDefault(); setDropStage(stage.id); }} onDragLeave={() => setDropStage("")} onDrop={(e) => drop(e, stage.id)}>
          <div className="columnHead"><Icon name={stage.id} size={42} /><b>{stage.name}</b><span className={"count" + (items.length ? "" : " dim")}>{items.length}</span></div>
          {items.map((entry) => {
            const date = entry.section === "plan" ? entry.active[0]?.date : stage.id === "published" ? publishedOn(entry) : entry.targetDate;
            const isToday = date === today && stage.id !== "published";
            return <button key={entry.post.id} className={"card" + (isToday ? " hot" : "")} draggable={!disabled}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", entry.post.id)} onClick={() => actions.openTopic(entry.post.id)}>
              <small>{stage.id === "published" ? publishedCaption(entry) : isToday ? "Сегодня" : date ? dateLabel(date) : ""}{entry.section === "plan" ? " · " + entry.active.map((slot) => slot.platform.name).join(", ") : ""}</small>
              <b>{entry.post.title}</b>
            </button>;
          })}
          {!items.length && stage.id !== "published" && stage.id !== "idea" && <p className="dropHint">{hints[stage.id]}</p>}
          {stage.id === "published" && <p className="dropHint soft">Вышедшие темы через месяц остаются только в «Итогах»</p>}
        </section>;
      })}
    </div>
  </>;
}

function BankView({ entries, today, filter, setFilter, matches, query, setQuery, freeWednesday, disabled, actions }) {
  const ideas = entries.filter((entry) => entry.section === "ideas");
  const groups = [["all", "Все"], ["dated", "С датой"], ["free", "Без даты"], ["late", "Просроченные"]];
  const chosen = ideas.filter((entry) => matches(entry.post)).filter((entry) => filter === "all" || (filter === "dated" && !entry.shelved && !entry.overdue)
    || (filter === "free" && entry.shelved) || (filter === "late" && entry.overdue))
    .sort((a, b) => (a.shelved - b.shelved) || (b.overdue - a.overdue) || a.targetDate.localeCompare(b.targetDate));
  const taken = new Set(entries.map((entry) => lower(entry.post.title)));
  const backlog = telegramBacklog.filter((idea) => !taken.has(lower(idea.title)) && matches(idea));
  return <>
    <PageHead eyebrow="Все замыслы в одном месте" title="Банк тем"><Search query={query} setQuery={setQuery} /></PageHead>
    <div className="segmented" role="group" aria-label="Фильтр">{groups.map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
      {label}<span>{id === "all" ? ideas.length : id === "free" ? ideas.filter((e) => e.shelved).length : id === "late" ? ideas.filter((e) => e.overdue).length : ideas.filter((e) => !e.shelved && !e.overdue).length}</span></button>)}</div>
    <div className="tile listTile">
      {chosen.length ? chosen.map((entry) => <div key={entry.post.id} className={"bankRow" + (entry.overdue ? " late" : "")}>
        <Icon name={entry.stage} size={40} />
        <button className="bankText" onClick={() => actions.openTopic(entry.post.id)}>
          <b>{entry.post.title}</b>
          <small>{entry.shelved ? "без даты" : (entry.overdue ? "дата прошла · " : "") + dateLabel(entry.targetDate)}{contentTypes[entry.post.type] ? " · " + contentTypes[entry.post.type] : ""}</small>
        </button>
        <div className="slotTools">
          {entry.overdue && <button className="button secondary small" disabled={disabled} onClick={() => actions.markPublished(entry.post)}>Уже вышло</button>}
          {(entry.overdue || entry.shelved) && <button className="button secondary small" disabled={disabled} onClick={() => actions.reschedule(entry.post, freeWednesday)}>На {dateLabel(freeWednesday)}</button>}
          {!entry.shelved && <button className="button quiet small" disabled={disabled} onClick={() => actions.shelve(entry.post, true)}>В банк</button>}
        </div>
      </div>) : <p className="muted emptyText">{query ? "Темы не найдены" : filter === "late" ? "Хвостов нет. Все прошедшие темы разобраны." : "Здесь пока пусто."}</p>}
    </div>
    {backlog.length > 0 && <details className="tile backlog">
      <summary><Icon name="idea" size={34} />Архив идей · {backlog.length}</summary>
      <p className="muted">Темы из прежних планов. Перед возвратом проверь, есть ли исходник и право на показ.</p>
      {backlog.map((idea) => <div key={idea.title} className="bankRow">
        <span className="bankText"><b>{idea.title}</b><small>{idea.source}</small></span>
        <button className="button secondary small" disabled={disabled} onClick={() => actions.adoptIdea(idea.title, freeWednesday)}>Взять на {dateLabel(freeWednesday)}</button>
      </div>)}
    </details>}
  </>;
}

function ResultsView({ published, today, disabled, actions, query, setQuery }) {
  const withNumbers = published.filter(hasNumbers).length;
  const requests = published.reduce((sum, entry) => sum + (Number(entry.record.metrics?.workRequests) || 0), 0);
  const review = telegramPlan.find((post) => post.type === "review" && post.date >= today);
  return <>
    <PageHead eyebrow="Что вышло и как сработало" title="Итоги"><Search query={query} setQuery={setQuery} /></PageHead>
    <div className="stats">
      <section className="tile hero stat"><Icon name="rocket" size={100} className="tileArt" /><p className="tileLabel">Вышло</p><p className="bigNumber">{published.length}</p><p className="tileText">публикаций в календаре</p></section>
      <section className="tile decide stat"><Icon name="chart" size={96} className="tileArt" /><p className="tileLabel">С цифрами</p><p className="bigNumber">{withNumbers}<span className="dim">/{published.length}</span></p><p className="tileText">внеси просмотры ниже</p></section>
      <section className="tile stat"><Icon name="trophy" size={92} className="tileArt" /><p className="tileLabel muted">Обращения о работе</p><p className="bigNumber">{requests || "—"}</p><p className="tileText">по полям ниже</p></section>
      <section className="tile done stat"><Icon name="calendar" size={84} className="tileArt" /><p className="tileLabel">Обзор 90 дней</p>
        <p className="display statDate">{review ? dateLabel(review.date) : "не назначен"}</p><p className="tileText">{review ? relative(review.date, today) : ""}</p></section>
    </div>
    <section className="tile resultsTable" aria-label="Вышедшие публикации">
      <div className="resultsRow head"><span /><span>Публикация</span>{metricFields.map(([, label]) => <span key={label}>{label}</span>)}<span>Ссылка</span></div>
      {published.map((entry) => <div key={entry.post.id} className="resultsRow">
        <Icon name="rocket" size={40} />
        <button className="bankText" onClick={() => actions.openTopic(entry.post.id)}><b>{entry.post.title}</b><small>{publishedCaption(entry)}</small></button>
        {metricFields.map(([key, label]) => <input key={key} aria-label={label} inputMode="numeric" placeholder="—" disabled={disabled}
          value={entry.record.metrics?.[key] ?? ""} onChange={(e) => actions.changeMetric(entry.post, key, e.target.value)} />)}
        <input aria-label="Ссылка на пост" placeholder="t.me/…" disabled={disabled} value={entry.record.links?.post || ""} onChange={(e) => actions.changeLink(entry.post, e.target.value)} />
      </div>)}
      {!published.length && <p className="muted emptyText">Вышедших публикаций пока нет.</p>}
    </section>
  </>;
}

function ArchiveDetails({ record }) {
  const metrics = Object.entries(metricLabels).filter(([key]) => !metricFields.some(([field]) => field === key) && record.metrics?.[key] !== undefined && record.metrics[key] !== "");
  const note = record.resultNote || record.note;
  if (!metrics.length && !note) return null;
  return <details className="archiveDetails">
    <summary>Сохранённые заметки</summary>
    {note && <p>{note}</p>}
    {metrics.length > 0 && <dl>{metrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{record.metrics[key]}</dd></div>)}</dl>}
  </details>;
}

export default App;
