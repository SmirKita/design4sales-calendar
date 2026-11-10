import React, { useState } from "react";
import { LEADS, MODES, PLATFORMS, STATUSES, FORMATS, moscowInstant, platformSlot, scheduledSlots, todayInMoscow } from "./publicationSchedule.js";

function LeadOptions() {
  return LEADS.map((lead) => <option value={lead} key={lead}>{lead === 0 ? "В момент публикации" : `За ${lead} мин`}</option>);
}

function PlatformName({ platform }) {
  return <><span aria-hidden="true" className="platformIcon">{platform.icon}</span>{platform.name}</>;
}

export function SchedulePills({ post, record, settings }) {
  const slots = scheduledSlots(post, record, settings).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return slots.length ? <ul className="schedulePills" aria-label="Выходы по площадкам">
    {slots.map((slot) => <li key={slot.platform.id} className={`slot-${slot.status}`}>
      <PlatformName platform={slot.platform} /> <strong>{slot.date !== post.date && `${slot.date.slice(8)}.${slot.date.slice(5, 7)} · `}{slot.time}</strong>
      {settings.enabled && slot.reminder && !["cancelled", "published"].includes(slot.status) && <span aria-label="Напоминание включено" title="Напоминание включено">🔔</span>}
      {!["planned", "ready"].includes(slot.status) && <span>{STATUSES.find(([key]) => key === slot.status)[1]}</span>}
    </li>)}
  </ul> : null;
}

