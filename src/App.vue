<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { onOtoolsKeyword } from 'otools-plugin-sdk';
import { capture } from 'otools-plugin-sdk/capture';
import type { CaptureCapabilities, CapturePermission } from 'otools-plugin-sdk/capture';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  normalizeHex, rgbToHex, formatColor, appendRecent, parseColor,
  rgbToHsv, hsvToRgb, type RGB, type HSV, type ColorFormatName,
} from './colors';
import { createCaptureSession, decodeColorPng } from './captureSession';
import { useI18n } from './i18n';

const { t, direction } = useI18n();
const native = isTauri();
const selected = ref<RGB | null>(null);
const busy = ref(false);
const error = ref('');
const copied = ref('');
const history = ref<string[]>([]);
const permission = ref<CapturePermission | null>(null);
const capabilities = ref<CaptureCapabilities | null>(null);
const recentKey = 'otools-colorpicker:history:v1';
const formatKey = 'otools-colorpicker:format:v1';
const formats = ['hex', 'rgb', 'hsl'] as const;
type ColorFormat = typeof formats[number];
const currentFormat = ref<ColorFormat>('hex');
const freezeScreen = ref(false);
const freezeScreenKey = 'otools-colorpicker:freeze-screen:v1';
const demoColors = ['#8b5cf6', '#22d3ee', '#f59e0b', '#22c55e', '#ef4444', '#f8fafc'];
const presetColors = [
  '#FF0000', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3',
  '#03A9F4', '#00BCD4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
  '#FFEB3B', '#FFC107', '#FF9800', '#FF5722', '#795548', '#9E9E9E',
  '#607D8B', '#000000', '#FFFFFF', '#8B5CF6', '#22D3EE', '#F8FAFC',
];
const allFormats: ColorFormatName[] = ['hex', 'rgb', 'hsl', 'hexa', 'rgba', 'hsla', 'hsv', 'cmyk', 'lab'];
const hsv = ref<HSV>({ h: 0, s: 0, v: 0 });
const inputText = ref('');
const inputInvalid = ref(false);
const favorites = ref<string[]>([]);
const favoritesKey = 'otools-colorpicker:favorites:v1';
const dragging = ref<'sv' | 'hue' | null>(null);
let disposed = false;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let stopLaunch: (() => void) | undefined;
let initialization: Promise<void> | undefined;
const hex = computed(() => selected.value ? rgbToHex(selected.value) : '—');
const rgb = computed(() => selected.value ? formatColor(selected.value, 'rgb') : '—');
const hsl = computed(() => selected.value ? formatColor(selected.value, 'hsl') : '—');
const displayText = computed(() => selected.value ? formatColor(selected.value, currentFormat.value) : '—');
const canPick = computed(() => native && capabilities.value?.available && capabilities.value.interactive && permission.value?.granted);
const hueColor = computed(() => `hsl(${hsv.value.h}, 100%, 50%)`);
const conversions = computed(() => allFormats.map(key => ({
  key,
  value: selected.value ? formatColor(selected.value, key) : '—',
})));
const isFavorite = computed(() => selected.value ? favorites.value.includes(rgbToHex(selected.value)) : false);

