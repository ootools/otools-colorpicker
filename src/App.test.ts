// @vitest-environment jsdom
import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OtoolsKeywordDispatch } from 'otools-plugin-sdk';
import App from './App.vue';
import manifest from '../plugin.json';

const bridge = vi.hoisted(() => ({
  native: false,
  launch: undefined as ((items: OtoolsKeywordDispatch[]) => void) | undefined,
  coldLaunch: false,
  invoke: vi.fn(), subscribe: vi.fn(), stop: vi.fn(),
  capabilities: vi.fn(), permissionStatus: vi.fn(), requestPermission: vi.fn(),
  select: vi.fn(), readImage: vi.fn(), release: vi.fn(),
  windowAccess: vi.fn(), listen: vi.fn(), browserCopy: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native, invoke: bridge.invoke }));
vi.mock('otools-plugin-sdk', () => ({ onOtoolsKeyword: bridge.subscribe }));
vi.mock('otools-plugin-sdk/capture', () => ({ capture: {
  capabilities: bridge.capabilities, permissionStatus: bridge.permissionStatus, requestPermission: bridge.requestPermission,
  select: bridge.select, readImage: bridge.readImage, release: bridge.release,
} }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: bridge.windowAccess }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));

const launch = { id: 'launch-1', keyword: 'launch', source: 'direct', payload: null, createdAtMs: 1 };
const completed = {
  status: 'completed', captureId: 'capture-1',
  image: { imageId: 'image-1', mimeType: 'image/png', width: 1, height: 1, expiresAt: 1000 },
  displayId: 'display-1', rect: { x: 0, y: 0, width: 1, height: 1 }, action: 'complete',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
let app: ReturnType<typeof createApp> | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks(); bridge.native = false; bridge.coldLaunch = false; bridge.launch = undefined;
  localStorage.clear(); document.documentElement.lang = 'en-US';
  bridge.subscribe.mockImplementation((handler: typeof bridge.launch) => {
    bridge.launch = handler;
    if (bridge.coldLaunch) handler?.([launch]);
    return Promise.resolve(bridge.stop);
  });
  bridge.capabilities.mockResolvedValue({ available: true, platform: 'macos', interactive: true, screen: true, region: true, window: true, edit: true, pin: true });
  bridge.permissionStatus.mockResolvedValue({ granted: true, canRequest: true });
  bridge.requestPermission.mockResolvedValue({ granted: true, canRequest: true });
  bridge.select.mockResolvedValue(completed);
  bridge.readImage.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  bridge.release.mockResolvedValue(undefined);
  bridge.invoke.mockResolvedValue(true);
  bridge.browserCopy.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { language: 'en-US', clipboard: { writeText: bridge.browserCopy } });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:pixel', revokeObjectURL: vi.fn() });
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 1; naturalHeight = 1; async decode() {} });
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = createElement(tag, options);
    if (element instanceof HTMLCanvasElement) Object.defineProperty(element, 'getContext', { value: () => ({
      drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([18, 52, 86, 255]) }),
    }) });
    return element;
  });
});
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  host = document.createElement('div'); document.body.append(host);
  app = createApp(App); app.mount(host); await nextTick();
}
async function ready() { await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[data-testid="pick"]')!.disabled).toBe(false)); }
function copyCalls() { return bridge.invoke.mock.calls.filter(([command]) => command === 'otools_copy_text'); }

it('labels browser preview and provides only simple demo swatches', async () => {
  await mount();
  expect(host.textContent).toContain('Browser preview');
  expect(host.textContent).toContain('browser clipboard');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="pick"]')!.disabled).toBe(true);
  expect(host.querySelector('[data-testid="demo"]')).not.toBeNull();
  expect(host.querySelector('canvas, [data-testid="region"], .close, .demo-image-button')).toBeNull();
  expect(bridge.subscribe).not.toHaveBeenCalled();
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

const freezeKey = 'otools-colorpicker:freeze-screen:v1';
function freezeToggle() { return host.querySelector<HTMLInputElement>('input[type="checkbox"]')!; }

it.each([false, true])('offers an accessible, default-off freeze preference (native=%s)', async native => {
  bridge.native = native;
  await mount();
  const toggle = freezeToggle();
  expect(toggle).not.toBeNull();
  expect(toggle.checked).toBe(false);
  expect(toggle.disabled).toBe(false);
  expect(toggle.labels?.[0].textContent).toContain('Freeze screen');
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toContain('Off: live');
});

it.each([null, 'false', 'TRUE', '1', ' true ', 'true'])('enables freezing only for the literal stored value %j', async value => {
  bridge.native = true; bridge.coldLaunch = true;
  if (value !== null) localStorage.setItem(freezeKey, value);
  await mount();
  await vi.waitFor(() => expect(bridge.select).toHaveBeenCalledOnce());
  expect(bridge.select.mock.calls[0][0].freezeScreen).toBe(value === 'true');
  expect(freezeToggle().checked).toBe(value === 'true');
});

it('persists toggles across mounts and sends the saved mode on direct launch', async () => {
  await mount();
  const toggle = freezeToggle();
  expect(toggle).not.toBeNull();
  toggle.click(); await nextTick();
  expect(localStorage.getItem(freezeKey)).toBe('true');
  app!.unmount(); app = undefined;
  bridge.native = true; bridge.coldLaunch = true;
  await mount(); await ready();
  expect(freezeToggle().checked).toBe(true);
  expect(bridge.select.mock.calls[0][0].freezeScreen).toBe(true);
  freezeToggle().click(); await nextTick();
  expect(localStorage.getItem(freezeKey)).toBe('false');
  app!.unmount(); app = undefined;
  await mount(); await ready();
  expect(freezeToggle().checked).toBe(false);
  expect(bridge.select.mock.calls[1][0].freezeScreen).toBe(false);
});

it('restores freezing independently of malformed history', async () => {
  localStorage.setItem('otools-colorpicker:history:v1', '{broken');
  localStorage.setItem(freezeKey, 'true');
  bridge.native = true; bridge.coldLaunch = true;
  await mount();
  await vi.waitFor(() => expect(bridge.select).toHaveBeenCalledOnce());
  expect(bridge.select.mock.calls[0][0].freezeScreen).toBe(true);
});

it('reports preference save failure without crashing or losing the chosen mode', async () => {
  await mount();
  const toggle = freezeToggle();
  expect(toggle).not.toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  toggle.click(); await nextTick();
  expect(toggle.checked).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save preferences');
});

it('prevents mode changes during cold initialization and through image release', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  const capability = deferred<unknown>();
  const releasing = deferred<void>();
  bridge.capabilities.mockReturnValueOnce(capability.promise);
  bridge.release.mockReturnValueOnce(releasing.promise);
  await mount();
  const toggle = freezeToggle();
  expect(toggle).not.toBeNull();
  expect(toggle.disabled).toBe(true);
  toggle.click();
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  expect(localStorage.getItem(freezeKey)).toBeNull();
  expect(toggle.checked).toBe(false);
  capability.resolve({ available: true, interactive: true });
  await vi.waitFor(() => expect(bridge.release).toHaveBeenCalledOnce());
  expect(bridge.select.mock.calls[0][0].freezeScreen).toBe(false);
  expect(toggle.disabled).toBe(true);
  releasing.resolve(); await ready();
  expect(toggle.disabled).toBe(false);
});

it.each([false, true])('keeps unsupported guidance specific to the selected mode (freeze=%s)', async freeze => {
  bridge.native = true; bridge.coldLaunch = true;
  document.documentElement.lang = 'zh-CN';
  localStorage.setItem(freezeKey, String(freeze));
  bridge.select.mockResolvedValueOnce({ status: 'error', captureId: 'capture-1', error: { code: 'unsupported', message: 'Unavailable' } });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe(freeze
    ? '当前宿主不支持原生取色' : '实时取色不可用，可开启冻结画面取色'));
  expect(bridge.select).toHaveBeenCalledOnce();
  expect(freezeToggle().checked).toBe(freeze);
  expect(localStorage.getItem(freezeKey)).toBe(String(freeze));
  expect(copyCalls()).toEqual([]);
  expect(bridge.invoke).not.toHaveBeenCalledWith('show_panel_window', expect.anything());
});

