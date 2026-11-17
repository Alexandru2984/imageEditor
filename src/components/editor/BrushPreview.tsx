import { tint, type BrushKind } from "@/utils/brushes";

const STROKE = "M3 11 C 10 2, 18 2, 21 8 S 31 14, 37 5";

/** A small sample stroke showing what each brush looks like in the current colour. */
export function BrushPreview({ kind, color }: { kind: BrushKind; color: string }) {
  const common = { d: STROKE, fill: "none", strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 40 16" className="h-4 w-10 overflow-visible" aria-hidden="true">
      {kind === "pen" && <path {...common} stroke={color} strokeWidth={2.5} />}
      {kind === "highlighter" && (
        <path {...common} stroke={color} strokeOpacity={0.45} strokeWidth={7} strokeLinecap="butt" />
      )}
      {kind === "neon" && (
        <path
          {...common}
          stroke={tint(color, 0.65)}
          strokeWidth={2.5}
          style={{ filter: `drop-shadow(0 0 2px ${color}) drop-shadow(0 0 3px ${color})` }}
        />
      )}
      {kind === "dashed" && (
        <path {...common} stroke={color} strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="butt" />
      )}
    </svg>
  );
}
