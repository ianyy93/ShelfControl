/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from "react";
import { GroceryItem, PriceEntry } from "../types";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { Button } from "./ui/button";
import { Trash2, Edit2, Check, X } from "lucide-react";
import { Input } from "./ui/input";

interface PriceAnalysisTabProps {
  items: GroceryItem[];
  onUpdateItem: (itemId: string, fields: Partial<GroceryItem>) => Promise<void>;
}

export function PriceAnalysisTab({ items, onUpdateItem }: PriceAnalysisTabProps) {
  const [selectedItemId, setSelectedItemId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"aggregate" | "splitByStore">("aggregate");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PriceEntry | null>(null);

  const itemsWithPriceHistory = useMemo(() => {
    return items.filter(i => (i.priceHistory || []).length > 0);
  }, [items]);

  const targetItems = useMemo(() => {
    if (selectedItemId === "all") return itemsWithPriceHistory;
    return itemsWithPriceHistory.filter(i => i.id === selectedItemId);
  }, [itemsWithPriceHistory, selectedItemId]);

  const allEntriesSorted = useMemo(() => {
    const entries: (PriceEntry & { itemId: string; itemName: string })[] = [];
    targetItems.forEach(item => {
      (item.priceHistory || []).forEach(ph => {
        entries.push({ ...ph, itemId: item.id!, itemName: item.name });
      });
    });
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [targetItems]);

  const data = useMemo(() => {
    const allEntries: (PriceEntry & { itemName?: string })[] = [];
    targetItems.forEach(item => {
      (item.priceHistory || []).forEach(ph => {
         allEntries.push({ ...ph, itemName: item.name });
      });
    });

    allEntries.sort((a, b) => a.date.localeCompare(b.date));

    // Define interface for data points
    interface DataPoint {
      date: string;
      ts: number;
      sum?: number;
      count?: number;
      Aggregate?: number;
      Aggregate_store?: string;
      Aggregate_info?: string;
      [key: string]: any; // Allow store names
    }

    const dateMap = new Map<string, DataPoint>();
    
    allEntries.forEach(entry => {
      if (!dateMap.has(entry.date)) {
        dateMap.set(entry.date, { date: entry.date, ts: new Date(entry.date).getTime() });
      }
      const dataPoint = dateMap.get(entry.date)!;
      
      const priceVal = entry.price;
      
      if (viewMode === "splitByStore") {
        dataPoint[entry.store] = priceVal;
        dataPoint[`${entry.store}_info`] = `${entry.itemName} (${entry.unitStr})`;
      } else {
        if (!dataPoint.sum) dataPoint.sum = 0;
        if (!dataPoint.count) dataPoint.count = 0;
        dataPoint.sum += priceVal;
        dataPoint.count += 1;
        dataPoint["Aggregate"] = dataPoint.sum / dataPoint.count;
        dataPoint[`Aggregate_store`] = entry.store;
        dataPoint[`Aggregate_info`] = `${entry.itemName} (${entry.unitStr})`;
      }
    });

    return Array.from(dateMap.values()).sort((a, b) => a.ts - b.ts);
  }, [targetItems, viewMode]);

  const existingStores = useMemo(() => {
    const stores = new Set<string>();
    targetItems.forEach(item => {
      (item.priceHistory || []).forEach(ph => stores.add(ph.store));
    });
    return Array.from(stores);
  }, [targetItems]);

  const colors = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#ff0000", "#00C49F", "#0088FE", "#FFBB28"];

  const CustomTooltip = ({ active, payload, label }: { active?: boolean, payload?: any[], label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-md rounded-lg text-sm">
          <p className="font-bold mb-2">{label}</p>
          {payload.map((p: any, idx: number) => {
             const infoKey = p.dataKey === "Aggregate" ? `Aggregate_info` : `${p.dataKey}_info`;
             const storeKey = p.dataKey === "Aggregate" ? `Aggregate_store` : null;
             return (
               <div key={idx} style={{ color: p.color }} className="mb-1">
                 <span className="font-semibold">{p.name === "Aggregate" && storeKey ? p.payload[storeKey] : p.name}: </span>
                 ${p.value.toFixed(2)} 
                 <span className="text-gray-500 text-xs ml-1 block">{p.payload[infoKey]}</span>
               </div>
             );
          })}
        </div>
      );
    }
    return null;
  };

  const CustomDot = (props: { cx?: number, cy?: number, payload?: any, stroke?: string }) => {
    const { cx, cy, payload } = props;
    let color = props.stroke || "black";
    
    if (viewMode === "aggregate" && payload?.Aggregate_store) {
      const storeIdx = existingStores.indexOf(payload.Aggregate_store) % colors.length;
      if (storeIdx !== -1) color = colors[storeIdx];
    }

    return (
      <circle cx={cx} cy={cy} r={4} stroke="white" strokeWidth={1} fill={color} />
    );
  };

  const handlePriceUpdate = async (itemId: string, entryId: string, updatedEntry: PriceEntry) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const newHistory = (item.priceHistory || []).map(ph => ph.id === entryId ? updatedEntry : ph);
    await onUpdateItem(itemId, { priceHistory: newHistory });
    setEditingEntryId(null);
    setEditForm(null);
  };

  const handlePriceDelete = async (itemId: string, entryId: string) => {
    if (!confirm("Are you sure you want to delete this price record?")) return;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const newHistory = (item.priceHistory || []).filter(ph => ph.id !== entryId);
    await onUpdateItem(itemId, { priceHistory: newHistory });
  };

  const selectStyles = "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 bg-gray-50";

  if (itemsWithPriceHistory.length === 0) {
    return (
      <div className="text-center py-16 bg-white border border-dashed rounded-lg">
        <p className="text-gray-500">No price history available. Track prices when checking off items from your shopping list.</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Item:</label>
          <select 
            value={selectedItemId} 
            onChange={e => setSelectedItemId(e.target.value)}
            className={selectStyles}
          >
            <option value="all">All Tracked Items</option>
            {itemsWithPriceHistory.map(i => (
              <option key={i.id} value={i.id!}>{i.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">View:</label>
          <select 
            value={viewMode} 
            onChange={e => setViewMode(e.target.value as "aggregate" | "splitByStore")}
            className={selectStyles}
          >
            <option value="aggregate">Aggregate Trend</option>
            <option value="splitByStore">Split by Store</option>
          </select>
        </div>
      </div>

      <div className="h-[400px] w-full mt-8">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="date" tick={{fontSize: 12}} tickMargin={10} axisLine={false} tickLine={false} />
            <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} />
            <Tooltip content={<CustomTooltip />} />
            {viewMode === "splitByStore" ? (
              existingStores.map((store, i) => (
                <Line 
                  key={store} 
                  type="monotone" 
                  dataKey={store} 
                  name={store}
                  stroke={colors[i % colors.length]} 
                  strokeWidth={2}
                  dot={<CustomDot />}
                  activeDot={{ r: 6 }} 
                  connectNulls
                />
              ))
            ) : (
              <Line 
                type="monotone" 
                dataKey="Aggregate" 
                name="Aggregate"
                stroke="#4B5563" 
                strokeWidth={2}
                dot={<CustomDot />}
                activeDot={{ r: 6 }} 
              />
            )}
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {viewMode === "aggregate" && (
        <div className="flex flex-wrap gap-3 justify-center text-xs text-gray-600 mt-4 border-t pt-4">
          <span className="font-semibold text-gray-800">Store Legend: </span>
          {existingStores.map((s, i) => (
             <div key={s} className="flex items-center gap-1.5">
               <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }}></div>
               {s}
             </div>
          ))}
        </div>
      )}

      <div className="border-t pt-8 space-y-4">
        <h3 className="font-bold text-gray-900 flex items-center justify-between">
          <span>Recent Price Entries</span>
          <span className="text-xs font-normal text-gray-500">{allEntriesSorted.length} entries shown</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider border-b">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 font-semibold">Store</th>
                <th className="px-4 py-3 font-semibold">Price</th>
                <th className="px-4 py-3 font-semibold">Unit</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {allEntriesSorted.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50/50 group">
                  <td className="px-4 py-3">
                    {editingEntryId === entry.id ? (
                      <Input type="date" value={editForm?.date} onChange={e => setEditForm(f => f ? {...f, date: e.target.value} : null)} className="h-8 text-xs p-1" />
                    ) : entry.date}
                  </td>
                  <td className="px-4 py-3 font-medium">{entry.itemName}</td>
                  <td className="px-4 py-3">
                    {editingEntryId === entry.id ? (
                      <Input value={editForm?.store} onChange={e => setEditForm(f => f ? {...f, store: e.target.value} : null)} className="h-8 text-xs px-2" />
                    ) : entry.store}
                  </td>
                  <td className="px-4 py-3">
                    {editingEntryId === entry.id ? (
                      <Input type="number" step="any" value={editForm?.price} onChange={e => setEditForm(f => f ? {...f, price: Number(e.target.value)} : null)} className="h-8 text-xs px-2 w-20" />
                    ) : `$${entry.price.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {editingEntryId === entry.id ? (
                      <Input value={editForm?.unitStr} onChange={e => setEditForm(f => f ? {...f, unitStr: e.target.value} : null)} className="h-8 text-xs px-2 w-20" />
                    ) : entry.unitStr}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {editingEntryId === entry.id ? (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => handlePriceUpdate(entry.itemId, entry.id, editForm!)}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400" onClick={() => { setEditingEntryId(null); setEditForm(null); }}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-500" onClick={() => { setEditingEntryId(entry.id); setEditForm(entry); }}>
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" onClick={() => handlePriceDelete(entry.itemId, entry.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
