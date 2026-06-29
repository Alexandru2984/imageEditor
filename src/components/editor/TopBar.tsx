import { Download, Image as ImageIcon, RotateCcw, RotateCw, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useState } from "react";
import { removeBackground, loadImage } from "@/utils/backgroundRemoval";
import { FabricImage } from "fabric";

interface TopBarProps {
  fabricCanvas: any;
  uploadedImage: string | null;
}

export const TopBar = ({ fabricCanvas, uploadedImage }: TopBarProps) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRemoveBackground = async () => {
    if (!fabricCanvas || !uploadedImage) {
      toast.error("No image to process!");
      return;
    }

    setIsProcessing(true);
    const loadingToast = toast.loading("Removing background... This may take a minute.");

    try {
      // Get the background image from canvas
      const objects = fabricCanvas.getObjects();
      const bgImage = objects.find((obj: any) => !obj.selectable);
      
      if (!bgImage) {
        throw new Error("Could not find background image");
      }

      // Convert canvas image to blob
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error("Could not get canvas context");

      // Get the image element from the fabric image
      const imgElement = (bgImage as any).getElement();
      tempCanvas.width = imgElement.naturalWidth;
      tempCanvas.height = imgElement.naturalHeight;
      tempCtx.drawImage(imgElement, 0, 0);

      const blob = await new Promise<Blob>((resolve) => {
        tempCanvas.toBlob((b) => resolve(b!), 'image/png');
      });

      // Load image and remove background
      const img = await loadImage(blob);
      const resultBlob = await removeBackground(img);
      
      // Convert blob to URL
      const resultUrl = URL.createObjectURL(resultBlob);

      // Create new fabric image and replace the old one
      const newImg = await FabricImage.fromURL(resultUrl);
      newImg.scaleToWidth(fabricCanvas.width * 0.8);
      newImg.scaleToHeight(fabricCanvas.height * 0.8);
      newImg.set({
        left: fabricCanvas.width / 2 - (newImg.width! * newImg.scaleX!) / 2,
        top: fabricCanvas.height / 2 - (newImg.height! * newImg.scaleY!) / 2,
      });
      newImg.selectable = false;

      // Remove old image and add new one
      fabricCanvas.remove(bgImage);
      fabricCanvas.add(newImg);
      fabricCanvas.sendObjectToBack(newImg);
      fabricCanvas.renderAll();

      toast.dismiss(loadingToast);
      toast.success("Background removed successfully!");
    } catch (error) {
      console.error("Background removal error:", error);
      toast.dismiss(loadingToast);
      toast.error("Failed to remove background. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = (format: "png" | "jpg") => {
    if (!fabricCanvas) return;
    
    const dataURL = fabricCanvas.toDataURL({
      format: format === "png" ? "png" : "jpeg",
      quality: 1,
    });
    
    const link = document.createElement("a");
    link.download = `image-editor-export.${format}`;
    link.href = dataURL;
    link.click();
    
    toast.success(`Image exported as ${format.toUpperCase()}!`);
  };

  const handleRotate = (direction: "left" | "right") => {
    if (!fabricCanvas) return;
    
    const activeObject = fabricCanvas.getActiveObject();
    if (activeObject) {
      const currentAngle = activeObject.angle || 0;
      const newAngle = direction === "left" ? currentAngle - 90 : currentAngle + 90;
      activeObject.rotate(newAngle);
      fabricCanvas.renderAll();
      toast.success("Object rotated!");
    } else {
      toast.error("Select an object first!");
    }
  };

  return (
    <div className="h-16 bg-[hsl(var(--editor-panel))] border-b border-border flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold">Image Editor</h1>
      </div>

      <div className="flex items-center gap-2">
        {uploadedImage && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveBackground}
              disabled={isProcessing}
            >
              <Scissors className="h-4 w-4 mr-2" />
              {isProcessing ? "Processing..." : "Remove Background"}
            </Button>
            
            <Separator orientation="vertical" className="h-6 mx-2" />
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRotate("left")}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Rotate Left
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRotate("right")}
            >
              <RotateCw className="h-4 w-4 mr-2" />
              Rotate Right
            </Button>
            
            <Separator orientation="vertical" className="h-6 mx-2" />
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExport("png")}
            >
              <Download className="h-4 w-4 mr-2" />
              Export PNG
            </Button>
            
            <Button
              variant="default"
              size="sm"
              onClick={() => handleExport("jpg")}
            >
              <Download className="h-4 w-4 mr-2" />
              Export JPG
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
