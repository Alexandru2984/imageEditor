import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  Image as ImageIcon,
  AlertTriangle,
  History,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SavedProject } from "@/utils/projectStore";
import {
  MAX_IMAGE_FILE_BYTES,
  RASTER_FILE_ACCEPT,
  readSafeRasterImage,
} from "@/utils/imageFile";
import { isAbortError } from "@/utils/abort";

interface ImageUploadProps {
  onImageUpload: (dataUrl: string) => void;
  onImageLoadStart: () => AbortSignal;
  savedProject?: SavedProject | null;
  onRestore?: () => void;
  onOpenProject?: (file: File) => void;
}

export const ImageUpload = ({
  onImageUpload,
  onImageLoadStart,
  savedProject,
  onRestore,
  onOpenProject,
}: ImageUploadProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      const signal = onImageLoadStart();
      try {
        const { dataUrl } = await readSafeRasterImage(file, signal);
        if (signal.aborted) return;
        onImageUpload(dataUrl);
        toast.success("Image uploaded successfully!");
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to read the image. Please try again."
        );
      }
    },
    [onImageLoadStart, onImageUpload]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  // Paste from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            void processFile(file);
          }
          break;
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [processFile]);

  return (
    <div className="flex flex-col items-center gap-4 max-w-2xl">
      {savedProject && onRestore && (
        <div className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-[hsl(var(--editor-panel))] px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <History className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Continue last project</p>
              <p className="text-xs text-muted-foreground truncate">
                Autosaved {new Date(savedProject.savedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onRestore} className="shrink-0">
            Continue
          </Button>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload an image"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`
          flex flex-col items-center justify-center p-12 rounded-xl w-full
          cursor-pointer transition-all duration-200 select-none
          border-2 border-dashed
          ${
            isDragging
              ? "border-primary bg-primary/10 scale-[1.02]"
              : "border-border bg-[hsl(var(--editor-panel))] hover:border-muted-foreground hover:bg-accent/50"
          }
        `}
      >
        <div
          className={`transition-transform duration-200 ${isDragging ? "scale-110" : ""}`}
        >
          {isDragging ? (
            <Upload className="w-20 h-20 text-primary mb-6 animate-bounce" />
          ) : (
            <ImageIcon className="w-20 h-20 text-muted-foreground mb-6" />
          )}
        </div>

        <h2 className="text-2xl font-bold mb-2">
          {isDragging ? "Drop your image here" : "Upload an Image"}
        </h2>

        <p className="text-muted-foreground mb-6 text-center max-w-sm">
          {isDragging
            ? "Release to upload your image"
            : "Drag & drop, click to browse, or paste from clipboard"}
        </p>

        <span className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors">
          <Upload className="mr-2 h-5 w-5" />
          Choose Image
        </span>

        <input
          ref={fileInputRef}
          type="file"
          accept={RASTER_FILE_ACCEPT}
          onChange={handleFileChange}
          data-testid="image-input"
          className="hidden"
        />

        <div className="flex items-center gap-4 mt-6 text-xs text-muted-foreground">
          <span>Supports: JPG, PNG, GIF, WebP</span>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Max: {Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))}MB / 50MP
          </span>
        </div>
      </div>

      {onOpenProject && (
        <>
          <button
            onClick={() => projectInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open a saved project file
          </button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".json,application/json"
            data-testid="project-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onOpenProject(file);
            }}
            className="hidden"
          />
        </>
      )}
    </div>
  );
};
