import { calculate, calculatorProfile, deriveAlphabet, deriveChecksumAlphabet, deriveExpandableChecksumAlphabet, escapeHtml, friendlyError, parseIdentifier, spokenDropsExplainer, trySuggestions, visualDropsExplainer, type CalculatorInput, type AlphabetMode, type CodecMode, type ProfanityMode, type SafetyLevel } from "./core.js";
import { renderTryList } from "./try-list.js";
import { Baseh, type BasehProfile } from "@cloudyventures/baseh";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  preset: $<HTMLSelectElement>("preset"),
  codecMode: $<HTMLSelectElement>("codec-mode"),
  namespace: $<HTMLInputElement>("namespace"),
  mode: $<HTMLSelectElement>("alphabet-mode"),
  customRow: $("custom-alpha-row"),
  customAlpha: $<HTMLInputElement>("custom-alphabet"),
  visual: $<HTMLSelectElement>("visual-safety"),
  visualDrops: $("visual-drops"),
  spoken: $<HTMLSelectElement>("spoken-safety"),
  spokenDrops: $("spoken-drops"),
  profanity: $<HTMLSelectElement>("profanity-mode"),
  minLenRow: $("min-length-row"),
  minLen: $<HTMLInputElement>("min-length"),
  shortCheckRow: $("short-checksum-row"),
  shortCheck: $<HTMLSelectElement>("short-checksum"),
  shortCheckUntilRow: $("short-checksum-until-row"),
  shortCheckUntil: $<HTMLSelectElement>("short-checksum-until"),
  sepMinRow: $("sep-min-length-row"),
  sepMinLen: $<HTMLInputElement>("sep-min-length"),
  bodyRow: $("body-length-row"),
  bodyLen: $<HTMLInputElement>("body-length"),
  bodyLenOut: $("body-length-out"),
  checksumLen: $<HTMLSelectElement>("checksum-length"),
  maxRep: $<HTMLSelectElement>("max-repetition"),
  permutation: $<HTMLInputElement>("permutation"),
  separator: $<HTMLInputElement>("separator"),
  records: $<HTMLInputElement>("records"),
  retention: $<HTMLInputElement>("retention"),
  peak: $<HTMLInputElement>("peak"),
  margin: $<HTMLInputElement>("margin"),
  summary: $("summary"),
  alphaSize: $("alpha-size"),
  alphaView: $("alpha-view"),
  examplesBody: document.querySelector("#examples tbody") as HTMLElement,
  convId: $<HTMLInputElement>("conv-id"),
  convIdOut: $("conv-id-out"),
  convCode: $<HTMLInputElement>("conv-code"),
  convCodeOut: $("conv-code-out"),
  convTry: $("conv-try"),
  fitOut: $("fit-out"),
  problems: $("problems"),
  copyJson: $<HTMLButtonElement>("copy-json"),
  copyUrl: $<HTMLButtonElement>("copy-url"),
  reset: $<HTMLButtonElement>("reset")
};

interface Preset {
  codecMode: CodecMode;
  mode: AlphabetMode;
  visual: SafetyLevel;
  spoken: SafetyLevel;
  profanity: ProfanityMode;
  bodyLength: number;
  checksumLength: number;
  /** Spec 22.5: the frozen expandable tier ships 1 short checksum through length 5. */
  shortChecksumLength: number;
  shortChecksumUntil: number;
  separator: string;
}

