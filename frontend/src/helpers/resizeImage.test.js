import { resizeImageToDataUrl } from "./resizeImage";

test("rejects a missing file", async () => {
  await expect(resizeImageToDataUrl(null)).rejects.toThrow(/png or jpeg/i);
});

test("rejects a non-image file type", async () => {
  const file = { type: "text/plain", name: "notes.txt" };
  await expect(resizeImageToDataUrl(file)).rejects.toThrow(/png or jpeg/i);
});

test("rejects a file whose type is not an image, without reading it", async () => {
  await expect(resizeImageToDataUrl({ type: "application/pdf" })).rejects.toThrow(/png or jpeg/i);
  await expect(resizeImageToDataUrl({ type: "" })).rejects.toThrow(/png or jpeg/i);
});