it.each(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'es-ES', 'ru-RU', 'ar-SA'])('localizes the freeze control and live-mode guidance in %s', async locale => {
  document.documentElement.lang = locale;
  bridge.native = true; bridge.coldLaunch = true;
  bridge.select.mockResolvedValueOnce({ status: 'error', captureId: 'capture-1', error: { code: 'unsupported', message: 'Unavailable' } });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
  const toggle = freezeToggle();
  expect(toggle).not.toBeNull();
  expect(toggle.labels?.[0].textContent?.trim()).toBeTruthy();
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent?.trim()).toBeTruthy();
  if (locale !== 'en-US') {
    expect(toggle.labels?.[0].textContent).not.toContain('Freeze screen');
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('Live color picking');
  }
  expect(host.querySelector('main')?.getAttribute('dir')).toBe(locale === 'ar-SA' ? 'rtl' : 'ltr');
});

it('keeps the default host Panel size without custom dimensions', () => {
  expect(manifest).toMatchObject({ openMode: 'panel', directLaunch: true });
  expect(manifest).not.toHaveProperty('panelWidth');
  expect(manifest).not.toHaveProperty('panelHeight');
  expect(manifest).not.toHaveProperty('customWindow');
});

it('does not pick on ordinary desktop mount or manual panel reveal', async () => {
  bridge.native = true;
  await mount(); await ready();
  expect(bridge.select).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  bridge.launch?.([{ ...launch, keyword: 'option', source: 'host' }]);
  await nextTick();
  expect(bridge.select).not.toHaveBeenCalled();
  expect(bridge.listen).not.toHaveBeenCalled();
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

it('preserves Option reveal during cold initialization and starts the direct request only once', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  const capability = deferred<unknown>();
  const permission = deferred<unknown>();
  let panelVisible = false; // The host hides it when accepting the direct request.
  bridge.invoke.mockImplementation(async command => {
    if (command === 'hide_panel_window') panelVisible = false;
    return true;
  });
  bridge.capabilities.mockReturnValueOnce(capability.promise);
  bridge.permissionStatus.mockReturnValueOnce(permission.promise);
  await mount();
  expect(bridge.subscribe).toHaveBeenCalledOnce();
  expect(bridge.select).not.toHaveBeenCalled();
  bridge.launch?.([launch, { ...launch, id: 'duplicate' }]);
  panelVisible = true; // User reveals it via Option while initialization is pending.
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  capability.resolve({ available: true, interactive: true });
  await vi.waitFor(() => expect(bridge.permissionStatus).toHaveBeenCalledOnce());
  expect(bridge.select).not.toHaveBeenCalled();
  permission.resolve({ granted: true, canRequest: true });
  await vi.waitFor(() => expect(bridge.release).toHaveBeenCalledExactlyOnceWith('image-1'));
  expect(bridge.select).toHaveBeenCalledExactlyOnceWith({ mode: 'color', edit: false, hideHost: false, restoreHost: false, freezeScreen: false }, expect.any(AbortSignal));
  expect(panelVisible).toBe(true);
  expect(bridge.invoke.mock.calls).toEqual([['otools_copy_text', { text: '#123456' }]]);
  expect(bridge.browserCopy).not.toHaveBeenCalled();
  expect(host.textContent).toContain('#123456');
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Copied');
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

it('manually picks through the same native path and persists the auto-copy format', async () => {
  bridge.native = true;
  await mount(); await ready();
  host.querySelector<HTMLButtonElement>('[data-testid="format-rgb"]')!.click(); await nextTick();
  host.querySelector<HTMLButtonElement>('[data-testid="pick"]')!.click();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('otools_copy_text', { text: 'rgb(18, 52, 86)' }));
  expect(bridge.invoke).toHaveBeenCalledWith('hide_panel_window', {});
  expect(bridge.invoke.mock.invocationCallOrder[0]).toBeLessThan(bridge.select.mock.invocationCallOrder[0]);
  expect(localStorage.getItem('otools-colorpicker:format:v1')).toBe('rgb');
  expect(JSON.parse(localStorage.getItem('otools-colorpicker:history:v1')!)).toEqual(['#123456']);
});

it('restores the persisted format for direct launch', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  localStorage.setItem('otools-colorpicker:format:v1', 'hsl');
  await mount();
  await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('otools_copy_text', { text: 'hsl(210, 65%, 20%)' }));
});

