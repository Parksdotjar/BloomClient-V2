export type SoundCategory = "buttons" | "toggles" | "scroll" | "success";
export type SoundCue = "button" | "toggleOn" | "toggleOff" | "scroll" | "success";

export type InteractionSoundSettings = {
  enabled: boolean;
  volume: number;
  depth: number;
  echo: number;
  categories: Record<SoundCategory, boolean>;
};

export const defaultInteractionSounds: InteractionSoundSettings = {
  enabled: false,
  volume: 35,
  depth: 60,
  echo: 20,
  categories: { buttons: true, toggles: true, scroll: false, success: true },
};

const categoryForCue: Record<SoundCue, SoundCategory> = {
  button: "buttons", toggleOn: "toggles", toggleOff: "toggles", scroll: "scroll", success: "success",
};
const categories: SoundCategory[] = ["buttons", "toggles", "scroll", "success"];
const percent = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value)
  ? Math.round(Math.max(0, Math.min(100, value))) : fallback;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export function normalizeInteractionSounds(value: unknown): InteractionSoundSettings {
  const saved = record(value);
  const enabledCategories = record(saved.categories);
  return {
    enabled: saved.enabled === true,
    volume: percent(saved.volume, defaultInteractionSounds.volume),
    depth: percent(saved.depth, defaultInteractionSounds.depth),
    echo: percent(saved.echo, defaultInteractionSounds.echo),
    categories: Object.fromEntries(categories.map(category => [category,
      typeof enabledCategories[category] === "boolean" ? enabledCategories[category] : defaultInteractionSounds.categories[category],
    ])) as Record<SoundCategory, boolean>,
  };
}

