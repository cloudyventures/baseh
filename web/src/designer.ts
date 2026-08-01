import { design, exportDesign, parseRequired, sampleCodes, type DesignerInput, type ProfanityMode, type SafetyLevel, type Candidate } from "./core.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  required: $<HTMLInputElement>("required"),
  dRecords: $<HTMLInputElement>("d-records"),
  dRetention: $<HTMLInputElement>("d-retention"),
  maxLen: $<HTMLInputElement>("max-len"),
  separator: $<HTMLInputElement>("d-separator"),
  minCheck: $<HTMLSelectElement>("min-check"),
  maxUtil: $<HTMLSelectElement>("max-util"),
  visual: $<HTMLSelectElement>("d-visual"),
  spoken: $<HTMLSelectElement>("d-spoken"),
  profanity: $<HTMLSelectElement>("d-profanity"),
  allowAlnum: $<HTMLInputElement>("allow-alnum"),
  allowUpper: $<HTMLInputElement>("allow-upper"),
  allowDigits: $<HTMLInputElement>("allow-digits"),
  recommended: $("recommended"),
  repair: $("repair"),
  alternatives: $("alternatives"),
  tbody: document.querySelector("#candidates tbody") as HTMLElement,
  exportBtn: $<HTMLButtonElement>("d-export")
};

const UNITS: Array<[bigint, string]> = [
  [1_000_000_000_000n, "T"],
  [1_000_000_000n, "B"],
  [1_000_000n, "M"]
];

function fmt(n: bigint): string {
  if (n <= 999_999n) return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  for (const [scale, suffix] of UNITS) {
    if (n >= scale) {
      const tenths = (n * 10n + scale / 2n) / scale;
      const frac = tenths % 10n;
      const body = frac === 0n ? `${tenths / 10n}` : `${tenths / 10n}.${frac}`;
      return `${body}${suffix}`;
    }
  }
  return n.toString();
}

function fmtFull(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function readInput(): DesignerInput | null {
  const requiredCapacity = parseRequired(els.required.value);
  if (requiredCapacity === null) return null;
  const num = (el: HTMLInputElement): bigint | undefined =>
    el.value.trim() === "" ? undefined : BigInt(Math.max(0, Math.floor(Number(el.value))));
  return {
    requiredCapacity,
    recordsPerDay: num(els.dRecords),
    retentionDays: num(els.dRetention),
    peakMultiplier: 1.25,
    safetyMargin: 2.0,
    maxDisplayedLength: Number(els.maxLen.value),
    minimumChecksumLength: Number(els.minCheck.value),
    maxUtilization: Number(els.maxUtil.value),
    separator: els.separator.value.trim(),
    allowDigits: els.allowDigits.checked,
    allowUpper: els.allowUpper.checked,
    allowAlnum: els.allowAlnum.checked,
    visualSafety: els.visual.value as SafetyLevel,
    spokenSafety: els.spoken.value as SafetyLevel,
    profanity: els.profanity.value as ProfanityMode
  };
}

function sampleLine(s: { id: string; code: string; blocked?: boolean }): string {
  let title: string;
  let marker: string;
  if (s.id === "0") {
    title = "Identifier 0: the first number in the space. Its code shows what the all-leading-symbols shape looks like.";
    marker = "0";
  } else if (s.id === "1") {
    title = "Identifier 1: the second number in the space. Its code shows what changes between adjacent identifiers.";
    marker = "1";
  } else {
    title = "Identifier infinity: the highest number this design can issue (its capacity minus one). Its code shows what the very last codes look like.";
    marker = "&infin;";
  }
  const rendered = s.blocked
    ? `<span class="muted">blocked: this identifier spells a profanity and is never issued</span>`
    : `<code>${s.code}</code>`;
  return `<div title="${title}">${marker}: ${rendered}</div>`;
}

function card(c: Candidate, label?: string): string {
  const samples = sampleCodes(c.alphabet, c.bodyLength, c.checksumLength, c.capacity, c.spoken, c.separator, c.profanity)
    .map(sampleLine)
    .join("");
  return `<div class="card alt-card">
    ${label ? `<div class="label">${label}</div>` : ""}
    <div class="big">${c.bodyLength} body + ${c.checksumLength} check</div>
    <div>Capacity: <strong title="${fmtFull(c.capacity)}">${fmt(c.capacity)}</strong></div>
    <div>Utilization: ${(c.utilization * 100).toFixed(1)}% &middot; Displayed: ${c.displayedLength} chars</div>
    <div>Alphabet: ${c.alphabetId} (${c.alphabetSize} symbols)</div>
    ${samples ? `<div class="samples">${samples}</div>` : ""}
  </div>`;
}

function render() {
  const input = readInput();
  if (!input) {
    els.recommended.innerHTML = "";
    els.repair.innerHTML = "<p>Enter a required capacity of at least 1 (digits only).</p>";
    els.alternatives.innerHTML = "";
    els.tbody.innerHTML = "";
    return;
  }
  const result = design(input);
  els.recommended.innerHTML = result.recommended
    ? card(result.recommended, "Recommended")
    : "";
  els.repair.innerHTML = result.repair ? `<p>${result.repair}</p>` : "";
  els.alternatives.innerHTML = result.alternatives.map((a) => card(a.candidate, a.label)).join("")
    || (result.recommended ? "" : "");
  els.tbody.innerHTML = result.feasible.slice(0, 25).map((c) => `
    <tr>
      <td>${c === result.recommended ? `<span class="badge green">recommended</span>` : ""}</td>
      <td>${c.bodyLength}+${c.checksumLength}</td>
      <td title="${fmtFull(c.capacity)}">${fmt(c.capacity)}</td>
      <td>${(c.utilization * 100).toFixed(1)}%</td>
      <td>${c.displayedLength}</td>
      <td><code>${sampleCodes(c.alphabet, c.bodyLength, c.checksumLength, c.capacity, c.spoken, c.separator, c.profanity).find((s) => s.id === "0")?.code ?? ""}</code></td>
      <td>${c.reason}</td>
    </tr>`).join("");
  els.exportBtn.onclick = async () => {
    await navigator.clipboard.writeText(exportDesign(input, result));
    els.exportBtn.textContent = "Copied";
    setTimeout(() => (els.exportBtn.textContent = "Copy export JSON"), 1200);
  };
}

for (const el of [els.required, els.dRecords, els.dRetention, els.maxLen, els.separator, els.minCheck,
  els.maxUtil, els.visual, els.spoken, els.profanity, els.allowAlnum, els.allowUpper, els.allowDigits]) {
  el.addEventListener("input", render);
}
// When the user leaves the required field, restate their number in the
// standard display format ("60000000" and "60m" both become "60M").
els.required.addEventListener("change", () => {
  const value = parseRequired(els.required.value);
  if (value !== null) els.required.value = fmt(value);
});
render();
