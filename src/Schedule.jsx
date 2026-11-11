import React, { useState } from "react";
import { LEADS, MODES, PLATFORMS, FORMATS, moscowInstant, scheduledSlots, todayInMoscow } from "./publicationSchedule.js";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
export function dateLabel(date) {
  return dateFormat.format(new Date(date + "T12:00:00Z"));
}

function nextDate(date, time, now) {
  const today = todayInMoscow(new Date(now));
  if (date > today) return date;
  if (moscowInstant(today, time) > now) return today;
  return new Date(Date.parse(today + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
}

const leadLabel = (lead) => lead === 0 ? "В момент выхода" : `За ${lead} мин`;
const terminal = (slot) => ["published", "cancelled"].includes(slot.status);

function PlatformName({ platform }) {
  return <span className="platformName"><span aria-hidden="true" className="platformIcon">{platform.icon}</span>{platform.name}</span>;
}

export function PlacementEditor({ post, record, settings, change, now, disabled }) {
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState(false);
  const slots = scheduledSlots(post, record, settings).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const currentYear = todayInMoscow(new Date(now)).slice(0, 4);
  const available = PLATFORMS.filter((platform) => !slots.some((slot) => slot.platform.id === platform.id));

  return <div className="placements">
    {slots.map((slot) => {
      const { platform } = slot;
      const patch = (value) => change(platform.id, value);
      const past = moscowInstant(slot.date, slot.time) <= now;
      const lead = slot.lead ?? settings.lead;
      let status = "Запланировано";
      if (slot.status === "published") status = "Опубликовано";
      else if (slot.status === "cancelled") status = "Отменено";
      else if (past) status = "Время прошло";
      const signal = terminal(slot) || past ? "" : !settings.enabled || !slot.reminder ? "Без напоминания"
        : moscowInstant(slot.date, slot.time) - lead * 60_000 <= now ? "Напомнить в момент выхода" : `Напомнить · ${leadLabel(lead).toLowerCase()}`;
      return <section className="slot" key={platform.id} aria-label={platform.name}>
        <div className="slotTop">
          <div>
            <PlatformName platform={platform} />
            <p className="slotTime"><time dateTime={`${slot.date}T${slot.time}:00+03:00`}>{dateLabel(slot.date)}{slot.date.startsWith(currentYear) ? "" : " " + slot.date.slice(0, 4)} · {slot.time}</time> <span>МСК</span></p>
            <p className="slotMeta"><span className={`slotStatus ${slot.status === "published" ? "done" : ""}`}>{status}</span>{signal && <span>{signal}</span>}</p>
          </div>
          <div className="slotActions">
            {!terminal(slot) && <button className="button secondary" disabled={disabled} onClick={() => {
              patch({ status: "published", publishedAt: new Date().toISOString() });
              setEditing("");
            }}>Отметить выход</button>}
            <button className="button quiet" disabled={disabled} aria-expanded={editing === platform.id} onClick={() => {
              setAdding(false);
              setEditing(editing === platform.id ? "" : platform.id);
            }}>{editing === platform.id ? "Готово" : "Изменить"}</button>
          </div>
        </div>
        {editing === platform.id && <div className="slotEditor">
          <div className="fields">
            <label>Дата<input type="date" value={slot.date} onChange={(e) => e.target.value && patch({
              date: e.target.value, ...(terminal(slot) ? {} : { status: "moved" }),
            })} /></label>
            <label>Время · МСК<input type="time" value={slot.time} onChange={(e) => e.target.value && patch({ mode: "custom", time: e.target.value })} /></label>
            {platform.id === "ig" && <label>Формат<select value={slot.format} onChange={(e) => patch({ format: e.target.value })}>
              {FORMATS.map((format) => <option key={format}>{format}</option>)}
            </select></label>}
            <label>Напоминание<select value={slot.reminder ? slot.lead ?? "default" : "off"} onChange={(e) => {
              const value = e.target.value;
              patch(value === "off" ? { reminder: false } : { reminder: true, lead: value === "default" ? null : Number(value) });
            }}>
              <option value="off">Без напоминания</option>
              <option value="default">По настройкам · {leadLabel(settings.lead).toLowerCase()}</option>
              {LEADS.map((lead) => <option value={lead} key={lead}>{leadLabel(lead)}</option>)}
            </select></label>
          </div>
          <div className="slotTools">
            {slot.mode !== "default" && <button className="button quiet" onClick={() => patch({ mode: "default" })}>Вернуть обычное время</button>}
            {terminal(slot) ? <button className="button secondary" onClick={() => patch({ status: "planned", publishedAt: null })}>Вернуть в план</button>
              : <button className="button quiet danger" onClick={() => {
                patch({ status: "cancelled", publishedAt: null });
                setEditing("");
              }}>Отменить выход</button>}
            {slot.status === "cancelled" && <button className="button quiet danger" onClick={() => {
              patch({ enabled: false });
              setEditing("");
            }}>Убрать площадку</button>}
          </div>
        </div>}
      </section>;
    })}
    {available.length > 0 && <button className="button secondary addPlatform" disabled={disabled} aria-expanded={adding} onClick={() => {
      setAdding(!adding);
      setEditing("");
    }}>＋ Добавить площадку</button>}
    {adding && <AddPlacement available={available} post={post} record={record} settings={settings} now={now} add={(platform, patch) => {
      change(platform, patch);
      setAdding(false);
    }} />}
  </div>;
}

function AddPlacement({ available, post, record, settings, now, add }) {
  const [platform, setPlatform] = useState(available[0].id);
  const [error, setError] = useState("");
  const existing = record.placements?.[platform];
  const preferred = settings.platforms[platform];
  const preferredTime = existing?.time || preferred[preferred.mode];
  return <form className="slotEditor" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const date = String(data.get("date"));
    const time = String(data.get("time"));
    const instant = moscowInstant(date, time);
    if (!Number.isFinite(instant) || instant <= Date.now()) { setError("Выбери будущее время выхода."); return; }
    add(platform, { enabled: true, date, time, mode: time === preferred[preferred.mode] ? "default" : "custom", reminder: data.has("reminder"), status: "planned", publishedAt: null });
  }}>
    <div className="fields">
      <label>Площадка<select autoFocus value={platform} onChange={(e) => setPlatform(e.target.value)}>
        {available.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <label>Дата<input name="date" type="date" defaultValue={nextDate(post.date, preferredTime, now)} required /></label>
      <label>Время · МСК<input key={platform} name="time" type="time" defaultValue={preferredTime} required /></label>
    </div>
    <label className="checkbox"><input key={platform} type="checkbox" name="reminder" defaultChecked={existing?.reminder ?? settings.enabled} /> Напомнить · {leadLabel(settings.lead).toLowerCase()}</label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="button primary">Добавить выход</button>
  </form>;
}

export function ScheduleSettings({ settings, change, native, sync, syncText, syncAction }) {
  const [selected, setSelected] = useState("tg");
  const row = settings.platforms[selected];
  const patch = (value) => change({ platforms: { ...settings.platforms, [selected]: { ...row, ...value } } });
  return <>
    <section className="panel settingsPanel" id="apple-settings">
      <h2>Напоминания</h2>
      <p role="status">{syncText}</p>
      {sync?.list && <p className="muted">Список · {sync.list}</p>}
      {sync?.online === false && <p className="muted">Нет сети. Правки сохраняются на Mac, iCloud доставит их после подключения.</p>}
      {sync?.lastSuccess && <p className="muted">Последняя сверка · {new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }).format(new Date(sync.lastSuccess))} МСК</p>}
      {native && <div className="slotTools">
        <button className="button primary" disabled={sync?.busy} onClick={() => syncAction("check")}>{sync?.connected ? "Проверить подключение" : "Подключить список"}</button>
        {sync?.configured && <button className="button secondary" disabled={sync?.busy} onClick={() => syncAction("sync")}>Синхронизировать сейчас</button>}
      </div>}
      <label className="checkbox"><input type="checkbox" checked={settings.enabled} onChange={(e) => change({ enabled: e.target.checked })} /> Напоминать о публикациях</label>
      <label className="checkbox"><input type="checkbox" checked={settings.morning} onChange={(e) => change({ morning: e.target.checked })} /> Утренняя сводка в 08:30 МСК</label>
      <div className="fields"><label>Когда напоминать<select value={settings.lead} onChange={(e) => change({ lead: Number(e.target.value) })}>
        {LEADS.map((lead) => <option value={lead} key={lead}>{leadLabel(lead)}</option>)}
      </select></label></div>
    </section>
    <details className="panel settingsPanel">
      <summary>Время по умолчанию для площадок</summary>
      <div className="fields">
        <label>Площадка<select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {PLATFORMS.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
        </select></label>
        <label>Использовать<select value={row.mode} onChange={(e) => patch({ mode: e.target.value })}>
          {MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {MODES.map(([key, label]) => <label key={key}>{label} · МСК<input type="time" value={row[key]} onChange={(e) => e.target.value && patch({ [key]: e.target.value })} /></label>)}
      </div>
    </details>
  </>;
}

export function NewPublication({ create, settings, close }) {
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState("tg");
  const [time, setTime] = useState("");
  const preferredTime = settings.platforms[platform][settings.platforms[platform].mode];
  return <form className="panel newPublication" onSubmit={(e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const problem = create({ title: String(data.get("title")).trim(), date: String(data.get("date")), platform, time: time || preferredTime, usesDefault: !time || time === preferredTime, reminder: data.has("reminder") });
    if (problem) setError(problem);
  }}>
    <h2>Новая публикация</h2>
    <label>Тема<input name="title" maxLength={180} required autoFocus placeholder="Например, разбор упаковки" /></label>
    <div className="fields">
      <label>Площадка<select value={platform} onChange={(e) => { setPlatform(e.target.value); setTime(""); }}>
        {PLATFORMS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <label>Дата<input name="date" type="date" defaultValue={nextDate(todayInMoscow(), preferredTime, Date.now())} required /></label>
      <label>Время · МСК<input type="time" value={time || preferredTime} onChange={(e) => setTime(e.target.value)} required /></label>
    </div>
    <label className="checkbox"><input type="checkbox" name="reminder" defaultChecked={settings.enabled} /> Напомнить · {leadLabel(settings.lead).toLowerCase()}</label>
    {error && <p role="alert">{error}</p>}
    <div className="slotTools"><button className="button primary" type="submit">Запланировать</button><button className="button quiet" type="button" onClick={close}>Закрыть</button></div>
  </form>;
}