/** Original, action-specific Foley rendered once into bounded mono samples. */
export function synthesizeInteractionSound(
  cue: SoundCue,
  options: { depth?: number; echo?: number } = {},
  sampleRate = 24_000,
): Float32Array {
  const rate = Number.isFinite(sampleRate) ? Math.max(8_000, Math.min(96_000, Math.round(sampleRate))) : 24_000;
  const depth = percent(options.depth, defaultInteractionSounds.depth) / 100;
  const reflection = percent(options.echo, defaultInteractionSounds.echo) / 100;
  const duration = cue === "toggleOn" || cue === "toggleOff" ? 0.36 : cue === "success" ? 0.32 : cue === "scroll" ? 0.038 : 0.16;
  const dry = new Float32Array(Math.ceil(rate * duration));
  const output = new Float32Array(dry.length);
  const tone = 1.15 - depth * 0.4;
  let seed = 0x4b10d + cue.length * 71;
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0x80000000 - 1;
  };
  const strike = (offset: number, frequency: number, weight: number, damping: number, cutoff = 3_200, textureWeight = 0.65) => {
    const start = Math.round(offset * rate);
    const contactAlpha = 1 - Math.exp(-2 * Math.PI * cutoff * tone / rate);
    const bodyAlpha = 1 - Math.exp(-2 * Math.PI * 230 / rate);
    let contact = 0;
    let contactLow = 0;
    for (let i = start; i < dry.length; i += 1) {
      const time = (i - start) / rate;
      if (time > damping * 7) break;
      const attack = 1 - Math.exp(-time / 0.0008);
      const phase = 2 * Math.PI * frequency * (time + 0.0016 * (1 - Math.exp(-time / 0.008)));
      const body = Math.sin(phase) * Math.exp(-time / damping)
        + 0.38 * Math.sin(phase * 2.31 + 0.2) * Math.exp(-time / (damping * 0.52))
        + 0.12 * Math.sin(phase * 3.87) * Math.exp(-time / (damping * 0.27));
      contact += contactAlpha * (noise() - contact);
      contactLow += bodyAlpha * (contact - contactLow);
      const texture = (contact - contactLow) * Math.exp(-time / Math.min(0.0055, damping)) * textureWeight;
      dry[i] += weight * attack * (body * 0.64 + texture);
    }
  };
  const ping = (offset: number, frequency: number, weight: number, damping: number) => {
    const start = Math.round(offset * rate);
    for (let i = start; i < dry.length; i += 1) {
      const time = (i - start) / rate;
      const envelope = (1 - Math.exp(-time / 0.0012)) * Math.exp(-time / damping);
      const phase = 2 * Math.PI * frequency * time;
      dry[i] += weight * envelope * (Math.sin(phase) + 0.16 * Math.sin(phase * 2.01) * Math.exp(-time / 0.014));
    }
  };

  if (cue === "button") {
    // A tight rhythm-game-style contact hit: dry attack, low body, small click.
    // This is synthesis, not an osu! skin sample or a pitched notification beep.
    strike(0, 340 * tone, 0.86, 0.013, 4_300, 1.15);
    strike(0.004, 760 * tone, 0.22, 0.006, 3_600, 0.32);
    strike(0.001, 160 * tone, 0.26, 0.014, 1_300, 0.08);
  } else if (cue === "scroll") {
    // Short and completely dry so high-rate scrolling stays discrete, not noisy.
    strike(0, 680 * tone, 1, 0.0028, 4_800, 1.35);
  } else if (cue === "toggleOn" || cue === "toggleOff") {
    const on = cue === "toggleOn";
    strike(0, 270 * tone, 0.20, 0.008, 2_000, 0.45);
    const travel = 0.175;
    let phase = 0, filtered = 0, low = 0;
    for (let i = 0; i < Math.round(rate * travel); i += 1) {
      const time = i / rate;
      const progress = time / travel;
      const direction = on ? progress : 1 - progress;
      const frequency = (150 + 230 * direction) * tone;
      phase += 2 * Math.PI * frequency / rate;
      const cutoff = (650 + 1_700 * direction) * tone;
      filtered += (1 - Math.exp(-2 * Math.PI * cutoff / rate)) * (noise() - filtered);
      low += (1 - Math.exp(-2 * Math.PI * 300 / rate)) * (filtered - low);
      const envelope = Math.sin(Math.PI * progress) ** 1.35;
      dry[i] += envelope * (0.14 * (filtered - low) + 0.055 * Math.sin(phase));
    }
    // The seat arrives during the last part of the 220ms thumb travel.
    strike(0.178, (on ? 320 : 210) * tone, 0.28, 0.009, 2_300, 0.42);
    ping(0.180, (on ? 960 : 540) * tone, 0.42, 0.025);
  } else {
    // A resolved, compact pair reserved for confirmed completed operations.
    strike(0, 240 * tone, 0.38, 0.015, 1_700, 0.23);
    ping(0.008, 610 * tone, 0.34, 0.023);
    ping(0.082, 915 * tone, 0.48, 0.030);
  }

  const firstReflection = Math.round(rate * 0.021);
  const secondReflection = Math.round(rate * 0.037);
  const lowPassAlpha = 1 - Math.exp(-2 * Math.PI * 850 / rate);
  const dcDecay = Math.exp(-2 * Math.PI * 28 / rate);
  const softened = new Float32Array(dry.length);
  let previousInput = 0;
  let dcFiltered = 0;
  let peak = 0;
  for (let i = 0; i < dry.length; i += 1) {
    softened[i] = (i ? softened[i - 1] : 0) + lowPassAlpha * (dry[i] - (i ? softened[i - 1] : 0));
    const mixed = dry[i] + (cue === "scroll" ? 0 : reflection) * (
      (i >= firstReflection ? softened[i - firstReflection] * 0.21 : 0)
      + (i >= secondReflection ? softened[i - secondReflection] * 0.085 : 0)
    );
    dcFiltered = mixed - previousInput + dcDecay * dcFiltered;
    previousInput = mixed;
    const tail = Math.min(1, (dry.length - 1 - i) / (rate * 0.012));
    output[i] = dcFiltered * tail;
    peak = Math.max(peak, Math.abs(output[i]));
  }
  // Fixed cue levels leave headroom even at maximum volume and four voices.
  const level = cue === "scroll" ? 0.18 : cue === "success" ? 0.48 : 0.52;
  if (peak > 0) for (let i = 0; i < output.length; i += 1) output[i] *= level / peak;
  output[0] = 0;
  output[output.length - 1] = 0;
  return output;
}

let preferences = normalizeInteractionSounds(undefined);
let blocked = false;
let context: AudioContext | null = null;
let master: GainNode | null = null;
let epoch = 0;
let pendingResume = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const buffers = new Map<SoundCue, AudioBuffer>();
const voices = new Set<AudioBufferSourceNode>();
const voiceCategories = new Map<AudioBufferSourceNode, SoundCategory>();
let toggleRequest = 0;
const lastPlayed = new Map<SoundCategory, number>();
const cueCooldown: Record<SoundCategory, number> = { buttons: 45, toggles: 0, scroll: 22, success: 250 };
const SAMPLE_RATE = 24_000;
const MAX_VOICES = 4;
const visible = () => typeof document !== "undefined" && !document.hidden && document.hasFocus();
const outputVolume = () => 0.43 * (preferences.volume / 100) ** 1.3;

function clearIdleTimer() {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
}

function cancelVoice(source: AudioBufferSourceNode) {
  source.onended = null;
  try { source.stop(); } catch { /* Already ended. */ }
  source.disconnect();
  voices.delete(source);
  voiceCategories.delete(source);
}

function suspendWhenIdle(delay = 750) {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (!voices.size && context?.state === "running") void context.suspend().catch(() => {});
  }, delay);
}

