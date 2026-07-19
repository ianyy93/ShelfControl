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

    const ai = getAiClient();
    
    // Prepare image payload for Gemini
    const imagePart = {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: cleanImage,
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
Also extract the merchant/store name and the receipt date in YYYY-MM-DD format if visible.`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
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

    let textOutput = response.text;
    if (!textOutput) {
      throw new Error("Empty response received from the Gemini model.");
    }

    textOutput = textOutput.trim();
    // Strip markdown JSON wrappers if present
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
