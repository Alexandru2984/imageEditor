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
  | "dodge"
  | "burn"
  | "sponge"
  | "blur"
  | "sharpen"
  | "smudge";

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
