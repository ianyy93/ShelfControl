import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

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
    aiClient = new GoogleGenAI({
      apiKey,
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

    const ai = getAiClient();
    
    // Prepare image payload for Gemini
    const imagePart = {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: image,
      },
    };

    const currentDate = new Date().toISOString().split("T")[0];
    const promptText = `Analyze this receipt or invoice and extract all purchased grocery and household items. 
For each item, determine:
- A clean, friendly item name (e.g., "Organic Apples", "Whole Milk").
- The quantity purchased. Since the user wants to count items (including meat, seafood, and produce) by pieces ('pcs') rather than weight, estimate or extract the piece count for the quantity.
- The unit of measurement. NEVER use weight units (such as 'kg', 'g', 'lb', 'lbs', 'oz'). Instead, always use 'pcs' as the unit for count/pieces. For liquids, you may still use volume units ('mL', 'L') if appropriate, but for solid items, meat, and produce, always use 'pcs'.
- The best category (must be exactly one of: Produce, Dairy & Eggs, Meat & Seafood, Pantry, Frozen, Beverages, Snacks, Household, Dog Supplies, Other).
- The total price paid for that item.
Also extract the merchant/store name and the receipt date in YYYY-MM-DD format if visible. The current date is ${currentDate}. If the year is ambiguous or 2 digits (e.g. '05-07-26' could be 2005-07-26 or 2026-07-05 depending on whether it is interpreted as YY-MM-DD or DD-MM-YY), make an assumption to resolve it to be closest to the current date (${currentDate}), but not a future date. Mark 'dateBoughtAmbiguous' as true if such an ambiguity exists, and explain the assumption and alternate possible dates in 'dateAssumptionMade'.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
            dateBoughtAmbiguous: {
              type: Type.BOOLEAN,
              description: "True if the date format or year on the receipt was ambiguous (e.g. could be interpreted as multiple years, or multiple date layouts)."
            },
            dateAssumptionMade: {
              type: Type.STRING,
              description: "Short explanation of the assumption made to resolve the ambiguous date (e.g., 'Assumed 2026-07-05 instead of 2005-07-26 because it is closer to today and not in the future.')."
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
                  }
                },
                required: ["name", "quantity", "category"]
              }
            }
          },
          required: ["items"]
        }
      }
    });

    const textOutput = response.text;
    if (!textOutput) {
      throw new Error("Empty response received from the Gemini model.");
    }

    const parsedData = JSON.parse(textOutput.trim());

    // Validate and sanitize the dateBought on backend to ensure strict YYYY-MM-DD or empty
    if (parsedData.dateBought) {
      const rawDate = String(parsedData.dateBought).trim();
      const match = rawDate.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (match) {
        const y = match[1];
        const m = match[2].padStart(2, '0');
        const d = match[3].padStart(2, '0');
        parsedData.dateBought = `${y}-${m}-${d}`;
      } else {
        const altMatch = rawDate.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (altMatch) {
          const part1 = altMatch[1];
          const part2 = altMatch[2];
          const y = altMatch[3];
          let m = part1;
          let d = part2;
          if (parseInt(part1) > 12) {
            d = part1;
            m = part2;
          }
          parsedData.dateBought = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        } else {
          parsedData.dateBought = "";
        }
      }
    } else {
      parsedData.dateBought = "";
    }

    res.json(parsedData);
  } catch (error: any) {
    console.error("Receipt processing failed:", error);
    res.status(500).json({ error: error.message || "Failed to scan receipt" });
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