function loadPreferences() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentKey) || '[]');
    history.value = Array.isArray(parsed) ? appendRecent(parsed.filter((value): value is string => typeof value === 'string'), '') : [];
    const format = localStorage.getItem(formatKey);
    if (format === 'hex' || format === 'rgb' || format === 'hsl') currentFormat.value = format;
  } catch { history.value = []; }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
    favorites.value = Array.isArray(saved) ? appendRecent(saved.filter((value): value is string => typeof value === 'string'), '', 24) : [];
  } catch { favorites.value = []; }
  try { freezeScreen.value = localStorage.getItem(freezeScreenKey) === 'true'; }
  catch { error.value = t('preferencesFailed'); }
}
function toggleFreezeScreen(event: Event) {
  const input = event.target as HTMLInputElement;
  if (busy.value) { input.checked = freezeScreen.value; return; }
  freezeScreen.value = input.checked;
  try { localStorage.setItem(freezeScreenKey, String(freezeScreen.value)); }
  catch { error.value = t('preferencesFailed'); }
}
function saveHistory() {
  try { localStorage.setItem(recentKey, JSON.stringify(history.value)); }
  catch { error.value = t('historyFailed'); }
}
function setLiveColor(value: RGB, syncInput = true) {
  selected.value = value;
  hsv.value = rgbToHsv(value);
  if (syncInput) { inputText.value = rgbToHex(value); inputInvalid.value = false; }
}
function chooseColor(value: RGB) {
  setLiveColor(value);
  history.value = appendRecent(history.value, rgbToHex(value));
  saveHistory();
  resetCopied();
}
function commitSelected() {
  if (!selected.value) return;
  const hex = rgbToHex(selected.value);
  history.value = appendRecent(history.value, hex);
  saveHistory();
  inputText.value = hex;
  inputInvalid.value = false;
}
function selectColor(value: string) {
  const normalized = normalizeHex(value);
  if (!normalized) return;
  resetCopied();
  chooseColor({ r: parseInt(normalized.slice(1, 3), 16), g: parseInt(normalized.slice(3, 5), 16), b: parseInt(normalized.slice(5, 7), 16) });
}
function selectFormat(format: ColorFormat) {
  currentFormat.value = format;
  try { localStorage.setItem(formatKey, format); }
  catch { error.value = t('preferencesFailed'); }
}
function resetCopied() { clearTimeout(copiedTimer); copied.value = ''; }
function markCopied(name: string) {
  if (disposed) return;
  resetCopied(); copied.value = name;
  copiedTimer = setTimeout(() => { copied.value = ''; }, 1800);
}
async function writeClipboard(text: string): Promise<boolean> {
  if (native) return await invoke<unknown>('otools_copy_text', { text }) === true;
  // Browser preview only; native failures must never fall back to this path.
  await navigator.clipboard.writeText(text);
  return true;
}
const session = createCaptureSession({
  capture,
  hidePanel: () => invoke<void>('hide_panel_window', {}),
  decode: decodeColorPng,
  async copy(color) {
    chooseColor(color);
    const format = currentFormat.value;
    const success = await writeClipboard(formatColor(color, format));
    if (success) markCopied(format);
    return success;
  },
});

function initialize(): Promise<void> {
  return initialization ??= (async () => {
    if (!native) return;
    try {
      const available = await capture.capabilities();
      if (disposed) return;
      capabilities.value = available;
      const status = await capture.permissionStatus();
      if (!disposed) permission.value = status;
    } catch { if (!disposed) error.value = t('unsupported'); }
  })();
}
async function startCapture(origin: 'manual' | 'direct' = 'manual') {
  if (disposed || busy.value || !native) return;
  // Snapshot the preference before initialization; one launch keeps one capture mode.
  const captureOptions = { panelAlreadyHidden: origin === 'direct', freezeScreen: freezeScreen.value };
  const unsupportedMessage = () => t(captureOptions.freezeScreen ? 'unsupported' : 'liveUnavailable');
  // Acquire the guard before initialization so queued cold launches coalesce.
  busy.value = true; error.value = ''; resetCopied();
  try {
    await initialize();
    if (disposed) return;
    if (!capabilities.value?.available || !capabilities.value.interactive) { error.value = unsupportedMessage(); return; }
    // Authorization can change in System Settings while this hidden page stays alive.
    const status = await capture.permissionStatus();
    if (disposed) return;
    permission.value = status;
    if (!status.granted && status.canRequest) {
      const requested = await capture.requestPermission();
      if (disposed) return;
      permission.value = requested;
    }
    if (!permission.value?.granted) { error.value = t('permissionDenied'); return; }
    await session.start(captureOptions);
  } catch (reason) {
    if (!disposed) {
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : undefined;
      error.value = code === 'permissionDenied' ? t('permissionDenied') : code === 'unsupported' ? unsupportedMessage()
        : code === 'outputFailed' ? t('copyFailed') : t('captureFailed');
      if (code === 'permissionDenied') {
        permission.value = { granted: false, canRequest: permission.value?.canRequest ?? true };
        try {
          const status = await capture.permissionStatus();
          if (!disposed) permission.value = status;
        } catch { /* Keep the denied state and the manual permission action. */ }
      }
    }
  } finally { if (!disposed) busy.value = false; }
}
async function requestPermission() {
  try {
    const status = await capture.requestPermission();
    if (!disposed) { permission.value = status; error.value = status.granted ? '' : t('permissionDenied'); }
  } catch { if (!disposed) error.value = t('permissionDenied'); }
}
async function copy(value: string, name: ColorFormatName) {
  if (value === '—') return;
  resetCopied(); error.value = '';
  try {
    if (await writeClipboard(value) !== true) throw new Error('Clipboard write was not confirmed');
    markCopied(name);
  } catch { if (!disposed) error.value = t('copyFailed'); }
}
function clearHistory() { history.value = []; saveHistory(); }

