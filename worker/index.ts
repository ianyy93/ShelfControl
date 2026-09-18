import { GoogleGenAI, Type } from "@google/genai";

interface Env {
  GEMINI_API_KEY: string;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

const RECEIPT_MODEL = (typeof process !== "undefined" && process.env?.GEMINI_RECEIPT_MODEL) || "gemini-2.5-flash";

let aiClient: GoogleGenAI | null = null;

function getAiClient(env: Env): GoogleGenAI {
  if (!aiClient) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not defined in environment.");
    }
    aiClient = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY.trim(),
    });
  }
  return aiClient;
}

function sanitizeDate(rawValue: unknown): string {
  const fallback = new Date().toISOString().split("T")[0];
  if (!rawValue) return fallback;

  const normalized = String(rawValue).trim().replace(/\s+/g, " ");
  if (!normalized) return fallback;

  const yearFirstMatch = normalized.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (yearFirstMatch) {
    return `${yearFirstMatch[1]}-${String(yearFirstMatch[2]).padStart(2, "0")}-${String(yearFirstMatch[3]).padStart(2, "0")}`;
  }

  const dayMonthYearMatch = normalized.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dayMonthYearMatch) {
    let month = Number(dayMonthYearMatch[1]);
    let day = Number(dayMonthYearMatch[2]);
    const year = Number(dayMonthYearMatch[3]);
    if (month > 12 && day <= 12) {
      [month, day] = [day, month];
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsedDate = new Date(normalized);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}`;
  }

  return fallback;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" }, {
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    // Receipt Scan API
    if (url.pathname === "/api/receipt/scan") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (request.method !== "POST") {
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
      }

      try {
        const body = await request.json().catch(() => null) as any;
        const image = body?.image;
        const mimeType = body?.mimeType || "image/jpeg";

        if (!image) {
          return Response.json({ error: "Missing image base64 data" }, { status: 400 });
        }

        const cleanImage = String(image).includes(",") ? String(image).split(",")[1] : String(image);
        const promptText = `Extract grocery receipt data as JSON. Return only the fields needed for inventory import:
- store: merchant name
- dateBought: receipt date in YYYY-MM-DD or empty string
- items: array of { name, quantity, unit, category, price, unitPrice?, priceQuantity?, priceUnit?, notes?, entries? }
Rules:
- category must be one of: Produce, Dairy & Eggs, Meat & Seafood, Pantry, Frozen, Beverages, Snacks, Household, Dog Supplies, Other
- unit should be 'pcs' for counted items or a standard weight/volume unit when clear
- if a price is per kg/L/each, fill unitPrice / priceQuantity / priceUnit
- keep names clean and short
- do not include explanations or markdown`;

        const client = getAiClient(env);
        const callGemini = async () => client.models.generateContent({
          model: RECEIPT_MODEL,
          contents: [{ inlineData: { mimeType, data: cleanImage } }, { text: promptText }],
          config: {
            systemInstruction: "You are an expert receipt parsing assistant. Extract grocery items and store info into the exact JSON schema requested.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                store: { type: Type.STRING },
                dateBought: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unit: { type: Type.STRING },
                      category: { type: Type.STRING },
                      price: { type: Type.NUMBER },
                      unitPrice: { type: Type.NUMBER },
                      priceQuantity: { type: Type.NUMBER },
                      priceUnit: { type: Type.STRING },
                      notes: { type: Type.STRING },
                      entries: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            location: { type: Type.STRING },
                            quantity: { type: Type.NUMBER },
                            amount: { type: Type.NUMBER },
                            unit: { type: Type.STRING },
                            expiryDate: { type: Type.STRING },
                            dateBought: { type: Type.STRING },
                            label: { type: Type.STRING },
                            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                          },
                        },
                      },
                    },
                    required: ["name", "quantity", "unit", "category", "price"],
                  },
                },
              },
              required: ["store", "dateBought", "items"],
            },
          },
        });

        let response;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            response = await callGemini();
            break;
          } catch (error: any) {
            const message = String(error?.message || "");
            const shouldRetry = /429|500|502|503|504|524|timeout|temporar/i.test(message) || error?.status === 429 || error?.status === 500 || error?.status === 502 || error?.status === 503 || error?.status === 504 || error?.status === 524;
            if (shouldRetry && attempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 250 * attempt));
              continue;
            }
            throw error;
          }
        }

        const parsed = JSON.parse(response.text || "{}");
        if (parsed.dateBought) {
          parsed.dateBought = sanitizeDate(parsed.dateBought);
        } else {
          parsed.dateBought = "";
        }

        return Response.json(parsed, {
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      } catch (error: any) {
        return Response.json({ 
          error: error?.message || "Failed to scan receipt", 
          details: error?.stack || error 
        }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // Forward non-API requests to static assets
    if (!env.ASSETS) {
      return new Response("Internal Server Error: ASSETS binding is missing in Worker environment.", { status: 500 });
    }
    return env.ASSETS.fetch(request);
  },
};
