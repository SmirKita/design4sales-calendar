import React, { useMemo, useRef, useState } from "react";
import { contentTypes, phaseOptions, reviewWindows, telegramPlan } from "./data/telegramPlan.js";
import { telegramBacklog } from "./data/telegramBacklog.js";
import { loadCalendarState, normalizeState, saveCalendarState, STORAGE_SCHEMA_VERSION } from "./storage.js";

const emptyMetrics = { v24: "", v72: "", replies: "", subscriptions: "", workRequests: "", minutes: "", clicks: "" };
const phaseLabels = { preparation: "Подготовка", publication: "Публикация", distribution: "Распространение", measurement: "Проверка" };

function dateLabel(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", weekday: "short" })
    .format(new Date(`${iso}T12:00:00`)).replace(" г.", "");
}

function shortDate(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(`${iso}T12:00:00`));
}

function isValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

function metric(value) {
  return isValue(value) ? Number(value).toLocaleString("ru-RU") : "н/д";
}

function getRecord(state, post) {
  const saved = state[post.id] || {};
  return {
    ...saved,
    phases: { ...post.defaultPhases, ...(saved.phases || {}) },
    metrics: { ...emptyMetrics, ...(saved.metrics || {}) },
    links: { post: "", external: "", invite: "", ...(saved.links || {}) },
    actionChecks: saved.actionChecks || {},
    resultNote: saved.resultNote || saved.note || "",
  };
}

