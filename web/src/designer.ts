import { candidateProfile, design, deriveAlphabet, deriveChecksumAlphabet, exportDesign, friendlyError, parseRequired, powBigInt, sampleCodes, spokenPairsThrough, type DesignerInput, type ProfanityMode, type SafetyLevel, type Candidate } from "./core.js";
import { Baseh } from "@cloudyventures/baseh";

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
  spokenDrops: $("d-spoken-drops"),
  profanity: $<HTMLSelectElement>("d-profanity"),
  permutation: $<HTMLInputElement>("d-permutation"),
  allowAlnum: $<HTMLInputElement>("allow-alnum"),
  allowUpper: $<HTMLInputElement>("allow-upper"),
  allowDigits: $<HTMLInputElement>("allow-digits"),
  convId: $<HTMLInputElement>("d-conv-id"),
  convIdOut: $("d-conv-id-out"),
  convCode: $<HTMLInputElement>("d-conv-code"),
  convCodeOut: $("d-conv-code-out"),
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
    profanity: els.profanity.value as ProfanityMode,
    permutation: els.permutation.checked
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
    ? `<span class="muted" title="This identifier spells a profanity and is never issued.">blocked</span>`
    : `<code>${s.code}</code>`;
  return `<span class="sample" title="${title}">${marker} ${rendered}</span>`;
}

// The share of displayed strings whose checksum accidentally validates.
function collisionRate(c: Candidate, input: DesignerInput): string {
  if (c.checksumLength === 0) return "100%";
  const size = deriveChecksumAlphabet(c.alphabet, input.spokenSafety, c.profanity).length;
  const pct = 100 / Number(powBigInt(BigInt(size), c.checksumLength));
  if (pct >= 0.1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return "<0.01%";
}

function card(c: Candidate, permutation: boolean, label?: string): string {
  const samples = sampleCodes(c.alphabet, c.bodyLength, c.checksumLength, c.capacity, c.spoken, c.separator, c.profanity, permutation)
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
    els.convIdOut.textContent = "";
    els.convCodeOut.textContent = "";
    return;
  }
  const result = design(input);
  // Tell the user exactly which letters spoken safety removes, for the
  // alphanumeric alphabet under the current visual safety setting; other
  // alphabets drop the same letters when they contain them.
  {
    const preSpoken = deriveAlphabet("alnum", "", input.visualSafety, "none", input.profanity);
    const pairs = spokenPairsThrough(input.spokenSafety).filter(([keep]) => preSpoken.includes(keep));
    els.spokenDrops.textContent = input.spokenSafety === "none"
      ? ""
      : pairs.length === 0
        ? "No spoken drops apply with the current safety settings."
        : `Removes from the alphabet: ${pairs.map(([keep, drop]) => `${drop} (read as ${keep})`).join(", ")}.`;
  }
  els.recommended.innerHTML = result.recommended
    ? card(result.recommended, input.permutation, "Recommended")
    : "";
  els.repair.innerHTML = result.repair ? `<p>${result.repair}</p>` : "";
  els.alternatives.innerHTML = result.alternatives.map((a) => card(a.candidate, input.permutation, a.label)).join("")
    || (result.recommended ? "" : "");
  els.tbody.innerHTML = result.feasible.slice(0, 25).map((c) => `
    <tr>
      <td>${c === result.recommended ? `<span class="badge green">recommended</span>` : ""}</td>
      <td>${c.bodyLength}+${c.checksumLength}</td>
      <td title="${fmtFull(c.capacity)}">${fmt(c.capacity)}</td>
      <td>${(c.utilization * 100).toFixed(1)}%</td>
      <td>${c.displayedLength}</td>
      <td>${collisionRate(c, input)}</td>
      <td><code>${sampleCodes(c.alphabet, c.bodyLength, c.checksumLength, c.capacity, c.spoken, c.separator, c.profanity, input.permutation).find((s) => s.id === "0")?.code ?? ""}</code></td>
      <td>${c.reason}</td>
    </tr>`).join("");
  els.exportBtn.onclick = async () => {
    await navigator.clipboard.writeText(exportDesign(input, result));
    els.exportBtn.textContent = "Copied";
    setTimeout(() => (els.exportBtn.textContent = "Copy export JSON"), 1200);
  };

  // Live conversion against the recommended candidate's profile.
  let h: Baseh | null = null;
  if (result.recommended) {
    try {
      h = new Baseh(candidateProfile(result.recommended, input.permutation));
    } catch {
      h = null;
    }
  }
  const idRaw = els.convId.value.trim();
  if (idRaw === "") {
    els.convIdOut.textContent = "";
  } else if (!/^[0-9]+$/.test(idRaw)) {
    els.convIdOut.textContent = "an identifier is a non-negative integer, digits only";
  } else if (!h) {
    els.convIdOut.textContent = "no feasible design to convert with";
  } else {
    try {
      els.convIdOut.innerHTML = "";
      const out = document.createElement("code");
      out.textContent = h.encode(BigInt(idRaw));
      els.convIdOut.appendChild(out);
    } catch (e) {
      els.convIdOut.textContent = friendlyError(e);
    }
  }
  const codeRaw = els.convCode.value.replace(/\s+/g, "");
  if (codeRaw === "") {
    els.convCodeOut.textContent = "";
  } else if (!h) {
    els.convCodeOut.textContent = "no feasible design to convert with";
  } else {
    try {
      els.convCodeOut.textContent = `identifier ${h.decode(codeRaw).id}`;
    } catch (e) {
      els.convCodeOut.textContent = friendlyError(e);
    }
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(readState()));
  } catch {
    // Storage full or disabled: persistence is best effort.
  }
}

