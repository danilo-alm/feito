import type { HexAccent } from "@feito/core/types";

type Rgb = [number, number, number];
export type Hsv = { hue: number; saturation: number; brightness: number };

const rgb = (hex: HexAccent): Rgb => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

function hex(channels: Rgb): HexAccent {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function toHsv(color: HexAccent, previousHue = 0): Hsv {
  const [red, green, blue] = rgb(color).map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const span = max - Math.min(red, green, blue);
  let hue = previousHue;
  if (span > 0) {
    const sector = max === red ? (green - blue) / span
      : max === green ? 2 + (blue - red) / span
      : 4 + (red - green) / span;
    hue = (sector * 60 + 360) % 360;
  }
  return { hue, saturation: max ? span / max : 0, brightness: max };
}

export function fromHsv({ hue, saturation, brightness }: Hsv): HexAccent {
  const channel = (offset: number) => {
    const sector = (hue / 60 + offset) % 6;
    return 255 * brightness * (1 - saturation * Math.max(0, Math.min(sector, 4 - sector, 1)));
  };
  return hex([channel(5), channel(3), channel(1)]);
}

function luminance(color: HexAccent) {
  const [red, green, blue] = rgb(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function mix(color: HexAccent, target: number, weight: number): HexAccent {
  const [red, green, blue] = rgb(color).map((value) => value + (target - value) * weight);
  return hex([red, green, blue]);
}

function tint(color: HexAccent, surface: HexAccent, weight: number) {
  const base = rgb(surface);
  const [red, green, blue] = rgb(color).map((channel, index) => base[index] + (channel - base[index]) * weight);
  return hex([red, green, blue]);
}

/** Preserve the chosen RGB value and derive a readable accent for the active theme. */
export function customAccentTokens(color: HexAccent, dark: boolean) {
  let accent = color;
  let low = 0;
  let high = 1;
  const target = dark ? 255 : 0;
  const foreground = dark ? "#141518" : "#ffffff";
  const readable = (candidate: HexAccent) => {
    const level = luminance(candidate) + 0.05;
    const onButton = luminance(foreground) + 0.05;
    // The accent doubles as text on tinted surfaces in all three Feito themes.
    return dark
      ? level >= 4.5 * Math.max(onButton, luminance(tint(candidate, "#1d1f23", 0.16)) + 0.05,
        luminance(tint(candidate, "#0b0c0e", 0.2)) + 0.05)
      : Math.min(onButton, luminance(tint(candidate, "#efefea", 0.12)) + 0.05) >= 4.5 * level;
  };
  if (!readable(color)) {
    for (let step = 0; step < 9; step++) {
      const weight = (low + high) / 2;
      if (readable(mix(color, target, weight))) high = weight;
      else low = weight;
    }
    accent = mix(color, target, high);
  }
  return { accent, hover: mix(accent, target, 0.16), foreground };
}
