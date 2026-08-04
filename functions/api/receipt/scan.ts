import { GoogleGenAI, Type } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

function getAiClient(env: any): GoogleGenAI {
  console.log("[SCAN API LOG] Initializing/retrieving GoogleGenAI client...");
  
  // Log environment/process details to diagnose the 405/500 issues
  const processDefined = typeof process !== "undefined";
  console.log(`[SCAN API LOG] typeof process: ${typeof process}`);
  if (processDefined) {
    console.log(`[SCAN API LOG] typeof process.env: ${typeof process.env}`);
    console.log(`[SCAN API LOG] process.env.GEMINI_API_KEY defined: ${typeof (process.env as any)?.GEMINI_API_KEY !== "undefined"}`);
  }
  
  const envDefined = typeof env !== "undefined";
  console.log(`[SCAN API LOG] typeof env: ${typeof env}`);
  if (envDefined) {
    console.log(`[SCAN API LOG] env.GEMINI_API_KEY defined: ${typeof env?.GEMINI_API_KEY !== "undefined"}`);
    if (env?.GEMINI_API_KEY) {
      console.log(`[SCAN API LOG] env.GEMINI_API_KEY length: ${env.GEMINI_API_KEY.length}`);
    }
  }

  if (!aiClient) {
    const apiKey = env?.GEMINI_API_KEY || (processDefined ? (process.env as any)?.GEMINI_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in any environment (env or process.env).");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey.trim(),
    });
    console.log("[SCAN API LOG] Created new GoogleGenAI instance successfully");
  } else {
    console.log("[SCAN API LOG] Reusing existing GoogleGenAI instance");
  }
  return aiClient;
}

function sanitizeDate(rawValue: unknown): string {
  const fallback = new Date().toISOString().split("T")[0];
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const normalized = String(rawValue).trim().replace(/\s+/g, " ");
  if (!normalized) {
    return fallback;
  }

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
      const temp = month;
      month = day;
      day = temp;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsedDate = new Date(normalized);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}`;
  }

  return fallback;
}

export async function onRequestPost(context: any) {
  console.log("[SCAN API LOG] onRequestPost started");
  try {
    const req = context.request;
    const body = await req.json().catch((e: any) => {
      console.error("[SCAN API LOG] Failed to parse JSON body:", e);
      return null;
    });
    
    console.log("[SCAN API LOG] Request body parsed successfully:", !!body);
    
    const image = body?.image;
    const mimeType = body?.mimeType || "image/jpeg";

    if (!image) {
      console.error("[SCAN API LOG] Missing image base64 data");
      return Response.json({ error: "Missing image base64 data" }, { status: 400 });
    }

    console.log(`[SCAN API LOG] Image Base64 length: ${image.length}, mimeType: ${mimeType}`);

    const cleanImage = String(image).includes(",") ? String(image).split(",")[1] : String(image);
    const promptText = `Analyze this receipt or invoice and extract all purchased grocery and household items.
For each item, determine:
- A clean, friendly item name (e.g., "Organic Apples", "Whole Milk").
- The purchased quantity as it appears on the receipt (for example: 3, 2, 1.5, 12, or 2.5).
- The unit of measurement for that quantity (use 'pcs' for counted items, or a meaningful unit like 'kg', 'g', 'lb', 'oz', 'mL', 'L' when the receipt clearly shows a weight or volume basis).
- The best category (must be exactly one of: Produce, Dairy & Eggs, Meat & Seafood, Pantry, Frozen, Beverages, Snacks, Household, Dog Supplies, Other).
- The total price paid for that line item.
- The price basis quantity and unit that the price applies to if the receipt shows a unit price or a package/weight/volume price (for example, 2.5 kg, 1 L, 3 pcs). If the receipt does not specify a separate price basis, set the price basis equal to the purchased quantity and the same unit.
- A short note with any useful context such as pack size, bundle, or multi-pack details.
Also extract the merchant/store name and the receipt date in YYYY-MM-DD format if visible.`;

    const client = getAiClient(context.env);
    
    console.log("[SCAN API LOG] Requesting generateContent from Gemini...");
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
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
                  priceQuantity: { type: Type.NUMBER },
                  priceUnit: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
                required: ["name", "quantity", "unit", "category", "price"],
              },
            },
          },
          required: ["store", "dateBought", "items"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    console.log("[SCAN API LOG] Parsing succeeded, results store:", parsed.store);
    if (parsed.dateBought) {
      parsed.dateBought = sanitizeDate(parsed.dateBought);
    } else {
      parsed.dateBought = "";
    }

    return Response.json(parsed);
  } catch (error: any) {
    console.error("[SCAN API LOG] Error during receipt scan processing:", error);
    if (error?.stack) {
      console.error("[SCAN API LOG] Error stack:", error.stack);
    }
    return Response.json({ error: error?.message || "Failed to scan receipt", details: error?.stack || error }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function onRequestGet() {
  console.log("[SCAN API LOG] onRequestGet hit unexpectedly");
  return Response.json({ error: "Method Not Allowed. Use POST." }, { status: 405 });
}
