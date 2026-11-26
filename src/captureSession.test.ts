// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureCompletedResult, CaptureResult } from 'otools-plugin-sdk/capture';
import { CaptureError, createCaptureSession, decodeColorPng, type ColorCaptureTransport } from './captureSession';
import type { RGB } from './colors';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const png = new Uint8Array([137, 80, 78, 71]);
const color = { r: 18, g: 52, b: 86 };
const completed: CaptureCompletedResult = {
  status: 'completed', captureId: 'capture-1',
  image: { imageId: 'image-1', mimeType: 'image/png', width: 1, height: 1, expiresAt: 1000 },
  displayId: 'display-1', rect: { x: 20, y: 30, width: 1, height: 1 }, action: 'complete',
};

function setup() {
  const events: string[] = [];
  const capture = {
    select: vi.fn<ColorCaptureTransport['select']>(async () => { events.push('select'); return completed; }),
    readImage: vi.fn<ColorCaptureTransport['readImage']>(async id => { events.push(`read:${id}`); return png; }),
    release: vi.fn<ColorCaptureTransport['release']>(async id => { events.push(`release:${id}`); }),
  };
  const decode = vi.fn(async (_bytes: Uint8Array): Promise<RGB> => { events.push('decode'); return color; });
  const copy = vi.fn(async (_color: RGB) => { events.push('copy'); return true; });
  const hidePanel = vi.fn(async () => { events.push('hide-panel'); });
  return { events, capture, decode, copy, hidePanel, session: createCaptureSession({ capture, decode, copy, hidePanel }) };
}

