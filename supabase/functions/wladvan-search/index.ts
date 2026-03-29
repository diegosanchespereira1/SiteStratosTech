import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const EXTRACTION_PROMPT = `You extract structured product search information from customer messages at Wladvan, an auto parts store for diesel vehicles.

The message may contain multiple customer messages joined by " | ".

Return ONLY valid JSON:
{
  "intent": "product_search" | "greeting" | "operational" | "confirmation" | "other",
  "product": "string or null",
  "vehicle": "string or null",
  "year": "string or null",
  "search_query": "optimized search terms for database",
  "missing_info": []
}

Intent rules:
- "greeting": greetings like "oi", "boa noite", "tudo bem" with no product mention
- "operational": questions about hours, address, payment, delivery, warranty
- "product_search": asking about a specific auto part/product
- "confirmation": confirming previous info ("sim", "isso", "2015") or providing missing details
- "other": anything else

search_query rules:
- Extract ONLY product name + vehicle + year. Remove ALL filler words.
- For "greeting"/"operational", set to ""
- For "confirmation" with prior context in the message, extract product terms from full context

Known vehicles: HR=Hyundai HR, K2500=Kia K2500, H100=Hyundai H100, Sprinter=Mercedes-Benz Sprinter, Ducato=Fiat Ducato, Master=Renault Master, Daily=Iveco Daily, Transit=Ford Transit, Boxer=Peugeot Boxer, L200=Mitsubishi L200, Hilux=Toyota Hilux, Frontier=Nissan Frontier

missing_info: what's still needed for a precise search. Options: "year","product","vehicle". Empty if complete.

Examples:
"olá, estou procurando motor da hr | sim, 2015"
→ {"intent":"product_search","product":"motor","vehicle":"HR","year":"2015","search_query":"motor HR 2015","missing_info":[]}

"boa noite"
→ {"intent":"greeting","product":null,"vehicle":null,"year":null,"search_query":"","missing_info":[]}

"qual o horário de vocês?"
→ {"intent":"operational","product":null,"vehicle":null,"year":null,"search_query":"","missing_info":[]}

"preciso de disco de freio"
→ {"intent":"product_search","product":"disco de freio","vehicle":null,"year":null,"search_query":"disco de freio","missing_info":["vehicle","year"]}

"olá, estou procurando motor da hr | estou procurando o motor mesmo"
→ {"intent":"product_search","product":"motor","vehicle":"HR","year":null,"search_query":"motor HR","missing_info":["year"]}`;

interface Extraction {
  intent: string;
  product: string | null;
  vehicle: string | null;
  year: string | null;
  search_query: string;
  missing_info: string[];
}

const FALLBACK_EXTRACTION: Extraction = {
  intent: "other",
  product: null,
  vehicle: null,
  year: null,
  search_query: "",
  missing_info: [],
};

async function extractIntent(
  apiKey: string,
  message: string,
): Promise<Extraction> {
  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data?.choices?.[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(raw) as Partial<Extraction>;
    return {
      intent: parsed.intent ?? "other",
      product: parsed.product ?? null,
      vehicle: parsed.vehicle ?? null,
      year: parsed.year ?? null,
      search_query: parsed.search_query ?? "",
      missing_info: Array.isArray(parsed.missing_info) ? parsed.missing_info : [],
    };
  } catch {
    return { ...FALLBACK_EXTRACTION, search_query: message.slice(0, 200) };
  }
}

interface SearchRequestBody {
  message?: string;
  max_rows?: number;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as SearchRequestBody;
    const message = String(body.message ?? "").trim();

    if (!message) {
      return jsonResponse(400, { error: "message is required" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey?.trim()) {
      return jsonResponse(503, {
        error: "OPENAI_API_KEY not configured",
        intent: "error",
        extracted: FALLBACK_EXTRACTION,
        products: [],
      });
    }

    const extraction = await extractIntent(apiKey, message);

    let products: unknown[] = [];
    const searchableIntents = ["product_search", "confirmation"];

    if (
      searchableIntents.includes(extraction.intent) &&
      extraction.search_query.trim().length > 0
    ) {
      const supabase = createAdminClient();
      const maxRows = Math.min(Math.max(body.max_rows ?? 25, 1), 50);

      const { data, error } = await supabase.rpc(
        "search_wladvan_products_semantic",
        {
          search_query: extraction.search_query,
          exclude_terms: [],
          max_rows: maxRows,
        },
      );

      if (error) {
        console.error("RPC error:", error.message);
      }
      if (data && Array.isArray(data)) {
        products = data;
      }
    }

    return jsonResponse(200, {
      intent: extraction.intent,
      extracted: {
        product: extraction.product,
        vehicle: extraction.vehicle,
        year: extraction.year,
        search_query: extraction.search_query,
        missing_info: extraction.missing_info,
      },
      products,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error("wladvan-search error:", msg);
    return jsonResponse(500, {
      error: msg,
      intent: "error",
      extracted: FALLBACK_EXTRACTION,
      products: [],
    });
  }
});
