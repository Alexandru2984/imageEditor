import { Mask } from "./mask";
import { sameGrid, type DocumentGrid, type PixelSelection } from "./state";

/**
 * Selections as the undo history keeps them: run-length encoded, since a
 * selection is mostly long runs of 0 and 255 (a rectangle on a 12 MP photo
 * is a few kilobytes instead of 12 MB). A mask with too few runs for that
 * to pay is kept as it is: masks are never changed once made.
 */
export interface StoredSelection {
  grid: DocumentGrid;
  width: number;
  height: number;
  /** Runs (a value byte, then the run's length as a base-128 varint), or the bytes themselves. */
  bytes: Uint8Array;
  encoded: boolean;
}

/** The size of the runs' encoding, or -1 once it would be no smaller than the mask. */
function encodedSize(data: Uint8Array): number {
  let size = 0;
  let index = 0;
  while (index < data.length) {
    const value = data[index]!;
    let end = index + 1;
    while (end < data.length && data[end] === value) end += 1;
    let length = end - index;
    size += 2;
    while (length >= 128) {
      length >>>= 7;
      size += 1;
    }
    if (size >= data.length) return -1;
    index = end;
  }
  return size;
}

export function encodeRuns(data: Uint8Array): Uint8Array | null {
  const size = encodedSize(data);
  if (size < 0) return null;
  const out = new Uint8Array(size);
  let at = 0;
  let index = 0;
  while (index < data.length) {
    const value = data[index]!;
    let end = index + 1;
    while (end < data.length && data[end] === value) end += 1;
    out[at++] = value;
    let length = end - index;
    while (length >= 128) {
      out[at++] = (length & 127) | 128;
      length >>>= 7;
    }
    out[at++] = length;
    index = end;
  }
  return out;
}

export function decodeRuns(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  let index = 0;
  while (index < bytes.length && at < length) {
    const value = bytes[index++]!;
    let run = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[index++] ?? 0;
      run += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    const end = Math.min(length, at + run);
    if (value) out.fill(value, at, end);
    at = end;
  }
  return out;
}

const stored = new WeakMap<Mask, StoredSelection>();

/** A selection to keep in the history; the same mask is encoded once. */
export function storeSelection(selection: PixelSelection | null): StoredSelection | null {
  if (!selection) return null;
  const { mask, grid } = selection;
  const known = stored.get(mask);
  if (known && sameGrid(known.grid, grid)) return known;
  const runs = encodeRuns(mask.data);
  const record: StoredSelection = { grid, width: mask.width, height: mask.height, bytes: runs ?? mask.data, encoded: !!runs };
  stored.set(mask, record);
  return record;
}

/** A kept selection as one to set again. */
export function restoreSelection(record: StoredSelection): PixelSelection {
  const data = record.encoded ? decodeRuns(record.bytes, record.width * record.height) : record.bytes;
  const mask = new Mask(record.width, record.height, data);
  stored.set(mask, record);
  return { grid: record.grid, mask };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
};

export function sameStoredSelection(a: StoredSelection | null, b: StoredSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.width === b.width && a.height === b.height && a.encoded === b.encoded && sameGrid(a.grid, b.grid) && sameBytes(a.bytes, b.bytes);
}

/** What a kept selection costs in memory. */
export const storedSize = (record: StoredSelection | null): number => record?.bytes.byteLength ?? 0;
