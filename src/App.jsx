import React, { useEffect, useMemo, useRef, useState } from "react";
import { calendarData, platformLabels } from "./data/calendarData.js";

const STORAGE_KEY = "design4sales-calendar-progress-v1";

const statusLabels = {
  planned: "Запланировано",
  not_started: "Не начато",
  in_progress: "В работе",
  done: "Готово",
  published: "Опубликовано",
  skipped: "Пропустить",
};

const checkLabels = {
  text: "Текст готов",
  visual: "Визуал готов",
  video: "Видео готово",
  article: "Статья готова",
  cover: "Обложка готова",
  published: "Выложено",
  tracked: "Записано",
  videoReady: "Ролик готов",
  coverReady: "Обложка готова",
  publishYoutubeShorts: "Опубликовано в YouTube Shorts",
  publishVkVideo: "Опубликовано в VK Видео",
  publishRutube: "Опубликовано в RUTUBE",
  publishReels: "Опубликовано в Reels, если нужно",
  linksTracked: "Ссылки внесены в контент-таблицу",
};

const typeLabels = {
  today: "Сегодня",
  plan: "План",
  week: "Эта неделя",
  past: "Прошлые",
  overdue: "Просроченные",
  ready: "Готово к публикации",
  vcMonthly: "Публикация месяца",
  extra: "Доп. публикации",
};

const viewAccentClass = {
  today: "viewToday",
  plan: "viewPlan",
  week: "viewWeek",
  past: "viewPast",
  overdue: "viewOverdue",
  ready: "viewReady",
  vcMonthly: "viewMonthly",
  extra: "viewExtra",
};

const platformClass = {
  "Telegram + VK": "tg",
  Instagram: "instagram",
  "Reels / Shorts / VK Видео": "video",
  Дзен: "dzen",
  "vc.ru": "vc",
  Сетка: "setka",
  Facebook: "facebook",
  Другое: "other",
};

const platformDisplayName = {
  "Shorts/Reels/VK Видео": "Reels / Shorts / VK Видео",
  "Reels / Shorts / VK Видео": "Reels / Shorts / VK Видео",
};

const platformStatName = {
  "Shorts/Reels/VK Видео": "Видео",
  "Reels / Shorts / VK Видео": "Видео",
};

const platformFilterItems = [
  { key: "Telegram + VK", label: "Telegram + VK" },
  { key: "Instagram", label: "Instagram" },
  { key: "Reels / Shorts / VK Видео", label: "Reels / Shorts / VK Видео" },
  { key: "Дзен", label: "Дзен" },
  { key: "vc.ru", label: "vc.ru" },
  { key: "Сетка", label: "Сетка" },
  { key: "Facebook", label: "Facebook" },
];

function parseDate(date) {
  return new Date(`${date}T12:00:00`);
}

function formatShortRange(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const d1 = String(startDate.getDate()).padStart(2, "0");
  const d2 = String(endDate.getDate()).padStart(2, "0");
  const m1 = String(startDate.getMonth() + 1).padStart(2, "0");
  const m2 = String(endDate.getMonth() + 1).padStart(2, "0");
  return `${d1}.${m1} – ${d2}.${m2}`;
}

function getTaskProgress(progress, task) {
  const item = progress[task.id] || { status: task.defaultStatus || "not_started", checks: {} };
  const checks = { ...(item.checks || {}) };
  if (item.status === "published") {
    checks.published = true;
  }
  return { status: item.status || deriveStatus(task, checks), checks };
}

function isComplete(progressItem) {
  return progressItem.status === "published";
}

function isSkipped(progressItem) {
  return progressItem.status === "skipped";
}

function allTasks(day) {
  return [...day.priority, ...day.optional, ...day.archive];
}

function getPlatformDisplayName(platform) {
  return platformDisplayName[platform] || platform;
}

function getPlatformStatName(platform) {
  return platformStatName[platform] || getPlatformDisplayName(platform);
}

function matchesPlatformFilter(task, filterKey) {
  return task.platform === filterKey;
}

function folderIdsForDay(day) {
  const map = new Map();
  allTasks(day).forEach((task) => {
    const key = task.folderId || "ПАПКА_НЕ_НАЙДЕНА";
    if (!map.has(key)) {
      map.set(key, {
        folderId: key,
        folderSource: task.folderSource || "missing",
        folderNote: task.folderNote,
      });
    }
  });
  return [...map.values()];
}

