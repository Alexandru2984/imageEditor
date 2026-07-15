export type Tool =
  | "select"
  | "draw"
  | "eraser"
  | "rectangle"
  | "circle"
  | "line"
  | "arrow"
  | "text"
  | "crop"
  | "marquee";

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
