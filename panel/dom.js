import { faviconSources } from "../lib/model.js";

export function message(text) {
  const p = document.createElement("p");
  p.className = "center";
  p.textContent = text;
  return p;
}

export function hint(text) {
  const p = document.createElement("p");
  p.className = "empty";
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
