import { supabase } from "../lib/supabase";

type ImageBucket = "product-images" | "category-images" | "homepage-banners";
export interface CategoryImageUploadResult { url: string; cleanupWarning: string | null }

function imageExtension(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && /^[a-z0-9]{2,5}$/.test(extension)) return extension;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

async function uploadPublicImage(bucket: ImageBucket, folder: string, file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG, or WebP image");
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller");
  const path = `${folder}/${crypto.randomUUID()}.${imageExtension(file)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function publicImagePath(bucket: ImageBucket, url: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;
  try {
    return decodeURIComponent(url.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

async function removeCategoryImage(url: string, operation: "replace" | "delete"): Promise<string | null> {
  const path = publicImagePath("category-images", url);
  if (!path) return null;
  const { error } = await supabase.storage.from("category-images").remove([path]);
  if (!error) return null;
  return operation === "replace"
    ? "Category saved, but its previous image could not be removed from Storage."
    : "Category deleted, but its image could not be removed from Storage.";
}

export async function deleteCategoryImage(url: string): Promise<string | null> {
  return removeCategoryImage(url, "delete");
}

export async function uploadStoreLogo(file: File): Promise<string> {
  return uploadPublicImage("homepage-banners", "store", file);
}

export async function deleteStoreLogo(url: string): Promise<string | null> {
  const path = publicImagePath("homepage-banners", url);
  if (!path) return null;
  const { error } = await supabase.storage.from("homepage-banners").remove([path]);
  return error ? "Settings were saved, but the previous store logo could not be removed from Storage." : null;
}

export async function uploadUpiQrImage(file: File): Promise<string> {
  return uploadPublicImage("homepage-banners", "upi", file);
}

export async function deleteUpiQrImage(url: string): Promise<string | null> {
  const path = publicImagePath("homepage-banners", url);
  if (!path) return null;
  const { error } = await supabase.storage.from("homepage-banners").remove([path]);
  return error ? "Settings were saved, but the previous UPI QR image could not be removed from Storage." : null;
}

export async function uploadProductImages(productId: string, files: File[]): Promise<void> {
  if (!files.length) return;
  const { data: existing, error: existingError } = await supabase.from("product_images").select("id,is_primary").eq("product_id", productId);
  if (existingError) throw existingError;

  const uploaded: string[] = [];
  try {
    const results = await Promise.allSettled(files.map(async (file) => {
      const url = await uploadPublicImage("product-images", productId, file);
      uploaded.push(url);
      return url;
    }));
    const urls: string[] = [];
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      urls.push(result.value);
    }
    if (!existing.length) {
      const { error } = await supabase.from("product_images").insert(urls.map((image_url, index) => ({
        product_id: productId, image_url, display_order: index, is_primary: index === 0,
      })));
      if (error) throw error;
    } else {
      const { error } = await supabase.from("product_images").insert(urls.map((image_url, index) => ({
        product_id: productId, image_url, display_order: existing.length + index, is_primary: false,
      })));
      if (error) throw error;
    }
  } catch (error) {
    await supabase.storage.from("product-images").remove(uploaded.map((url) => url.split("/product-images/").pop() ?? ""));
    throw error;
  }
}

export async function setPrimaryProductImage(productId: string, imageId: string): Promise<void> {
  const { error: clearError } = await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
  if (clearError) throw clearError;
  const { error } = await supabase.from("product_images").update({ is_primary: true }).eq("id", imageId).eq("product_id", productId).select("id").single();
  if (error) throw error;
}

export async function uploadCategoryImage(categoryId: string, file: File): Promise<CategoryImageUploadResult> {
  const { data: category, error: readError } = await supabase.from("categories").select("image_url").eq("id", categoryId).single();
  if (readError) throw readError;
  const url = await uploadPublicImage("category-images", categoryId, file);
  const { error } = await supabase.from("categories").update({ image_url: url }).eq("id", categoryId);
  if (error) {
    const newPath = publicImagePath("category-images", url);
    if (newPath) await supabase.storage.from("category-images").remove([newPath]);
    throw error;
  }
  const cleanupWarning = category.image_url ? await removeCategoryImage(category.image_url, "replace") : null;
  return { url, cleanupWarning };
}

export async function uploadPrivateFile(bucket: "customization-uploads" | "payment-proofs", file: File): Promise<string> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in before uploading a private file");

  const imageTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedType = imageTypes.includes(file.type) || file.type === "application/pdf";
  if (!allowedType) throw new Error("Choose a JPEG, PNG, WebP, or PDF file");
  const maxBytes = bucket === "customization-uploads" ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`File must be ${bucket === "customization-uploads" ? "20" : "10"} MB or smaller`);

  // The extension comes from the validated MIME type, never from the file name, so the stored name is always one of
  // jpg / png / webp / pdf (the payment-proof database function checks for exactly these).
  const safeExtension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${safeExtension}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/** Removes one of the signed-in customer's own private files. Returns false (instead of throwing) when it could not be removed. */
export async function deletePrivateFile(bucket: "customization-uploads" | "payment-proofs", path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  return !error;
}

export async function createPrivateUploadUrl(bucket: "customization-uploads" | "payment-proofs", path: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

// ---- Admin photo preparation (Phase 2B) --------------------------------------------------------------------------
// Same private `customization-uploads` bucket and the same policies as customer uploads. Nothing here ever creates a
// public URL: previews and downloads use signed URLs that expire within minutes.

export const ADMIN_PREPARED_MAX_BYTES = 10 * 1024 * 1024;
const ADMIN_PREPARED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Previews live for 2 minutes, downloads for 1 minute. Both are minted on demand and never stored. */
export const PREVIEW_URL_SECONDS = 120;
export const DOWNLOAD_URL_SECONDS = 60;

/** Signs many private paths in one request. A path that cannot be signed maps to null instead of failing the batch. */
export async function createPrivateUploadUrls(bucket: "customization-uploads", paths: string[], expiresIn = PREVIEW_URL_SECONDS): Promise<Record<string, string | null>> {
  const unique = [...new Set(paths)];
  const result: Record<string, string | null> = Object.fromEntries(unique.map((path) => [path, null]));
  if (!unique.length) return result;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
  if (error) throw error;
  for (const item of data) if (item.path && !item.error && item.signedUrl) result[item.path] = item.signedUrl;
  return result;
}

/** Signed URL that makes the browser save the file (Content-Disposition: attachment) instead of displaying it. */
export async function createPrivateDownloadUrl(bucket: "customization-uploads", path: string, fileName: string, expiresIn = DOWNLOAD_URL_SECONDS): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn, { download: fileName });
  if (error) throw error;
  return data.signedUrl;
}

/** Reads a private file with the signed-in admin's own session (no URL is created). */
export async function downloadPrivateFile(bucket: "customization-uploads", path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return data;
}

/**
 * Uploads an admin-prepared image to `<admin user id>/admin-prepared/<request id>/<uuid>.<ext>`.
 * The path is always new (upsert is off and the name is a random UUID), so an original or customer-edited file can never be overwritten.
 */
export async function uploadAdminPreparedFile(requestId: string, file: File): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Invalid request reference");
  if (!ADMIN_PREPARED_TYPES.includes(file.type)) throw new Error("Prepared photos must be JPEG, PNG or WebP");
  if (file.size === 0) throw new Error("The prepared photo is empty");
  if (file.size > ADMIN_PREPARED_MAX_BYTES) throw new Error("Prepared photos must be 10 MB or smaller");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Sign in before uploading a private file");
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/admin-prepared/${requestId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("customization-uploads").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}
