/** Downscale a camera photo to at most `max` px on the long side and re-encode as JPEG. */
export async function resizeToJpeg(file: File, max = 1024): Promise<{ mime: "image/jpeg"; base64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
