import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zipStore } from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);

/** The files a zip lists in its central directory, read back with their data. */
function readZip(buffer: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const end = buffer.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    files.push({ name, data: buffer.subarray(start, start + size), crc });
    at += 46 + nameLength;
  }
  return files;
}

describe("zipStore", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("stores each file, with UTF-8 names, where its headers say", async () => {
    const files = [
      { name: "photo@2x.png", data: Uint8Array.from([137, 80, 78, 71, 0, 255]) },
      { name: "Ștefan – copertă.webp", data: bytes("RIFF....WEBP") },
      { name: "empty.txt", data: new Uint8Array(0) },
    ];
    const blob = zipStore(files, new Date(2026, 10, 23, 15, 30, 10));
    expect(blob.type).toBe("application/zip");
    const read = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(read.map((file) => file.name)).toEqual(files.map((file) => file.name));
    read.forEach((file, index) => {
      expect([...file.data]).toEqual([...files[index]!.data]);
      expect(file.crc).toBe(crc32(files[index]!.data));
    });
  });

  it("is a zip that standard tools open", async () => {
    let python: string;
    try {
      python = execFileSync("python3", ["-c", "print(1)"]).toString().trim();
    } catch {
      return; // No Python here: the structure test above stands.
    }
    expect(python).toBe("1");
    const directory = mkdtempSync(join(tmpdir(), "zip-test-"));
    const path = join(directory, "export.zip");
    const blob = zipStore([
      { name: "a.png", data: bytes("first") },
      { name: "folder-less ü.jpg", data: bytes("second file") },
    ]);
    writeFileSync(path, new Uint8Array(await blob.arrayBuffer()));
    const listing = execFileSync("python3", [
      "-I",
      "-c",
      "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('|'.join(f'{i.filename}:{z.read(i).decode()}' for i in z.infolist()))",
      path,
    ])
      .toString()
      .trim();
    expect(listing).toBe("a.png:first|folder-less ü.jpg:second file");
    expect(readFileSync(path).length).toBeGreaterThan(0);
  });
});