function getMonday(date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

function sameWeek(date, anchor) {
  const monday = getMonday(anchor);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return date >= monday && date <= sunday;
}

function planWeeks(days) {
  const weeks = [];
  const seen = new Set();
  days.forEach((day) => {
    const monday = getMonday(parseDate(day.date));
    const key = monday.toISOString().slice(0, 10);
    if (!seen.has(key)) {
      seen.add(key);
      weeks.push(monday);
    }
  });
  return weeks;
}

function getPlanWeekNumber(days, anchor) {
  const currentMonday = getMonday(anchor).toISOString().slice(0, 10);
  const index = planWeeks(days).findIndex((week) => week.toISOString().slice(0, 10) === currentMonday);
  return index >= 0 ? index + 1 : 1;
}

function getNearestDay(days) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return days.find((day) => parseDate(day.date) >= today) || days[days.length - 1];
}

function getTodayIso() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentWeekAnchor(days) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const first = parseDate(days[0].date);
  const last = parseDate(days[days.length - 1].date);
  if (today < first) return first;
  if (today > last) return last;
  return today;
}

function statusForDay(day, progress) {
  const tasks = allTasks(day);
  const activeTasks = tasks.filter((task) => !isSkipped(getTaskProgress(progress, task)));
  const done = activeTasks.filter((task) => isComplete(getTaskProgress(progress, task))).length;
  return { done, total: activeTasks.length, skipped: tasks.length - activeTasks.length };
}

function getChecklistForTask(task) {
  if (task.checklist?.length) {
    return task.checklist;
  }
  if (task.rutubeMode === "new" || task.platform === "Reels / Shorts / VK Видео" || task.taskType === "video") {
    return ["videoReady", "coverReady", "publishYoutubeShorts", "publishVkVideo", "publishRutube", "publishReels", "linksTracked"];
  }
  if (task.platform === "Дзен" || task.platform === "vc.ru" || task.taskType === "article") {
    return ["article", "cover", "published", "tracked"];
  }
  if (task.taskType === "stories") {
    return ["visual", "published", "tracked"];
  }
  return ["text", "visual", "published", "tracked"];
}

function hasAnyChecked(checks, keys) {
  return keys.some((key) => Boolean(checks[key]));
}

function deriveStatus(task, checks) {
  if (checks.published || checks.linksTracked) return "published";

  const checklist = getChecklistForTask(task);
  const stageKeys = checklist.filter((key) => !["published", "tracked", "linksTracked"].includes(key));
  if (!hasAnyChecked(checks, stageKeys)) return "not_started";

  if (task.rutubeMode === "new") {
    return checks.videoReady && checks.coverReady ? "done" : "in_progress";
  }
  if (task.platform === "Reels / Shorts / VK Видео" || task.taskType === "video") {
    return checks.video && checks.cover ? "done" : "in_progress";
  }
  if (task.platform === "Дзен" || task.platform === "vc.ru" || task.taskType === "article") {
    return checks.article ? "done" : "in_progress";
  }
  if (task.taskType === "stories") {
    return checks.visual ? "done" : "in_progress";
  }
  return checks.text && checks.visual ? "done" : "in_progress";
}

function useCalendarProgress() {
  const [progress, setProgress] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  const updateTask = (task, patch) => {
    setProgress((current) => {
      const currentItem = current[task.id] || { status: task.defaultStatus || "not_started", checks: {} };
      const checks = {
        ...currentItem.checks,
        ...(patch.checks || {}),
      };
      let status = patch.status || currentItem.status || "not_started";

      if (patch.status === "published") {
        checks.published = true;
        status = "published";
      } else if (patch.status === "skipped") {
        status = "skipped";
      } else if (patch.status) {
        status = patch.status;
        if (status !== "published") {
          checks.published = false;
        }
      } else if (patch.checks) {
        status = deriveStatus(task, checks);
        if (patch.checks.published === false && status === "not_started") {
          status = "in_progress";
        }
      }

      if (checks.published && status !== "skipped") {
        status = "published";
      }

      return {
        ...current,
        [task.id]: { status, checks },
      };
    });
  };

  return [progress, setProgress, updateTask];
}

function Header({ taskCount }) {
  return (
    <header className="hero" id="top">
      <div>
        <p className="eyebrow">Design4Sales</p>
        <h1>Контент-календарь</h1>
        <p className="heroText">Рабочий дашборд публикаций на 27.04.2026 – 25.07.2026</p>
      </div>
      <div className="heroCard">
        <span>Период</span>
        <strong>27.04.2026 — 25.07.2026</strong>
        <small>{taskCount} задач</small>
      </div>
    </header>
  );
}