describe('native color session', () => {
  it('selects one color with host restoration disabled, reads, decodes, copies, then releases', async () => {
    const { session, capture, decode, copy, events } = setup();
    await expect(session.start()).resolves.toEqual(color);
    expect(capture.select).toHaveBeenCalledExactlyOnceWith({ mode: 'color', edit: false, hideHost: false, restoreHost: false, freezeScreen: false }, expect.any(AbortSignal));
    expect(decode).toHaveBeenCalledExactlyOnceWith(png);
    expect(copy).toHaveBeenCalledExactlyOnceWith(color);
    expect(events).toEqual(['hide-panel', 'select', 'read:image-1', 'decode', 'copy', 'release:image-1']);
  });

  it('skips panel hiding for a direct request already hidden by the host', async () => {
    const { session, hidePanel, capture, events } = setup();
    await expect(session.start({ panelAlreadyHidden: true })).resolves.toEqual(color);
    expect(hidePanel).not.toHaveBeenCalled();
    expect(capture.select).toHaveBeenCalledExactlyOnceWith({ mode: 'color', edit: false, hideHost: false, restoreHost: false, freezeScreen: false }, expect.any(AbortSignal));
    expect(events).toEqual(['select', 'read:image-1', 'decode', 'copy', 'release:image-1']);
  });

  it('freezes only when requested and snapshots options before hiding the panel', async () => {
    const { session, capture, hidePanel } = setup();
    const hiding = deferred<void>();
    hidePanel.mockReturnValueOnce(hiding.promise);
    const options = { freezeScreen: true };
    const running = session.start(options);
    options.freezeScreen = false;
    hiding.resolve();
    await expect(running).resolves.toEqual(color);
    expect(capture.select).toHaveBeenCalledExactlyOnceWith({ mode: 'color', edit: false, hideHost: false, restoreHost: false, freezeScreen: true }, expect.any(AbortSignal));
  });

  it('waits for panel-only hide and skips selection if cancelled during hide', async () => {
    const { session, capture, hidePanel } = setup();
    const hiding = deferred<void>();
    hidePanel.mockReturnValueOnce(hiding.promise);
    const running = session.start();
    expect(capture.select).not.toHaveBeenCalled();
    await expect(session.start()).resolves.toBeNull();
    session.cancel(); hiding.resolve();
    await expect(running).resolves.toBeNull();
    expect(capture.select).not.toHaveBeenCalled();
  });

  it('surfaces hide failure without starting selection or copying', async () => {
    const { session, capture, copy, hidePanel } = setup();
    hidePanel.mockRejectedValueOnce(new Error('Hide panel failed'));
    await expect(session.start()).rejects.toMatchObject({ message: 'Hide panel failed' });
    expect(capture.select).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'error'] as const)('does not copy or read a %s cancellation', async status => {
    const { session, capture, copy } = setup();
    capture.select.mockResolvedValueOnce(status === 'cancelled'
      ? { status, captureId: 'capture-1' }
      : { status, captureId: 'capture-1', error: { code: 'cancelled', message: 'Cancelled' } });
    await expect(session.start()).resolves.toBeNull();
    expect(copy).not.toHaveBeenCalled();
    expect(capture.readImage).not.toHaveBeenCalled();
    expect(capture.release).not.toHaveBeenCalled();
  });

  it('surfaces a permission error without copying', async () => {
    const { session, capture, copy } = setup();
    capture.select.mockResolvedValueOnce({ status: 'error', captureId: 'capture-1', error: { code: 'permissionDenied', message: 'Denied' } });
    await expect(session.start()).rejects.toMatchObject({ code: 'permissionDenied' });
    expect(copy).not.toHaveBeenCalled();
  });

  it.each(['busy', 'timeout', 'unsupported'] as const)('preserves %s errors', async code => {
    const { session, capture } = setup();
    const error = new CaptureError(code, 'Unavailable');
    capture.select.mockRejectedValueOnce(error);
    await expect(session.start()).rejects.toBe(error);
  });

  it.each(['read', 'decode', 'copy'] as const)('releases the lease when %s fails and allows retry', async stage => {
    const { session, capture, decode, copy } = setup();
    const failure = new Error(`${stage} failed`);
    if (stage === 'read') capture.readImage.mockRejectedValueOnce(failure);
    if (stage === 'decode') decode.mockRejectedValueOnce(failure);
    if (stage === 'copy') copy.mockRejectedValueOnce(failure);
    await expect(session.start()).rejects.toMatchObject({ message: failure.message });
    expect(capture.release).toHaveBeenCalledExactlyOnceWith('image-1');
    if (stage !== 'copy') expect(copy).not.toHaveBeenCalled();
    await expect(session.start()).resolves.toEqual(color);
  });

  it('requires explicit true clipboard confirmation', async () => {
    const { session, capture, copy } = setup();
    copy.mockResolvedValueOnce(false);
    await expect(session.start()).rejects.toMatchObject({ code: 'outputFailed' });
    expect(capture.release).toHaveBeenCalledExactlyOnceWith('image-1');
  });

  it('rejects a non-pixel result and still releases it', async () => {
    const { session, capture, decode, copy } = setup();
    capture.select.mockResolvedValueOnce({ ...completed, image: { ...completed.image, width: 2 } });
    await expect(session.start()).rejects.toMatchObject({ code: 'captureFailed' });
    expect(decode).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(capture.release).toHaveBeenCalledExactlyOnceWith('image-1');
  });

  it('preserves the original failure when release also fails', async () => {
    const { session, capture } = setup();
    const error = new CaptureError('notFound', 'Expired');
    capture.readImage.mockRejectedValueOnce(error);
    capture.release.mockRejectedValueOnce(new Error('Release failed'));
    await expect(session.start()).rejects.toBe(error);
  });

  it('reports a release failure and unlocks the next start', async () => {
    const { session, capture } = setup();
    capture.release.mockRejectedValueOnce({ code: 'forbidden', message: 'Wrong owner' });
    await expect(session.start()).rejects.toMatchObject({ code: 'forbidden' });
    await expect(session.start()).resolves.toEqual(color);
  });

  it('holds the in-flight guard through copy and release', async () => {
    const { session, capture, copy } = setup();
    const copying = deferred<boolean>();
    const releasing = deferred<void>();
    copy.mockReturnValueOnce(copying.promise);
    capture.release.mockReturnValueOnce(releasing.promise);
    const running = session.start();
    await expect(session.start()).resolves.toBeNull();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
    await expect(session.start()).resolves.toBeNull();
    copying.resolve(true);
    await vi.waitFor(() => expect(capture.release).toHaveBeenCalledOnce());
    await expect(session.start()).resolves.toBeNull();
    releasing.resolve();
    await expect(running).resolves.toEqual(color);
    expect(capture.select).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'dispose'] as const)('aborts on %s and releases late completed results without reading or copying', async action => {
    const { session, capture, copy } = setup();
    const result = deferred<CaptureResult>();
    capture.select.mockReturnValueOnce(result.promise);
    const running = session.start();
    await vi.waitFor(() => expect(capture.select).toHaveBeenCalledOnce());
    session[action]();
    expect(capture.select.mock.calls[0][1]?.aborted).toBe(true);
    await expect(session.start()).resolves.toBeNull();
    result.resolve(completed);
    await expect(running).resolves.toBeNull();
    expect(capture.readImage).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(capture.release).toHaveBeenCalledExactlyOnceWith('image-1');
    if (action === 'dispose') await expect(session.start()).resolves.toBeNull();
    else await expect(session.start()).resolves.toEqual(color);
  });

  it.each(['read', 'decode'] as const)('discards a late %s after unmount and releases the lease', async stage => {
    const { session, capture, decode, copy } = setup();
    const reading = deferred<Uint8Array>();
    const decoding = deferred<RGB>();
    if (stage === 'read') capture.readImage.mockReturnValueOnce(reading.promise);
    else decode.mockReturnValueOnce(decoding.promise);
    const running = session.start();
    await vi.waitFor(() => expect(stage === 'read' ? capture.readImage : decode).toHaveBeenCalledOnce());
    session.dispose();
    reading.resolve(png); decoding.resolve(color);
    await expect(running).resolves.toBeNull();
    expect(copy).not.toHaveBeenCalled();
    expect(capture.release).toHaveBeenCalledExactlyOnceWith('image-1');
  });
});

describe('1×1 PNG decoding', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function canvasFixture(width = 1, rejects = false) {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:pixel'), revokeObjectURL: revoke });
    vi.stubGlobal('Image', class {
      src = ''; naturalWidth = width; naturalHeight = 1;
      async decode() { if (rejects) throw new Error('Bad PNG'); }
    });
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([18, 52, 86, 255]) }));
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      const element = createElement(tag, options);
      if (element instanceof HTMLCanvasElement) Object.defineProperty(element, 'getContext', { value: () => ({ drawImage, getImageData }) });
      return element;
    });
    return { revoke, drawImage, getImageData };
  }
  it('decodes the original single pixel through a detached Canvas and revokes the URL', async () => {
    const { revoke, drawImage, getImageData } = canvasFixture();
    await expect(decodeColorPng(png)).resolves.toEqual({ r: 18, g: 52, b: 86 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(document.querySelector('canvas')).toBeNull();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:pixel');
  });
  it.each(['size', 'decode'] as const)('revokes the URL on a %s failure', async failure => {
    const { revoke } = canvasFixture(failure === 'size' ? 2 : 1, failure === 'decode');
    await expect(decodeColorPng(png)).rejects.toThrow();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:pixel');
  });
});
