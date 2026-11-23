import { sanitizeFileName } from "@/utils/fileName";

/**
 * Export As: what files an export makes, and their names. A size is a scale
 * of the document's own resolution, or a width in pixels (the height follows);
 * as in Photoshop, the 1× file has no suffix and the others say their size:
 * "photo@2x.png", "photo-1200w.png". One size alone needs no suffix: the file
 * is named as the dialog shows. Exporting layers puts each layer's name after
 * the document's.
 */

export type ExportSize = { scale: number } | { width: number };

export const sizeSuffix = (size: ExportSize): string =>
  "width" in size ? `-${Math.round(size.width)}w` : size.scale === 1 ? "" : `@${size.scale}x`;

/** The scale of the document's resolution a size asks for, given the document's width at 1×. */
export const scaleOf = (size: ExportSize, nativeWidth: number): number =>
  "width" in size ? size.width / Math.max(1, nativeWidth) : size.scale;

export interface PlannedFile<T> {
  name: string;
  size: ExportSize;
  target: T;
}

/**
 * One file per target (the document, or each layer) and size, named for
 * both; names that would repeat get "-2", "-3"…
 */
export function plannedFiles<T>(
  baseName: string,
  extension: string,
  targets: readonly { label: string | null; target: T }[],
  sizes: readonly ExportSize[]
): PlannedFile<T>[] {
  const base = sanitizeFileName(baseName);
  const taken = new Set<string>();
  const files: PlannedFile<T>[] = [];
  for (const { label, target } of targets) {
    const layer = label === null ? "" : `-${sanitizeFileName(label, "layer")}`;
    for (const size of sizes) {
      const stem = `${base}${layer}${sizes.length > 1 ? sizeSuffix(size) : ""}`;
      let name = `${stem}.${extension}`;
      for (let copy = 2; taken.has(name.toLowerCase()); copy += 1) name = `${stem}-${copy}.${extension}`;
      taken.add(name.toLowerCase());
      files.push({ name, size, target });
    }
  }
  return files;
}
