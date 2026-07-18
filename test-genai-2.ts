import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function run() {
  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: "Analyze this receipt",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            store: {
              type: Type.STRING,
              description: "Name of the store or merchant."
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
                required: ["name", "quantity", "category"]
              }
            }
          },
          required: ["items"]
        }
      }
    });
    console.log(response.text);
  } catch (error) {
    console.error("Test failed", error);
  }
}

run();