it.each([false, true])('cancels without copying or operating a window (freeze=%s)', async freeze => {
  bridge.native = true; bridge.coldLaunch = true;
  localStorage.setItem(freezeKey, String(freeze));
  bridge.select.mockResolvedValueOnce({ status: 'cancelled', captureId: 'capture-1' });
  await mount(); await ready();
  expect(copyCalls()).toEqual([]);
  expect(bridge.release).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

it.each([false, undefined, 'true'])('treats non-true host copy response %s as failure and retains the selected value', async result => {
  bridge.native = true; bridge.coldLaunch = true;
  bridge.invoke.mockImplementation(async command => command === 'otools_copy_text' ? result : undefined);
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Copy failed'));
  expect(host.querySelector('[role="status"]')?.textContent).not.toContain('Copied');
  expect(host.textContent).toContain('#123456');
  expect(bridge.release).toHaveBeenCalledExactlyOnceWith('image-1');
  expect(bridge.browserCopy).not.toHaveBeenCalled();
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

it('keeps native capture failures in the panel without opening a window', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  bridge.select.mockResolvedValueOnce({ status: 'error', captureId: 'capture-1', error: { code: 'captureFailed', message: 'Failed' } });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Color picking failed'));
  expect(copyCalls()).toEqual([]);
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

it('requests missing permission on direct launch and continues only after the user grants it', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  bridge.permissionStatus.mockResolvedValue({ granted: false, canRequest: true });
  const authorization = deferred<unknown>();
  bridge.requestPermission.mockReturnValueOnce(authorization.promise);
  await mount();
  await vi.waitFor(() => expect(bridge.requestPermission).toHaveBeenCalledOnce());
  expect(bridge.select).not.toHaveBeenCalled();
  bridge.launch?.([{ ...launch, id: 'while-requesting' }]);
  authorization.resolve({ granted: true, canRequest: true });
  await vi.waitFor(() => expect(copyCalls()).toHaveLength(1));
  expect(bridge.select).toHaveBeenCalledOnce();
  expect(bridge.invoke).not.toHaveBeenCalledWith('show_panel_window', expect.anything());
});

it('does not prompt on mount, and rechecks external authorization on the next launch', async () => {
  bridge.native = true;
  bridge.permissionStatus.mockResolvedValue({ granted: false, canRequest: true });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-testid="permission"]')).not.toBeNull());
  expect(bridge.requestPermission).not.toHaveBeenCalled();
  bridge.permissionStatus.mockResolvedValue({ granted: true, canRequest: true });
  bridge.launch?.([launch]);
  await vi.waitFor(() => expect(copyCalls()).toHaveLength(1));
  expect(bridge.requestPermission).not.toHaveBeenCalled();
});

it('keeps denied authorization visible for manual inspection without starting capture', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  bridge.permissionStatus.mockResolvedValue({ granted: false, canRequest: true });
  bridge.requestPermission.mockResolvedValue({ granted: false, canRequest: true });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('permission'));
  expect(bridge.requestPermission).toHaveBeenCalledOnce();
  expect(bridge.select).not.toHaveBeenCalled();
  expect(copyCalls()).toEqual([]);
});

it('does not start capture after unmount during an authorization request', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  bridge.permissionStatus.mockResolvedValue({ granted: false, canRequest: true });
  const authorization = deferred<unknown>();
  bridge.requestPermission.mockReturnValueOnce(authorization.promise);
  await mount();
  await vi.waitFor(() => expect(bridge.requestPermission).toHaveBeenCalledOnce());
  app!.unmount(); app = undefined;
  authorization.resolve({ granted: true, canRequest: true });
  await nextTick(); await nextTick();
  expect(bridge.select).not.toHaveBeenCalled();
});