/** Settings changes never create an audio context or play an unsolicited preview. */
export function configureInteractionSounds(value: unknown, isBlocked = false) {
  const next = normalizeInteractionSounds(value);
  if (next.depth !== preferences.depth || next.echo !== preferences.echo) buffers.clear();
  const permissionChanged = next.enabled !== preferences.enabled || isBlocked !== blocked
    || categories.some(category => next.categories[category] !== preferences.categories[category]);
  preferences = next;
  blocked = isBlocked;
  if (permissionChanged) epoch += 1;
  if (master && context) {
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(outputVolume(), context.currentTime, 0.008);
  }
  if (!next.enabled || next.volume === 0 || blocked || permissionChanged) stopInteractionSounds();
}

/** Cancel pending and active sounds; safe before audio has ever been enabled. */
export function stopInteractionSounds() {
  epoch += 1;
  lastPlayed.clear();
  for (const source of voices) cancelVoice(source);
  if (context) suspendWhenIdle(0);
}

/** Release the device and cached buffers on app unmount; future gestures can reopen it. */
export function disposeInteractionSounds() {
  stopInteractionSounds();
  clearIdleTimer();
  const previous = context;
  context = null;
  master?.disconnect();
  master = null;
  buffers.clear();
  pendingResume = false;
  if (previous && previous.state !== "closed") void previous.close().catch(() => {});
}

function allowed(cue: SoundCue, preview: boolean) {
  return !blocked && visible() && preferences.volume > 0
    && (preview || (preferences.enabled && preferences.categories[categoryForCue[cue]]));
}

/**
 * Call from an accepted interaction or a confirmed operation. Preview is an
 * explicit user action and bypasses the master/category switches only. A failed
 * or delayed context resume drops the cue instead of playing a backlog later.
 */
export async function playInteractionSound(cue: SoundCue, options: { preview?: boolean } = {}): Promise<boolean> {
  const preview = options.preview === true;
  if (!allowed(cue, preview)) return false;
  const category = categoryForCue[cue];
  // A quick reversal must replace the old sweep, including its future landing.
  if (category === "toggles") {
    toggleRequest += 1;
    for (const source of voices) if (voiceCategories.get(source) === "toggles") cancelVoice(source);
  }
  const requestedToggle = toggleRequest;
  if (pendingResume) return false;
  const requestedAt = performance.now();
  const previousPlay = lastPlayed.get(category);
  if (previousPlay !== undefined && requestedAt - previousPlay < cueCooldown[category]) return false;
  const requestEpoch = epoch;
  let source: AudioBufferSourceNode | undefined;
  try {
    if (!context || context.state === "closed") {
      const AudioContextClass = globalThis.AudioContext;
      if (!AudioContextClass || (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive)) return false;
      context = new AudioContextClass({ latencyHint: "interactive" });
      master = context.createGain();
      master.gain.value = outputVolume();
      master.connect(context.destination);
    }
    const audio = context;
    clearIdleTimer();
    if (audio.state !== "running") {
      pendingResume = true;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const resumed = audio.resume().then(() => {
          if (context === audio && !voices.size) suspendWhenIdle();
          return true;
        });
        const ready = await Promise.race([
          resumed,
          new Promise<false>(resolve => { deadline = setTimeout(() => resolve(false), 180); }),
        ]);
        if (!ready) return false;
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        pendingResume = false;
      }
    }
    if (context !== audio || requestEpoch !== epoch || !allowed(cue, preview)
      || (category === "toggles" && requestedToggle !== toggleRequest)
      || audio.state !== "running" || performance.now() - requestedAt > 180) {
      if (context === audio) suspendWhenIdle();
      return false;
    }
    if (voices.size >= MAX_VOICES) {
      // Frequent wheel ticks must not swallow a deliberate button/confirmation.
      const replaceable = category !== "scroll" ? [...voices].find(voice => voiceCategories.get(voice) === "scroll") : undefined;
      if (replaceable) cancelVoice(replaceable);
      else return false;
    }
    let buffer = buffers.get(cue);
    if (!buffer) {
      const samples = synthesizeInteractionSound(cue, preferences, SAMPLE_RATE);
      buffer = audio.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      buffers.set(cue, buffer);
    }
    source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(master!);
    const playing = source;
    source.onended = () => {
      playing.disconnect();
      voices.delete(playing);
      voiceCategories.delete(playing);
      if (!voices.size) suspendWhenIdle();
    };
    voices.add(source);
    voiceCategories.set(source, category);
    lastPlayed.set(category, requestedAt);
    source.start();
    return true;
  } catch {
    // Sound must never block an action, display an audio error, or retry itself.
    if (source) {
      source.onended = null;
      source.disconnect();
      voices.delete(source);
      voiceCategories.delete(source);
    }
    if (context) suspendWhenIdle();
    return false;
  }
}
