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
const tabs = [
  { key: 'values', label: 'tabValues' },
  { key: 'presets', label: 'tabPresets' },
  { key: 'recent', label: 'tabRecent' },
  { key: 'favorites', label: 'tabFavorites' },
] as const;
type TabKey = typeof tabs[number]['key'];
const activeTab = ref<TabKey>('values');
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
const conversionRows = computed(() => {
  const rows: (typeof conversions.value)[] = [];
  for (let index = 0; index < conversions.value.length; index += 3) rows.push(conversions.value.slice(index, index + 3));
  return rows;
});
const heroColor = computed(() => selected.value ? hex.value : 'linear-gradient(135deg, #8B5CF6, #6D28D9)');
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
    <header class="topbar">
      <span class="brand" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="#fff" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <h1>{{ t('title') }}</h1>
      <span class="topbar-spacer"></span>
      <span v-if="!native" class="badge preview-badge">{{ t('demoBadge') }}</span>
      <span v-else-if="permission && !permission.granted" class="badge warn-badge">{{ t('pendingAuth') }}</span>
      <template v-else>
        <span class="ready-dot" aria-hidden="true"></span>
        <span class="ready-text">{{ t('ready') }}</span>
      </template>
      <span class="gear" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="#A6A2BD" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="#A6A2BD" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
    </header>

    <section v-if="error" class="error" role="alert">{{ error }}</section>

    <div class="workspace">
      <div class="col-left">
        <section class="hero" :style="{ '--hero-color': heroColor }">
          <div class="hero-top">
            <span class="hero-label">{{ t('currentColor') }}</span>
            <button data-testid="favorite" class="star-btn" :disabled="!selected" :aria-pressed="isFavorite" :aria-label="isFavorite ? t('removeFavorite') : t('addFavorite')" @click="toggleFavorite">{{ isFavorite ? '★' : '☆' }}</button>
          </div>
          <div class="hero-bottom">
            <strong class="hero-hex">{{ displayText }}</strong>
            <button data-testid="copy-hex" class="copy-hero" :disabled="!selected" @click="copy(hex, 'hex')">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" stroke="#fff" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="#fff" stroke-width="2"/></svg>
              <span>{{ copied === 'hex' ? t('copied') : t('copy') + ' HEX' }}</span>
            </button>
          </div>
          <span class="hero-status" role="status">{{ copied ? t('copied') : '' }}</span>
        </section>

        <div class="actions">
          <button data-testid="pick" class="primary" :disabled="busy || !canPick" @click="startCapture()">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7" stroke="#1A1230" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="#1A1230" stroke-width="2" stroke-linecap="round"/></svg>
            <span>{{ busy ? t('busy') : t('pick') }}</span>
          </button>
          <label for="freeze-screen" class="freeze-toggle">
            <input id="freeze-screen" data-testid="freeze-screen" type="checkbox" role="switch" :checked="freezeScreen" :aria-checked="freezeScreen" :disabled="busy" aria-describedby="freeze-screen-hint" @change="toggleFreezeScreen">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v20M4 6l16 12M20 6L4 18M12 2l-2 3M12 2l2 3M12 22l-2-3M12 22l2-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <span>{{ t('freezeScreen') }}</span>
          </label>
        </div>
        <p id="freeze-screen-hint" class="sr-only">{{ t('freezeScreenHint') }}</p>
        <p class="hint-line">{{ t('autoCopy') }}</p>

        <div v-if="capabilities && (!capabilities.available || !capabilities.interactive)" class="notice">{{ t(freezeScreen ? 'unsupported' : 'liveUnavailable') }}</div>

        <div v-if="permission && !permission.granted" class="permission-card">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l9 16H3l9-16z" stroke="#FBBF24" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#FBBF24" stroke-width="2" stroke-linecap="round"/></svg>
          <div class="permission-copy"><strong>{{ t('permission') }}</strong><span>{{ t('grantHint') }}</span></div>
          <button v-if="permission.canRequest" data-testid="permission" class="grant-btn" @click="requestPermission">{{ t('grant') }}</button>
        </div>

        <section v-if="!native" class="intro">
          <p class="sr-only">{{ t('previewOnly') }}</p>
          <p class="muted">{{ t('browserClipboard') }}</p>
          <div class="demo-grid">
            <button v-for="color in demoColors" :key="color" data-testid="demo" class="demo-swatch" :style="{ background: color }" :aria-label="color" @click="selectColor(color)"></button>
          </div>
        </section>
      </div>

      <div class="col-right">
        <div class="palette">
          <div class="sv-field" data-testid="sv-picker" role="slider" tabindex="0" :style="{ '--hue': hueColor }"
            :aria-label="t('saturationValue')" :aria-valuemin="0" :aria-valuemax="100"
            :aria-valuenow="hsv.s" :aria-valuetext="`${hsv.s}% / ${hsv.v}%`"
            @pointerdown="startDrag('sv', $event)" @pointermove="moveDrag('sv', $event)"
            @pointerup="endDrag" @pointercancel="endDrag" @keydown="onSliderKey('sv', $event)">
            <span class="sv-thumb" :style="{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }"></span>
          </div>
          <div class="palette-side">
            <div class="hue-field" data-testid="hue-slider" role="slider" tabindex="0"
              :aria-label="t('hue')" :aria-valuemin="0" :aria-valuemax="359" :aria-valuenow="hsv.h"
              @pointerdown="startDrag('hue', $event)" @pointermove="moveDrag('hue', $event)"
              @pointerup="endDrag" @pointercancel="endDrag" @keydown="onSliderKey('hue', $event)">
              <span class="hue-thumb" :style="{ left: `${hsv.h / 360 * 100}%` }"></span>
            </div>
            <label class="input-label" for="color-input">{{ t('inputColor') }}</label>
            <input id="color-input" data-testid="color-input" class="color-input" :value="inputText" :aria-label="t('inputColor')" :placeholder="t('enterColor')" :aria-invalid="inputInvalid" spellcheck="false" @input="onColorInput" @change="commitColorInput" @keydown.enter="commitColorInput">
            <p v-if="inputInvalid" class="invalid-hint">{{ t('invalidColor') }}</p>
            <p v-else class="format-hint">HEX / RGB / HSL<br>CMYK / LAB</p>
          </div>
        </div>
      </div>
    </div>

    <section class="collection">
      <div class="tabbar">
        <button v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: activeTab === tab.key }" :aria-pressed="activeTab === tab.key" @click="activeTab = tab.key">{{ t(tab.label) }}</button>
        <span class="tabbar-spacer"></span>
        <span class="tabbar-hint">{{ t('viewAll') }}</span>
      </div>
      <div class="tabbody">
        <div v-show="activeTab === 'values'" class="values-panel">
          <div class="quick-row">
            <div class="format-switch">
              <button v-for="format in formats" :key="format" :data-testid="`format-${format}`" :class="{ active: currentFormat === format }" :aria-pressed="currentFormat === format" @click="selectFormat(format)">{{ format.toUpperCase() }}</button>
            </div>
            <button data-testid="copy-rgb" class="quick-copy" :disabled="!selected" @click="copy(rgb, 'rgb')">RGB</button>
            <button data-testid="copy-hsl" class="quick-copy" :disabled="!selected" @click="copy(hsl, 'hsl')">HSL</button>
          </div>
          <div class="conversion-grid">
            <div v-for="(row, rowIndex) in conversionRows" :key="rowIndex" class="conversion-row">
              <div v-for="item in row" :key="item.key" class="conversion-card" :data-testid="`convert-${item.key}`">
                <span class="conversion-name">{{ item.key.toUpperCase() }}</span>
                <code>{{ item.value }}</code>
                <button :data-testid="`convert-copy-${item.key}`" :disabled="item.value === '—'" @click="copy(item.value, item.key)">{{ t('copy') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div v-show="activeTab === 'presets'" class="preset-panel">
          <div class="preset-grid">
            <button v-for="color in presetColors" :key="color" data-testid="preset-color" class="preset-swatch" :style="{ background: color }" :aria-label="color" @click="selectColor(color)"></button>
          </div>
        </div>

        <div v-show="activeTab === 'recent'" class="list-panel">
          <div class="panel-head"><h2>{{ t('recent') }}</h2><button class="text-button" @click="clearHistory">{{ t('clear') }}</button></div>
          <div v-if="history.length" class="history-grid">
            <button v-for="color in history" :key="color" data-testid="recent-color" class="history-item" :aria-label="color" @click="selectColor(color)"><span class="history-chip" :style="{ background: color }"></span><span class="history-hex">{{ color }}</span></button>
          </div>
          <p v-else class="empty">{{ t('empty') }}</p>
        </div>

        <div v-show="activeTab === 'favorites'" class="list-panel">
          <div class="panel-head"><h2>{{ t('favorites') }}</h2></div>
          <div v-if="favorites.length" class="history-grid">
            <div v-for="color in favorites" :key="color" class="favorite-item">
              <button data-testid="favorite-color" class="history-chip" :style="{ background: color }" :aria-label="color" @click="selectColor(color)"></button>
              <button class="remove-favorite" :aria-label="t('removeFavorite')" @click="removeFavorite(color)">×</button>
            </div>
          </div>
          <p v-else class="empty">{{ t('emptyFavorites') }}</p>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span class="footer-left"><i class="dot" aria-hidden="true"></i>{{ t('footerStatus') }}</span>
      <span class="footer-right">{{ t('shortcut') }}</span>
    </footer>
  </main>
</template>

<style>
html, body, #app { margin: 0; width: 100%; height: 100%; background: #14121F; }
* { box-sizing: border-box; }
</style>
<style scoped>
.picker { height: 100vh; min-height: 560px; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #14121F; color: #F4F2FB; font: 13px/1.45 Inter, system-ui, sans-serif; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button:disabled, input:disabled { cursor: default; opacity: .45; }
button:focus-visible, input:focus-visible, [role="slider"]:focus-visible { outline: 2px solid #A78BFA; outline-offset: 2px; }

.topbar { flex: 0 0 40px; height: 40px; display: flex; align-items: center; gap: 10px; }
.brand { width: 28px; height: 28px; border-radius: 9px; background: #8B5CF6; display: grid; place-items: center; }
.brand svg { width: 16px; height: 16px; }
.topbar h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: .01em; }
.topbar-spacer { flex: 1; }
.badge { font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 10px; }
.preview-badge { color: #C4B5FD; background: #2E2850; }
.warn-badge { color: #FBBF24; background: #3A2E18; }
.ready-dot { width: 8px; height: 8px; border-radius: 50%; background: #34D399; }
.ready-text { font-size: 12px; color: #A6A2BD; }
.gear svg { width: 18px; height: 18px; display: block; }

.error { flex: 0 0 auto; border-radius: 10px; padding: 8px 12px; background: #32243A; color: #F5C7FA; font-size: 12px; }

.workspace { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 378px minmax(0, 1fr); gap: 12px; }
.col-left, .col-right { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; }

.hero { flex: 1 1 auto; min-height: 132px; position: relative; padding: 16px; border-radius: 14px; overflow: hidden; background: var(--hero-color); display: flex; flex-direction: column; justify-content: space-between; }
.hero-top, .hero-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hero-label { font-size: 12px; font-weight: 500; color: #FFFFFFCC; }
.star-btn { border: 0; background: transparent; color: #FFFFFF; font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px; }
.hero-hex { font-size: 27px; font-weight: 500; font-family: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .01em; color: #fff; overflow-wrap: anywhere; }
.copy-hero { display: flex; align-items: center; gap: 7px; padding: 8px 11px; border: 1px solid #FFFFFF59; border-radius: 10px; background: #FFFFFF2B; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.copy-hero svg { width: 15px; height: 15px; }
.hero-status { position: absolute; bottom: 5px; left: 16px; font-size: 10px; color: #D1FAE5; }

.actions { flex: 0 0 46px; height: 46px; display: flex; gap: 10px; }
.primary { flex: 1; display: flex; align-items: center; justify-content: center; gap: 9px; border: 0; border-radius: 12px; background: #A78BFA; color: #1A1230; font-size: 14px; font-weight: 600; cursor: pointer; }
.primary svg { width: 18px; height: 18px; }
.freeze-toggle { width: 140px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid #3A3552; border-radius: 12px; background: #1E1B2E; color: #C9C4DE; font-size: 13px; font-weight: 500; cursor: pointer; }
.freeze-toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.freeze-toggle svg { width: 18px; height: 18px; }
.hint-line { margin: 0; text-align: center; font-size: 11px; color: #6F6B86; }
.notice { border-radius: 8px; padding: 6px 10px; background: #2A2130; color: #F5C7FA; font-size: 11px; }

.permission-card { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #6B4A6B; border-radius: 12px; background: #2A2130; }
.permission-card > svg { width: 22px; height: 22px; flex: 0 0 auto; }
.permission-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.permission-copy strong { font-size: 12px; color: #FDE9B8; }
.permission-copy span { font-size: 10px; color: #C7A9C0; }
.grant-btn { flex: 0 0 auto; padding: 7px 11px; border: 0; border-radius: 9px; background: #FBBF24; color: #2A2130; font-size: 11px; font-weight: 600; cursor: pointer; }

.intro { flex: 0 0 auto; }
.muted { margin: 0 0 6px; font-size: 10px; color: #8E88A8; }
.demo-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.demo-swatch { height: 26px; border: 1px solid #FFFFFF24; border-radius: 6px; cursor: pointer; }

.palette { flex: 1 1 auto; min-height: 0; display: flex; gap: 12px; padding: 14px; border: 1px solid #2C2940; border-radius: 14px; background: #1B1929; }
.sv-field { position: relative; flex: 0 0 210px; align-self: stretch; border-radius: 10px; border: 1px solid #FFFFFF20; background: linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent), var(--hue); cursor: crosshair; touch-action: none; }
.sv-thumb { position: absolute; width: 14px; height: 14px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px #0008; transform: translate(-50%, -50%); pointer-events: none; }
.palette-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.hue-field { position: relative; flex: 0 0 18px; height: 18px; border-radius: 9px; border: 1px solid #FFFFFF20; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); cursor: pointer; touch-action: none; }
.hue-thumb { position: absolute; top: 50%; width: 12px; height: 20px; border: 2px solid #fff; border-radius: 5px; box-shadow: 0 0 0 1px #0008; transform: translate(-50%, -50%); pointer-events: none; }
.input-label { font-size: 11px; font-weight: 500; color: #8E88A8; }
.color-input { width: 100%; height: 40px; padding: 0 12px; border: 1px solid #3A3552; border-radius: 9px; background: #12111D; color: #F4F2FB; font: 14px/1.4 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.color-input[aria-invalid="true"] { border-color: #F472B6; }
.invalid-hint { margin: 0; color: #F9A8D4; font-size: 10px; }
.format-hint { margin: 0; color: #6F6B86; font-size: 10px; }

.collection { flex: 0 0 200px; height: 200px; display: flex; flex-direction: column; border: 1px solid #2C2940; border-radius: 14px; background: #1B1929; overflow: hidden; }
.tabbar { flex: 0 0 40px; height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 12px; }
.tab { height: 26px; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; color: #8E88A8; font-size: 12px; font-weight: 500; cursor: pointer; }
.tab.active { background: #2E2850; color: #C4B5FD; font-weight: 600; }
.tabbar-spacer { flex: 1; }
.tabbar-hint { font-size: 11px; font-weight: 500; color: #8B5CF6; }
.tabbody { flex: 1; min-height: 0; padding: 10px 14px; overflow: hidden; }

.quick-row { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; }
.format-switch { display: flex; gap: 5px; }
.format-switch button, .quick-copy { height: 26px; padding: 0 12px; border: 1px solid #3A3552; border-radius: 7px; background: #232134; color: #C9C4DE; font-size: 11px; font-weight: 600; cursor: pointer; }
.format-switch button.active { border-color: #8B5CF6; background: #2E2850; color: #C4B5FD; }
.quick-copy { margin-left: auto; }
.conversion-grid { display: flex; flex-direction: column; gap: 7px; }
.conversion-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.conversion-card { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-radius: 8px; background: #232134; }
.conversion-name { flex: 0 0 38px; color: #A78BFA; font-size: 10px; font-weight: 600; }
.conversion-card code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #E8E5F5; font: 12px/1 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.conversion-card button { flex: 0 0 auto; border: 0; background: transparent; color: #8E88A8; font-size: 10px; cursor: pointer; padding: 2px; }

.preset-panel { height: 100%; overflow: auto; }
.preset-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 8px; }
.preset-swatch { aspect-ratio: 1.5; border: 1px solid #FFFFFF24; border-radius: 6px; cursor: pointer; }

.list-panel { height: 100%; overflow: auto; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.panel-head h2 { margin: 0; font-size: 12px; color: #D9D7E8; }
.text-button { border: 0; background: transparent; color: #B7A9FB; font-size: 11px; cursor: pointer; }
.history-grid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 8px; }
.history-item { display: flex; flex-direction: column; align-items: center; gap: 3px; border: 0; background: transparent; color: #C9C6D8; cursor: pointer; padding: 0; }
.history-chip { display: block; width: 100%; aspect-ratio: 1.5; border: 1px solid #FFFFFF24; border-radius: 6px; cursor: pointer; }
.history-hex { font-size: 9px; font-family: "Roboto Mono", ui-monospace, monospace; }
.favorite-item { position: relative; }
.remove-favorite { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; padding: 0; border: 1px solid #6B6B80; border-radius: 50%; background: #222330; color: #F8F7FF; font-size: 11px; line-height: 1; cursor: pointer; }
.empty { margin: 8px 0 0; color: #6F6B86; font-size: 11px; }

.footer { flex: 0 0 22px; height: 22px; display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #6F6B86; }
.footer-left { display: flex; align-items: center; gap: 7px; }
.footer-left .dot { width: 6px; height: 6px; border-radius: 50%; background: #A78BFA; }
.footer-right { color: #5C5872; }
</style>