it('refreshes revoked native permission and exposes the manual permission action', async () => {
  bridge.native = true;
  bridge.permissionStatus.mockResolvedValueOnce({ granted: true, canRequest: true })
    .mockResolvedValueOnce({ granted: true, canRequest: true })
    .mockResolvedValueOnce({ granted: false, canRequest: true });
  bridge.select.mockResolvedValueOnce({ status: 'error', captureId: 'capture-1', error: { code: 'permissionDenied', message: 'Revoked' } });
  await mount(); await ready();
  host.querySelector<HTMLButtonElement>('[data-testid="pick"]')!.click();
  await vi.waitFor(() => expect(host.querySelector('[data-testid="permission"]')).not.toBeNull());
  expect(bridge.permissionStatus).toHaveBeenCalledTimes(3);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="pick"]')!.disabled).toBe(true);
  expect(copyCalls()).toEqual([]);
  host.querySelector<HTMLButtonElement>('[data-testid="permission"]')!.click(); await ready();
  expect(bridge.select).toHaveBeenCalledOnce();
});

it('prevents capture on unsupported hosts and initialization failure', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  bridge.capabilities.mockRejectedValueOnce(new Error('Unavailable'));
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('unavailable'));
  expect(bridge.select).not.toHaveBeenCalled();
  expect(bridge.windowAccess).not.toHaveBeenCalled();
});

