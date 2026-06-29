export type Tool =
  | "select"
  | "draw"
  | "eraser"
  | "rectangle"
  | "circle"
  | "line"
  | "arrow"
  | "text"
  | "crop";

export interface HistoryEntry {
  json: string;
  timestamp: number;
}

export interface LayerInfo {
  id: number;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
}
