import { faviconSources } from "../lib/model.js";

/**
 * 按位置把 parent 的子节点对齐到 els：相同元素原地保留，
 * 只移动错位元素、删除多余尾部。键控复用的前提——
 * 调用方保证 els[i] 就是第 i 位应该存在的元素。
 */
export function reconcile(parent, els) {
  let anchor = parent.firstElementChild;
  for (const el of els) {
    if (el === anchor) {
      anchor = anchor.nextElementSibling;
      continue;
    }
    parent.insertBefore(el, anchor || null);
  }
  while (parent.childElementCount > els.length) parent.removeChild(parent.lastElementChild);
}

export function message(text) {
  const p = document.createElement("p");
  p.className = "center";
  p.textContent = text;
  return p;
}

export function sectionTitle(text) {
  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h2");
  title.textContent = text;
  head.append(title);
  return head;
}

export function sectionAction(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "section-action";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

export function settingsIcon() {
  // 6-tooth cog, stroke-rendered
  return svgPath("M8 2v2.2M11.3 3.3 9.9 5.1M14 6.7l-1.8 1M15 10h-2.2M13.7 13.3 11.9 12M10 15v-2.2M6.7 13.7 8.1 12M4 11.3l1.8-1M3 8h2.2M4.3 4.7 6.1 6M6 3l1.9 1.8", false);
}

export function nameBlock(name) {
  const copy = document.createElement("span");
  copy.className = "copy";
  const strong = document.createElement("span");
  strong.className = "name";
  strong.textContent = name;
  copy.append(strong);
  return copy;
}

export function hoverAction(label, glyph, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-x";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(glyph === "minus" ? markIcon("M4 8h8") : markIcon("M4.5 4.5l7 7M11.5 4.5l-7 7"));
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

export function markIcon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  return svg;
}

export function folderIcon(open) {
  const span = document.createElement("span");
  span.className = open ? "folder open" : "folder";
  if (open) {
    span.append(svgPaths([
      "M1.8 3.1h4.1l1.15 1.25H13.2c.55 0 1 .42 1 .95V6.3H1.8V3.1z",
      "M1.15 6.7h13.7l-1.45 6.2a1 1 0 0 1-.98.8H3.55a1 1 0 0 1-.98-.8L1.15 6.7z",
    ]));
  } else {
    span.append(svgPath("M2.05 4.35c0-.8.62-1.45 1.4-1.45h2.55l1.15 1.25h5.45c.78 0 1.4.65 1.4 1.45v6.15c0 .8-.62 1.45-1.4 1.45H3.45c-.78 0-1.4-.65-1.4-1.45V4.35z"));
  }
  return span;
}

export function searchIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "7");
  circle.setAttribute("cy", "7");
  circle.setAttribute("r", "4.25");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "1.6");
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "path");
  handle.setAttribute("d", "M10.2 10.2 13 13");
  handle.setAttribute("fill", "none");
  handle.setAttribute("stroke", "currentColor");
  handle.setAttribute("stroke-width", "1.6");
  handle.setAttribute("stroke-linecap", "round");
  svg.append(circle, handle);
  return svg;
}

export function svgPaths(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
  }
  return svg;
}

export function svgPath(d, filled = true) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  if (filled) path.setAttribute("fill", "currentColor");
  else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.append(path);
  return svg;
}

export function faviconMissing() {
  const span = document.createElement("span");
  span.className = "favicon missing";
  return span;
}

export function favicon(url, favIconUrl) {
  const sources = faviconSources(url, favIconUrl, (path) => chrome.runtime.getURL?.(path) ?? path);
  if (!sources.length) return faviconMissing();
  const img = document.createElement("img");
  img.className = "favicon";
  img.alt = "";
  let index = 0;
  img.addEventListener("error", () => {
    index += 1;
    if (index < sources.length) img.src = sources[index];
    else img.replaceWith(faviconMissing());
  });
  img.src = sources[0];
  return img;
}

export function menuDivider() {
  const gap = document.createElement("div");
  gap.className = "menu-gap";
  gap.setAttribute("role", "separator");
  return gap;
}

export function menuItem(label, onClick, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (danger) button.className = "danger";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}