function pointerRatio(event: PointerEvent, element: HTMLElement): { x: number; y: number } | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}
function updateSv(event: PointerEvent) {
  const ratio = pointerRatio(event, event.currentTarget as HTMLElement);
  if (!ratio) return;
  setLiveColor(hsvToRgb({ ...hsv.value, s: Math.round(ratio.x * 100), v: Math.round((1 - ratio.y) * 100) }));
}
function updateHue(event: PointerEvent) {
  const ratio = pointerRatio(event, event.currentTarget as HTMLElement);
  if (!ratio) return;
  setLiveColor(hsvToRgb({ ...hsv.value, h: Math.round(ratio.x * 360) % 360 }));
}
function startDrag(kind: 'sv' | 'hue', event: PointerEvent) {
  if (busy.value) return;
  dragging.value = kind;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  if (kind === 'sv') updateSv(event); else updateHue(event);
}
function moveDrag(kind: 'sv' | 'hue', event: PointerEvent) {
  if (dragging.value !== kind) return;
  if (kind === 'sv') updateSv(event); else updateHue(event);
}
function endDrag(event: PointerEvent) {
  if (!dragging.value) return;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  dragging.value = null;
  commitSelected();
}
function onSliderKey(kind: 'sv' | 'hue', event: KeyboardEvent) {
  const step = event.shiftKey ? 10 : 1;
  const next = { ...hsv.value };
  if (kind === 'hue') {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next.h = (next.h + step) % 360;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next.h = (next.h - step + 360) % 360;
    else if (event.key === 'Home') next.h = 0;
    else if (event.key === 'End') next.h = 359;
    else return;
  } else {
    if (event.key === 'ArrowRight') next.s = Math.min(100, next.s + step);
    else if (event.key === 'ArrowLeft') next.s = Math.max(0, next.s - step);
    else if (event.key === 'ArrowUp') next.v = Math.min(100, next.v + step);
    else if (event.key === 'ArrowDown') next.v = Math.max(0, next.v - step);
    else if (event.key === 'Home') { next.s = 0; next.v = 0; }
    else if (event.key === 'End') { next.s = 100; next.v = 100; }
    else return;
  }
  event.preventDefault();
  setLiveColor(hsvToRgb(next));
  commitSelected();
}
function onColorInput(event: Event) {
  inputText.value = (event.target as HTMLInputElement).value;
  const parsed = parseColor(inputText.value);
  inputInvalid.value = !parsed && inputText.value.trim().length > 0;
  if (parsed) setLiveColor(parsed, false);
}
function commitColorInput(event: Event) {
  const parsed = parseColor((event.target as HTMLInputElement).value);
  if (!parsed) return;
  setLiveColor(parsed, false);
  commitSelected();
}
function saveFavorites() {
  try { localStorage.setItem(favoritesKey, JSON.stringify(favorites.value)); }
  catch { error.value = t('historyFailed'); }
}
function toggleFavorite() {
  if (!selected.value) return;
  const hex = rgbToHex(selected.value);
  favorites.value = favorites.value.includes(hex)
    ? favorites.value.filter(value => value !== hex)
    : appendRecent(favorites.value, hex, 24);
  saveFavorites();
}
function removeFavorite(hex: string) {
  favorites.value = favorites.value.filter(value => value !== hex);
  saveFavorites();
}

