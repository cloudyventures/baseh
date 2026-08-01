import { calculate, type CalculatorInput, type AlphabetMode, type ProfanityMode, type SafetyLevel, deriveChecksumAlphabet } from "./core.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  preset: $<HTMLSelectElement>("preset"),
  namespace: $<HTMLInputElement>("namespace"),
  mode: $<HTMLSelectElement>("alphabet-mode"),
  customRow: $("custom-alpha-row"),
  customAlpha: $<HTMLInputElement>("custom-alphabet"),
  visual: $<HTMLSelectElement>("visual-safety"),
  spoken: $<HTMLSelectElement>("spoken-safety"),
  profanity: $<HTMLSelectElement>("profanity-mode"),
  bodyLen: $<HTMLInputElement>("body-length"),
  bodyLenOut: $("body-length-out"),
  checksumLen: $<HTMLSelectElement>("checksum-length"),
  separator: $<HTMLInputElement>("separator"),
  records: $<HTMLInputElement>("records"),
  retention: $<HTMLInputElement>("retention"),
  peak: $<HTMLInputElement>("peak"),
  margin: $<HTMLInputElement>("margin"),
  summary: $("summary"),
  alphaSize: $("alpha-size"),
  alphaView: $("alpha-view"),
  examplesBody: document.querySelector("#examples tbody") as HTMLElement,
  fitOut: $("fit-out"),
  problems: $("problems"),
  copyJson: $<HTMLButtonElement>("copy-json"),
  copyUrl: $<HTMLButtonElement>("copy-url"),
  reset: $<HTMLButtonElement>("reset")
};

const PRESETS: Record<string, Partial<typeof state>> = {
  "compact-numeric": { mode: "digits", visual: "none", bodyLength: 6, checksumLength: 1 },
  "safe-alnum": { mode: "alnum", visual: "heavy", bodyLength: 6, checksumLength: 1 },
  "short-support": { mode: "alnum", visual: "heavy", bodyLength: 5, checksumLength: 1 },
  "high-validation": { mode: "alnum", visual: "heavy", bodyLength: 6, checksumLength: 2 }
};

const state = {
  mode: "alnum" as AlphabetMode,
  visual: "light" as SafetyLevel,
  spoken: "light" as SafetyLevel,
  bodyLength: 6,
  checksumLength: 1
};

function fmt(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function readInput(): CalculatorInput {
  const num = (el: HTMLInputElement): bigint | undefined =>
    el.value.trim() === "" ? undefined : BigInt(Math.max(0, Math.floor(Number(el.value))));
  return {
    namespace: els.namespace.value,
    alphabetMode: els.mode.value as AlphabetMode,
    customAlphabet: els.customAlpha.value,
    visualSafety: els.visual.value as SafetyLevel,
    spokenSafety: els.spoken.value as SafetyLevel,
    profanity: els.profanity.value as ProfanityMode,
    bodyLength: Number(els.bodyLen.value),
    checksumLength: Number(els.checksumLen.value),
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
  Object.assign(state, p);
  els.mode.value = state.mode;
  els.visual.value = state.visual;
  els.bodyLen.value = String(state.bodyLength);
  els.checksumLen.value = String(state.checksumLength);
  render();
}

function render() {
  const input = readInput();
  els.customRow.hidden = input.alphabetMode !== "custom" && input.visualSafety !== "none";
  els.bodyLenOut.textContent = String(input.bodyLength);
  const r = calculate(input);

  els.alphaSize.textContent = String(r.alphabet.length);
  els.alphaView.textContent = r.alphabet;
  els.summary.innerHTML = `
    <div class="big">${fmt(r.capacity)}</div>
    <div>valid references</div>
    <div>${r.displayedLength} displayed characters &middot; ${r.bits} bits of capacity</div>
    <div>checksum false acceptance ${r.falseAcceptance}${
      input.checksumLength > 0
        ? ` <span class="badge ${r.checksumStates === 26n ? "amber" : "green"}">${
            r.checksumStates === 26n ? "structured gaps, see spec 6.3" : "total single-substitution detection"
          }</span>`
        : ""
    }</div>`;

  els.examplesBody.innerHTML = r.examples
    .map((e) => `<tr><td>${e.id}</td><td>${e.blocked
        ? `<span class="muted">blocked: spells a profanity, never issued</span>`
        : `<code>${e.code}</code>`}</td></tr>`)
    .join("");

  let fit = "";
  if (r.required !== null) {
    fit += `<div>Required: <strong>${fmt(r.required)}</strong></div>`;
    fit += `<div>Utilization: ${r.utilization?.toFixed(2)}% <span class="badge ${r.utilizationStatus}">${r.utilizationStatus}</span></div>`;
  }
  if (r.lifetimeDays !== null) {
    const years = Number(r.lifetimeDays) / 365.25;
    fit += `<div>Lifetime at current rate: ${fmt(r.lifetimeDays)} days${years < 1e6 ? ` (about ${years.toFixed(1)} years)` : ""}</div>`;
  }
  if (input.checksumLength === 0) fit += `<div class="warn">No checksum: typing errors cannot be detected reliably.</div>`;
  els.fitOut.innerHTML = fit || "<div>Enter demand figures to see utilization and lifetime.</div>";

  els.problems.innerHTML = r.problems.map((p) => `<p>${p}</p>`).join("");
  els.copyJson.disabled = !r.valid;
}

els.copyJson.addEventListener("click", async () => {
  const input = readInput();
  const r = calculate(input);
  await navigator.clipboard.writeText(JSON.stringify({
    profileId: "draft-from-calculator",
    bodyAlphabet: r.alphabet,
    bodyLength: input.bodyLength,
    checksumAlphabet: deriveChecksumAlphabet(r.alphabet, input.spokenSafety, input.profanity),
    checksumLength: input.checksumLength,
    caseSensitive: false,
    separator: input.separator,
    profanity: input.profanity === "none" ? undefined : { mode: input.profanity },
    permutation: { enabled: false }
  }, null, 2));
  els.copyJson.textContent = "Copied";
  setTimeout(() => (els.copyJson.textContent = "Copy profile JSON"), 1200);
});

els.copyUrl.addEventListener("click", async () => {
  const input = readInput();
  const params = new URLSearchParams({
    mode: input.alphabetMode,
    visual: input.visualSafety,
    body: String(input.bodyLength),
    check: String(input.checksumLength)
  });
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}?${params}`);
  els.copyUrl.textContent = "Copied";
  setTimeout(() => (els.copyUrl.textContent = "Copy URL"), 1200);
});

els.reset.addEventListener("click", () => applyPreset(els.preset.value || "safe-alnum"));
els.preset.addEventListener("change", () => applyPreset(els.preset.value));
for (const el of [els.namespace, els.mode, els.customAlpha, els.visual, els.spoken, els.profanity, els.bodyLen,
  els.checksumLen, els.separator, els.records, els.retention, els.peak, els.margin]) {
  el.addEventListener("input", render);
}

// Restore shareable state from the URL.
{
  const q = new URLSearchParams(location.search);
  if (q.get("mode")) els.mode.value = q.get("mode") as string;
  if (q.get("visual")) els.visual.value = q.get("visual") as string;
  if (q.get("body")) els.bodyLen.value = q.get("body") as string;
  if (q.get("check")) els.checksumLen.value = q.get("check") as string;
}
applyPreset(els.preset.value);
