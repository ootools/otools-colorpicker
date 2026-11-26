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

export type ColorFormatName = 'hex' | 'rgb' | 'hsl' | 'hexa' | 'rgba' | 'hsla' | 'hsv' | 'cmyk' | 'lab'

export function formatColor(rgb: RGB, format: ColorFormatName, alpha = 1): string {
  if (format === 'hex') return rgbToHex(rgb)
  if (format === 'rgb') return `rgb(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)})`
  if (format === 'hsl') {
    const { h, s, l } = rgbToHsl(rgb)
    return `hsl(${h}, ${s}%, ${l}%)`
  }
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0
  const alphaText = Number(a.toFixed(2))
  if (format === 'hexa') return `${rgbToHex(rgb)}${Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()}`
  if (format === 'rgba') return `rgba(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)}, ${alphaText})`
  if (format === 'hsla') {
    const { h, s, l } = rgbToHsl(rgb)
    return `hsla(${h}, ${s}%, ${l}%, ${alphaText})`
  }
  if (format === 'hsv') {
    const { h, s, v } = rgbToHsv(rgb)
    return `hsv(${h}, ${s}%, ${v}%)`
  }
  if (format === 'cmyk') {
    const { c, m, y, k } = rgbToCmyk(rgb)
    return `cmyk(${c}%, ${m}%, ${y}%, ${k}%)`
  }
  const lab = rgbToLab(rgb)
  return `lab(${lab.l}, ${lab.a}, ${lab.b})`
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

export interface HSV { h: number; s: number; v: number }
export interface CMYK { c: number; m: number; y: number; k: number }
export interface LAB { l: number; a: number; b: number }

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value)))
}

function rounded(value: number): number {
  const result = Math.round(finite(value))
  return result === 0 ? 0 : result
}

function hueOf(rgb: RGB, max: number, delta: number): number {
  const r = channel(rgb.r) / 255
  const g = channel(rgb.g) / 255
  const b = channel(rgb.b) / 255
  let hue = 0
  if (delta !== 0) {
    if (max === r) hue = (g - b) / delta
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    hue = (Math.round(hue * 60) + 360) % 360
  }
  return hue
}

export function rgbToHsv(rgb: RGB): HSV {
  const r = channel(rgb.r) / 255
  const g = channel(rgb.g) / 255
  const b = channel(rgb.b) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  return {
    h: hueOf(rgb, max, delta),
    s: max === 0 ? 0 : Math.round(delta / max * 100),
    v: Math.round(max * 100),
  }
}

export function hsvToRgb(hsv: HSV): RGB {
  const h = ((finite(hsv.h) % 360) + 360) % 360
  const s = clamp(hsv.s, 0, 100) / 100
  const v = clamp(hsv.v, 0, 100) / 100
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  const sectors: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x],
  ]
  const [r, g, b] = sectors[Math.min(5, Math.floor(h / 60))]
  return { r: channel((r + m) * 255), g: channel((g + m) * 255), b: channel((b + m) * 255) }
}

export function hslToRgb(hsl: { h: number; s: number; l: number }): RGB {
  const s = clamp(hsl.s, 0, 100) / 100
  const l = clamp(hsl.l, 0, 100) / 100
  const v = l + s * Math.min(l, 1 - l)
  const sv = v === 0 ? 0 : 2 * (1 - l / v)
  return hsvToRgb({ h: finite(hsl.h), s: sv * 100, v: v * 100 })
}

export function rgbToCmyk(rgb: RGB): CMYK {
  const r = channel(rgb.r) / 255
  const g = channel(rgb.g) / 255
  const b = channel(rgb.b) / 255
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round((1 - r - k) / (1 - k) * 100),
    m: Math.round((1 - g - k) / (1 - k) * 100),
    y: Math.round((1 - b - k) / (1 - k) * 100),
    k: Math.round(k * 100),
  }
}

export function cmykToRgb(cmyk: CMYK): RGB {
  const c = clamp(cmyk.c, 0, 100) / 100
  const m = clamp(cmyk.m, 0, 100) / 100
  const y = clamp(cmyk.y, 0, 100) / 100
  const k = clamp(cmyk.k, 0, 100) / 100
  return {
    r: channel(255 * (1 - c) * (1 - k)),
    g: channel(255 * (1 - m) * (1 - k)),
    b: channel(255 * (1 - y) * (1 - k)),
  }
}

