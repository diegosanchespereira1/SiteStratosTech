import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";
import { writeOperationLog } from "../_shared/ops_log.ts";

interface KnowledgeProcessBody {
  knowledgeFileId?: string;
}

function splitTextInChunks(text: string, chunkSize = 800): string[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];
  const chunks: string[] = [];
  let current = 0;
  while (current < cleaned.length) {
    chunks.push(cleaned.slice(current, current + chunkSize));
    current += chunkSize;
  }
  return chunks;
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
    const supabase = createAdminClient();
    const body = (await req.json().catch(() => ({}))) as KnowledgeProcessBody;
    const knowledgeFileId = String(body.knowledgeFileId ?? "").trim();

    if (!knowledgeFileId) {
      return jsonResponse(400, { ok: false, error: "knowledgeFileId e obrigatorio." });
    }

    const { data: file, error: fileError } = await supabase
      .from("knowledge_files")
      .select("*")
      .eq("id", knowledgeFileId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (fileError || !file) {
      await writeOperationLog({
        tenantId,
        source: "knowledge-process",
        level: "warn",
        event: "file_not_found",
        message: "Arquivo nao encontrado para processar.",
        details: { knowledgeFileId },
      });
      return jsonResponse(404, { ok: false, error: "Arquivo nao encontrado." });
    }

    await writeOperationLog({
      tenantId,
      source: "knowledge-process",
      event: "processing_started",
      message: `Processando arquivo guia: ${file.file_name}.`,
      details: { knowledgeFileId: file.id, fileName: file.file_name },
    });

    await supabase
      .from("knowledge_files")
      .update({ status: "processing", error_message: null })
      .eq("id", file.id);

    // Best effort text extraction: for now store file metadata as first chunk fallback.
    let extractedText = `Arquivo: ${file.file_name}\nMime: ${file.mime_type}\nPath: ${file.storage_path}`;

    try {
      const { data: downloaded, error: downloadError } = await supabase.storage
        .from("knowledge-files")
        .download(file.storage_path);

      if (!downloadError && downloaded) {
        const maybeText = await downloaded.text();
        if (maybeText && maybeText.trim()) {
          extractedText = maybeText;
        }
      }
    } catch (e) {
      await writeOperationLog({
        tenantId,
        source: "knowledge-process",
        level: "warn",
        event: "storage_download_failed",
        message: (e as Error).message,
        details: { knowledgeFileId: file.id, storagePath: file.storage_path },
      });
    }

    const chunks = splitTextInChunks(extractedText, 800);

    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("knowledge_file_id", file.id);

    if (chunks.length > 0) {
      const payload = chunks.map((chunk, index) => ({
        tenant_id: tenantId,
        knowledge_file_id: file.id,
        chunk_index: index,
        content: chunk,
        metadata: { source: "knowledge-process", chunkSize: chunk.length },
      }));
      const { error: insertError } = await supabase.from("knowledge_chunks").insert(payload);
      if (insertError) {
        await supabase
          .from("knowledge_files")
          .update({ status: "failed", error_message: insertError.message })
          .eq("id", file.id);
        await writeOperationLog({
          tenantId,
          source: "knowledge-process",
          level: "error",
          event: "chunks_insert_failed",
          message: insertError.message,
          details: { knowledgeFileId: file.id, fileName: file.file_name },
        });
        return jsonResponse(500, { ok: false, error: insertError.message });
      }
    }

    await supabase
      .from("knowledge_files")
      .update({ status: "ready", error_message: null })
      .eq("id", file.id);

    await writeOperationLog({
      tenantId,
      source: "knowledge-process",
      event: "processing_completed",
      message: `Arquivo guia processado: ${chunks.length} chunks.`,
      details: { knowledgeFileId: file.id, fileName: file.file_name, chunkCount: chunks.length },
    });

    return jsonResponse(200, {
      ok: true,
      knowledgeFileId: file.id,
      chunkCount: chunks.length,
      status: "ready",
    });
  } catch (error) {
    const errMsg = (error as Error).message;
    return jsonResponse(401, { ok: false, error: errMsg });
  }
});
