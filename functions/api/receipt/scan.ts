import { GoogleGenAI, Type } from "@google/genai";

const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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
  try {
    const req = context.request;
    const body = await req.json().catch(() => null);
    const image = body?.image;
    const mimeType = body?.mimeType || "image/jpeg";

    if (!image) {
      return Response.json({ error: "Missing image base64 data" }, { status: 400 });
    }

    const cleanImage = String(image).includes(",") ? String(image).split(",")[1] : String(image);
    const promptText = `Analyze this receipt or invoice ...`;

    const response = await aiClient.models.generateContent({
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
    if (parsed.dateBought) {
      parsed.dateBought = sanitizeDate(parsed.dateBought);
    } else {
      parsed.dateBought = "";
    }

    return Response.json(parsed);
  } catch (error: any) {
    return Response.json({ error: error?.message || "Failed to scan receipt", details: error?.stack || error }, { status: 500 });
  }
}
