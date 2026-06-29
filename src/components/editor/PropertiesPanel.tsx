import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";

interface PropertiesPanelProps {
  activeColor: string;
  onColorChange: (color: string) => void;
  fabricCanvas: any;
}

export const PropertiesPanel = ({ activeColor, onColorChange, fabricCanvas }: PropertiesPanelProps) => {
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);

  const applyFilters = () => {
    if (!fabricCanvas) return;
    
    const objects = fabricCanvas.getObjects();
    const bgImage = objects[0];
    
    if (bgImage && bgImage.filters) {
      // Apply filters logic here
      fabricCanvas.renderAll();
    }
  };

  const colors = [
    "#a855f7", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#ef4444", "#ffffff", "#000000"
  ];

  return (
    <div className="w-80 bg-[hsl(var(--editor-panel))] border-l border-border p-6 overflow-y-auto">
      <div className="space-y-6">
        <div>
          <Label className="text-sm font-semibold mb-3 block">Color</Label>
          <div className="grid grid-cols-5 gap-2">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => onColorChange(color)}
                className={`w-12 h-12 rounded-lg transition-all ${
                  activeColor === color ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110" : ""
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <input
            type="color"
            value={activeColor}
            onChange={(e) => onColorChange(e.target.value)}
            className="w-full h-12 rounded-lg mt-3 cursor-pointer bg-transparent border border-border"
          />
        </div>

        <Separator />

        <div>
          <Label className="text-sm font-semibold mb-3 block">Brightness</Label>
          <Slider
            value={[brightness]}
            onValueChange={(v) => {
              setBrightness(v[0]);
              applyFilters();
            }}
            min={-100}
            max={100}
            step={1}
            className="w-full"
          />
          <span className="text-xs text-muted-foreground mt-1 block">{brightness}</span>
        </div>

        <div>
          <Label className="text-sm font-semibold mb-3 block">Contrast</Label>
          <Slider
            value={[contrast]}
            onValueChange={(v) => {
              setContrast(v[0]);
              applyFilters();
            }}
            min={-100}
            max={100}
            step={1}
            className="w-full"
          />
          <span className="text-xs text-muted-foreground mt-1 block">{contrast}</span>
        </div>

        <div>
          <Label className="text-sm font-semibold mb-3 block">Saturation</Label>
          <Slider
            value={[saturation]}
            onValueChange={(v) => {
              setSaturation(v[0]);
              applyFilters();
            }}
            min={-100}
            max={100}
            step={1}
            className="w-full"
          />
          <span className="text-xs text-muted-foreground mt-1 block">{saturation}</span>
        </div>
      </div>
    </div>
  );
};