function CalendarGuide() {
  return (
    <section className="guidePanel">
      <div>
        <p className="eyebrow">Памятка по площадкам</p>
        <h2>vc.ru — редкая репутационная публикация</h2>
      </div>
      <p>
        vc.ru — 1 публикация в месяц. Публикуем только сильные экспертные материалы: кейсы, большие разборы, статьи про процесс работы, упаковку услуги, визуальную систему бренда. Игры, сторис, легкие офферы и короткие посты на vc.ru не ведем.
      </p>
    </section>
  );
}

function StatsBar({ progress }) {
  const tasks = calendarData.flatMap(allTasks);
  const monthlyVcTasks = tasks.filter((task) => task.platform === "vc.ru" && task.monthlyFeature);
  const regularTasks = tasks.filter((task) => !(task.platform === "vc.ru" && task.monthlyFeature));
  const counts = tasks.reduce(
    (acc, task) => {
      const item = getTaskProgress(progress, task);
      if (task.platform === "vc.ru" && task.monthlyFeature) {
        return acc;
      }
      acc.total += 1;
      acc[item.status] = (acc[item.status] || 0) + 1;
      if (!isComplete(item) && !isSkipped(item)) acc.left += 1;
      return acc;
    },
    { total: 0, done: 0, published: 0, in_progress: 0, left: 0 },
  );
  const effectiveTotal = counts.total - (counts.skipped || 0);
  const percent = effectiveTotal ? Math.round(((counts.published || 0) / effectiveTotal) * 100) : 0;
  const monthlyVcCompleted = monthlyVcTasks.filter((task) => isComplete(getTaskProgress(progress, task))).length;

  const platformStats = platformLabels.map((platform) => {
    const platformTasks = regularTasks.filter((task) => task.platform === platform);
    const activeTasks = platformTasks.filter((task) => !isSkipped(getTaskProgress(progress, task)));
    const completed = activeTasks.filter((task) => isComplete(getTaskProgress(progress, task))).length;
    return { platform, completed, total: activeTasks.length, label: getPlatformStatName(platform) };
  });

  return (
    <section className="statsPanel">
      <div className="statsGrid">
        <Stat label="Всего задач" value={counts.total} />
        <Stat label="Готово" value={counts.done || 0} tone="green" />
        <Stat label="Опубликовано" value={counts.published || 0} tone="blue" />
        <Stat label="В работе" value={counts.in_progress || 0} tone="yellow" />
        <Stat label="Осталось" value={counts.left || 0} tone="red" />
        <Stat label="vc.ru / месяц" value={`${monthlyVcCompleted}/${monthlyVcTasks.length}`} tone="dark" />
      </div>
      <div className="progressLine" aria-label={`Общий прогресс ${percent}%`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="platformProgress">
        {platformStats.map((item) => (
          <span key={item.platform}>
            <PlatformBadge platform={item.platform} label={item.label} />
            {item.completed}/{item.total}
          </span>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Filters({ view, setView, selectedPlatforms, setSelectedPlatforms, search, setSearch, jumpToDate }) {
  const togglePlatform = (platform) => {
    setSelectedPlatforms((current) =>
      current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform],
    );
  };

  return (
    <section className="filters">
      <div className="buttonRow">
        {Object.entries(typeLabels).map(([key, label]) => (
          <button
            key={key}
            className={`viewButton ${viewAccentClass[key] || ""} ${view === key ? "active" : ""}`}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="platformFilters" aria-label="Фильтр по площадкам">
        {platformFilterItems.map((item) => (
          <button
            key={item.key}
            className={selectedPlatforms.includes(item.key) ? "selected" : ""}
            onClick={() => togglePlatform(item.key)}
          >
            <PlatformBadge platform={item.label} label={item.label} />
          </button>
        ))}
      </div>
      <div className="searchRow">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по теме, площадке, папке или CTA"
          type="search"
        />
        <select onChange={(event) => jumpToDate(event.target.value)} defaultValue="">
          <option value="" disabled>
            Перейти к дате
          </option>
          {calendarData.map((day) => (
            <option key={day.date} value={day.date}>
              {day.displayDate} · {day.title}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function TodayPanel({ day, progress, updateTask }) {
  return (
    <section className="todayPanel">
      <div className="sectionTitle">
        <div>
          <p className="eyebrow">Сегодня / ближайшая задача</p>
          <h2>
            {day.displayDate} · {day.title}
          </h2>
        </div>
        <span className="typePill">{day.typeLabel}</span>
        {day.calendarNote && <span className="notePill">{day.calendarNote}</span>}
      </div>
      <DayCard day={day} progress={progress} updateTask={updateTask} highlight />
    </section>
  );
}

function CalendarNav({ jumpToMonth }) {
  return (
    <nav className="monthNav" aria-label="Навигация по календарю">
      <button onClick={() => jumpToMonth("2026-04")}>Апрель–май</button>
      <button onClick={() => jumpToMonth("2026-06")}>Июнь</button>
      <button onClick={() => jumpToMonth("2026-07")}>Июль</button>
      <a href="#top">Наверх</a>
    </nav>
  );
}

function DayCard({
  day,
  progress,
  updateTask,
  compact = false,
  highlight = false,
  taskFilter = null,
  onlyExtra = false,
}) {
  const dayProgress = statusForDay(day, progress);
  const completePercent = dayProgress.total ? Math.round((dayProgress.done / dayProgress.total) * 100) : 0;
  const todayIso = getTodayIso();
  const overdue = day.date < todayIso && dayProgress.done < dayProgress.total;
  const isToday = day.date === todayIso;

  return (
    <article className={`dayCard ${highlight ? "highlight" : ""} ${isToday ? "todayCard" : ""} ${overdue ? "overdue" : ""}`} id={`date-${day.date}`}>
      <div className="dayHeader">
        <div>
          <div className="dateLine">
            <h3>
              {day.displayDate} · {day.day}
            </h3>
            {isToday && <span className="todayTag">Сегодня</span>}
            {overdue && <span className="overdueTag">Просрочено</span>}
          </div>
          <p>{day.title}</p>
        </div>
        <div className="dayMeta">
          <span className="typePill">{day.typeLabel}</span>
          {day.calendarNote && <span className="notePill">{day.calendarNote}</span>}
          <strong>
            {dayProgress.done} из {dayProgress.total}
          </strong>
          <small>{dayProgress.skipped ? `выложено · ${dayProgress.skipped} пропущено` : "задач выложено"}</small>
        </div>
      </div>
      <div className="miniProgress">
        <span style={{ width: `${completePercent}%` }} />
      </div>

      {!onlyExtra && (
        <TaskSection title="Главное" tasks={day.priority} progress={progress} updateTask={updateTask} taskFilter={taskFilter} />
      )}
      <TaskSection title="Дополнительно" tasks={day.optional} progress={progress} updateTask={updateTask} taskFilter={taskFilter} />
      <TaskSection title="Архив / перепаковка" tasks={day.archive} progress={progress} updateTask={updateTask} taskFilter={taskFilter} />

      {!compact && (
        <div className="dayFooter">
          <InfoList title="Что подготовить" items={day.prepare} />
          <FolderList title="Папки дня" folderIds={folderIdsForDay(day)} />
          <InfoList title="CTA" items={day.cta} />
        </div>
      )}
    </article>
  );
}

function TaskSection({ title, tasks, progress, updateTask, taskFilter = null }) {
  const visibleTasks = taskFilter ? tasks.filter((task) => taskFilter(task)) : tasks;
  if (!visibleTasks.length) return null;
  return (
    <section className="taskSection">
      <h4>{title}</h4>
      <div className="taskList">
        {visibleTasks.map((task) => (
          <TaskItem key={task.id} task={task} progress={progress} updateTask={updateTask} />
        ))}
      </div>
    </section>
  );
}

function TaskItem({ task, progress, updateTask }) {
  const item = getTaskProgress(progress, task);
  const done = isComplete(item);
  const checklist = getChecklistForTask(task);
  return (
    <div className={`taskItem ${item.status} ${done ? "doneTask" : ""}`}>
      <div className="taskTop">
        <PlatformBadge platform={task.platform} />
        <div className="taskMainText">
          <p>{task.text}</p>
          {task.monthlyFeature && <span className="monthlyBadge">{task.monthlyLabel || "vc.ru · сильная статья месяца"}</span>}
          {task.videoLabel && task.folderSource !== "excel" && <span className="monthlyBadge">{task.videoLabel}</span>}
          <MaterialRef folderId={task.folderId} folderSource={task.folderSource} folderNote={task.folderNote} />
          {task.warning && <div className="taskWarning">{task.warning}</div>}
        </div>
        <span className={`statusBadge ${item.status}`}>{statusLabels[item.status]}</span>
      </div>
      <div className="taskControls">
        <StatusControls task={task} item={item} updateTask={updateTask} />
        <div className="stages">
          <div className="stagesHeader">
            <strong>Этапы</strong>
            <span>Отмечай по порядку: подготовил → выложил → записал в таблицу.</span>
          </div>
          <div className="checks">
            {checklist.map((check) => (
              <label key={check} className={item.checks?.[check] ? "checked" : ""}>
              <input
                type="checkbox"
                checked={Boolean(item.checks?.[check])}
                onChange={(event) => updateTask(task, { checks: { [check]: event.target.checked } })}
              />
              {checkLabels[check] || check}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformBadge({ platform, label = null }) {
  return <span className={`platformBadge ${platformClass[platform] || "other"}`}>{label || getPlatformDisplayName(platform)}</span>;
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button className="copyButton" onClick={copyValue} type="button" disabled={!value}>
      {copied ? "Скопировано" : "Скопировать"}
    </button>
  );
}

function folderSourceLabel(source) {
  if (source === "excel") return "Архивная папка";
  if (source === "generated") return "Новая папка";
  return "Папка не найдена";
}

function MaterialRef({ folderId, folderSource, folderNote }) {
  const value = folderId || "ПАПКА_НЕ_НАЙДЕНА";
  return (
    <div className="materialRef">
      <span>Материалы:</span>
      <code>{value}</code>
      <span className={`folderTag ${folderSource || "missing"}`}>{folderSourceLabel(folderSource)}</span>
      {folderNote && <span className="folderNote">{folderNote}</span>}
      {folderId && folderId !== "ПАПКА_НЕ_НАЙДЕНА" && <CopyButton value={folderId} />}
    </div>
  );
}

function StatusControls({ task, item, updateTask }) {
  return (
    <select
      className={`statusSelect ${item.status}`}
      value={item.status}
      onChange={(event) => updateTask(task, { status: event.target.value })}
      aria-label="Статус задачи"
    >
      {Object.entries(statusLabels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

function InfoList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="infoList">
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FolderList({ title, folderIds }) {
  if (!folderIds?.length) {
    return (
      <div className="infoList folderList">
        <h4>{title}</h4>
        <p className="emptyFolders">папка не указана</p>
      </div>
    );
  }
  return (
    <div className="infoList folderList">
      <h4>{title}</h4>
      <ul>
        {folderIds.map((folder) => (
          <li key={folder.folderId}>
            <code>{folder.folderId}</code>
            <span className={`folderTag ${folder.folderSource || "missing"}`}>{folderSourceLabel(folder.folderSource)}</span>
            {folder.folderNote && <span className="folderNote">{folder.folderNote}</span>}
            {folder.folderId !== "ПАПКА_НЕ_НАЙДЕНА" && <CopyButton value={folder.folderId} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgressExportImport({ progress, setProgress }) {
  const fileRef = useRef(null);

  const exportProgress = () => {
    const tasksById = Object.fromEntries(calendarData.flatMap(allTasks).map((task) => [task.id, task]));
    const exportData = Object.fromEntries(
      Object.entries(progress).map(([taskId, item]) => [
        taskId,
        {
          ...item,
          folderId: tasksById[taskId]?.folderId || item.folderId,
          folderSource: tasksById[taskId]?.folderSource || item.folderSource,
          folderNote: tasksById[taskId]?.folderNote || item.folderNote,
        },
      ]),
    );
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "design4sales_calendar_progress.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setProgress(parsed);
      } catch {
        alert("Не удалось импортировать JSON. Проверьте файл прогресса.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const resetProgress = () => {
    if (confirm("Сбросить весь прогресс календаря?")) {
      setProgress({});
    }
  };

  return (
    <section className="progressTools">
      <button onClick={exportProgress}>Экспорт прогресса JSON</button>
      <button onClick={() => fileRef.current?.click()}>Импорт прогресса JSON</button>
      <button className="danger" onClick={resetProgress}>
        Сбросить прогресс
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={importProgress} hidden />
    </section>
  );
}

function matchesFilters(day, view, selectedPlatforms, search, progress) {
  const all = allTasks(day);
  const query = search.trim().toLowerCase();
  const platformMatch =
    !selectedPlatforms.length || all.some((task) => selectedPlatforms.some((platform) => matchesPlatformFilter(task, platform)));
  const textHaystack = [
    day.displayDate,
    day.day,
    day.title,
    day.typeLabel,
    ...day.prepare,
    ...day.cta,
    ...all.flatMap((task) => [
      task.platform,
      getPlatformDisplayName(task.platform),
      task.text,
      task.taskType,
      task.folderId,
      task.folderNote,
      task.monthlyLabel,
      task.warning,
      task.defaultStatus,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  const searchMatch = !query || textHaystack.includes(query);
  const readyMatch =
    view === "ready"
      ? all.some((task) => getTaskProgress(progress, task).status === "done")
      : true;
  const vcMonthlyMatch = view === "vcMonthly" ? all.some((task) => task.monthlyFeature && task.platform === "vc.ru") : true;
  const extraMatch = view === "extra" ? day.optional.length > 0 || day.archive.length > 0 : true;
  return platformMatch && searchMatch && readyMatch && vcMonthlyMatch && extraMatch;
}

export default function App() {
  const [progress, setProgress, updateTask] = useCalendarProgress();
  const [view, setView] = useState("today");
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [search, setSearch] = useState("");
  const nearestDay = useMemo(() => getNearestDay(calendarData), []);
  const weekAnchor = useMemo(() => getCurrentWeekAnchor(calendarData), []);
  const taskCount = useMemo(
    () => calendarData.flatMap(allTasks).filter((task) => !(task.platform === "vc.ru" && task.monthlyFeature)).length,
    [],
  );
  const todayIso = useMemo(() => getTodayIso(), []);

  const filteredDays = useMemo(() => {
    return calendarData.filter((day) => {
      const date = parseDate(day.date);
      const dayProgress = statusForDay(day, progress);
      const isPast = day.date < todayIso;
      const isCompleted = dayProgress.total > 0 && dayProgress.done === dayProgress.total;
      if (view === "today" && day.date !== nearestDay.date) return false;
      if (view === "plan" && isPast && isCompleted) return false;
      if (view === "past" && (!isPast || !isCompleted)) return false;
      if (view === "week" && !sameWeek(date, weekAnchor)) return false;
      if (
        view === "overdue" &&
        (day.date >= todayIso ||
          !allTasks(day).some((task) => {
            const status = getTaskProgress(progress, task).status;
            return status !== "published" && status !== "skipped";
          }))
      ) {
        return false;
      }
      return matchesFilters(day, view, selectedPlatforms, search, progress);
    });
  }, [view, selectedPlatforms, search, progress, nearestDay, weekAnchor, todayIso]);

  const taskFilter = useMemo(() => {
    if (view === "overdue") {
      return (task) => {
        const status = getTaskProgress(progress, task).status;
        return status !== "published" && status !== "skipped";
      };
    }
    if (view === "ready") {
      return (task) => getTaskProgress(progress, task).status === "done";
    }
    if (view === "vcMonthly") {
      return (task) => task.platform === "vc.ru" && task.monthlyFeature;
    }
    return null;
  }, [view, progress]);

  const jumpToDate = (date) => {
    document.getElementById(`date-${date}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const jumpToMonth = (month) => {
    const day = calendarData.find((item) => item.date.startsWith(month)) || calendarData[0];
    jumpToDate(day.date);
  };

  const weekDays = calendarData.filter((day) => sameWeek(parseDate(day.date), weekAnchor));
  const weekLabel = weekDays.length ? formatShortRange(weekDays[0].date, weekDays[weekDays.length - 1].date) : "";
  const weekNumber = getPlanWeekNumber(calendarData, weekAnchor);

  return (
    <div className="app">
      <Header taskCount={taskCount} />
      <CalendarGuide />
      <StatsBar progress={progress} />
      <Filters
        view={view}
        setView={setView}
        selectedPlatforms={selectedPlatforms}
        setSelectedPlatforms={setSelectedPlatforms}
        search={search}
        setSearch={setSearch}
        jumpToDate={jumpToDate}
      />
      <ProgressExportImport progress={progress} setProgress={setProgress} />
      {view === "today" ? (
        <TodayPanel day={nearestDay} progress={progress} updateTask={updateTask} />
      ) : (
        <>
          <CalendarNav jumpToMonth={jumpToMonth} />

          {view === "week" && (
            <div className="weekBanner">
              <span>Неделя {weekNumber}</span>
              <strong>{weekLabel}</strong>
            </div>
          )}

          <main className="calendarGrid">
            {filteredDays.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                progress={progress}
                updateTask={updateTask}
                compact
                highlight={day.date === todayIso}
                taskFilter={taskFilter}
                onlyExtra={view === "extra"}
              />
            ))}
          </main>

          {!filteredDays.length && (
            <div className="emptyState">
              <h2>Ничего не найдено</h2>
              <p>Снимите часть фильтров или измените поисковый запрос.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
