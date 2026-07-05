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

    const promptText = `Analyze this receipt or invoice and extract all purchased grocery and household items. 
For each item, determine:
- A clean, friendly item name (e.g., "Organic Apples", "Whole Milk").
- The quantity purchased.
- The unit of measurement (e.g. "pcs", "g", "kg", "mL", "L", or empty if count).
- The best category (must be exactly one of: Produce, Dairy & Eggs, Meat & Seafood, Pantry, Frozen, Beverages, Snacks, Household, Dog Supplies, Other).
- The total price paid for that item.
Also extract the merchant/store name and the receipt date in YYYY-MM-DD format if visible.`;

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
                    description: "Standard unit (e.g., pcs, g, kg, mL, L, pack, or empty if count/pieces)."
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