it('stops a cold launch on unmount while initialization is pending', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  const capability = deferred<unknown>();
  bridge.capabilities.mockReturnValueOnce(capability.promise);
  await mount();
  app!.unmount(); app = undefined;
  capability.resolve({ available: true, interactive: true });
  await nextTick(); await nextTick();
  expect(bridge.select).not.toHaveBeenCalled();
  expect(bridge.stop).toHaveBeenCalledOnce();
});

it('releases a late result after unmount without reading or copying', async () => {
  bridge.native = true; bridge.coldLaunch = true;
  const result = deferred<unknown>();
  bridge.select.mockReturnValueOnce(result.promise);
  await mount();
  await vi.waitFor(() => expect(bridge.select).toHaveBeenCalledOnce());
  app!.unmount(); app = undefined;
  expect(bridge.select.mock.calls[0][1].aborted).toBe(true);
  result.resolve(completed);
  await vi.waitFor(() => expect(bridge.release).toHaveBeenCalledExactlyOnceWith('image-1'));
  expect(bridge.readImage).not.toHaveBeenCalled();
  expect(copyCalls()).toEqual([]);
});

it('unsubscribes even if subscription settles after unmount', async () => {
  bridge.native = true;
  const subscribed = deferred<() => void>();
  bridge.subscribe.mockReturnValueOnce(subscribed.promise);
  await mount(); app!.unmount(); app = undefined;
  subscribed.resolve(bridge.stop);
  await vi.waitFor(() => expect(bridge.stop).toHaveBeenCalledOnce());
});

it('restores valid history and explicitly uses browser clipboard only in the demo', async () => {
  localStorage.setItem('otools-colorpicker:history:v1', JSON.stringify(['#ff0000', 'invalid', '#00FF00']));
  await mount();
  const swatches = host.querySelectorAll<HTMLButtonElement>('[data-testid="recent-color"]');
  expect(swatches.length).toBe(2);
  swatches[0].click(); await nextTick();
  host.querySelector<HTMLButtonElement>('[data-testid="copy-rgb"]')!.click();
  await vi.waitFor(() => expect(bridge.browserCopy).toHaveBeenCalledWith('rgb(255, 0, 0)'));
  expect(copyCalls()).toEqual([]);
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain('Copied'));
});

it('reports browser clipboard rejection', async () => {
  bridge.browserCopy.mockRejectedValueOnce(new Error('Denied'));
  await mount();
  host.querySelector<HTMLButtonElement>('[data-testid="demo"]')!.click(); await nextTick();
  host.querySelector<HTMLButtonElement>('[data-testid="copy-hex"]')!.click();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Copy failed'));
  expect(host.querySelector('[role="status"]')?.textContent).not.toContain('Copied');
});
