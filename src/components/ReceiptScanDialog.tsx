import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CATEGORIES, Category, GroceryItem, InventoryEntry, PriceEntry } from "../types";
import { 
  Receipt, 
  Upload, 
  X, 
  Plus, 
  Minus, 
  Trash2, 
  Loader2, 
  Sparkles, 
  Building, 
  Calendar, 
  DollarSign, 
  AlertCircle,
  Check,
  Terminal
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ReceiptScanDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  existingItems: GroceryItem[];
  onImport: (itemsToImport: Array<{
    name: string;
    quantity: number;
    category: Category;
    unit: string;
    price?: number;
    store?: string;
    dateBought?: string;
  }>) => Promise<void>;
}

interface ParsedItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: Category;
  price?: number;
}

interface DebugInfo {
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  base64Length?: number;
  base64Start?: string;
  userAgent?: string;
  serverDetails?: any;
}

export function ReceiptScanDialog({ isOpen, onOpenChange, existingItems, onImport }: ReceiptScanDialogProps) {
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  
  // Parsed state
  const [parsedStore, setParsedStore] = useState("");
  const [parsedDate, setParsedDate] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [isParsed, setIsParsed] = useState(false);
  const [activeFocusItemId, setActiveFocusItemId] = useState<string | null>(null);

  // Helper to find exact or fuzzy match from existing items
  const getMatchedExistingItem = (name: string) => {
    if (!name.trim()) return null;
    const normalized = name.toLowerCase().trim();
    
    // 1. Exact case-insensitive match
    const exact = existingItems.find(item => item.name.toLowerCase().trim() === normalized);
    if (exact) {
      return { item: exact, type: "exact" as const };
    }
    
    // 2. Substring match
    const substringMatch = existingItems.find(item => {
      const existingName = item.name.toLowerCase().trim();
      return existingName.includes(normalized) || normalized.includes(existingName);
    });
    if (substringMatch) {
      return { item: substringMatch, type: "partial" as const };
    }
    
    // 3. Match of individual word parts (at least 3 characters)
    const queryWords = normalized.split(/\s+/).filter(w => w.length >= 3);
    if (queryWords.length > 0) {
      const overlapMatch = existingItems.find(item => {
        const existingName = item.name.toLowerCase().trim();
        return queryWords.some(word => existingName.includes(word));
      });
      if (overlapMatch) {
        return { item: overlapMatch, type: "partial" as const };
      }
    }

    return null;
  };

  // Helper to filter all matching autocomplete suggestions from existing inventory items
  const getSuggestions = (query: string) => {
    if (!query.trim()) return existingItems.slice(0, 5);
    const normalized = query.toLowerCase();
    
    // Prioritize items that start with or contain the typed query
    return existingItems
      .filter(item => item.name.toLowerCase().includes(normalized))
      .slice(0, 5);
  };

  const handleApplyMatch = (itemId: string, existingItemName: string, category: Category) => {
    setParsedItems(prev =>
      prev.map(item => {
        if (item.id === itemId) {
          return {
            ...item,
            name: existingItemName,
            category: category
          };
        }
        return item;
      })
    );
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadingMessages = [
    "Gemini is analyzing the receipt image...",
    "Extracting merchant name and purchase date...",
    "Scanning line items, quantities, and prices...",
    "Matching items with standard grocery categories...",
    "Preparing your preview dashboard..."
  ];

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const parts = result.split(",");
        if (parts.length < 2) {
          reject(new Error("FileReader result does not contain base64 content after comma."));
          return;
        }
        const base64 = parts[1];
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const processFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, etc.)");
      return;
    }

    setLoading(true);
    setError(null);
    setDebugInfo(null);
    setLoadingStep(0);
    setIsParsed(false);

    // Rotate loading messages
    stepIntervalRef.current = setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % loadingMessages.length);
    }, 2500);

    let base64 = "";
    try {
      base64 = await fileToBase64(file);
      const response = await fetch("/api/receipt/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: base64,
          mimeType: file.type,
        }),
      });

      if (!response.ok) {
        let errMsg = "Failed to scan receipt";
        let errDetails: any = null;
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
          errDetails = errData.details || null;
          if (errDetails) {
            errMsg += " | Details: " + (typeof errDetails === "object" ? JSON.stringify(errDetails) : errDetails);
          }
        } catch {
          const textErr = await response.text().catch(() => "");
          errMsg = `Server error ${response.status}: ${response.statusText || "Internal Server Error"}`;
          errDetails = textErr;
          if (textErr && textErr.length < 200) {
            errMsg += ` (${textErr})`;
          }
        }
        
        const errorObject = new Error(errMsg);
        (errorObject as any).serverDetails = errDetails;
        throw errorObject;
      }

      const data = await response.json();
      
      // Map parsed items
      const items: ParsedItem[] = (data.items || []).map((item: any, idx: number) => {
        let unit = item.unit || "pcs";
        const lowerUnit = unit.toLowerCase().trim();
        // If it got weight units anyway, convert them to pcs as per user preference
        if (["kg", "g", "lb", "lbs", "oz", "ounce", "ounces", "gram", "grams", "kilo", "kilograms", "kilogram"].includes(lowerUnit)) {
          unit = "pcs";
        }
        return {
          id: `parsed-${idx}-${Date.now()}`,
          name: item.name || "Unknown Item",
          quantity: item.quantity || 1,
          unit: unit,
          category: (CATEGORIES.includes(item.category) ? item.category : "Other") as Category,
          price: item.price !== undefined ? Number(item.price) : undefined,
        };
      });

      // Robust client-side sanitization of dateBought to avoid HTML5 date input pattern crashes
      let finalDate = data.dateBought || "";
      if (finalDate) {
        const clean = String(finalDate).trim();
        const match = clean.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (match) {
          finalDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        } else {
          finalDate = new Date().toISOString().split("T")[0];
        }
      } else {
        finalDate = new Date().toISOString().split("T")[0];
      }

      setParsedStore(data.store || "");
      setParsedDate(finalDate);
      setParsedItems(items);
      setIsParsed(true);
    } catch (err: any) {
      console.error("Scanning Error Caught:", err);
      setError(err.message || "An error occurred while parsing the receipt.");
      setDebugInfo({
        errorName: err.name || "Error",
        errorMessage: err.message,
        errorStack: err.stack,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        base64Length: base64 ? base64.length : 0,
        base64Start: base64 ? base64.substring(0, 100) + "..." : "Not successfully encoded to base64",
        userAgent: navigator.userAgent,
        serverDetails: err.serverDetails,
      });
    } finally {
      setLoading(false);
      if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
    }
  };

  const handleUpdateItem = (id: string, field: keyof ParsedItem, value: any) => {
    setParsedItems(prev =>
      prev.map(item => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setParsedItems(prev => prev.filter(item => item.id !== id));
  };

  const handleAddItem = () => {
    const newItem: ParsedItem = {
      id: `parsed-manual-${Date.now()}`,
      name: "",
      quantity: 1,
      unit: "pcs",
      category: "Produce",
    };
    setParsedItems(prev => [...prev, newItem]);
  };

  const handleImportAll = async () => {
    try {
      setLoading(true);
      const payload = parsedItems
        .filter(item => item.name.trim() !== "")
        .map(item => ({
          name: item.name,
          quantity: item.quantity,
          category: item.category,
          unit: item.unit,
          price: item.price,
          store: parsedStore,
          dateBought: parsedDate,
        }));

      await onImport(payload);
      onOpenChange(false);
      // Reset state
      setIsParsed(false);
      setParsedItems([]);
      setParsedStore("");
      setParsedDate("");
    } catch (err: any) {
      setError(err.message || "Failed to import items to inventory.");
    } finally {
      setLoading(false);
    }
  };

  const totalSpent = parsedItems.reduce((sum, item) => sum + (item.price || 0), 0);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <Sparkles className="w-5 h-5 text-blue-600 animate-pulse" />
            Scan Receipt with Gemini AI
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="space-y-2">
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2 border border-red-100">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">Error Scanning Receipt</div>
                <div className="text-xs mt-0.5 opacity-90">{error}</div>
              </div>
            </div>
            
            {debugInfo && (
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 text-xs">
                <button
                  type="button"
                  onClick={() => setShowDebug(!showDebug)}
                  className="w-full px-3 py-2 flex items-center justify-between bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200/80 transition-colors text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-gray-500" />
                    {showDebug ? "Hide Diagnostic & Debug Info" : "Show Diagnostic & Debug Info"}
                  </span>
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                    {debugInfo.errorName || "DOMException"}
                  </span>
                </button>
                
                {showDebug && (
                  <div className="p-3 space-y-2 font-mono divide-y divide-gray-200/60 max-h-[250px] overflow-y-auto">
                    <div className="pb-2 space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Exception Overview</p>
                      <p className="text-gray-800"><span className="text-red-600 font-semibold">{debugInfo.errorName}:</span> {debugInfo.errorMessage}</p>
                    </div>
                    
                    {debugInfo.errorStack && (
                      <div className="py-2 space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Client Stack Trace</p>
                        <pre className="text-[10px] bg-gray-900 text-gray-300 p-2 rounded overflow-x-auto whitespace-pre leading-relaxed">
                          {debugInfo.errorStack}
                        </pre>
                      </div>
                    )}

                    <div className="py-2 space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Uploaded File Context</p>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                        <p><strong>Name:</strong> {debugInfo.fileName}</p>
                        <p><strong>Type:</strong> {debugInfo.fileType}</p>
                        <p><strong>Size:</strong> {(debugInfo.fileSize || 0).toLocaleString()} bytes</p>
                        <p><strong>Base64 Length:</strong> {(debugInfo.base64Length || 0).toLocaleString()} chars</p>
                      </div>
                    </div>

                    {debugInfo.base64Start && (
                      <div className="py-2 space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Base64 Payload Preview</p>
                        <pre className="text-[10px] bg-gray-100 p-1.5 rounded border overflow-x-auto text-gray-500">
                          {debugInfo.base64Start}
                        </pre>
                      </div>
                    )}

                    <div className="py-2 space-y-1">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Client Browser Info</p>
                      <p className="text-[11px] text-gray-600 leading-normal">{debugInfo.userAgent}</p>
                    </div>

                    {debugInfo.serverDetails && (
                      <div className="pt-2 space-y-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Server Diagnostic Details</p>
                        <pre className="text-[10px] bg-gray-900 text-yellow-400 p-2 rounded overflow-x-auto whitespace-pre leading-relaxed">
                          {typeof debugInfo.serverDetails === "object"
                            ? JSON.stringify(debugInfo.serverDetails, null, 2)
                            : String(debugInfo.serverDetails)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[300px] py-4">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center justify-center py-16 text-center space-y-4"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-blue-50 border-t-blue-600 animate-spin" />
                  <Receipt className="w-6 h-6 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h3 className="font-semibold text-gray-900">Parsing Receipt...</h3>
                  <p className="text-sm text-gray-500 animate-pulse">
                    {loadingMessages[loadingStep]}
                  </p>
                </div>
              </motion.div>
            ) : !isParsed ? (
              <motion.div
                key="uploader"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-4 ${
                    dragActive
                      ? "border-blue-500 bg-blue-50/50 scale-[0.99]"
                      : "border-gray-300 bg-gray-50 hover:bg-gray-100/70"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center border text-gray-500">
                    <Upload className="w-6 h-6 text-gray-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-900 text-sm">
                      Upload or drop your receipt image
                    </p>
                    <p className="text-xs text-gray-500">
                      Supports PNG, JPEG, WEBP. Max size 15MB.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="bg-white">
                    Select File
                  </Button>
                </div>

                <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-800 space-y-1">
                    <p className="font-semibold">How Receipt Scanning works:</p>
                    <p className="text-blue-700/80 leading-relaxed">
                      Upload a photo of your shopping receipt. Gemini AI will automatically extract items, estimate quantities, guess categories, and track prices. Extracted items will be prepared as **unassigned location** inventory items.
                    </p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                {/* Store metadata */}
                <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5 text-gray-500" /> Store / Merchant
                    </Label>
                    <Input
                      value={parsedStore}
                      onChange={(e) => setParsedStore(e.target.value)}
                      placeholder="e.g. Costco, Walmart"
                      className="bg-white h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-gray-500" /> Date Bought
                      </span>
                    </Label>
                    <Input
                      type="date"
                      value={parsedDate}
                      onChange={(e) => {
                        setParsedDate(e.target.value);
                      }}
                      className="bg-white h-9 transition-all"
                    />
                  </div>
                </div>

                {/* Items list */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm text-gray-800 uppercase tracking-wider">
                      Extracted Items ({parsedItems.length})
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddItem}
                      className="h-7 text-xs"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add Custom
                    </Button>
                  </div>

                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                    {parsedItems.map((item, index) => (
                      <div
                        key={item.id}
                        className="p-3 bg-white border rounded-xl shadow-sm space-y-3 relative group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            Item #{index + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveItem(item.id)}
                            className="h-6 w-6 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                          <div className="sm:col-span-5 space-y-1 relative">
                            <Label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                              Item Name
                            </Label>
                            <Input
                              value={item.name}
                              onChange={(e) => handleUpdateItem(item.id, "name", e.target.value)}
                              onFocus={() => setActiveFocusItemId(item.id)}
                              onBlur={() => setTimeout(() => setActiveFocusItemId(null), 250)}
                              placeholder="Type item name..."
                              className="h-8 text-sm pr-6"
                            />
                            
                            {/* Suggestions Dropdown */}
                            {activeFocusItemId === item.id && (
                              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-[160px] overflow-y-auto divide-y divide-gray-100">
                                <div className="p-1.5 text-[9px] font-bold text-gray-400 bg-gray-50 uppercase tracking-wider sticky top-0">
                                  Link with Existing Item:
                                </div>
                                {getSuggestions(item.name).length === 0 ? (
                                  <div className="p-2 text-xs text-gray-500 italic">No exact matches. New item will be created.</div>
                                ) : (
                                  getSuggestions(item.name).map(ex => (
                                    <button
                                      key={ex.id}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleApplyMatch(item.id, ex.name, ex.category);
                                        setActiveFocusItemId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs flex items-center justify-between transition-colors"
                                    >
                                      <span className="font-semibold text-gray-700">{ex.name}</span>
                                      <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-semibold">
                                        {ex.category}
                                      </span>
                                    </button>
                                  ))
                                )}
                              </div>
                            )}

                            {/* Match/Mismatch Indicator under the input */}
                            {(() => {
                              const match = getMatchedExistingItem(item.name);
                              if (match?.type === "exact") {
                                return (
                                  <p className="text-[10px] text-green-600 font-semibold flex items-center gap-1 mt-1">
                                    <Check className="w-3 h-3 shrink-0" /> Merges with existing item
                                  </p>
                                );
                              } else if (match?.type === "partial") {
                                return (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleApplyMatch(item.id, match.item.name, match.item.category);
                                    }}
                                    className="text-[10px] text-blue-600 font-medium hover:underline flex items-center gap-1 mt-1 text-left"
                                  >
                                    💡 Match: <span className="font-bold underline">{match.item.name}</span> ({match.item.category})?
                                  </button>
                                );
                              } else if (item.name.trim()) {
                                return (
                                  <p className="text-[10px] text-gray-500 font-medium flex items-center gap-1 mt-1">
                                    ✨ New item (will create in inventory)
                                  </p>
                                );
                              }
                              return null;
                            })()}
                          </div>

                          <div className="sm:col-span-3 space-y-1">
                            <Label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                              Category
                            </Label>
                            <select
                              value={item.category}
                              onChange={(e) => handleUpdateItem(item.id, "category", e.target.value)}
                              className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2 py-1 text-sm shadow-sm ring-offset-background focus:outline-none bg-gray-50 text-xs"
                            >
                              {CATEGORIES.map(c => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-2 space-y-1">
                            <Label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                              Qty
                            </Label>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() =>
                                  handleUpdateItem(item.id, "quantity", Math.max(0.01, item.quantity - 1))
                                }
                                className="h-8 w-8 shrink-0"
                              >
                                <Minus className="w-3 h-3" />
                              </Button>
                              <Input
                                type="number"
                                step="any"
                                min="0.01"
                                value={item.quantity}
                                onChange={(e) =>
                                  handleUpdateItem(item.id, "quantity", Number(e.target.value))
                                }
                                className="h-8 text-center px-1 text-sm bg-white"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => handleUpdateItem(item.id, "quantity", item.quantity + 1)}
                                className="h-8 w-8 shrink-0"
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>

                          <div className="sm:col-span-2 space-y-1">
                            <Label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                              Price ($)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.price !== undefined ? item.price : ""}
                              onChange={(e) =>
                                handleUpdateItem(
                                  item.id,
                                  "price",
                                  e.target.value === "" ? undefined : Number(e.target.value)
                                )
                              }
                              placeholder="0.00"
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Summary footer */}
                  {totalSpent > 0 && (
                    <div className="text-right text-xs font-semibold text-blue-900 bg-blue-50/50 border border-blue-100 p-2.5 rounded-lg">
                      Estimated Total Spent: ${totalSpent.toFixed(2)}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t pt-4 flex justify-between gap-3 mt-4 shrink-0">
          {isParsed ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsParsed(false);
                  setParsedItems([]);
                  setParsedStore("");
                }}
                disabled={loading}
              >
                Scan Another
              </Button>
              <Button
                type="button"
                onClick={handleImportAll}
                disabled={loading || parsedItems.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                <Check className="w-4 h-4" />
                Add to Inventory (Unassigned)
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={loading}
                className="ml-auto"
              >
                Close
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
