import { describe, expect, it } from 'vitest'
import {
  appendRecent,
  formatColor,
  mapPointerToPixel,
  normalizeHex,
  rgbToHex,
  rgbToHsl,
  samplePixel,
  type RGB,
} from './colors'

describe('normalizeHex', () => {
  it.each([
    ['#abc', '#AABBCC'],
    ['f09', '#FF0099'],
    ['#a1b2c3', '#A1B2C3'],
    ['00ff80', '#00FF80'],
    ['#000', '#000000'],
    ['FFF', '#FFFFFF'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected)
  })

  it.each(['', '#', '#12', '#1234', '12345', '#1234567', '#12345678', '#ggg', '##abc', '0x123456', ' #abc', '#abc ', '#abc\n'])('rejects malformed input %j', (input) => {
    expect(normalizeHex(input)).toBeNull()
  })
})

const conversions: { name: string; rgb: RGB; hex: string; hsl: { h: number; s: number; l: number } }[] = [
  { name: 'red', rgb: { r: 255, g: 0, b: 0 }, hex: '#FF0000', hsl: { h: 0, s: 100, l: 50 } },
  { name: 'green', rgb: { r: 0, g: 255, b: 0 }, hex: '#00FF00', hsl: { h: 120, s: 100, l: 50 } },
  { name: 'blue', rgb: { r: 0, g: 0, b: 255 }, hex: '#0000FF', hsl: { h: 240, s: 100, l: 50 } },
  { name: 'yellow', rgb: { r: 255, g: 255, b: 0 }, hex: '#FFFF00', hsl: { h: 60, s: 100, l: 50 } },
  { name: 'cyan', rgb: { r: 0, g: 255, b: 255 }, hex: '#00FFFF', hsl: { h: 180, s: 100, l: 50 } },
  { name: 'magenta', rgb: { r: 255, g: 0, b: 255 }, hex: '#FF00FF', hsl: { h: 300, s: 100, l: 50 } },
  { name: 'gray', rgb: { r: 128, g: 128, b: 128 }, hex: '#808080', hsl: { h: 0, s: 0, l: 50 } },
  { name: 'black', rgb: { r: 0, g: 0, b: 0 }, hex: '#000000', hsl: { h: 0, s: 0, l: 0 } },
  { name: 'white', rgb: { r: 255, g: 255, b: 255 }, hex: '#FFFFFF', hsl: { h: 0, s: 0, l: 100 } },
  { name: 'steel blue', rgb: { r: 70, g: 130, b: 180 }, hex: '#4682B4', hsl: { h: 207, s: 44, l: 49 } },
]

describe('RGB conversions', () => {
  it.each(conversions)('converts $name to hex', ({ rgb, hex }) => {
    expect(rgbToHex(rgb)).toBe(hex)
  })

  it.each(conversions)('converts $name to HSL', ({ rgb, hsl }) => {
    expect(rgbToHsl(rgb)).toEqual(hsl)
  })

  it('clamps and rounds channels before formatting', () => {
    expect(rgbToHex({ r: -10, g: 127.5, b: 300 })).toBe('#0080FF')
    expect(rgbToHex({ r: 0.49, g: 15.49, b: 15.5 })).toBe('#000F10')
    expect(rgbToHsl({ r: 300, g: -1, b: 0.4 })).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('keeps non-finite channels within the RGB range', () => {
    expect(rgbToHex({ r: NaN, g: Infinity, b: -Infinity })).toBe('#00FF00')
  })

  it('wraps hue rounded to 360 back to zero', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 1 })).toEqual({ h: 0, s: 100, l: 50 })
  })
})

describe('formatColor', () => {
  it('formats conventional hex, RGB, and HSL strings', () => {
    const rgb = { r: 70, g: 130, b: 180 }
    expect(formatColor(rgb, 'hex')).toBe('#4682B4')
    expect(formatColor(rgb, 'rgb')).toBe('rgb(70, 130, 180)')
    expect(formatColor(rgb, 'hsl')).toBe('hsl(207, 44%, 49%)')
  })

  it('uses clamped integer channels for RGB strings', () => {
    expect(formatColor({ r: -1, g: 12.6, b: 256 }, 'rgb')).toBe('rgb(0, 13, 255)')
  })
})

