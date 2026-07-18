import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function run() {
  const promptText = `Analyze this receipt or invoice and extract all purchased grocery and household items.`;
  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: promptText },
            {
              inlineData: {
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            store: { type: Type.STRING, description: "Name of the store" },
            dateBought: { type: Type.STRING, description: "Date on the receipt" },
            items: {
              type: Type.ARRAY,
              description: "List of items found on the receipt.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unit: { type: Type.STRING },
                  category: { type: Type.STRING },
                  price: { type: Type.NUMBER }
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
