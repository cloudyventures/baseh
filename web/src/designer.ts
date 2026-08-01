import { design, exportDesign, sampleCodes, type DesignerInput, type SafetyLevel, type Candidate } from "./core.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  required: $<HTMLInputElement>("required"),
  dRecords: $<HTMLInputElement>("d-records"),
  dRetention: $<HTMLInputElement>("d-retention"),
  maxLen: $<HTMLInputElement>("max-len"),
  minCheck: $<HTMLSelectElement>("min-check"),
  maxUtil: $<HTMLSelectElement>("max-util"),
  visual: $<HTMLSelectElement>("d-visual"),
  spoken: $<HTMLSelectElement>("d-spoken"),
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
  const reqDigits = els.required.value.replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(reqDigits) || BigInt(reqDigits || "0") < 1n) return null;
  const num = (el: HTMLInputElement): bigint | undefined =>
    el.value.trim() === "" ? undefined : BigInt(Math.max(0, Math.floor(Number(el.value))));
  return {
    requiredCapacity: BigInt(reqDigits),
    recordsPerDay: num(els.dRecords),
    retentionDays: num(els.dRetention),
    peakMultiplier: 1.25,
    safetyMargin: 2.0,
    maxDisplayedLength: Number(els.maxLen.value),
    minimumChecksumLength: Number(els.minCheck.value),
    maxUtilization: Number(els.maxUtil.value),
    allowDigits: els.allowDigits.checked,
    allowUpper: els.allowUpper.checked,
    allowAlnum: els.allowAlnum.checked,
    visualSafety: els.visual.value as SafetyLevel,
    spokenSafety: els.spoken.value as SafetyLevel
  };
}

function card(c: Candidate, label?: string): string {
  const samples = sampleCodes(c.alphabet, c.bodyLength, c.checksumLength, c.capacity, c.spoken)
    .map((s) => `${fmt(BigInt(s.id))}: <code>${s.code}</code>`)
    .join(" &middot; ");
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
      <td>${c.reason}</td>
    </tr>`).join("");
  els.exportBtn.onclick = async () => {
    await navigator.clipboard.writeText(exportDesign(input, result));
    els.exportBtn.textContent = "Copied";
    setTimeout(() => (els.exportBtn.textContent = "Copy export JSON"), 1200);
  };
}

for (const el of [els.required, els.dRecords, els.dRetention, els.maxLen, els.minCheck,
  els.maxUtil, els.visual, els.spoken, els.allowAlnum, els.allowUpper, els.allowDigits]) {
  el.addEventListener("input", render);
}
render();
