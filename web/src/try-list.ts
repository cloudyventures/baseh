/**
 * Renders the "Try" suggestion chips under a Code converter. Chips that
 * carry a mutated code load it into the converter on click; prose-only
 * items render as plain text.
 */
import type { TryItem } from "./core.js";

export function renderTryList(container: HTMLElement, items: TryItem[], apply: (code: string) => void): void {
  container.innerHTML = "";
  if (items.length === 0) return;
  const lead = document.createElement("span");
  lead.textContent = "Try: ";
  container.appendChild(lead);
  items.forEach((item, i) => {
    if (i > 0) container.appendChild(document.createTextNode("; "));
    if (item.code !== undefined) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "try";
      b.textContent = item.label;
      b.title = item.code;
      b.addEventListener("click", () => apply(item.code!));
      container.appendChild(b);
    } else {
      container.appendChild(document.createTextNode(item.label));
    }
  });
}
