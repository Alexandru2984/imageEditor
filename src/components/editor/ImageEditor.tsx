import { useState } from "react";
import { Canvas as FabricCanvasComponent } from "./Canvas";
import { Toolbar } from "./Toolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { ImageUpload } from "./ImageUpload";
import { TopBar } from "./TopBar";

export type Tool = "select" | "draw" | "rectangle" | "circle" | "text" | "crop";

export const ImageEditor = () => {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeColor, setActiveColor] = useState("#a855f7");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [fabricCanvas, setFabricCanvas] = useState<any>(null);

  return (
    <div className="flex flex-col h-screen bg-[hsl(var(--editor-bg))]">
      <TopBar fabricCanvas={fabricCanvas} uploadedImage={uploadedImage} />
      
      <div className="flex flex-1 overflow-hidden">
        <Toolbar 
          activeTool={activeTool} 
          onToolClick={setActiveTool}
          fabricCanvas={fabricCanvas}
        />
        
        <div className="flex-1 flex items-center justify-center p-4">
          {!uploadedImage ? (
            <ImageUpload onImageUpload={setUploadedImage} />
          ) : (
            <FabricCanvasComponent
              activeTool={activeTool}
              activeColor={activeColor}
              uploadedImage={uploadedImage}
              onCanvasReady={setFabricCanvas}
            />
          )}
        </div>
        
        <PropertiesPanel 
          activeColor={activeColor}
          onColorChange={setActiveColor}
          fabricCanvas={fabricCanvas}
        />
      </div>
    </div>
  );
};
