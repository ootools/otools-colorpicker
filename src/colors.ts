export interface RGB {
  r: number
  g: number
  b: number
}

function channel(value: number): number {
  return Number.isNaN(value) ? 0 : Math.round(Math.min(255, Math.max(0, value)))
}

export function normalizeHex(value: string): string | null {
  const digits = value.startsWith('#') ? value.slice(1) : value
  if ((digits.length !== 3 && digits.length !== 6) || /[^0-9a-f]/i.test(digits)) {
    return null
  }
  const expanded = digits.length === 3
    ? [...digits].map((digit) => digit + digit).join('')
    : digits
  return `#${expanded.toUpperCase()}`
}

export function rgbToHex(rgb: RGB): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => channel(value).toString(16).padStart(2, '0'))
    .join('').toUpperCase()}`
}

export function rgbToHsl(rgb: RGB): { h: number; s: number; l: number } {
  const r = channel(rgb.r) / 255
  const g = channel(rgb.g) / 255
  const b = channel(rgb.b) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) }
  }

  let hue: number
  if (max === r) {
    hue = (g - b) / delta
  } else if (max === g) {
    hue = (b - r) / delta + 2
  } else {
    hue = (r - g) / delta + 4
  }

  return {
    h: (Math.round(hue * 60) + 360) % 360,
    s: Math.round(delta / (1 - Math.abs(2 * lightness - 1)) * 100),
    l: Math.round(lightness * 100),
  }
}

export function formatColor(rgb: RGB, format: 'hex' | 'rgb' | 'hsl'): string {
  if (format === 'hex') return rgbToHex(rgb)
  if (format === 'rgb') return `rgb(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)})`
  const { h, s, l } = rgbToHsl(rgb)
  return `hsl(${h}, ${s}%, ${l}%)`
}

export function appendRecent(history: string[], hex: string, limit = 24): string[] {
  if (!Number.isFinite(limit) || limit < 1) return []
  const capacity = Math.floor(limit)
  const recent = new Set<string>()
  for (const value of [hex, ...history]) {
    const normalized = normalizeHex(value)
    if (normalized !== null) recent.add(normalized)
    if (recent.size === capacity) break
  }
  return [...recent]
}

function validDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0
}

export function mapPointerToPixel(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  image: { width: number; height: number },
): { x: number; y: number } | null {
  if (
    ![client.x, client.y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0
    || !validDimensions(image.width, image.height)
  ) return null

  const x = client.x - rect.left
  const y = client.y - rect.top
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null

  // The canvas CSS rectangle is the rendered image, with no internal letterboxing.
  return {
    x: Math.min(image.width - 1, Math.floor(x / rect.width * image.width)),
    y: Math.min(image.height - 1, Math.floor(y / rect.height * image.height)),
  }
}

export function samplePixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): RGB | null {
  if (
    !validDimensions(width, height)
    || !Number.isSafeInteger(width * height * 4)
    || data.length !== width * height * 4
    || !Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= width || y >= height
  ) return null

  const offset = (y * width + x) * 4
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
}
