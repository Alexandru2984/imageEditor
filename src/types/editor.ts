export type Tool =
  | "select"
  | "brush"
  | "bucket"
  | "gradient"
  | "draw"
  | "eraser"
  | "rectangle"
  | "circle"
  | "triangle"
  | "star"
  | "line"
  | "arrow"
  | "text"
  | "crop"
  | "marquee"
  | "ellipseMarquee"
  | "lasso"
  | "polygonLasso"
  | "magicWand"
  | "cloneStamp"
  | "spotHealing"
  | "healingBrush"
  /** Patch and Content-Aware Move: draw around an area, then drag it. */
  | "patch"
  | "contentAwareMove"
  | "redEye"
  | "dodge"
  | "burn"
  | "sponge"
  | "blur"
  | "sharpen"
  | "smudge"
  /** Edit › Transform › Distort or Perspective, on the selected layer. */
  | "warp"
  /** The Pen (P) and Direct Selection (A), which draw and edit paths. */
  | "pen"
  | "directSelect";

export interface HistoryEntry {
  json: string;
  timestamp: number;
}

export interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  isBackground: boolean;
}

/** Side panel (desktop) / bottom sheet (mobile) tabs. */
export type PanelTab = "properties" | "adjust" | "layers";

/** View › Rulers, Grid, Guides and Lock Guides. */
export interface ViewOptions {
  rulers: boolean;
  grid: boolean;
  guides: boolean;
  lockGuides: boolean;
}