loadPreferences();
// Subscribe before awaiting capabilities/permissions: the SDK drains its cold mailbox here.
if (native) {
  void onOtoolsKeyword(items => {
    if (items.some(item => item.keyword === 'launch' && item.source === 'direct')) void startCapture('direct');
  }).then(stop => { if (disposed) stop(); else stopLaunch = stop; })
    .catch(() => { if (!disposed) error.value = t('launchFailed'); });
  void initialize();
}
onUnmounted(() => { disposed = true; session.dispose(); stopLaunch?.(); clearTimeout(copiedTimer); });
</script>

<template>
  <main class="picker" :dir="direction">
    <header class="header"><span class="eyebrow">OTools</span><h1>{{ t('title') }}</h1></header>
    <section v-if="error" class="error" role="alert">{{ error }}</section>
    <section v-if="!native" class="intro">
      <div class="demo-note"><strong>{{ t('previewOnly') }}</strong><span>{{ t('demoBadge') }}</span></div>
      <p class="muted">{{ t('browserClipboard') }}</p>
      <div class="demo-grid"><button v-for="color in demoColors" :key="color" data-testid="demo" class="demo-swatch" :style="{ background: color }" :aria-label="color" @click="selectColor(color)"></button></div>
    </section>
    <p v-else class="muted">{{ t('launchHint') }}</p>
    <div class="freeze-preference">
      <label for="freeze-screen"><input id="freeze-screen" data-testid="freeze-screen" type="checkbox" role="switch" :checked="freezeScreen" :aria-checked="freezeScreen" :disabled="busy" aria-describedby="freeze-screen-hint" @change="toggleFreezeScreen">{{ t('freezeScreen') }}</label>
      <p id="freeze-screen-hint" class="muted">{{ t('freezeScreenHint') }}</p>
    </div>
    <section class="actions"><button data-testid="pick" class="primary" :disabled="busy || !canPick" @click="startCapture()">{{ busy ? t('busy') : t('pick') }}</button></section>
    <p class="muted">{{ t('autoCopy') }}</p>
    <p v-if="capabilities && (!capabilities.available || !capabilities.interactive)" class="notice">{{ t(freezeScreen ? 'unsupported' : 'liveUnavailable') }}</p>
    <p v-if="permission && !permission.granted" class="notice">{{ t('permissionDenied') }}</p>
    <button v-if="permission && !permission.granted && permission.canRequest" data-testid="permission" class="permission" @click="requestPermission">{{ t('permission') }} · {{ t('grant') }}</button>
    <section class="color-card" :style="{ '--color': selected ? hex : 'linear-gradient(135deg,#8b5cf6,#22d3ee)' }">
      <div class="color-preview"></div><div class="color-values"><strong>{{ displayText }}</strong><span>{{ selected ? `${rgb} · ${hsl}` : t('sample') }}</span></div>
      <div class="formats"><button v-for="format in formats" :key="format" :data-testid="`format-${format}`" :class="{ active: currentFormat === format }" :aria-pressed="currentFormat === format" @click="selectFormat(format)">{{ format.toUpperCase() }}</button><button data-testid="copy-hex" :disabled="!selected" @click="copy(displayText, currentFormat)">{{ copied === currentFormat ? t('copied') : t('copy') }}</button></div>
      <div class="copy-row"><button data-testid="copy-rgb" :disabled="!selected" @click="copy(rgb, 'rgb')">{{ rgb }}</button><button data-testid="copy-hsl" :disabled="!selected" @click="copy(hsl, 'hsl')">{{ hsl }}</button></div>
      <span class="status" role="status">{{ copied ? t('copied') : '' }}</span>
    </section>
    <section class="palette">
      <h2>{{ t('palette') }}</h2>
      <div class="sv-field" data-testid="sv-picker" role="slider" tabindex="0" :style="{ '--hue': hueColor }"
        :aria-label="t('saturationValue')" :aria-valuemin="0" :aria-valuemax="100"
        :aria-valuenow="hsv.s" :aria-valuetext="`${hsv.s}% / ${hsv.v}%`"
        @pointerdown="startDrag('sv', $event)" @pointermove="moveDrag('sv', $event)"
        @pointerup="endDrag" @pointercancel="endDrag" @keydown="onSliderKey('sv', $event)">
        <span class="sv-thumb" :style="{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }"></span>
      </div>
      <div class="hue-field" data-testid="hue-slider" role="slider" tabindex="0"
        :aria-label="t('hue')" :aria-valuemin="0" :aria-valuemax="359" :aria-valuenow="hsv.h"
        @pointerdown="startDrag('hue', $event)" @pointermove="moveDrag('hue', $event)"
        @pointerup="endDrag" @pointercancel="endDrag" @keydown="onSliderKey('hue', $event)">
        <span class="hue-thumb" :style="{ left: `${hsv.h / 360 * 100}%` }"></span>
      </div>
      <p class="muted">{{ t('presets') }}</p>
      <div class="preset-grid"><button v-for="color in presetColors" :key="color" data-testid="preset-color" class="preset-swatch" :style="{ background: color }" :aria-label="color" @click="selectColor(color)"></button></div>
    </section>
    <section class="converter">
      <div class="section-head"><h2>{{ t('converter') }}</h2><button data-testid="favorite" class="text-button favorite-button" :disabled="!selected" :aria-pressed="isFavorite" :aria-label="isFavorite ? t('removeFavorite') : t('addFavorite')" @click="toggleFavorite">{{ isFavorite ? '★' : '☆' }}</button></div>
      <input id="color-input" data-testid="color-input" class="color-input" :value="inputText" :aria-label="t('enterColor')" :placeholder="t('enterColor')" :aria-invalid="inputInvalid" spellcheck="false" @input="onColorInput" @change="commitColorInput" @keydown.enter="commitColorInput">
      <p v-if="inputInvalid" class="invalid-hint">{{ t('invalidColor') }}</p>
      <div class="conversion-list"><div v-for="row in conversions" :key="row.key" class="conversion-row" :data-testid="`convert-${row.key}`"><span class="conversion-name">{{ row.key.toUpperCase() }}</span><code>{{ row.value }}</code><button :data-testid="`convert-copy-${row.key}`" :disabled="row.value === '—'" @click="copy(row.value, row.key)">{{ t('copy') }}</button></div></div>
    </section>
    <section class="recent"><div class="section-head"><h2>{{ t('recent') }}</h2><button class="text-button" @click="clearHistory">{{ t('clear') }}</button></div><div v-if="history.length" class="history-grid"><button v-for="color in history" :key="color" data-testid="recent-color" class="history-item" :aria-label="color" @click="selectColor(color)"><span class="history-chip" :style="{ background: color }"></span><span class="history-hex">{{ color }}</span></button></div><p v-else class="muted">{{ t('empty') }}</p></section>
    <section class="favorites"><h2>{{ t('favorites') }}</h2><div v-if="favorites.length" class="history-grid"><div v-for="color in favorites" :key="color" class="favorite-item"><button data-testid="favorite-color" class="history-chip" :style="{ background: color }" :aria-label="color" @click="selectColor(color)"></button><button class="remove-favorite" :aria-label="t('removeFavorite')" @click="removeFavorite(color)">×</button></div></div><p v-else class="muted">{{ t('emptyFavorites') }}</p></section>
  </main>
