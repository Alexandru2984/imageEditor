import { useEffect, useRef } from "react";
import { Canvas as FabricCanvas, Circle, Rect, PencilBrush, IText, FabricImage } from "fabric";
import { Tool } from "./ImageEditor";
import { toast } from "sonner";

interface CanvasProps {
  activeTool: Tool;
  activeColor: string;
  uploadedImage: string | null;
  onCanvasReady: (canvas: FabricCanvas) => void;
}

export const Canvas = ({ activeTool, activeColor, uploadedImage, onCanvasReady }: CanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 1200,
      height: 800,
      backgroundColor: "#1a1a1a",
    });

    fabricCanvasRef.current = canvas;
    onCanvasReady(canvas);

    // Load uploaded image
    if (uploadedImage) {
      FabricImage.fromURL(uploadedImage).then((img) => {
        img.scaleToWidth(canvas.width! * 0.8);
        img.scaleToHeight(canvas.height! * 0.8);
        img.set({
          left: canvas.width! / 2 - (img.width! * img.scaleX!) / 2,
          top: canvas.height! / 2 - (img.height! * img.scaleY!) / 2,
        });
        img.selectable = false;
        canvas.add(img);
        canvas.sendObjectToBack(img);
        canvas.renderAll();
      });
    }

    return () => {
      canvas.dispose();
    };
  }, [uploadedImage]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = activeTool === "draw";
    
    if (activeTool === "draw") {
      const brush = new PencilBrush(canvas);
      brush.color = activeColor;
      brush.width = 3;
      canvas.freeDrawingBrush = brush;
    }

    if (activeTool === "rectangle") {
      const rect = new Rect({
        left: 100,
        top: 100,
        fill: activeColor,
        width: 150,
        height: 100,
        stroke: activeColor,
        strokeWidth: 2,
      });
      canvas.add(rect);
      canvas.setActiveObject(rect);
    } else if (activeTool === "circle") {
      const circle = new Circle({
        left: 100,
        top: 100,
        fill: activeColor,
        radius: 75,
        stroke: activeColor,
        strokeWidth: 2,
      });
      canvas.add(circle);
      canvas.setActiveObject(circle);
    } else if (activeTool === "text") {
      const text = new IText("Double click to edit", {
        left: 100,
        top: 100,
        fill: activeColor,
        fontSize: 32,
        fontFamily: "Arial",
      });
      canvas.add(text);
      canvas.setActiveObject(text);
    }
  }, [activeTool, activeColor]);

  return (
    <div className="relative rounded-lg overflow-hidden shadow-2xl border border-border">
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
};
