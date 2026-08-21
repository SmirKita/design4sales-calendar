import React, { useMemo, useRef, useState } from "react";
import { contentTypes, reviewWindows, statusOptions, telegramPlan } from "./data/telegramPlan.js";

const STORAGE_KEY = "design4sales-telegram-calendar-v2";
const emptyMetrics = { views: "", reactions: "", comments: "", forwards: "", clicks: "" };

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateLabel(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", weekday: "short" })
    .format(new Date(`${iso}T12:00:00`))
    .replace(" г.", "");
}

function shortDate(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(`${iso}T12:00:00`));
}

function getRecord(state, id) {
  const saved = state[id] || {};
  return { ...saved, status: saved.status || "planned", note: saved.note || "", metrics: { ...emptyMetrics, ...(saved.metrics || {}) } };
}

function engagement(metrics) {
  const views = number(metrics.views);
  if (!views) return 0;
  return ((number(metrics.reactions) + number(metrics.comments) + number(metrics.forwards)) / views) * 100;
}

function responseRate(metrics) {
  const views = number(metrics.views);
  return views ? (number(metrics.comments) / views) * 100 : 0;
}

function App() {
  const [state, setState] = useState(loadState);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("calendar");
  const importRef = useRef(null);

  const update = (id, patch) => {
    setState((current) => {
      const next = { ...current, [id]: { ...getRecord(current, id), ...patch } };
      saveState(next);
      return next;
    });
  };

  const filtered = useMemo(() => telegramPlan.filter((post) => {
    const record = getRecord(state, post.id);
    const haystack = `${post.title} ${post.thought} ${post.format}`.toLowerCase();
    return (typeFilter === "all" || post.type === typeFilter)
      && (statusFilter === "all" || record.status === statusFilter)
      && (weekFilter === "all" || String(post.week) === weekFilter)
      && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [query, state, statusFilter, typeFilter, weekFilter]);

  const published = telegramPlan.filter((post) => getRecord(state, post.id).status === "published").length;
  const ready = telegramPlan.filter((post) => ["ready", "published"].includes(getRecord(state, post.id).status)).length;
  const withMetrics = telegramPlan.filter((post) => number(getRecord(state, post.id).metrics.views) > 0).length;
  const progress = Math.round((published / telegramPlan.length) * 100);

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Design4Sales_Telegram_progress.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importProgress = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const next = parsed.state || parsed;
      setState(next);
      saveState(next);
    } catch {
      alert("Не удалось прочитать файл прогресса.");
    }
    event.target.value = "";
  };

  const resetProgress = () => {
    if (!window.confirm("Сбросить все статусы, метрики и заметки этого цикла?")) return;
    setState({});
    saveState({});
  };

  return (
    <main>
      <header className="hero">
        <div className="heroTop">
          <div>
            <div className="eyebrow"><span className="telegramDot" /> Design4Sales · только Telegram</div>
            <h1>Живой контент-календарь</h1>
            <p className="heroText">22 августа — 3 октября 2026 · реальные решения, сомнения, разборы и эксперименты вместо конвейера чек-листов.</p>
          </div>
          <div className="cycleBadge"><strong>6 недель</strong><span>19 основных публикаций</span></div>
        </div>

        <div className="progressRail"><span style={{ width: `${progress}%` }} /></div>
        <div className="summaryGrid">
          <Summary value={published} label="опубликовано" accent />
          <Summary value={ready} label="готово к выпуску" />
          <Summary value={withMetrics} label="с заполненной статистикой" />
          <Summary value={`${progress}%`} label="цикла завершено" />
        </div>
      </header>

      <nav className="viewTabs" aria-label="Разделы календаря">
        <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Календарь</button>
        <button className={view === "reviews" ? "active" : ""} onClick={() => setView("reviews")}>Анализ каждые 2 недели</button>
        <button className={view === "principles" ? "active" : ""} onClick={() => setView("principles")}>Редакционный компас</button>
      </nav>

      {view === "calendar" && (
        <>
          <section className="toolbar">
            <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти тему или формат" aria-label="Поиск по календарю" />
            <select value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)} aria-label="Фильтр по неделе">
              <option value="all">Все недели</option>
              {[1, 2, 3, 4, 5, 6].map((week) => <option key={week} value={week}>Неделя {week}</option>)}
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Фильтр по типу">
              <option value="all">Все типы</option>
              {Object.entries(contentTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Фильтр по статусу">
              <option value="all">Все статусы</option>
              {statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </section>

          <div className="resultLine"><span>{filtered.length} публикаций</span><span>Один пост = одна ясная мысль</span></div>
          <section className="calendarList">
            {filtered.map((post) => <PostCard key={post.id} post={post} record={getRecord(state, post.id)} update={update} />)}
          </section>
          {!filtered.length && <div className="empty">По этим фильтрам публикаций нет.</div>}
        </>
      )}

      {view === "reviews" && <Reviews state={state} update={update} />}
      {view === "principles" && <Principles />}

      <footer className="footer">
        <div><strong>Прогресс хранится в этом браузере.</strong><span>Экспортируйте JSON для переноса или резервной копии.</span></div>
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

function PostCard({ post, record, update }) {
  const [open, setOpen] = useState(false);
  const statusLabel = statusOptions.find(([key]) => key === record.status)?.[1] || "Запланировано";
  const er = engagement(record.metrics);
  return (
    <article className={`postCard type-${post.type} ${record.status === "published" ? "isPublished" : ""}`}>
      <div className="postStripe" />
      <div className="postMain">
        <div className="postMeta">
          <span className="date">{dateLabel(post.date)}</span>
          <span>Неделя {post.week}</span>
          <span className="typePill">{contentTypes[post.type]}</span>
          {post.checkpoint && <span className="checkpoint">контрольная точка</span>}
        </div>
        <h2>{post.title}</h2>
        <p className="thought">{post.thought}</p>
        <div className="quickFacts">
          <div><span>Формат</span><strong>{post.format}</strong></div>
          <div><span>Лина</span><strong>{post.lina}</strong></div>
          <div><span>CTA</span><strong>{post.cta}</strong></div>
        </div>
        <button className="detailsButton" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Свернуть" : "Показать сценарий и материалы"}</button>
      </div>
      <aside className="postControls">
        <label>Статус
          <select value={record.status} onChange={(event) => update(post.id, { status: event.target.value })}>
            {statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <span className={`status status-${record.status}`}>{statusLabel}</span>
        <div className="miniMetric"><strong>{number(record.metrics.views).toLocaleString("ru-RU")}</strong><span>просмотров</span></div>
        <div className="miniMetric"><strong>{er ? `${er.toFixed(1)}%` : "—"}</strong><span>вовлечённость</span></div>
      </aside>

      {open && (
        <div className="postDetails">
          <Detail title="Что показываем визуально" text={post.visual} />
          <Detail title="Краткий сценарий" text={post.scenario} />
          <Detail title="Механика вовлечения" text={post.engagement} />
          <Detail title="Что подготовить" text={post.materials} />
          <section className="metricsBlock">
            <div className="sectionTitle"><span>После публикации</span><em>Заполняйте фактические данные Telegram</em></div>
            <div className="metricInputs">
              {[["views", "Просмотры"], ["reactions", "Реакции"], ["comments", "Комментарии / ответы"], ["forwards", "Пересылки"], ["clicks", "Переходы"]].map(([key, label]) => (
                <label key={key}>{label}<input inputMode="numeric" min="0" type="number" value={record.metrics[key]} onChange={(event) => update(post.id, { metrics: { ...record.metrics, [key]: event.target.value } })} /></label>
              ))}
            </div>
            <div className="calculated"><span>Вовлечённость: <strong>{er ? `${er.toFixed(2)}%` : "—"}</strong></span><span>Ответы / просмотры: <strong>{responseRate(record.metrics) ? `${responseRate(record.metrics).toFixed(2)}%` : "—"}</strong></span></div>
            <label className="noteField">Заметка после публикации<textarea value={record.note} onChange={(event) => update(post.id, { note: event.target.value })} placeholder="Что сработало, что не сработало, что изменить дальше" /></label>
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
      <div className="sectionIntro"><span>Не выполнять любой ценой</span><h2>Три момента, когда календарь можно менять</h2><p>Сравнивайте темы и форматы только после заполнения фактических метрик. Следующие публикации — гипотезы, а не обязательства.</p></div>
      {reviewWindows.map((window) => {
        const posts = telegramPlan.filter((post) => post.date >= window.start && post.date <= window.end);
        const measured = posts.filter((post) => number(getRecord(state, post.id).metrics.views) > 0);
        const totals = measured.reduce((acc, post) => {
          const m = getRecord(state, post.id).metrics;
          acc.views += number(m.views); acc.reactions += number(m.reactions); acc.comments += number(m.comments); acc.forwards += number(m.forwards);
          return acc;
        }, { views: 0, reactions: 0, comments: 0, forwards: 0 });
        const topViews = [...measured].sort((a, b) => number(getRecord(state, b.id).metrics.views) - number(getRecord(state, a.id).metrics.views))[0];
        const topResponse = [...measured].sort((a, b) => responseRate(getRecord(state, b.id).metrics) - responseRate(getRecord(state, a.id).metrics))[0];
        const zero = measured.filter((post) => number(getRecord(state, post.id).metrics.reactions) + number(getRecord(state, post.id).metrics.comments) + number(getRecord(state, post.id).metrics.forwards) === 0);
        const reviewId = `note-${window.id}`;
        const reviewRecord = getRecord(state, reviewId);
        const totalEr = totals.views ? ((totals.reactions + totals.comments + totals.forwards) / totals.views) * 100 : 0;
        return (
          <article className="reviewCard" key={window.id}>
            <div className="reviewHeader"><div><span>{window.label}</span><h3>{shortDate(window.start)} — {shortDate(window.end)}</h3></div><strong>Корректировать с: {window.decisionFrom}</strong></div>
            <div className="reviewStats">
              <Summary value={`${measured.length}/${posts.length}`} label="постов с метриками" />
              <Summary value={totals.views.toLocaleString("ru-RU")} label="суммарные просмотры" />
              <Summary value={totalEr ? `${totalEr.toFixed(2)}%` : "—"} label="вовлечённость периода" />
              <Summary value={zero.length} label="постов с нулевым откликом" />
            </div>
            <div className="reviewFindings">
              <p><span>Лидер по просмотрам</span><strong>{topViews?.title || "Нужны данные"}</strong></p>
              <p><span>Лидер по ответам</span><strong>{topResponse && responseRate(getRecord(state, topResponse.id).metrics) > 0 ? topResponse.title : "Нужны ответы аудитории"}</strong></p>
              <p><span>Проверить вручную</span><strong>Какая тема дала реакции, на что реально отвечали, что можно убрать или заменить.</strong></p>
            </div>
            <label className="decision">Решение на следующий отрезок<textarea value={reviewRecord.note} onChange={(event) => update(reviewId, { note: event.target.value })} placeholder="Например: оставить A/B раз в неделю, заменить слабый оффер, продолжить разборы черновиков…" /></label>
          </article>
        );
      })}
    </section>
  );
}

function Principles() {
  const balance = Object.entries(contentTypes).map(([key, label]) => ({ key, label, count: telegramPlan.filter((post) => post.type === key).length }));
  return (
    <section className="principles">
      <div className="sectionIntro"><span>Редакционный компас</span><h2>Система поддерживает живой канал, а не управляет им</h2><p>Если появляется сильная рабочая ситуация, её можно выпустить между основными датами или поставить вместо слабой запланированной темы.</p></div>
      <div className="principleGrid">
        <article><span>01</span><h3>Одна публикация — одна мысль</h3><p>Одна ситуация, один вопрос или одно решение. Классический список — не чаще раза в неделю.</p></article>
        <article><span>02</span><h3>Позиция автора обязательна</h3><p>Показывать собственный выбор, сомнение, спор с клиентской просьбой и вариант, который не прошёл внутренний отбор.</p></article>
        <article><span>03</span><h3>Вовлечение встроено в визуал</h3><p>A/B, «что убрать», «что заметили первым». Конкретный вопрос вместо пустого «а что думаете?».</p></article>
        <article><span>04</span><h3>Лина — второй голос</h3><p>Она может спорить, ошибаться и выбирать другой вариант. Присутствует только там, где добавляет характер.</p></article>
        <article><span>05</span><h3>Продажа без ритуального CTA</h3><p>Прямой оффер — один в цикле. В остальных постах действие связано с материалом: выбор, реакция, ответ или работа на разбор.</p></article>
        <article><span>06</span><h3>Ритм, а не заполнение дней</h3><p>Вторник — рабочая ситуация, четверг — главный материал, суббота — лёгкий визуальный формат. Пустые дни не требуют контента.</p></article>
      </div>
      <div className="balanceCard">
        <div><span>Баланс цикла</span><h3>Ориентир, не математический закон</h3></div>
        <div className="balanceBars">
          {balance.map((item) => <div key={item.key}><label><span>{item.label}</span><strong>{item.count} · {Math.round((item.count / telegramPlan.length) * 100)}%</strong></label><i><b className={`bar-${item.key}`} style={{ width: `${(item.count / telegramPlan.length) * 100}%` }} /></i></div>)}
        </div>
      </div>
    </section>
  );
}

export default App;