export function PlacementEditor({ post, record, settings, change, sync, manage }) {
  return <details className="placementEditor">
    <summary>Площадки и время <small>МСК</small></summary>
    <p className="scheduleHint">Включи площадки для этой темы. Перенос и отметка о выходе действуют только на выбранную площадку.</p>
    <div className="placementGrid">{PLATFORMS.map((platform) => {
      const slot = platformSlot(post, record, platform, settings);
      const patch = (value) => change(platform.id, value);
      const publish = (status) => patch({ status, publishedAt: status === "published" ? slot.publishedAt || new Date().toISOString() : null });
      return <fieldset className="placement" key={platform.id}>
        <legend><PlatformName platform={platform} /></legend>
        <label className="checkLabel"><input type="checkbox" checked={slot.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> Публиковать</label>
        {slot.enabled && <>
          {platform.id === "ig" && <label>Формат<select value={slot.format} onChange={(e) => patch({ format: e.target.value })}>{FORMATS.map((format) => <option key={format}>{format}</option>)}</select></label>}
          {platform.id !== "ig" && <small>{slot.format}</small>}
          <div className="scheduleFields">
            <label>Дата<input type="date" value={slot.date} onChange={(e) => {
              if (e.target.value) patch({ date: e.target.value, ...(slot.status === "published" || slot.status === "cancelled" ? {} : { status: "moved" }) });
            }} /></label>
            <label>Время · МСК<input type="time" value={slot.time} onChange={(e) => e.target.value && patch({ mode: "custom", time: e.target.value })} /></label>
          </div>
          <label>Источник времени<select value={slot.mode} onChange={(e) => patch({ mode: e.target.value, ...(e.target.value === "custom" ? { time: slot.time } : {}) })}>
            <option value="default">По расписанию площадки</option>
            {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            <option value="custom">Своё время</option>
          </select></label>
          <label>Статус<select value={slot.status} onChange={(e) => publish(e.target.value)}>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="checkLabel"><input type="checkbox" checked={slot.reminder} onChange={(e) => patch({ reminder: e.target.checked })} /> Напоминать</label>
          {slot.reminder && <>
            <label>Предупредить<select value={slot.lead ?? ""} onChange={(e) => patch({ lead: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">По настройкам ({settings.lead} мин)</option><LeadOptions />
            </select></label>
            <div className="statChecks">
              {[24, 72].map((hours) => <label key={hours} className="checkLabel"><input type="checkbox" checked={slot["v" + hours]} onChange={(e) => patch({ ["v" + hours]: e.target.checked })} /> Статистика через {hours} ч</label>)}
            </div>
          </>}
          {!["published", "cancelled"].includes(slot.status) && <button className="scheduleButton" onClick={() => publish("published")}>Отметить опубликованным</button>}
        </>}
      </fieldset>;
    })}</div>
    <div className="scheduleActions"><span>{sync}</span><button className="scheduleButton" onClick={manage}>Управление напоминаниями</button></div>
  </details>;
}

export function ScheduleSettings({ settings, change, native, sync, syncText, syncAction }) {
  return <section className="scheduleSettings">
    <div className="sectionIntro"><span>Europe/Moscow</span><h2>Расписание публикаций</h2><p>Ориентиры для тестирования охвата. Своё время в карточке имеет приоритет перед общим расписанием.</p></div>
    <div className="schedulePanel scheduleDefaults">
      {PLATFORMS.map((platform) => {
        const row = settings.platforms[platform.id];
        const patch = (value) => change({ platforms: { ...settings.platforms, [platform.id]: { ...row, ...value } } });
        return <fieldset className="placement" key={platform.id}><legend><PlatformName platform={platform} /></legend>
          <label>Время по умолчанию<select value={row.mode} onChange={(e) => patch({ mode: e.target.value })}>{MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="scheduleFields">
            {MODES.map(([key, label]) => <label key={key}>{label}<input type="time" value={row[key]} onChange={(e) => e.target.value && patch({ [key]: e.target.value })} /></label>)}
          </div>
        </fieldset>;
      })}
    </div>
    <div className="schedulePanel" id="apple-settings">
      <h3>Apple «Напоминания»</h3>
      <label className="checkLabel"><input type="checkbox" checked={settings.enabled} onChange={(e) => change({ enabled: e.target.checked })} /> Системные напоминания включены</label>
      <label className="checkLabel"><input type="checkbox" checked={settings.morning} onChange={(e) => change({ morning: e.target.checked })} /> Сводка в 08:30 МСК в дни выходов с напоминаниями</label>
      <label className="defaultLead">Предупреждение по умолчанию<select value={settings.lead} onChange={(e) => change({ lead: Number(e.target.value) })}><LeadOptions /></select></label>
      <p role="status">{syncText}</p>
      {sync?.lastSuccess && <p className="scheduleHint">Последняя успешная запись в Apple: {new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(sync.lastSuccess))} МСК.</p>}
      {native ? <>
        <p className="scheduleHint">Создай список Design4Sales в разделе iCloud на Mac. Подключение и обновление задач выполняются из этого приложения. В Apple время задачи — это время сигнала; время выхода указано в заметке.</p>
        <div className="scheduleActions">
          <button className="scheduleButton" onClick={() => syncAction("check")}>Проверить подключение</button>
          <button className="scheduleButton" onClick={() => syncAction("sync")}>Синхронизировать сейчас</button>
        </div>
      </> : <p className="scheduleHint">Веб-версия хранит свой план в этом браузере. Для автоматической записи в Apple перенеси прогресс через JSON в приложение календаря на Mac.</p>}
    </div>
  </section>;
}

export function NewPublication({ create }) {
  const [error, setError] = useState("");
  return <details className="schedulePanel newPublication">
    <summary>Новая публикация</summary>
    <form onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const problem = create({ title: String(data.get("title")).trim(), date: String(data.get("date")) });
      setError(problem || "");
      if (!problem) { e.currentTarget.reset(); e.currentTarget.closest("details").open = false; }
    }}>
      <label>Тема<input name="title" maxLength={180} required /></label>
      <label>Дата<input name="date" type="date" defaultValue={todayInMoscow()} required /></label>
      <button className="scheduleButton" type="submit">Добавить в календарь</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}

export function DaySchedule({ posts, state, settings }) {
  const [date, setDate] = useState(todayInMoscow);
  const rows = posts.flatMap((post) => scheduledSlots(post, state[post.id] || {}, settings)
    .filter((slot) => slot.date === date).map((slot) => ({ ...slot, post })))
    .sort((a, b) => moscowInstant(a.date, a.time) - moscowInstant(b.date, b.time) || a.platform.name.localeCompare(b.platform.name));
  return <details className="schedulePanel daySchedule">
    <summary>Выходы по дням</summary>
    <label>День · МСК<input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
    {rows.length ? <ul>{rows.map((slot) => <li className={`slot-${slot.status}`} key={slot.post.id + slot.platform.id}>
      <strong>{slot.time}</strong> <PlatformName platform={slot.platform} /> · <a href={`#post-${slot.post.id}`}>{slot.post.title}</a> · {STATUSES.find(([key]) => key === slot.status)[1]}
      {settings.enabled && slot.reminder && !["published", "cancelled"].includes(slot.status) && <span aria-label="Напоминание включено"> 🔔</span>}
    </li>)}</ul> : <p>На этот день выходов нет.</p>}
  </details>;
}
