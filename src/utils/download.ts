/** Trigger a same-origin browser download and release its object URL safely. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (blob.size === 0) throw new Error("Cannot download an empty file");

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);

  try {
    link.click();
  } catch (error) {
    link.remove();
    URL.revokeObjectURL(url);
    throw error;
  }

  // Revoking synchronously can cancel downloads in some browsers. Give the
  // download navigation a short window to consume the URL before cleanup.
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
}