describe('appendRecent', () => {
  it('moves an existing color to the front and normalizes all entries', () => {
    const history = ['#abc', '00ff00', '#AABBCC', 'bad input', '#123456', '#0f0']
    expect(appendRecent(history, '0F0')).toEqual(['#00FF00', '#AABBCC', '#123456'])
    expect(history).toEqual(['#abc', '00ff00', '#AABBCC', 'bad input', '#123456', '#0f0'])
  })

  it('caps history after deduplication', () => {
    expect(appendRecent(['#abc', '#ABC', '#123456', '#fff'], '#000', 3)).toEqual(['#000000', '#AABBCC', '#123456'])
  })

  it('ignores an invalid new color while cleaning existing history', () => {
    expect(appendRecent(['#abc', 'invalid', '#ABC', '#fff'], '#nope')).toEqual(['#AABBCC', '#FFFFFF'])
  })

  it('defaults to at most 24 recent colors', () => {
    const history = Array.from({ length: 24 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`)
    const result = appendRecent(history, '#fff')
    expect(result).toHaveLength(24)
    expect(result[0]).toBe('#FFFFFF')
    expect(result.at(-1)).toBe('#000016')
  })

  it.each([0, -1, NaN])('returns no entries for unusable limit %s', (limit) => {
    expect(appendRecent(['#fff'], '#000', limit)).toEqual([])
  })

  it('floors fractional limits', () => {
    expect(appendRecent(['#fff', '#abc'], '#000', 1.9)).toEqual(['#000000'])
  })
})

describe('mapPointerToPixel', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }
  const image = { width: 400, height: 200 }

  it('maps CSS positions into high-DPI pixels and floors fractions', () => {
    expect(mapPointerToPixel({ x: 100, y: 50 }, rect, image)).toEqual({ x: 0, y: 0 })
    expect(mapPointerToPixel({ x: 150.9, y: 75.9 }, rect, image)).toEqual({ x: 101, y: 51 })
  })

  it('uses independent horizontal and vertical scale factors', () => {
    expect(mapPointerToPixel({ x: 160, y: 80 }, rect, { width: 1000, height: 300 })).toEqual({ x: 300, y: 90 })
  })

  it('clamps the exact bottom and right edges to the final pixel', () => {
    expect(mapPointerToPixel({ x: 300, y: 150 }, rect, image)).toEqual({ x: 399, y: 199 })
  })

  it.each([
    { x: 99.99, y: 75 },
    { x: 300.01, y: 75 },
    { x: 150, y: 49.99 },
    { x: 150, y: 150.01 },
    { x: NaN, y: 75 },
    { x: 150, y: Infinity },
  ])('rejects outside or non-finite pointer %j', (client) => {
    expect(mapPointerToPixel(client, rect, image)).toBeNull()
  })

  it.each([
    { ...rect, width: 0 },
    { ...rect, height: -1 },
    { ...rect, width: Infinity },
    { ...rect, left: NaN },
    { ...rect, top: Infinity },
  ])('rejects invalid canvas geometry %j', (invalidRect) => {
    expect(mapPointerToPixel({ x: 150, y: 75 }, invalidRect, image)).toBeNull()
  })

  it.each([
    { width: 0, height: 200 },
    { width: 400, height: -1 },
    { width: 1.5, height: 200 },
    { width: 400, height: NaN },
    { width: Infinity, height: 200 },
  ])('rejects invalid image dimensions %j', (invalidImage) => {
    expect(mapPointerToPixel({ x: 150, y: 75 }, rect, invalidImage)).toBeNull()
  })
})

describe('samplePixel', () => {
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 128,
    0, 0, 255, 0, 12, 34, 56, 255,
  ])

  it('samples row-major RGBA data without treating alpha as a color channel', () => {
    expect(samplePixel(data, 2, 2, 0, 0)).toEqual({ r: 255, g: 0, b: 0 })
    expect(samplePixel(data, 2, 2, 1, 0)).toEqual({ r: 0, g: 255, b: 0 })
    expect(samplePixel(data, 2, 2, 0, 1)).toEqual({ r: 0, g: 0, b: 255 })
    expect(samplePixel(data, 2, 2, 1, 1)).toEqual({ r: 12, g: 34, b: 56 })
  })

  it.each([
    [-1, 0], [0, -1], [2, 0], [0, 2], [0.5, 0], [0, 1.5], [NaN, 0], [0, Infinity],
  ])('rejects out-of-bounds or non-integer pixel (%s, %s)', (x, y) => {
    expect(samplePixel(data, 2, 2, x, y)).toBeNull()
  })

  it.each([
    [0, 2], [2, 0], [-2, 2], [2, -2], [1.5, 2], [2, 1.5], [NaN, 2], [2, Infinity],
  ])('rejects invalid dimensions (%s, %s)', (width, height) => {
    expect(samplePixel(data, width, height, 0, 0)).toBeNull()
  })

  it.each([0, 15, 17, 20])('rejects mismatched RGBA buffer length %s', (length) => {
    expect(samplePixel(new Uint8ClampedArray(length), 2, 2, 0, 0)).toBeNull()
  })
})