function App() {
  const [state, setState] = useState(loadCalendarState);
  const [typeFilter, setTypeFilter] = useState("all");
  const [publicationFilter, setPublicationFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("all");
  const [cycleFilter, setCycleFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("calendar");
  const importRef = useRef(null);

  const update = (post, patch) => {
    setState((current) => {
      const next = { ...current, [post.id]: { ...getRecord(current, post), ...patch } };
      saveCalendarState(next);
      return next;
    });
  };

  const activeEntries = telegramPlan.filter((post) => post.cycle === "oct-dec");
  const activePublications = activeEntries.filter((post) => post.kind === "publication");
  const published = activePublications.filter((post) => getRecord(state, post).phases.publication === "published").length;
  const prepared = activeEntries.filter((post) => ["ready", "skip"].includes(getRecord(state, post).phases.preparation)).length;
  const measured = activeEntries.filter((post) => ["done", "na"].includes(getRecord(state, post).phases.measurement)).length;
  const progress = Math.round((measured / activeEntries.length) * 100);

  const filtered = useMemo(() => telegramPlan.filter((post) => {
    const record = getRecord(state, post);
    const haystack = `${post.title} ${post.thought} ${post.audience} ${post.mainPlatform} ${post.format}`.toLowerCase();
    return (cycleFilter === "all" || (cycleFilter === "active" ? post.cycle === "oct-dec" : post.cycle === "archive"))
      && (typeFilter === "all" || post.type === typeFilter)
      && (publicationFilter === "all" || record.phases.publication === publicationFilter)
      && (weekFilter === "all" || String(post.week) === weekFilter)
      && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [cycleFilter, publicationFilter, query, state, typeFilter, weekFilter]);

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), schemaVersion: STORAGE_SCHEMA_VERSION, state }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Design4Sales_calendar_progress.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importProgress = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const next = normalizeState(JSON.parse(await file.text()));
      setState(next);
      saveCalendarState(next);
    } catch {
      alert("Не удалось прочитать файл прогресса.");
    }
    event.target.value = "";
  };

  const resetProgress = () => {
    if (!window.confirm("Сбросить все статусы, результаты и заметки?")) return;
    const next = normalizeState({});
    setState(next);
    saveCalendarState(next);
  };

  return (
    <main>
      <header className="hero">
        <div className="heroTop">
          <div>
            <div className="eyebrow"><span className="telegramDot" /> Design4Sales · Telegram в центре</div>
            <h1>Живой контент-календарь</h1>
            <p className="heroText">Новый цикл с 1 октября 2026 · подготовка поста, публикация, распространение и проверка результата в одной карточке.</p>
          </div>
          <div className="cycleBadge"><strong>Октябрь → декабрь</strong><span>{activeEntries.length} рабочих записей · до часа в день</span></div>
        </div>
        <div className="progressRail"><span style={{ width: `${progress}%` }} /></div>
        <div className="summaryGrid">
          <Summary value={published} label="новых публикаций вышло" accent />
          <Summary value={prepared} label="записей подготовлено / не требует подготовки" />
          <Summary value={measured} label="проверено / не требует замера" />
          <Summary value={`${progress}%`} label="цикла закрыто по результату" />
        </div>
      </header>

      <nav className="viewTabs" aria-label="Разделы календаря">
        <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Календарь</button>
        <button className={view === "reviews" ? "active" : ""} onClick={() => setView("reviews")}>Контрольные срезы</button>
        <button className={view === "principles" ? "active" : ""} onClick={() => setView("principles")}>Редакционный компас</button>
        <button className={view === "backlog" ? "active" : ""} onClick={() => setView("backlog")}>Архив тем</button>
      </nav>

      {view === "calendar" && (
        <>
          <section className="toolbar">
            <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти тему, аудиторию или площадку" aria-label="Поиск по календарю" />
            <select value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)} aria-label="Фильтр по циклу">
              <option value="active">Новый цикл</option><option value="archive">Опубликованный архив</option><option value="all">Всё</option>
            </select>
            <select value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)} aria-label="Фильтр по неделе">
              <option value="all">Все недели</option>
              {[...new Set(telegramPlan.filter((post) => post.week > 0).map((post) => post.week))].map((week) => <option key={week} value={week}>Неделя {week}</option>)}
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Фильтр по типу">
              <option value="all">Все типы</option>{Object.entries(contentTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={publicationFilter} onChange={(event) => setPublicationFilter(event.target.value)} aria-label="Фильтр по статусу публикации">
              <option value="all">Любой статус публикации</option>{phaseOptions.publication.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </section>
          <div className="resultLine"><span>{filtered.length} записей</span><span>Подробности и действия открываются внутри карточки</span></div>
          <section className="calendarList">
            {filtered.map((post) => <PostCard key={post.id} post={post} record={getRecord(state, post)} update={update} />)}
          </section>
          {!filtered.length && <div className="empty">По этим фильтрам записей нет.</div>}
        </>
      )}

      {view === "reviews" && <Reviews state={state} update={update} />}
      {view === "principles" && <Principles />}
      {view === "backlog" && <Backlog />}

      <footer className="footer">
        <div><strong>Прогресс хранится в этом браузере.</strong><span>Старые записи и данные v3 сохраняются при переходе на новую схему.</span></div>
        <div className="footerActions">
          <button onClick={exportProgress}>Экспорт прогресса</button>
          <button onClick={() => importRef.current?.click()}>Импорт</button>
          <button className="danger" onClick={resetProgress}>Сбросить</button>
          <input ref={importRef} type="file" accept="application/json" onChange={importProgress} hidden />
        </div>
      </footer>
    </main>
  );
}

function Summary({ value, label, accent = false }) {
  return <div className={`summary ${accent ? "accent" : ""}`}><strong>{value}</strong><span>{label}</span></div>;
}

