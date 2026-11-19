import { describe, it, expect } from "vitest";
import {
  assertProjectSnapshotStorageLimits,
  readProjectFile,
  validateProjectSnapshot,
} from "./projectFile";

function fileOf(content: string): File {
  return new File([content], "p.imgedit.json", { type: "application/json" });
}

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAvyQP4rvqiVQAAAABJRU5ErkJggg==";

describe("readProjectFile", () => {
  it("rejects oversized snapshots before autosave reaches IndexedDB", () => {
    expect(() =>
      assertProjectSnapshotStorageLimits({
        json: "x".repeat(8 * 1024 * 1024 + 1),
        srcs: [],
      })
    ).toThrow(/too large to autosave/);
  });

  it("passes a snapshot within the storage limits through", () => {
    const snapshot = { json: '{"objects":[]}', srcs: [PNG_DATA_URL] };
    expect(assertProjectSnapshotStorageLimits(snapshot)).toEqual(snapshot);
  });

  it("rejects an embedded image over the per-image limit before autosave", () => {
    // ~49 MB once decoded: just over the 48 MB per-image limit.
    const huge = `data:image/png;base64,${"A".repeat(Math.ceil((49 * 1024 * 1024) / 3) * 4)}`;
    expect(() => assertProjectSnapshotStorageLimits({ json: "{}", srcs: [huge] })).toThrow(
      /oversized embedded image/
    );
  });

  it("rejects too much embedded image data in total before autosave", () => {
    // Two ~40 MB images: each allowed, together over the 72 MB total.
    const large = `data:image/png;base64,${"A".repeat(Math.ceil((40 * 1024 * 1024) / 3) * 4)}`;
    expect(() =>
      assertProjectSnapshotStorageLimits({ json: "{}", srcs: [large, large] })
    ).toThrow(/too much embedded image data/);
  });

  it("parses a valid project file into a snapshot", async () => {
    const snapshot = { json: '{"objects":[]}', srcs: [] };
    const file = fileOf(JSON.stringify({ version: 1, snapshot }));
    await expect(readProjectFile(file)).resolves.toEqual(snapshot);
  });

  it("cancels a stale project import", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      readProjectFile(fileOf('{"snapshot":{"json":"{}","srcs":[]}}'), controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects non-JSON content", async () => {
    await expect(readProjectFile(fileOf("not json"))).rejects.toThrow();
  });

  it("rejects JSON that isn't a project file", async () => {
    await expect(readProjectFile(fileOf('{"hello":"world"}'))).rejects.toThrow(
      /valid project file/
    );
  });

  it("rejects a snapshot missing its srcs array", async () => {
    const file = fileOf(JSON.stringify({ snapshot: { json: "{}" } }));
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("rejects a hostile oversized srcs collection before walking it", async () => {
    const srcs = new Array(2_000_000).fill(0);
    const file = fileOf(JSON.stringify({ snapshot: { json: "{}", srcs } }));
    await expect(readProjectFile(file)).rejects.toThrow(/too many embedded images/);
  });

  it("rejects unknown top-level project keys", async () => {
    const file = fileOf(
      JSON.stringify({ snapshot: { json: '{"objects":[]}', srcs: [] }, extra: 1 })
    );
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("rejects a project file from a newer, unknown version", async () => {
    const file = fileOf(JSON.stringify({ version: 2, snapshot: { json: "{}", srcs: [] } }));
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("rejects unknown snapshot keys", async () => {
    const file = fileOf(
      JSON.stringify({ snapshot: { json: '{"objects":[]}', srcs: [], extra: true } })
    );
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("rejects non-string image sources", async () => {
    const file = fileOf(JSON.stringify({ snapshot: { json: "{}", srcs: [PNG_DATA_URL, 7] } }));
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("rejects a snapshot that is an array or null", async () => {
    for (const snapshot of [[], null, "snapshot"]) {
      const file = fileOf(JSON.stringify({ snapshot }));
      await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
    }
  });

  it("rejects a snapshot whose json isn't a string", async () => {
    const file = fileOf(JSON.stringify({ snapshot: { json: 5, srcs: [] } }));
    await expect(readProjectFile(file)).rejects.toThrow(/valid project file/);
  });

  it("accepts placeholder srcs backed by inline data images", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"__snapshot_src_0"}]}',
      srcs: [PNG_DATA_URL],
    };
    const file = fileOf(JSON.stringify({ version: 1, snapshot }));
    await expect(readProjectFile(file)).resolves.toEqual(snapshot);
  });

  it("accepts the editor's bounded image filter stack", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Image",
            filters: [
              { type: "Brightness", brightness: 0.5 },
              { type: "Contrast", contrast: -1 },
              { type: "Saturation", saturation: 1 },
              { type: "Blur", blur: 0.25 },
              { type: "HueRotation", rotation: -0.5 },
            ],
          },
        ],
      }),
      srcs: [],
    };

    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).resolves.toEqual(snapshot);
  });

  it("accepts every adjustment and look the editor creates", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Image",
            filters: [
              { type: "Vintage", colorsOnly: false },
              { type: "Vibrance", vibrance: 0.4 },
              {
                type: "ColorMatrix",
                matrix: [1.1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 1, 0],
                colorsOnly: true,
              },
              { type: "Convolute", opaque: false, matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
              { type: "Noise", noise: 300 },
              { type: "Pixelate", blocksize: 12 },
            ],
          },
        ],
      }),
      srcs: [],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).resolves.toEqual(snapshot);
  });

  it.each([
    [{ type: "Pixelate", blocksize: 100_000 }, /unsafe pixelate filter value/],
    [{ type: "Noise", noise: -5 }, /unsafe noise filter value/],
    [{ type: "ColorMatrix", matrix: [1, 2, 3] }, /unsafe colormatrix filter value/],
    [{ type: "Convolute", matrix: Array(9).fill(1e9) }, /unsafe convolute filter value/],
    [{ type: "Sepia", matrix: Array(20).fill(0) }, /unsupported sepia filter property/],
    [{ type: "Vintage", colorsOnly: "yes" }, /unsafe vintage filter value/],
    [{ type: "Gamma", gamma: [1, 1, 1] }, /unsupported filter type: gamma/],
    [{ type: "Composed", subFilters: [] }, /unsupported filter type: composed/],
    [{ type: "Brightness", toString: 1 }, /unsupported brightness filter property/],
  ])("rejects unsafe or unknown filter %#", async (filter, message) => {
    const snapshot = {
      json: JSON.stringify({ objects: [{ type: "Image", filters: [filter] }] }),
      srcs: [],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(message);
  });

  it("rejects filter values that could overload Fabric's render pipeline", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Image",
            filters: [{ type: "Blur", blur: 1_000_000 }],
          },
        ],
      }),
      srcs: [],
    };

    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsafe blur filter value/);
  });

  it("rejects injected filter implementation properties", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Image",
            filters: [
              {
                type: "Brightness",
                brightness: 0,
                fragmentSource: "attacker-controlled shader",
              },
            ],
          },
        ],
      }),
      srcs: [],
    };

    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsupported brightness filter property/);
  });

  it("limits the number of filters applied to a single image", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Image",
            filters: Array.from({ length: 17 }, () => ({
              type: "Brightness",
              brightness: 0,
            })),
          },
        ],
      }),
      srcs: [],
    };

    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/too many image filters/);
  });

  it("rejects unsafe object dimensions and numeric strings", async () => {
    const oversized = {
      json: JSON.stringify({
        objects: [{ type: "Rect", width: 100_001, height: 10 }],
      }),
      srcs: [],
    };
    const coerced = {
      json: JSON.stringify({
        objects: [{ type: "Rect", width: 10, height: 10, opacity: "Infinity" }],
      }),
      srcs: [],
    };

    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot: oversized })))
    ).rejects.toThrow(/unsafe width value/);
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot: coerced })))
    ).rejects.toThrow(/unsafe opacity value/);
  });

  it("rejects text layers large enough to monopolize font measurement", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [{ type: "IText", text: "x".repeat(20_001) }],
      }),
      srcs: [],
    };

    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsafe text value/);
  });

  it("accepts a layer mask whose image is an inline data image", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"__snapshot_src_0","layerMask":{"src":"__snapshot_src_1","enabled":false}}]}',
      srcs: [PNG_DATA_URL, PNG_DATA_URL.replace("AAAAEklEQVR4", "AAAAEklEQVR5")],
    };
    const file = fileOf(JSON.stringify({ version: 1, snapshot }));
    await expect(readProjectFile(file)).resolves.toEqual(snapshot);
  });

  it("rejects layer masks that point outside or carry anything else", async () => {
    const masks = [
      '{"src":"https://evil.example/mask.png","enabled":true}',
      '{"src":"__snapshot_src_0","enabled":"yes"}',
      '{"src":"__snapshot_src_0","enabled":true,"onload":"x"}',
      '{"enabled":true}',
      '"__snapshot_src_0"',
      "null",
    ];
    for (const mask of masks) {
      const snapshot = {
        json: `{"objects":[{"type":"image","src":"__snapshot_src_0","layerMask":${mask}}]}`,
        srcs: [PNG_DATA_URL],
      };
      const file = fileOf(JSON.stringify({ snapshot }));
      await expect(readProjectFile(file), mask).rejects.toThrow();
    }
  });

  it("accepts guides on the photo and rejects malformed ones", async () => {
    const ok = {
      json: '{"objects":[{"type":"image","src":"__snapshot_src_0","guides":[{"axis":"x","position":12.5},{"axis":"y","position":40}]}]}',
      srcs: [PNG_DATA_URL],
    };
    await expect(readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot: ok })))).resolves.toEqual(ok);
    for (const guides of ['[{"axis":"x","position":"1"}]', '[{"axis":"x","position":1,"src":"https://evil.example"}]', '{"axis":"x"}', "[1e400]"]) {
      const snapshot = { json: `{"objects":[{"type":"image","src":"__snapshot_src_0","guides":${guides}}]}`, srcs: [PNG_DATA_URL] };
      await expect(readProjectFile(fileOf(JSON.stringify({ snapshot }))), guides).rejects.toThrow();
    }
  });

  it("accepts a layer style the editor writes", async () => {
    const style = {
      dropShadow: { enabled: true, color: "#000000", opacity: 75, angle: 120, distance: 10, size: 10 },
      stroke: { enabled: true, color: "#ff0000", opacity: 100, size: 3, position: "outside" },
    };
    const snapshot = {
      json: JSON.stringify({ objects: [{ type: "rect", layerStyle: style }] }),
      srcs: [],
    };
    const file = fileOf(JSON.stringify({ version: 1, snapshot }));
    await expect(readProjectFile(file)).resolves.toEqual(snapshot);
  });

  it("rejects layer styles with unknown effects or hostile values", async () => {
    const styles = [
      '{"bevel":{"enabled":true}}',
      '{"stroke":{"enabled":true,"color":"url(https://evil.example)","opacity":100,"size":3,"position":"outside"}}',
      '{"stroke":{"enabled":true,"color":"#000000","opacity":100,"size":100000,"position":"outside"}}',
      '{"colorOverlay":{"enabled":true,"color":"#000000","opacity":100,"src":"https://evil.example/x.png"}}',
      '"stroke"',
      "null",
    ];
    for (const style of styles) {
      const snapshot = { json: `{"objects":[{"type":"rect","layerStyle":${style}}]}`, srcs: [] };
      const file = fileOf(JSON.stringify({ snapshot }));
      await expect(readProjectFile(file), style).rejects.toThrow();
    }
  });

  it("rejects an extracted src pointing at an external URL", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"__snapshot_src_0"}]}',
      srcs: ["https://evil.example/track.png"],
    };
    const file = fileOf(JSON.stringify({ snapshot }));
    await expect(readProjectFile(file)).rejects.toThrow(/Only inline/);
  });

  it("rejects an external src smuggled directly into the JSON", async () => {
    // A tampered file can bypass the srcs array by putting a real URL in json
    const snapshot = {
      json: '{"objects":[{"type":"image","src":"https://evil.example/x.png"}]}',
      srcs: [],
    };
    const file = fileOf(JSON.stringify({ snapshot }));
    await expect(readProjectFile(file)).rejects.toThrow(/Only inline/);
  });

  it("rejects a Fabric pattern source that could trigger an external request", async () => {
    const snapshot = {
      json: JSON.stringify({
        objects: [
          {
            type: "Rect",
            fill: { type: "pattern", source: "https://evil.example/pixel.png" },
          },
        ],
      }),
      srcs: [],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsupported object type|Only inline/);
  });

  it("rejects placeholders that do not point into the validated source list", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"Image","src":"__snapshot_src_2"}]}',
      srcs: [PNG_DATA_URL],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/invalid image placeholder/);
  });

  it("rejects deeply nested snapshots without recursive traversal", async () => {
    let nested: unknown = { type: "Rect" };
    for (let index = 0; index < 70; index += 1) {
      nested = { type: "Rect", clipPath: nested };
    }
    const snapshot = { json: JSON.stringify({ objects: [nested] }), srcs: [] };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/nesting is too deep/);
  });

  it("rejects prototype-mutating property names", async () => {
    const snapshot = {
      json: '{"objects":[{"type":"Rect","__proto__":{"visible":false}}]}',
      srcs: [],
    };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 1, snapshot })))
    ).rejects.toThrow(/unsafe property name/);
  });

  it("rejects project versions the editor does not understand", async () => {
    const snapshot = { json: '{"objects":[]}', srcs: [] };
    await expect(
      readProjectFile(fileOf(JSON.stringify({ version: 99, snapshot })))
    ).rejects.toThrow(/valid project file/);
  });
});

describe("validateProjectSnapshot", () => {
  it("rejects holes in a sparse srcs array, as IndexedDB can store them", () => {
    const srcs: string[] = [];
    srcs[1] = PNG_DATA_URL;
    expect(() => validateProjectSnapshot({ json: '{"objects":[]}', srcs })).toThrow(
      /valid project snapshot/
    );
  });

  it("returns a copy, not the caller's object", () => {
    const input = { json: '{"objects":[]}', srcs: [] as string[] };
    const snapshot = validateProjectSnapshot(input);
    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot.srcs).not.toBe(input.srcs);
  });
});
