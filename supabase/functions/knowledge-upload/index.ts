import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { decodeBase64ToBytes } from "../_shared/decode_base64.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";
import { writeOperationLog } from "../_shared/ops_log.ts";

interface KnowledgeUploadBody {
  fileName?: string;
  mimeType?: string;
  fileBase64?: string;
  storagePath?: string;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const body = (await req.json().catch(() => ({}))) as KnowledgeUploadBody;

    const fileName = String(body.fileName ?? "").trim();
    const mimeType = String(body.mimeType ?? "application/octet-stream").trim();
    const storagePathInput = String(body.storagePath ?? "").trim();
    const base64 = String(body.fileBase64 ?? "").trim();

    if (!fileName) {
      return jsonResponse(400, { ok: false, error: "fileName e obrigatorio." });
    }

    const supabase = createAdminClient();
    const storagePath =
      storagePathInput || `${tenantId}/${crypto.randomUUID()}-${fileName.replace(/\s+/g, "_")}`;

    let sizeBytes = 0;
    if (base64) {
      const bytes = decodeBase64ToBytes(base64);
      sizeBytes = bytes.byteLength;

      const { error: uploadError } = await supabase.storage
        .from("knowledge-files")
        .upload(storagePath, bytes, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) {
        await writeOperationLog({
          tenantId,
          source: "knowledge-upload",
          level: "error",
          event: "storage_upload_failed",
          message: uploadError.message,
          details: { fileName, storagePath },
        });
        return jsonResponse(500, {
          ok: false,
          error: `Falha ao enviar arquivo para storage: ${uploadError.message}`,
        });
      }
    }

    const { data, error } = await supabase
      .from("knowledge_files")
      .insert({
        tenant_id: tenantId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        status: "uploaded",
      })
      .select("*")
      .maybeSingle();

    if (error) {
      await writeOperationLog({
        tenantId,
        source: "knowledge-upload",
        level: "error",
        event: "upload_failed",
        message: error.message,
        details: { fileName, storagePath },
      });
      return jsonResponse(500, { ok: false, error: error.message });
    }

    await writeOperationLog({
      tenantId,
      source: "knowledge-upload",
      event: "file_uploaded",
      message: `Arquivo ${data?.file_name} enviado. ID: ${data?.id}.`,
      details: { fileId: data?.id, fileName: data?.file_name, sizeBytes: data?.size_bytes },
    });

    return jsonResponse(200, {
      ok: true,
      file: data,
      uploadedToStorage: Boolean(base64),
      nextAction: "Chame /knowledge-process com knowledgeFileId",
    });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