function srgbToLinear(value: number): number {
  const normalized = channel(value) / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const normalized = clamp(value, 0, 1)
  return normalized <= 0.0031308 ? normalized * 12.92 : 1.055 * normalized ** (1 / 2.4) - 0.055
}

function labF(t: number): number {
  return t > 0.008856451679 ? Math.cbrt(t) : 7.787037 * t + 16 / 116
}

function labFInverse(f: number): number {
  const cubed = f ** 3
  return cubed > 0.008856451679 ? cubed : (f - 16 / 116) / 7.787037
}

export function rgbToLab(rgb: RGB): LAB {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  const x = labF((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047)
  const y = labF(r * 0.2126729 + g * 0.7151522 + b * 0.0721750)
  const z = labF((r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883)
  return {
    l: rounded(116 * y - 16),
    a: rounded(500 * (x - y)),
    b: rounded(200 * (y - z)),
  }
}

export function labToRgb(lab: LAB): RGB {
  const fy = (clamp(lab.l, 0, 100) + 16) / 116
  const fx = fy + clamp(lab.a, -128, 127) / 500
  const fz = fy - clamp(lab.b, -128, 127) / 200
  const x = labFInverse(fx) * 0.95047
  const y = labFInverse(fy)
  const z = labFInverse(fz) * 1.08883
  return {
    r: channel(linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314) * 255),
    g: channel(linearToSrgb(x * -0.969266 + y * 1.8760108 + z * 0.041556) * 255),
    b: channel(linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252) * 255),
  }
}

interface ColorToken { value: number; percent: boolean }

function parseTokens(body: string): ColorToken[] | null {
  const tokens: ColorToken[] = []
  for (const raw of body.split(/[\s,/]+/)) {
    if (!raw) continue
    const percent = raw.endsWith('%')
    const value = Number(raw.replace(/deg|%/gi, ''))
    if (!Number.isFinite(value) || !/^[+-]?(\d+\.?\d*|\.\d+)(deg|%)?$/i.test(raw)) return null
    tokens.push({ value, percent })
  }
  return tokens.length ? tokens : null
}

/** Parses the color notations used by common design tools; alpha is read but ignored. */
export function parseColor(input: string): RGB | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null

  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)
  if (hex) {
    const digits = hex[1]
    if (digits.length <= 4) {
      return {
        r: parseInt(digits[0] + digits[0], 16),
        g: parseInt(digits[1] + digits[1], 16),
        b: parseInt(digits[2] + digits[2], 16),
      }
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    }
  }

  const functional = /^(rgba?|hsla?|hsva?|cmyk|lab)\s*\(([^()]*)\)$/i.exec(value)
  if (!functional) return null
  const kind = functional[1].toLowerCase()
  const tokens = parseTokens(functional[2])
  if (!tokens) return null
  const count = tokens.length

  if (kind.startsWith('rgb')) {
    if (count !== 3 && count !== 4) return null
    const toByte = (token: ColorToken) => channel(token.value * (token.percent ? 2.55 : 1))
    return { r: toByte(tokens[0]), g: toByte(tokens[1]), b: toByte(tokens[2]) }
  }
  if (kind.startsWith('hsl') || kind.startsWith('hsv')) {
    if (count !== 3 && count !== 4) return null
    const h = ((tokens[0].value % 360) + 360) % 360
    const s = clamp(tokens[1].value, 0, 100)
    const third = clamp(tokens[2].value, 0, 100)
    return kind.startsWith('hsl') ? hslToRgb({ h, s, l: third }) : hsvToRgb({ h, s, v: third })
  }
  if (kind === 'cmyk' && count === 4) {
    return cmykToRgb({ c: tokens[0].value, m: tokens[1].value, y: tokens[2].value, k: tokens[3].value })
  }
  if (kind === 'lab' && count === 3) {
    return labToRgb({ l: tokens[0].value, a: tokens[1].value, b: tokens[2].value })
  }
  return null
}
