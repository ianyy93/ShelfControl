import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { parseReceiptText } from "./src/lib/receipt";

dotenv.config();

const app = express();
const PORT = 3000;
const RECEIPT_MODEL = process.env.GEMINI_RECEIPT_MODEL || "gemini-2.5-flash";

// Set up larger limits to support receipt base64 images
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// Initialize GoogleGenAI client lazy/safely
let aiClient: GoogleGenAI | null = null;

function getAiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in environment variables.");
    }
    const cleanApiKey = apiKey.trim();
    aiClient = new GoogleGenAI({
      apiKey: cleanApiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Receipt Scanning API Endpoint
app.post("/api/receipt/scan", async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      res.status(400).json({ error: "Missing image base64 data" });
      return;
    }

    console.log("[SERVER SCANDOC] Incoming Scan request details:");
    console.log(`- mimeType: ${mimeType}`);
    console.log(`- Raw payload length: ${image.length} chars`);
    
    // Defensive check: strip base64 URI scheme prefix if leaked
    let cleanImage = image;
    if (cleanImage.includes(",")) {
      console.log("- Warning: Base64 contained a comma prefix. Splitting out data content...");
      cleanImage = cleanImage.split(",")[1];
    }
    
    // Strip whitespace / newlines
    const originalLength = cleanImage.length;
    cleanImage = cleanImage.replace(/\s/g, "");
    if (cleanImage.length !== originalLength) {
      console.log(`- Warning: Whitespace removed from base64. Chars reduced from ${originalLength} to ${cleanImage.length}`);
    }
    
    // Character set validation for base64
    const invalidChars = cleanImage.match(/[^A-Za-z0-9+/=]/g);
    if (invalidChars) {
      const uniqChars = Array.from(new Set(invalidChars)).join("");
      console.error(`- Warning: Detected invalid Base64 characters: "${uniqChars}"`);
    }

    const fallbackParsed = parseReceiptText(cleanImage ? Buffer.from(cleanImage, "base64").toString("utf-8") : "");
    if (fallbackParsed.items.length > 0) {
      console.log("[SERVER SCANDOC] Falling back to deterministic receipt parsing without AI.");
      res.json({
        store: "",
        dateBought: new Date().toISOString().split("T")[0],
        items: fallbackParsed.items,
      });
      return;
    }

    const ai = getAiClient();

    const imagePart = {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: cleanImage,
      },
    };

    const currentDate = new Date().toISOString().split("T")[0];
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

    const callGemini = async () => ai.models.generateContent({
      model: RECEIPT_MODEL,
      contents: [imagePart, { text: promptText }],
      config: {
        systemInstruction: "You are an expert receipt parsing assistant. Extract grocery items and store info into the exact JSON schema requested.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            store: {
              type: Type.STRING,
              description: "The merchant or store name (e.g., Walmart, Costco, Target, Kroger)."
            },
            dateBought: {
              type: Type.STRING,
              description: "Date on the receipt in YYYY-MM-DD format. Leave empty if unknown."
            },
            items: {
              type: Type.ARRAY,
              description: "List of items found on the receipt.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: "Clean item description/name, e.g. Gala Apples, Milk 1 Gallon."
                  },
                  quantity: {
                    type: Type.NUMBER,
                    description: "Quantity purchased of this item."
                  },
                  unit: {
                    type: Type.STRING,
                    description: "Standard unit. NEVER use weight units (like kg, g, lb, lbs, oz) for meat, seafood, or produce; always use 'pcs' as the unit for solid items."
                  },
                  category: {
                    type: Type.STRING,
                    description: "Must be exactly one of: Produce, Dairy & Eggs, Meat & Seafood, Pantry, Frozen, Beverages, Snacks, Household, Dog Supplies, Other"
                  },
                  price: {
                    type: Type.NUMBER,
                    description: "Total line price paid for this item."
                  },
                  unitPrice: {
                    type: Type.NUMBER,
                    description: "Unit price when the receipt shows a per-unit or per-weight basis."
                  },
                  priceQuantity: {
                    type: Type.NUMBER,
                    description: "The quantity the price applies to when the receipt shows a unit price basis."
                  },
                  priceUnit: {
                    type: Type.STRING,
                    description: "The unit that the price applies to when the receipt shows a unit price basis."
                  },
                  notes: {
                    type: Type.STRING,
                    description: "Useful context such as pack size, bundle, or multi-pack details."
                  },
                  entries: {
                    type: Type.ARRAY,
                    description: "Inventory-style entry details for this item. Split into multiple entries if needed.",
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
                      }
                    }
                  }
                },
                required: ["name", "quantity", "unit", "category", "price"]
              }
            }
          },
          required: ["store", "dateBought", "items"]
        }
      }
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

    let textOutput = response.text;
    if (!textOutput) {
      throw new Error("Empty response received from the Gemini model.");
    }

    textOutput = textOutput.trim();
    if (textOutput.startsWith("```")) {
      textOutput = textOutput.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
    }

    const parsedData = JSON.parse(textOutput);
    console.log("Raw Gemini Output:", JSON.stringify(parsedData, null, 2));

    // Validate and sanitize the dateBought on backend to ensure strict YYYY-MM-DD or empty
    if (parsedData.dateBought) {
      const rawDate = String(parsedData.dateBought).trim();
      let finalDate = "";
      
      const match = rawDate.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (match) {
        finalDate = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
      } else {
        const altMatch = rawDate.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (altMatch) {
          const part1 = parseInt(altMatch[1]);
          const part2 = parseInt(altMatch[2]);
          const y = parseInt(altMatch[3]);
          let m = part1;
          let d = part2;
          if (part1 > 12) {
            d = part1;
            m = part2;
          }
          finalDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
      }
      
      console.log(`Parsed date mapping: rawDate=${rawDate} -> finalDate=${finalDate}`);
      parsedData.dateBought = finalDate;
    } else {
      parsedData.dateBought = "";
    }

    res.json(parsedData);
  } catch (error: any) {
    console.error("Receipt processing failed fully:");
    console.error(error);
    console.error(JSON.stringify(error, null, 2));
    res.status(500).json({ error: error.message || "Failed to scan receipt", details: error?.stack || error });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Vite / static file middleware setup
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
