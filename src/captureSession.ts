import { CaptureError, type CaptureApi, type CaptureErrorCode } from 'otools-plugin-sdk/capture-factory';
import type { RGB } from './colors';

export type ColorCaptureTransport = Pick<CaptureApi, 'select' | 'readImage' | 'release'>;

export interface CaptureSessionDependencies {
  capture: ColorCaptureTransport;
  hidePanel: () => Promise<void>;
  decode: (bytes: Uint8Array) => Promise<RGB>;
  copy: (color: RGB) => Promise<boolean>;
}

export interface CaptureSession {
  start(options?: { panelAlreadyHidden?: boolean; freezeScreen?: boolean }): Promise<RGB | null>;
  cancel(): void;
  dispose(): void;
}

const errorCodes: readonly CaptureErrorCode[] = [
  'unsupported', 'permissionDenied', 'busy', 'cancelled', 'timeout',
  'notFound', 'invalidRequest', 'forbidden', 'captureFailed', 'outputFailed',
];

function asCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  let value = error;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* Plain error message. */ }
  }
  const record = value && typeof value === 'object' ? value : undefined;
  const code = record && 'code' in record ? errorCodes.find(code => code === record.code) : undefined;
  const aborted = record && 'name' in record && record.name === 'AbortError';
  const message = record && 'message' in record && typeof record.message === 'string' ? record.message : String(error);
  return new CaptureError(code ?? (aborted ? 'cancelled' : 'captureFailed'), message);
}

/** Decode only the native overlay's completed pixel, never a displayed screenshot. */
export async function decodeColorPng(bytes: Uint8Array): Promise<RGB> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'image/png' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== 1 || image.naturalHeight !== 1) throw new CaptureError('captureFailed', 'Expected a 1×1 PNG');
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new CaptureError('captureFailed', 'Unable to decode the selected color');
    context.drawImage(image, 0, 0);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  } finally { URL.revokeObjectURL(url); }
}

export function createCaptureSession(deps: CaptureSessionDependencies): CaptureSession {
  let disposed = false;
  let active: AbortController | undefined;
  const cancel = () => active?.abort();

  return {
    async start({ panelAlreadyHidden = false, freezeScreen = false } = {}) {
      if (disposed || active) return null;
      const controller = new AbortController();
      active = controller;
      const cancelled = () => disposed || controller.signal.aborted;
      let imageId: string | undefined;
      let color: RGB | null = null;
      let failure: CaptureError | undefined;
      const recordFailure = (error: unknown) => {
        const normalized = asCaptureError(error);
        if (normalized.code !== 'cancelled') failure ??= normalized;
      };

      try {
        // Direct requests were hidden on host acceptance; preserve any later Option reveal.
        if (!panelAlreadyHidden) await deps.hidePanel();
        if (cancelled()) return null;
        const result = await deps.capture.select({ mode: 'color', edit: false, hideHost: false, restoreHost: false, freezeScreen }, controller.signal);
        if (result.status === 'completed') {
          // Keep the lease even for a late/cancelled response, so finally can release it.
          imageId = result.image.imageId;
          if (!cancelled()) {
            if (result.image.mimeType !== 'image/png' || result.image.width !== 1 || result.image.height !== 1) {
              throw new CaptureError('captureFailed', 'Expected a 1×1 PNG');
            }
            const bytes = await deps.capture.readImage(imageId);
            if (!cancelled()) {
              color = await deps.decode(bytes);
              if (!cancelled()) {
                try {
                  if (await deps.copy(color) !== true) throw new Error('Clipboard write was not confirmed');
                } catch (error) {
                  throw new CaptureError('outputFailed', error instanceof Error ? error.message : String(error));
                }
              }
            }
          }
        } else if (result.status === 'error' && !cancelled()) {
          throw new CaptureError(result.error.code, result.error.message);
        }
      } catch (error) {
        if (!cancelled()) recordFailure(error);
      } finally {
        try {
          if (imageId !== undefined) {
            try { await deps.capture.release(imageId); }
            catch (error) { if (!cancelled()) recordFailure(error); }
          }
        } finally {
          // Duplicate launches stay blocked until the image lease is released.
          active = undefined;
        }
      }

      if (cancelled()) return null;
      if (failure) throw failure;
      return color;
    },
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