// The frozen tiers. Every control stays editable after loading one,
// so a preset is a starting point you modify, not a locked view.
const PRESETS: Record<string, Preset> = {
  expandable: { codecMode: "expandable", mode: "alnum", visual: "none", spoken: "none", profanity: "blocklist", bodyLength: 4, checksumLength: 2, shortChecksumLength: 1, shortChecksumUntil: 5, separator: "-" },
  minimum: { codecMode: "fixed", mode: "alnum", visual: "none", spoken: "none", profanity: "blocklist", bodyLength: 6, checksumLength: 0, shortChecksumLength: 0, shortChecksumUntil: 0, separator: "-" },
  light: { codecMode: "fixed", mode: "alnum", visual: "light", spoken: "light", profanity: "blocklist", bodyLength: 6, checksumLength: 2, shortChecksumLength: 0, shortChecksumUntil: 0, separator: "-" },
  medium: { codecMode: "fixed", mode: "alnum", visual: "medium", spoken: "medium", profanity: "blocklist", bodyLength: 6, checksumLength: 2, shortChecksumLength: 0, shortChecksumUntil: 0, separator: "-" },
  heavy: { codecMode: "fixed", mode: "alnum", visual: "heavy", spoken: "heavy", profanity: "blocklist", bodyLength: 6, checksumLength: 2, shortChecksumLength: 0, shortChecksumUntil: 0, separator: "-" }
};