</template>

<style>
html,body,#app{margin:0;width:100%;min-height:100%;background:#171821}*{box-sizing:border-box}
</style>
<style scoped>
button:disabled,input:disabled{cursor:default;opacity:.4}button:focus-visible,input:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}
.freeze-preference{margin-top:12px}.freeze-preference label{display:flex;align-items:center;gap:8px;cursor:pointer}.freeze-preference input{margin:0;accent-color:#a78bfa}.freeze-preference .muted{margin:4px 0 0}
.picker{min-height:100vh;padding:18px;background:#171821;color:#f8f7ff;font:13px/1.45 Inter,system-ui,sans-serif}.eyebrow{font-size:10px;letter-spacing:.16em;color:#a78bfa;text-transform:uppercase}h1{font-size:20px;margin:2px 0 0}.intro{margin-top:14px}.demo-note{display:flex;justify-content:space-between;align-items:center;gap:10px;color:#d9d7e8}.demo-note span{font-size:10px;color:#a78bfa;border:1px solid #514b77;border-radius:10px;padding:2px 7px}.demo-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:10px}.demo-swatch{height:30px;border:2px solid #ffffff18;border-radius:7px;cursor:pointer}.actions{display:flex;gap:8px;margin:14px 0 8px}.actions button,.permission{flex:1;border:0;border-radius:8px;padding:9px;cursor:pointer;font-weight:600}.primary{background:#a78bfa;color:#17122a}.permission{background:#292a38;color:#eee;width:100%;margin:6px 0}.notice,.error{border-radius:8px;padding:8px;background:#32243a;color:#f5c7fa;font-size:12px}.section-head{display:flex;justify-content:space-between;align-items:center;color:#d9d7e8;font-size:11px}.text-button{border:0;background:transparent;color:#b7a9fb;font-size:11px;cursor:pointer}.color-card{margin-top:13px;padding:10px;border:1px solid #3d3d50;border-radius:10px;background:#222330}.color-preview{height:48px;border-radius:7px;background:var(--color);border:1px solid #fff3}.color-values{display:flex;flex-wrap:wrap;align-items:baseline;margin-top:8px;gap:8px}.color-values strong{font-size:18px;letter-spacing:.03em;overflow-wrap:anywhere}.color-values span{font-size:10px;color:#aaa8ba}.formats,.copy-row{display:flex;gap:5px;margin-top:8px}.formats button,.copy-row button{border:1px solid #404052;border-radius:6px;padding:6px 8px;background:#292a38;color:#dbd9e8;font-size:11px;cursor:pointer}.formats button.active{border-color:#a78bfa;color:#cfc4ff}.copy-row button{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{display:block;min-height:14px;color:#a7f3d0;font-size:11px;margin-top:5px}.recent{margin-top:14px}.recent h2{font-size:12px;margin:0}.history-grid{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.history-swatch{width:25px;height:25px;border:2px solid #fff2;border-radius:6px;cursor:pointer}.muted{color:#aaa8ba;font-size:12px;margin:8px 0}.error{margin-top:8px}
.palette,.converter{margin-top:14px;padding:10px;border:1px solid #3d3d50;border-radius:10px;background:#222330}
.palette h2,.favorites h2{font-size:12px;margin:0}.sv-field{position:relative;height:120px;margin-top:8px;border-radius:8px;border:1px solid #fff2;background:linear-gradient(to bottom,transparent,#000),linear-gradient(to right,#fff,transparent),var(--hue);cursor:crosshair;touch-action:none}
.sv-thumb{position:absolute;width:14px;height:14px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #0008;transform:translate(-50%,-50%);pointer-events:none}
.hue-field{position:relative;height:16px;margin-top:10px;border-radius:8px;border:1px solid #fff2;background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);cursor:pointer;touch-action:none}
.hue-thumb{position:absolute;top:50%;width:12px;height:20px;border:2px solid #fff;border-radius:4px;box-shadow:0 0 0 1px #0008;transform:translate(-50%,-50%);pointer-events:none}
.preset-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:5px;margin-top:4px}.preset-swatch{height:22px;border:1px solid #fff2;border-radius:5px;cursor:pointer}
.favorite-button{font-size:16px;line-height:1}.color-input{width:100%;margin-top:8px;padding:7px 8px;border:1px solid #404052;border-radius:6px;background:#171821;color:#f8f7ff;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.color-input[aria-invalid="true"]{border-color:#f472b6}.invalid-hint{margin:5px 0 0;color:#f9a8d4;font-size:11px}
.conversion-list{margin-top:8px;display:grid;gap:4px}.conversion-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;background:#292a38}.conversion-name{flex:0 0 40px;color:#a78bfa;font-size:10px;font-weight:600}.conversion-row code{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e8e6f5;font-size:11px}.conversion-row button{border:1px solid #4b4b60;border-radius:5px;background:#35364a;color:#d6d2e8;font-size:10px;padding:3px 6px;cursor:pointer}
.favorites{margin-top:14px}.history-item{display:flex;flex-direction:column;align-items:center;gap:3px;border:0;background:transparent;color:#c9c6d8;cursor:pointer;padding:0}.history-chip{display:block;width:25px;height:25px;border:2px solid #fff2;border-radius:6px;cursor:pointer}.history-hex{font-size:9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.favorite-item{position:relative}.remove-favorite{position:absolute;top:-5px;right:-5px;width:16px;height:16px;padding:0;border:1px solid #6b6b80;border-radius:50%;background:#222330;color:#f8f7ff;font-size:11px;line-height:1;cursor:pointer}
</style>
