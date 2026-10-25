// Rebuilds visual lines and word positions from positioned PDF text items.
import { isNumericToken } from "./parseUtils";

export interface TextItem {
  str: string;
  x: number;
  y: number; // PDF user-space y (origin bottom-left)
  w: number;
  h: number;
}

export interface Word {
  text: string;
  x0: number;
  x1: number;
}

export interface Line {
  y: number;
  h: number;
  words: Word[];
  text: string;
  /** char offset in `text` where each word starts */
  offsets: number[];
}

/** Group text items into lines (top to bottom) and split them into positioned words. */
export function buildLines(items: TextItem[]): Line[] {
  const clean = items.filter((it) => it.str && it.str.trim().length > 0);
  clean.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; h: number; items: TextItem[] }[] = [];
  for (const it of clean) {
    const h = Math.max(it.h || 0, 4);
    const tol = Math.max(2, h * 0.45);
    let g = groups.length ? groups[groups.length - 1] : undefined;
    if (!g || Math.abs(g.y - it.y) > tol) {
      // search recent groups (items are mostly sorted already)
      g = undefined;
      for (let i = groups.length - 1; i >= Math.max(0, groups.length - 3); i--) {
        if (Math.abs(groups[i].y - it.y) <= tol) {
          g = groups[i];
          break;
        }
      }
    }
    if (!g) {
      g = { y: it.y, h, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  const lines: Line[] = [];
  for (const g of groups) {
    g.items.sort((a, b) => a.x - b.x);
    const words: Word[] = [];
    for (const it of g.items) {
      const s = it.str;
      const len = s.length || 1;
      const cw = it.w > 0 ? it.w / len : (it.h || 8) * 0.5;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        words.push({ text: m[0], x0: it.x + m.index * cw, x1: it.x + (m.index + m[0].length) * cw });
      }
    }
    words.sort((a, b) => a.x0 - b.x0);
    const merged = mergeWords(words, g.h);
    let text = "";
    const offsets: number[] = [];
    for (const w of merged) {
      if (text.length) text += " ";
      offsets.push(text.length);
      text += w.text;
    }
    lines.push({ y: g.y, h: g.h, words: merged, text, offsets });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/** Merge fragments that belong together, e.g. "(" "1,234.5" ")" or "1,234" ".56". */
function mergeWords(words: Word[], h: number): Word[] {
  const out: Word[] = [];
  const tight = Math.max(0.8, h * 0.18);
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = w.x0 - prev.x1;
      const joinable =
        gap < tight &&
        (/^[()]$/.test(prev.text) || /^[()]$/.test(w.text) || /^\.\d+\)?$/.test(w.text) || (/[\d,]$/.test(prev.text) && /^[\d,.)]/.test(w.text)));
      if (joinable) {
        prev.text += w.text;
        prev.x1 = w.x1;
        continue;
      }
    }
    out.push({ ...w });
  }
  return out;
}

export interface SplitLine {
  label: string;
  numbers: Word[];
}

/** Split a line into its text label and trailing numeric tokens. */
export function splitLabelNumbers(line: Line): SplitLine {
  const words = line.words;
  let i = words.length;
  while (i > 0 && isNumericToken(words[i - 1].text)) i--;
  const labelWords = words.slice(0, i);
  // A label ending with an opening bracket number like "Note 3" is kept in label.
  return { label: labelWords.map((w) => w.text).join(" "), numbers: words.slice(i) };
}

/** x-centre of the words covering char range [start, start+len) in a line's text. */
export function xCenterOfRange(line: Line, start: number, len: number): number {
  const end = start + len;
  let x0 = Infinity;
  let x1 = -Infinity;
  line.words.forEach((w, idx) => {
    const ws = line.offsets[idx];
    const we = ws + w.text.length;
    if (we > start && ws < end) {
      x0 = Math.min(x0, w.x0);
      x1 = Math.max(x1, w.x1);
    }
  });
  if (!Number.isFinite(x0)) return NaN;
  return (x0 + x1) / 2;
}

export function xStartOfRange(line: Line, start: number): number {
  for (let idx = 0; idx < line.words.length; idx++) {
    const ws = line.offsets[idx];
    const we = ws + line.words[idx].text.length;
    if (we > start) return line.words[idx].x0;
  }
  return NaN;
}
