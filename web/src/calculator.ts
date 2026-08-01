import { calculate, calculatorProfile, friendlyError, type CalculatorInput, type AlphabetMode, type ProfanityMode, type SafetyLevel, deriveChecksumAlphabet } from "./core.js";
import { Baseh } from "@cloudyventures/baseh";

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
  fitOut: $("fit-out"),
  problems: $("problems"),
  copyJson: $<HTMLButtonElement>("copy-json"),
  copyUrl: $<HTMLButtonElement>("copy-url"),
  reset: $<HTMLButtonElement>("reset")
};

interface Preset {
  mode: AlphabetMode;
  visual: SafetyLevel;
  spoken: SafetyLevel;
  profanity: ProfanityMode;
  bodyLength: number;
  checksumLength: number;
  separator: string;
}

// The four frozen tiers. Every control stays editable after loading one,
// so a preset is a starting point you modify, not a locked view.
const PRESETS: Record<string, Preset> = {
  minimum: { mode: "alnum", visual: "none", spoken: "none", profanity: "blocklist", bodyLength: 6, checksumLength: 0, separator: "-" },
  light: { mode: "alnum", visual: "light", spoken: "light", profanity: "blocklist", bodyLength: 6, checksumLength: 1, separator: "" },
  medium: { mode: "alnum", visual: "medium", spoken: "medium", profanity: "blocklist", bodyLength: 6, checksumLength: 1, separator: "" },
  heavy: { mode: "alnum", visual: "heavy", spoken: "heavy", profanity: "blocklist", bodyLength: 6, checksumLength: 1, separator: "" }
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
  els.mode.value = p.mode;
  els.visual.value = p.visual;
  els.spoken.value = p.spoken;
  els.profanity.value = p.profanity;
  els.bodyLen.value = String(p.bodyLength);
  els.checksumLen.value = String(p.checksumLength);
  els.separator.value = p.separator;
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
    <div class="big">${fmt(r.capacity)} <span class="unit">valid references</span></div>
    <div>${r.displayedLength} displayed characters &middot; ${r.bits} bits of capacity</div>
    <div>checksum false acceptance ${r.falseAcceptance}${
      input.checksumLength > 0
        ? ` <span class="badge ${r.checksumStates <= BigInt(r.alphabet.length - 1) ? "amber" : "green"}">${
            r.checksumStates <= BigInt(r.alphabet.length - 1) ? "structured gaps, see spec 6.3" : "total single-substitution detection"
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
  els.fitOut.innerHTML = fit;
  els.fitOut.hidden = fit === "";

  els.problems.innerHTML = r.problems.map((p) => `<p>${p}</p>`).join("");
  els.copyJson.disabled = !r.valid;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(readState()));
  } catch {
    // Storage full or disabled: persistence is best effort.
  }

  // Live conversion against the same preview profile the examples use.
  let h: Baseh | null = null;
  if (r.valid) {
    try {
      const profile = calculatorProfile(input);
      h = profile ? new Baseh(profile) : null;
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
    els.convIdOut.textContent = "the configuration is invalid, fix it to convert";
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
    els.convCodeOut.textContent = "the configuration is invalid, fix it to convert";
  } else {
    try {
      els.convCodeOut.textContent = `identifier ${h.decode(codeRaw).id}`;
    } catch (e) {
      els.convCodeOut.textContent = friendlyError(e);
    }
  }
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
    permutation: input.permutation
      ? { enabled: true, algorithm: "feistel-v1", keyId: "<your-key-id>", keyBytes: "<your-key-bytes>", rounds: 8 }
      : { enabled: false }
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
    check: String(input.checksumLength),
    perm: input.permutation ? "1" : "0"
  });
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}?${params}`);
  els.copyUrl.textContent = "Copied";
  setTimeout(() => (els.copyUrl.textContent = "Copy URL"), 1200);
});

els.reset.addEventListener("click", () => applyPreset(els.preset.value || "medium"));
els.preset.addEventListener("change", () => applyPreset(els.preset.value));
for (const el of [els.namespace, els.mode, els.customAlpha, els.visual, els.spoken, els.profanity, els.bodyLen,
  els.checksumLen, els.permutation, els.separator, els.records, els.retention, els.peak, els.margin,
  els.convId, els.convCode]) {
  el.addEventListener("input", render);
}

// Settings persist through page refresh (sessionStorage) but not across
// a close and reopen: the tab's session store is what we write to.
const STORAGE_KEY = "baseh-calculator-state";

interface SavedState {
  namespace: string;
  mode: string;
  customAlphabet: string;
  visual: string;
  spoken: string;
  profanity: string;
  bodyLength: string;
  checksumLength: string;
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
    mode: els.mode.value,
    customAlphabet: els.customAlpha.value,
    visual: els.visual.value,
    spoken: els.spoken.value,
    profanity: els.profanity.value,
    bodyLength: els.bodyLen.value,
    checksumLength: els.checksumLen.value,
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
  els.mode.value = s.mode;
  els.customAlpha.value = s.customAlphabet;
  els.visual.value = s.visual;
  els.spoken.value = s.spoken;
  els.profanity.value = s.profanity;
  els.bodyLen.value = s.bodyLength;
  els.checksumLen.value = s.checksumLength;
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
    if (q.get("mode")) els.mode.value = q.get("mode") as string;
    if (q.get("visual")) els.visual.value = q.get("visual") as string;
    if (q.get("body")) els.bodyLen.value = q.get("body") as string;
    if (q.get("check")) els.checksumLen.value = q.get("check") as string;
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
    else applyPreset(els.preset.value || "medium");
  }
}