function PhaseSelect({ phase, value, onChange }) {
  const label = phaseOptions[phase].find(([key]) => key === value)?.[1] || value;
  return (
    <label className="phaseSelect"><span>{phaseLabels[phase]}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{phaseOptions[phase].map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
      <em className={`phase phase-${value}`}>{label}</em>
    </label>
  );
}

function PostCard({ post, record, update }) {
  const [open, setOpen] = useState(false);
  const toggleAction = (index) => update(post, { actionChecks: { ...record.actionChecks, [index]: !record.actionChecks[index] } });
  return (
    <article className={`postCard type-${post.type} ${record.phases.publication === "published" ? "isPublished" : ""}`}>
      <div className="postStripe" />
      <div className="postMain">
        <div className="postMeta">
          <span className="date">{dateLabel(post.date)}</span>
          {post.week > 0 && <span>Неделя {post.week}</span>}
          <span className="typePill">{contentTypes[post.type]}</span>
          {post.kind === "work" && <span className="checkpoint">рабочая запись</span>}
          {post.cycle === "archive" && <span className="archivePill">опубликованный архив</span>}
        </div>
        <h2>{post.title}</h2>
        {post.subtitle && <p className="subtitle">{post.subtitle}</p>}
        <p className="thought">{post.thought}</p>
        <div className="quickFacts">
          <div><span>Аудитория</span><strong>{post.audience}</strong></div>
          <div><span>Основной выход</span><strong>{post.mainPlatform}</strong></div>
          <div><span>Лимит</span><strong>{post.timeBudget}</strong></div>
        </div>
        <button className="detailsButton" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Свернуть" : "Открыть план и «После публикации»"}</button>
      </div>
      <aside className="postControls">
        {Object.keys(phaseLabels).map((phase) => <PhaseSelect key={phase} phase={phase} value={record.phases[phase]} onChange={(value) => update(post, { phases: { ...record.phases, [phase]: value } })} />)}
        <div className="miniMetric"><strong>{metric(record.metrics.v24)}</strong><span>V24</span></div>
        <div className="miniMetric"><strong>{metric(record.metrics.v72)}</strong><span>V72</span></div>
      </aside>

      {open && (
        <div className="postDetails">
          <Detail title="Что взять для текста и визуала" text={post.textVisual} />
          <Detail title="Что показываем визуально" text={post.visual} />
          <Detail title="Порядок работы" text={post.scenario} />
          <Detail title="Что подготовить" text={post.materials} />
          <Detail title="Действие читателя" text={post.engagement || post.cta} />
          <Detail title="Сроки проверки" text={post.checks} />

          <section className="afterBlock">
            <div className="sectionTitle"><div><span>После публикации</span><small>Действия выполняются по порядку</small></div><em>{Object.values(record.actionChecks).filter(Boolean).length}/{post.afterPublication.length} выполнено</em></div>
            <ol className="actionList">
              {post.afterPublication.map((action, index) => (
                <li key={action} className={record.actionChecks[index] ? "done" : ""}>
                  <label><input type="checkbox" checked={Boolean(record.actionChecks[index])} onChange={() => toggleAction(index)} /><span>{action}</span></label>
                </li>
              ))}
            </ol>
            <div className="linkInputs">
              <label>URL основной публикации<input type="url" value={record.links.post} onChange={(event) => update(post, { links: { ...record.links, post: event.target.value } })} placeholder="https://t.me/... или н/д" /></label>
              <label>URL внешнего размещения<input type="url" value={record.links.external} onChange={(event) => update(post, { links: { ...record.links, external: event.target.value } })} placeholder="Сетка / VK / н/д" /></label>
              <label>Пригласительная ссылка / источник<input type="text" value={record.links.invite} onChange={(event) => update(post, { links: { ...record.links, invite: event.target.value } })} placeholder="setka_oct26, vk_oct26 или н/д" /></label>
            </div>
          </section>

          <section className="metricsBlock">
            <div className="sectionTitle"><div><span>Результат</span><small>Пустое поле показывается как «н/д», ноль вводится только после измерения</small></div></div>
            <div className="metricInputs">
              {[["v24", "Просмотры TG · 24 ч"], ["v72", "Просмотры TG · 72 ч"], ["replies", "Ответы"], ["subscriptions", "Подписки по ссылкам"], ["workRequests", "Рабочие обращения"], ["minutes", "Затрачено, мин"], ["clicks", "Клики, если доступны"]].map(([key, label]) => (
                <label key={key}>{label}<input inputMode="numeric" min="0" type="number" value={record.metrics[key]} onChange={(event) => update(post, { metrics: { ...record.metrics, [key]: event.target.value } })} placeholder="н/д" /></label>
              ))}
            </div>
            <label className="noteField">Что повторить / изменить / остановить<textarea value={record.resultNote} onChange={(event) => update(post, { resultNote: event.target.value })} placeholder="Фактический вывод, выбранный адресат и повод, статус правил сообщества или следующий шаг" /></label>
          </section>
        </div>
      )}
    </article>
  );
}

function Detail({ title, text }) {
  return <section className="detail"><h3>{title}</h3><p>{text}</p></section>;
}

function Reviews({ state, update }) {
  return (
    <section className="reviews">
      <div className="sectionIntro"><span>Контрольные срезы</span><h2>Решения по фактам, а не по ощущению</h2><p>Сравнивайте V72 только у публикаций с завершённым окном. Подписки, ответы и рабочие обращения остаются разными результатами.</p></div>
      {reviewWindows.map((window) => {
        const posts = telegramPlan.filter((post) => post.kind === "publication" && post.date >= window.start && post.date <= window.end);
        const v72 = posts.filter((post) => isValue(getRecord(state, post).metrics.v72));
        const replies = posts.reduce((sum, post) => sum + Number(getRecord(state, post).metrics.replies || 0), 0);
        const subscriptions = posts.reduce((sum, post) => sum + Number(getRecord(state, post).metrics.subscriptions || 0), 0);
        const workRequests = posts.reduce((sum, post) => sum + Number(getRecord(state, post).metrics.workRequests || 0), 0);
        const reviewPost = { id: `note-${window.id}`, defaultPhases: {}, afterPublication: [] };
        const reviewRecord = getRecord(state, reviewPost);
        return (
          <article className="reviewCard" key={window.id}>
            <div className="reviewHeader"><div><span>{window.label}</span><h3>{shortDate(window.start)} — {shortDate(window.end)}</h3></div><strong>Решение с {window.decisionFrom}</strong></div>
            <div className="reviewStats">
              <Summary value={`${v72.length}/${posts.length}`} label="публикаций с V72" />
              <Summary value={replies} label="содержательных ответов" />
              <Summary value={subscriptions} label="вступлений по ссылкам" />
              <Summary value={workRequests} label="рабочих обращений" />
            </div>
            <label className="decision">Решение на следующий отрезок<textarea value={reviewRecord.resultNote} onChange={(event) => update(reviewPost, { resultNote: event.target.value })} placeholder="Что продолжить, изменить и остановить; какие данные пока н/д" /></label>
          </article>
        );
      })}
    </section>
  );
}

function Principles() {
  return (
    <section className="principles">
      <div className="sectionIntro"><span>Редакционный компас</span><h2>Telegram — центр, а не единственная точка</h2><p>Каждая площадка получает только тот формат, который можно сделать полезным в рамках дневного лимита.</p></div>
      <div className="principleGrid">
        <article><span>01</span><h3>До часа в день</h3><p>Клиентская работа важнее заполнения календаря. Не готов исходник — запись переносится.</p></article>
        <article><span>02</span><h3>Сетка — отдельная мысль</h3><p>700–1200 знаков с законченным выводом внутри площадки, а не тизер со спрятанным ответом.</p></article>
        <article><span>03</span><h3>VK — быстрая адаптация</h3><p>Использовать готовые кадры и законченный короткий текст. Не делать новый сложный материал ради дублирования.</p></article>
        <article><span>04</span><h3>Контакт только по поводу</h3><p>Нужны имя/публичный ID и реальный контекст. Нет контакта — сначала выбрать адресата.</p></article>
        <article><span>05</span><h3>Сообщество сначала проверить</h3><p>Описание, закреп, правила и бесплатность. До проверки это кандидат, не место публикации.</p></article>
        <article><span>06</span><h3>Неизвестное — «н/д»</h3><p>Ноль означает измеренное отсутствие события. Недоступные клики и пересылки не угадываются.</p></article>
      </div>
    </section>
  );
}

function Backlog() {
  return (
    <section className="backlog">
      <div className="sectionIntro"><span>Архив тем</span><h2>Идеи без обязательных дат и площадок</h2><p>Старый план используется только как архив. Тема возвращается в календарь, когда есть исходник, право на показ и время.</p></div>
      <div className="backlogGrid">{telegramBacklog.map((item) => <article key={item.title}><span>{item.source}</span><h3>{item.title}</h3></article>)}</div>
    </section>
  );
}

export default App;
