import React from "react";
import bank from "./assets/icons/bank.webp";
import bell from "./assets/icons/bell.webp";
import calendar from "./assets/icons/calendar.webp";
import chart from "./assets/icons/chart.webp";
import gear from "./assets/icons/gear.webp";
import idea from "./assets/icons/idea.webp";
import plane from "./assets/icons/plane.webp";
import ready from "./assets/icons/ready.webp";
import rocket from "./assets/icons/rocket.webp";
import text from "./assets/icons/text.webp";
import trophy from "./assets/icons/trophy.webp";
import visual from "./assets/icons/visual.webp";

// 3D-иконки сгенерированы Codex для Design4Sales (11.11.2026), стиль описан в docs/STYLE.md.
export const icons = { bank, bell, calendar, chart, gear, idea, plane, ready, rocket, text, trophy, visual };
export const stageIcons = { idea, text, visual, ready, published: rocket };

export function Icon({ name, size = 32, className = "", alt = "" }) {
  return <img className={"icon3d " + className} src={icons[name] || stageIcons[name]} alt={alt} width={size} height={size} draggable="false" />;
}