for (const el of [els.required, els.dRecords, els.dRetention, els.maxLen, els.separator, els.minCheck,
  els.maxUtil, els.visual, els.spoken, els.profanity, els.permutation, els.allowAlnum, els.allowUpper, els.allowDigits,
  els.convId, els.convCode]) {
  el.addEventListener("input", render);
}
// When the user leaves the required field, restate their number in the
// standard display format ("60000000" and "60m" both become "60M").
els.required.addEventListener("change", () => {
  const value = parseRequired(els.required.value);
  if (value !== null) els.required.value = fmt(value);
});

// Settings persist through page refresh (sessionStorage) but not across
// a close and reopen: the tab's session store is what we write to.
const STORAGE_KEY = "baseh-designer-state";

interface SavedState {
  required: string;
  recordsPerDay: string;
  retentionDays: string;
  maxLen: string;
  separator: string;
  minCheck: string;
  maxUtil: string;
  visual: string;
  spoken: string;
  profanity: string;
  permutation: boolean;
  allowAlnum: boolean;
  allowUpper: boolean;
  allowDigits: boolean;
  convId: string;
  convCode: string;
}

function readState(): SavedState {
  return {
    required: els.required.value,
    recordsPerDay: els.dRecords.value,
    retentionDays: els.dRetention.value,
    maxLen: els.maxLen.value,
    separator: els.separator.value,
    minCheck: els.minCheck.value,
    maxUtil: els.maxUtil.value,
    visual: els.visual.value,
    spoken: els.spoken.value,
    profanity: els.profanity.value,
    permutation: els.permutation.checked,
    allowAlnum: els.allowAlnum.checked,
    allowUpper: els.allowUpper.checked,
    allowDigits: els.allowDigits.checked,
    convId: els.convId.value,
    convCode: els.convCode.value
  };
}

function applyState(s: SavedState) {
  els.required.value = s.required;
  els.dRecords.value = s.recordsPerDay;
  els.dRetention.value = s.retentionDays;
  els.maxLen.value = s.maxLen;
  els.separator.value = s.separator;
  els.minCheck.value = s.minCheck;
  els.maxUtil.value = s.maxUtil;
  els.visual.value = s.visual;
  els.spoken.value = s.spoken;
  els.profanity.value = s.profanity;
  els.permutation.checked = s.permutation;
  els.allowAlnum.checked = s.allowAlnum;
  els.allowUpper.checked = s.allowUpper;
  els.allowDigits.checked = s.allowDigits;
  els.convId.value = s.convId;
  els.convCode.value = s.convCode;
}

try {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) applyState(JSON.parse(raw) as SavedState);
} catch {
  // Corrupt or unavailable storage falls back to the markup defaults.
}
// Whatever the required field holds (markup default or restored state),
// show it in the compact form so big values never read as walls of zeroes.
{
  const initial = parseRequired(els.required.value);
  if (initial !== null) els.required.value = fmt(initial);
}
render();
