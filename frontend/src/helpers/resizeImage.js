// Resize a chosen image file to a square avatar (default 256x256) entirely in the
// browser via canvas, returning a PNG data URL. Resizing client-side keeps the
// uploaded payload tiny; the server still independently validates and caps it.
export function resizeImageToDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Choose a PNG or JPEG image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("That file is not a valid image."));
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Image processing is not supported in this browser."));
            return;
          }
          // Center-crop to a square ("cover") so non-square uploads aren't squashed.
          const scale = Math.max(size / image.width, size / image.height);
          const drawWidth = image.width * scale;
          const drawHeight = image.height * scale;
          ctx.drawImage(image, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          reject(new Error("Could not process that image."));
        }
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default resizeImageToDataUrl;
