/**
 * Renders the "Try" suggestion chips under a Code converter. Chips that
 * carry a mutated code load it into the converter on click; prose-only
 * items render as plain text.
 */
import type { CodeLookup, TryItem } from "./core.js";

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

/**
 * Renders the Code converter's output note from a {@link lookupCode} result,
 * following the cookbook's state-to-UI table: typing stays neutral, bad-char
 * and too-long name the problem, invalid shows the reason-keyed message and
 * ok shows the identifier (with the amended code when correction fixed it).
 */
export function renderCodeLookup(container: HTMLElement, lookup: CodeLookup): void {
  container.innerHTML = "";
  switch (lookup.kind) {
    case "empty": return;
    case "typing":
      container.textContent = `${lookup.typed} — keep typing (${Math.round(lookup.progress * 100)}%)`;
      return;
    case "bad-char":
      container.textContent = "contains characters outside this alphabet";
      return;
    case "too-long":
      container.textContent = "more characters than this configuration's codes have";
      return;
    case "invalid":
      container.textContent = lookup.message;
      return;
    case "ok": {
      const lab = document.createElement("span");
      lab.textContent = "Identifier: ";
      const val = document.createElement("code");
      val.textContent = String(lookup.id);
      if (lookup.corrected) {
        const canonical = document.createElement("code");
        canonical.textContent = lookup.canonicalCode;
        container.append(lab, val, " - corrected to ", canonical);
      } else {
        container.append(lab, val);
      }
    }
  }
}
