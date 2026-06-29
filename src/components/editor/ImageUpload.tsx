import { Upload, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ImageUploadProps {
  onImageUpload: (imageUrl: string) => void;
}

export const ImageUpload = ({ onImageUpload }: ImageUploadProps) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Please upload an image file");
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageUrl = event.target?.result as string;
        onImageUpload(imageUrl);
        toast.success("Image uploaded successfully!");
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-border rounded-xl bg-[hsl(var(--editor-panel))] max-w-2xl">
      <ImageIcon className="w-24 h-24 text-muted-foreground mb-6" />
      <h2 className="text-2xl font-bold mb-2">Upload an Image</h2>
      <p className="text-muted-foreground mb-8 text-center">
        Start editing by uploading an image from your device
      </p>
      
      <label htmlFor="file-upload">
        <Button size="lg" className="cursor-pointer" asChild>
          <span>
            <Upload className="mr-2 h-5 w-5" />
            Choose Image
          </span>
        </Button>
      </label>
      <input
        id="file-upload"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      
      <p className="text-xs text-muted-foreground mt-4">
        Supports: JPG, PNG, GIF, WebP
      </p>
    </div>
  );
};