function fmt(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Example ids that land exactly on a power of ten read better compact
// ("1M", "100T"); anything else keeps the full grouped digits.
function fmtExampleId(id: string): string {
  const n = BigInt(id);
  for (const [scale, suffix] of [[1_000_000_000_000n, "T"], [1_000_000_000n, "B"], [1_000_000n, "M"]] as const) {
    if (n >= scale && n % scale === 0n) return `${n / scale}${suffix}`;
  }
  return fmt(n);
}

function readInput(): CalculatorInput {
  const num = (el: HTMLInputElement): bigint | undefined =>
    el.value.trim() === "" ? undefined : BigInt(Math.max(0, Math.floor(Number(el.value))));
  return {
    namespace: els.namespace.value,
    codecMode: els.codecMode.value as CodecMode,
    alphabetMode: els.mode.value as AlphabetMode,
    customAlphabet: els.customAlpha.value,
    visualSafety: els.visual.value as SafetyLevel,
    spokenSafety: els.spoken.value as SafetyLevel,
    profanity: els.profanity.value as ProfanityMode,
    bodyLength: Number(els.bodyLen.value),
    minLength: Number(els.minLen.value),
    separatorMinLength: Number(els.sepMinLen.value),
    checksumLength: Number(els.checksumLen.value),
    // Spec 22. The window select is the switch (0 = off); a length of 0 inside
    // a window is the zero-checksum window (all body, no typo detection there).
    shortChecksumLength: els.shortCheck.value === "off" || Number(els.shortCheckUntil.value) === 0 ? 0 : Number(els.shortCheck.value),
    shortChecksumUntil: els.shortCheck.value === "off" ? 0 : Number(els.shortCheckUntil.value),
    maxRepetition: Number(els.maxRep.value),
    permutation: els.permutation.checked,
    separator: els.separator.value,
    prefix: "",
    suffix: "",
    recordsPerDay: num(els.records),
    retentionDays: num(els.retention),
    peakMultiplier: Number(els.peak.value) || 1.25,
    safetyMargin: Number(els.margin.value) || 2.0
  };
}

function applyPreset(name: string) {
  const p = PRESETS[name];
  if (!p) return;
  els.codecMode.value = p.codecMode;
  els.mode.value = p.mode;
  els.visual.value = p.visual;
  els.spoken.value = p.spoken;
  els.profanity.value = p.profanity;
  els.bodyLen.value = String(p.bodyLength);
  els.checksumLen.value = String(p.checksumLength);
  // A tier with the feature off selects "off"; a zero-checksum window would select "0".
  els.shortCheck.value = p.shortChecksumUntil === 0 ? "off" : String(p.shortChecksumLength);
  els.shortCheckUntil.value = String(p.shortChecksumUntil);
  if (els.shortCheckUntil.value !== String(p.shortChecksumUntil)) els.shortCheckUntil.value = "5";
  els.separator.value = p.separator;
  // Every frozen tier ships maxRepetition 4 (spec 21.4).
  els.maxRep.value = "4";
  // Every frozen tier permutes with the published key, so its preset starts
  // with the preview on to match.
  els.permutation.checked = true;
  render();
}

function render() {
  const input = readInput();
  els.customRow.hidden = input.alphabetMode !== "custom" && input.visualSafety !== "none";
  els.minLenRow.hidden = input.codecMode !== "expandable";
  els.sepMinRow.hidden = input.codecMode !== "expandable";
  els.shortCheckRow.hidden = input.codecMode !== "expandable";
  els.shortCheckUntilRow.hidden = input.codecMode !== "expandable" || els.shortCheck.value === "off";
  {
    // The short length is bounded by checksumLength - 1 (spec 22.2); options
    // the current checksum length can't host are disabled.
    for (const opt of els.shortCheck.options) {
      opt.disabled = opt.value !== "off" && Number(opt.value) >= input.checksumLength;
    }
    // The window runs from minLength through 8 (spec 22.2).
    for (const opt of els.shortCheckUntil.options) {
      opt.disabled = Number(opt.value) !== 0 && (Number(opt.value) < input.minLength || Number(opt.value) > 8);
    }
  }
  els.bodyRow.hidden = input.codecMode === "expandable";
  els.bodyLenOut.textContent = String(input.bodyLength);
  {
    const beforeVisual = deriveAlphabet(input.alphabetMode, input.customAlphabet, "none", "none", input.profanity);
    const afterVisual = deriveAlphabet(input.alphabetMode, input.customAlphabet, input.visualSafety, "none", input.profanity);
    els.visualDrops.textContent = input.visualSafety === "none" ? "" : visualDropsExplainer(beforeVisual, afterVisual, input.visualSafety);
    els.spokenDrops.textContent = spokenDropsExplainer(afterVisual, input.spokenSafety);
  }
  const r = calculate(input);

  els.alphaSize.textContent = String(r.alphabet.length);
  els.alphaView.textContent = r.alphabet;
  // Spec 21.5: capacity() is unchanged by the filter, so the note states
  // its existence rather than subtracting the (negligible) blocked share.
  const repNote = input.maxRepetition > 0
    ? `<div class="muted">Repetition filter on: codes with a run of ${input.maxRepetition}+ identical symbols are never issued; the capacity above still counts them (well under 0.5% of ids).</div>`
    : "";
  if (r.generations) {
    // Spec 22: when the short checksum is on the effective checksum length
    // varies per generation, so the table states it per row.
    const showCheck = r.generations.some((g) => g.checksum !== input.checksumLength);
    const rows = r.generations.map((g) =>
      `<tr><td>${g.length}</td>${showCheck ? `<td>${g.checksum}</td>` : ""}<td>${fmt(g.capacity)}</td><td>${fmt(g.cumulative)}</td></tr>`).join("");
    els.summary.innerHTML = `
      <div class="big">grows automatically <span class="unit">when a generation fills</span></div>
      <div>${r.displayedLength} displayed characters to start &middot; ${r.bits} bits of capacity at ${input.minLength}</div>
      <div>checksum false acceptance ${r.falseAcceptance}</div>
      <table class="gen-table">
        <thead><tr><th>Length</th>${showCheck ? "<th>Checksum</th>" : ""}<th>New IDs</th><th>Cumulative</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>${repNote}`;
  } else {
    els.summary.innerHTML = `
      <div class="big">${fmt(r.capacity)} <span class="unit">valid references</span></div>
      <div>${r.displayedLength} displayed characters &middot; ${r.bits} bits of capacity</div>
      <div>checksum false acceptance ${r.falseAcceptance}${
        input.checksumLength > 0
          ? ` <span class="badge ${r.checksumStates <= BigInt(r.alphabet.length - 1) ? "amber" : "green"}">${
              r.checksumStates <= BigInt(r.alphabet.length - 1) ? "structured gaps, see spec 6.3" : "total single-substitution detection"
            }</span>`
          : ""
      }</div>${repNote}`;
  }

  els.examplesBody.innerHTML = r.examples
    .map((e) => `<tr><td title="${fmt(BigInt(e.id))}">${fmtExampleId(e.id)}</td><td>${e.blocked
        ? `<span class="muted">blocked: never issued (profanity or a repetition run)</span>`
        : `<code>${escapeHtml(e.code)}</code>`}</td></tr>`)
    .join("");

  let fit = "";
  if (r.required !== null) {
    fit += `<div>Required: <strong>${fmt(r.required)}</strong></div>`;
    if (r.requiredGeneration !== null) {
      fit += `<div>Fits inside the length-${r.requiredGeneration} generation: ${r.utilization?.toFixed(2)}% of its cumulative range <span class="badge ${r.utilizationStatus}">${r.utilizationStatus}</span></div>`;
      fit += `<div class="muted">Codes stay ${input.minLength} characters until generation 1 fills, then grow one symbol at a time.</div>`;
    } else {
      fit += `<div>Utilization: ${r.utilization?.toFixed(2)}% <span class="badge ${r.utilizationStatus}">${r.utilizationStatus}</span></div>`;
    }
  }
  if (r.lifetimeDays !== null) {
    const years = Number(r.lifetimeDays) / 365.25;
    fit += r.generations
      ? `<div>Days to fill that generation at current rate: ${fmt(r.lifetimeDays)} days${years < 1e6 ? ` (about ${years.toFixed(1)} years)` : ""}; codes then grow by one character, they never run out</div>`
      : `<div>Lifetime at current rate: ${fmt(r.lifetimeDays)} days${years < 1e6 ? ` (about ${years.toFixed(1)} years)` : ""}</div>`;
  }
  if (input.checksumLength === 0) fit += `<div class="warn">No checksum: typing errors cannot be detected reliably.</div>`;
  else if (input.shortChecksumUntil > 0 && input.shortChecksumLength === 0) fit += `<div class="warn">Zero checksum through length ${input.shortChecksumUntil}: typing errors on those short codes cannot be detected.</div>`;
  els.fitOut.innerHTML = fit;
  els.fitOut.hidden = fit === "";

  els.problems.innerHTML = r.problems.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  els.copyJson.disabled = !r.valid;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(readState()));
  } catch {
    // Storage full or disabled: persistence is best effort.
  }

  // Live conversion against the same preview profile the examples use.
  let h: Baseh | null = null;
  let previewProfile: BasehProfile | null = null;
  if (r.valid) {
    try {
      previewProfile = calculatorProfile(input);
      h = previewProfile ? new Baseh(previewProfile) : null;
    } catch {
      h = null;
    }
  }
  const idRaw = els.convId.value.trim();
  const idParsed = idRaw === "" ? null : parseIdentifier(idRaw);
  if (idRaw === "") {
    els.convIdOut.textContent = "";
  } else if (idParsed === null) {
    els.convIdOut.textContent = "an identifier is a non-negative integer; K, M, G, B and T suffixes are fine (\"1.5M\")";
  } else if (!h) {
    els.convIdOut.textContent = "the configuration is invalid, fix it to convert";
  } else {
    try {
      els.convIdOut.innerHTML = "";
      const lab = document.createElement("span");
      lab.textContent = "Code: ";
      const out = document.createElement("code");
      out.textContent = h.encode(idParsed);
      els.convIdOut.append(lab, out);
    } catch (e) {
      els.convIdOut.textContent = friendlyError(e);
    }
  }
  const codeRaw = els.convCode.value.replace(/\s+/g, "");
  if (codeRaw === "") {
    els.convCodeOut.textContent = "";
  } else if (!h) {
    els.convCodeOut.textContent = "the configuration is invalid, fix it to convert";
  } else {
    try {
      const result = h.decode(codeRaw, { tryCorrection: true, confusionProfile: "heavy" });
      els.convCodeOut.innerHTML = "";
      const lab = document.createElement("span");
      lab.textContent = "Identifier: ";
      const val = document.createElement("code");
      val.textContent = String(result.id);
      if (result.corrected) {
        const canonical = document.createElement("code");
        canonical.textContent = result.canonicalCode;
        els.convCodeOut.append(lab, val, " - corrected to ", canonical);
      } else {
        els.convCodeOut.append(lab, val);
      }
    } catch (e) {
      els.convCodeOut.textContent = friendlyError(e);
    }
  }

  // Pertinent things to try against the Code converter, rebuilt from the
  // current configuration; the sample is the largest deterministic example,
  // so every chip lands on a real issued code.
  const sample = [...r.examples].reverse().find((e) => !e.blocked && e.code)?.code ?? null;
  renderTryList(els.convTry, previewProfile ? trySuggestions(previewProfile, sample, h ?? undefined) : [], (code) => {
    els.convCode.value = code;
    els.convCode.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

els.copyJson.addEventListener("click", async () => {
  const input = readInput();
  const r = calculate(input);
  const shared = {
    profileId: "draft-from-calculator",
    checksumLength: input.checksumLength,
    caseSensitive: false,
    separator: input.separator,
    maxRepetition: input.maxRepetition,
    profanity: input.profanity === "none" ? undefined : { mode: input.profanity },
    permutation: input.permutation
      ? { enabled: true, algorithm: "feistel-v1", keyId: "<your-key-id>", keyBytes: "<your-key-bytes>", rounds: 8 }
      : { enabled: false }
  };
  await navigator.clipboard.writeText(JSON.stringify(
    input.codecMode === "expandable"
      ? {
          ...shared,
          mode: "expandable",
          bodyAlphabet: r.alphabet,
          minLength: input.minLength,
          checksumAlphabet: deriveExpandableChecksumAlphabet(r.alphabet),
          separatorMinLength: input.separatorMinLength,
          ...(input.shortChecksumUntil > 0
            ? { shortChecksumLength: input.shortChecksumLength, shortChecksumUntil: input.shortChecksumUntil }
            : {}),
          grouping: []
        }
      : {
          ...shared,
          bodyAlphabet: r.alphabet,
          bodyLength: input.bodyLength,
          checksumAlphabet: deriveChecksumAlphabet(r.alphabet, input.spokenSafety, input.profanity)
        }, null, 2));
  els.copyJson.textContent = "Copied";
  setTimeout(() => (els.copyJson.textContent = "Copy profile JSON"), 1200);
});

els.copyUrl.addEventListener("click", async () => {
  const input = readInput();
  const params = new URLSearchParams({
    cmode: input.codecMode,
    mode: input.alphabetMode,
    visual: input.visualSafety,
    body: String(input.bodyLength),
    min: String(input.minLength),
    sepmin: String(input.separatorMinLength),
    check: String(input.checksumLength),
    short: input.shortChecksumUntil > 0 ? String(input.shortChecksumLength) : "off",
    shortuntil: String(input.shortChecksumUntil),
    perm: input.permutation ? "1" : "0"
  });
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}?${params}`);
  els.copyUrl.textContent = "Copied";
  setTimeout(() => (els.copyUrl.textContent = "Copy URL"), 1200);
});

els.reset.addEventListener("click", () => applyPreset(els.preset.value || "expandable"));
els.preset.addEventListener("change", () => applyPreset(els.preset.value));
for (const el of [els.namespace, els.codecMode, els.mode, els.customAlpha, els.visual, els.spoken, els.profanity, els.bodyLen,
  els.minLen, els.sepMinLen, els.checksumLen, els.shortCheck, els.shortCheckUntil, els.maxRep, els.permutation, els.separator, els.records, els.retention, els.peak, els.margin,
  els.convId, els.convCode]) {
  el.addEventListener("input", render);
}

// Settings persist through page refresh (sessionStorage) but not across
// a close and reopen: the tab's session store is what we write to.
const STORAGE_KEY = "baseh-calculator-state";

interface SavedState {
  namespace: string;
  codecMode: string;
  mode: string;
  customAlphabet: string;
  visual: string;
  spoken: string;
  profanity: string;
  bodyLength: string;
  minLength: string;
  separatorMinLength: string;
  checksumLength: string;
  shortChecksumLength: string;
  shortChecksumUntil: string;
  maxRepetition: string;
  permutation: boolean;
  separator: string;
  records: string;
  retention: string;
  peak: string;
  margin: string;
  convId: string;
  convCode: string;
}

function readState(): SavedState {
  return {
    namespace: els.namespace.value,
    codecMode: els.codecMode.value,
    mode: els.mode.value,
    customAlphabet: els.customAlpha.value,
    visual: els.visual.value,
    spoken: els.spoken.value,
    profanity: els.profanity.value,
    bodyLength: els.bodyLen.value,
    minLength: els.minLen.value,
    separatorMinLength: els.sepMinLen.value,
    checksumLength: els.checksumLen.value,
    shortChecksumLength: els.shortCheck.value,
    shortChecksumUntil: els.shortCheckUntil.value,
    maxRepetition: els.maxRep.value,
    permutation: els.permutation.checked,
    separator: els.separator.value,
    records: els.records.value,
    retention: els.retention.value,
    peak: els.peak.value,
    margin: els.margin.value,
    convId: els.convId.value,
    convCode: els.convCode.value
  };
}

function applyState(s: SavedState) {
  els.namespace.value = s.namespace;
  // Older stored states predate the mode and expandable controls; fall back
  // to the current control values when a field is missing.
  els.codecMode.value = s.codecMode ?? els.codecMode.value;
  els.mode.value = s.mode;
  els.customAlpha.value = s.customAlphabet;
  els.visual.value = s.visual;
  els.spoken.value = s.spoken;
  els.profanity.value = s.profanity;
  els.bodyLen.value = s.bodyLength;
  els.minLen.value = s.minLength ?? els.minLen.value;
  els.sepMinLen.value = s.separatorMinLength ?? els.sepMinLen.value;
  els.checksumLen.value = s.checksumLength;
  // Older stored states predate the short checksum; keep the control default.
  // The pre-amendment control stored 0 for "off"; the amendment added a "0
  // symbols" zero-window option, so a stored 0 still maps to "off".
  els.shortCheck.value = s.shortChecksumLength === undefined || s.shortChecksumLength === "0" ? "off" : s.shortChecksumLength;
  els.shortCheckUntil.value = s.shortChecksumUntil ?? els.shortCheckUntil.value;
  // Older stored states predate the repetition filter; keep the control default.
  els.maxRep.value = s.maxRepetition ?? els.maxRep.value;
  els.permutation.checked = s.permutation;
  els.separator.value = s.separator;
  els.records.value = s.records;
  els.retention.value = s.retention;
  els.peak.value = s.peak;
  els.margin.value = s.margin;
  els.convId.value = s.convId;
  els.convCode.value = s.convCode;
}

{
  const q = new URLSearchParams(location.search);
  const hasParams = [...q.keys()].length > 0;
  if (hasParams) {
    // A shared link wins over stored state so the recipient sees exactly
    // what was copied.
    if (q.get("cmode")) els.codecMode.value = q.get("cmode") as string;
    if (q.get("mode")) els.mode.value = q.get("mode") as string;
    if (q.get("visual")) els.visual.value = q.get("visual") as string;
    if (q.get("body")) els.bodyLen.value = q.get("body") as string;
    if (q.get("min")) els.minLen.value = q.get("min") as string;
    if (q.get("sepmin")) els.sepMinLen.value = q.get("sepmin") as string;
    if (q.get("check")) els.checksumLen.value = q.get("check") as string;
    if (q.get("short")) els.shortCheck.value = q.get("short") as string;
    if (q.get("shortuntil")) els.shortCheckUntil.value = q.get("shortuntil") as string;
    // Legacy links stored short=0 for "off"; 0 only means the zero-checksum
    // window when a shortuntil accompanies it.
    if (q.get("short") === "0" && !q.get("shortuntil")) els.shortCheck.value = "off";
    if (q.get("perm")) els.permutation.checked = q.get("perm") === "1";
    render();
  } else {
    let restored = false;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        applyState(JSON.parse(raw) as SavedState);
        restored = true;
      }
    } catch {
      // Corrupt or unavailable storage falls back to the default preset.
    }
    if (restored) render();
    else applyPreset(els.preset.value || "expandable");
  }
}
