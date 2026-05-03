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
  selectedItemId: string | null;
  onSelectItemId: (id: string | null) => void;
}

export function PriceAnalysisTab({ items, onUpdateItem, selectedItemId, onSelectItemId }: PriceAnalysisTabProps) {
  const [viewMode, setViewMode] = useState<"aggregate" | "splitByStore">("aggregate");
  const [timeRange, setTimeRange] = useState<"All" | "P12M" | "P3M">("All");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PriceEntry | null>(null);

  const itemsWithPriceHistory = useMemo(() => {
    return items.filter(i => (i.priceHistory || []).length > 0);
  }, [items]);

  const resolvedSelectedItemId = useMemo(() => {
    if (selectedItemId && itemsWithPriceHistory.some(i => i.id === selectedItemId)) {
      return selectedItemId;
    }
    return itemsWithPriceHistory.length > 0 ? itemsWithPriceHistory[0].id : null;
  }, [selectedItemId, itemsWithPriceHistory]);

  const targetItems = useMemo(() => {
    if (!resolvedSelectedItemId) return [];
    return itemsWithPriceHistory.filter(i => i.id === resolvedSelectedItemId);
  }, [itemsWithPriceHistory, resolvedSelectedItemId]);

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

    interface DataPoint {
      date: string;
      ts: number;
      sum?: number;
      count?: number;
      Aggregate?: number;
      Aggregate_store?: string;
      Aggregate_info?: string;
      [key: string]: any;
    }

    const dateMap = new Map<string, DataPoint>();
    
    allEntries.forEach(entry => {
      if (!dateMap.has(entry.date)) {
        dateMap.set(entry.date, { date: entry.date, ts: new Date(entry.date).getTime() });
      }
      const dataPoint = dateMap.get(entry.date)!;
      
      const priceVal = entry.price / (entry.quantity || 1);
      
      if (viewMode === "splitByStore") {
        dataPoint[entry.store] = priceVal;
        dataPoint[`${entry.store}_info`] = `${entry.itemName} (${entry.unitStr})`;
        dataPoint[`${entry.store}_discount`] = entry.isDiscount;
      } else {
        if (!dataPoint.sum) dataPoint.sum = 0;
        if (!dataPoint.count) dataPoint.count = 0;
        dataPoint.sum += priceVal;
        dataPoint.count += 1;
        dataPoint["Aggregate"] = dataPoint.sum / dataPoint.count;
        dataPoint[`Aggregate_store`] = entry.store;
        dataPoint[`Aggregate_info`] = `${entry.itemName} (${entry.unitStr})`;
        dataPoint[`Aggregate_discount`] = entry.isDiscount;
      }
    });

    return Array.from(dateMap.values()).sort((a, b) => a.ts - b.ts);
  }, [targetItems, viewMode]);

  const filteredData = useMemo(() => {
    if (timeRange === "All") return data;
    const cutoff = new Date();
    if (timeRange === "P12M") {
      cutoff.setMonth(cutoff.getMonth() - 12);
    } else if (timeRange === "P3M") {
      cutoff.setMonth(cutoff.getMonth() - 3);
    }
    const cutoffTs = cutoff.getTime();
    return data.filter(d => d.ts >= cutoffTs);
  }, [data, timeRange]);

  const maxPrice = useMemo(() => {
    let max = 0;
    filteredData.forEach(d => {
      Object.keys(d).forEach(k => {
        if (typeof d[k] === 'number' && k !== 'ts' && k !== 'sum' && k !== 'count' && d[k] > max) {
          max = d[k];
        }
      });
    });
    return max > 0 ? max : 10;
  }, [filteredData]);

  const yTicks = useMemo(() => {
     const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
     let stepSize = steps[steps.length - 1];
     for (let i = 0; i < steps.length; i++) {
        if (maxPrice / steps[i] <= 6) {
            stepSize = steps[i];
            break;
        }
     }
     if (maxPrice / stepSize > 6 && maxPrice > 1000) {
        stepSize = Math.ceil(maxPrice / 6 / 100) * 100;
     }
     
     const ticks = [];
     const maxTick = Math.ceil((maxPrice * 1.1) / stepSize) * stepSize;
     const actualMaxTick = maxTick < maxPrice ? maxTick + stepSize : maxTick;
     for (let i = 0; i <= actualMaxTick; i += stepSize) {
         ticks.push(i);
     }
     if (ticks[ticks.length - 1] === maxPrice) {
         ticks.push(ticks[ticks.length - 1] + stepSize);
     }
     return ticks;
  }, [maxPrice]);

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
             const discountKey = p.dataKey === "Aggregate" ? `Aggregate_discount` : `${p.dataKey}_discount`;
             const isDiscount = p.payload[discountKey];
             return (
               <div key={idx} style={{ color: p.color }} className="mb-1">
                 <span className="font-semibold">{p.name === "Aggregate" && storeKey ? p.payload[storeKey] : p.name}: </span>
                 ${p.value.toFixed(2)} {isDiscount && <span className="text-[10px] bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded ml-1 font-bold">DEAL</span>}
                 <span className="text-gray-500 text-xs ml-1 block">{p.payload[infoKey]}</span>
               </div>
             );
          })}
        </div>
      );
    }
    return null;
  };

  const CustomDot = (props: { cx?: number, cy?: number, payload?: any, stroke?: string, dataKey?: string }) => {
    const { cx, cy, payload, dataKey } = props;
    let color = props.stroke || "black";
    
    if (viewMode === "aggregate" && payload?.Aggregate_store) {
      const storeIdx = existingStores.indexOf(payload.Aggregate_store) % colors.length;
      if (storeIdx !== -1) color = colors[storeIdx];
    }

    let isDiscount = false;
    if (viewMode === "aggregate") {
       isDiscount = payload?.Aggregate_discount === true;
    } else if (dataKey) {
       isDiscount = payload?.[`${dataKey}_discount`] === true;
    }

    if (isDiscount) {
      // Draw a star shape to denote a discount
      return (
        <path 
           d={`M ${cx} ${(cy || 0) - 7.5} L ${(cx || 0) + 2.25} ${(cy || 0) - 2.25} L ${(cx || 0) + 7.5} ${(cy || 0) - 2.25} L ${(cx || 0) + 3} ${(cy || 0) + 1.5} L ${(cx || 0) + 4.5} ${(cy || 0) + 7.5} L ${cx} ${(cy || 0) + 3.75} L ${(cx || 0) - 4.5} ${(cy || 0) + 7.5} L ${(cx || 0) - 3} ${(cy || 0) + 1.5} L ${(cx || 0) - 7.5} ${(cy || 0) - 2.25} L ${(cx || 0) - 2.25} ${(cy || 0) - 2.25} Z`}
           fill={color} 
           stroke="white" 
           strokeWidth={1.5} 
        />
      );
    }

    return (
      <circle cx={cx} cy={cy} r={6} stroke="white" strokeWidth={1.5} fill={color} />
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
    <div className="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Item:</label>
            <select 
              value={resolvedSelectedItemId || ""} 
              onChange={e => onSelectItemId(e.target.value)}
              className={selectStyles}
            >
              {itemsWithPriceHistory.map(i => (
                <option key={i.id} value={i.id!}>{i.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Period:</label>
            <select 
              value={timeRange} 
              onChange={e => setTimeRange(e.target.value as any)}
              className={selectStyles}
            >
              <option value="All">All Time</option>
              <option value="P12M">Last 12 Months</option>
              <option value="P3M">Last 3 Months</option>
            </select>
          </div>
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

      <div className="h-[200px] sm:h-[400px] w-full mt-6 sm:mt-8">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filteredData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="date" tick={{fontSize: 12}} tickMargin={10} axisLine={false} tickLine={false} />
            <YAxis ticks={yTicks} domain={[0, yTicks[yTicks.length - 1]]} tick={{fontSize: 12}} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} />
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

      <div className="flex justify-center flex-wrap gap-6 text-xs text-gray-600 mt-2 mb-4">
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 14 14" className="overflow-visible">
            <circle cx="7" cy="7" r="5" stroke="#9CA3AF" strokeWidth="1.5" fill="none" />
          </svg>
          <span>Regular Price</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 14 14" className="overflow-visible">
            <path 
               d={`M 7 0.5 L 8.7 5.5 L 14 5.5 L 9.7 8.5 L 11.3 13.5 L 7 10.5 L 2.7 13.5 L 4.3 8.5 L 0 5.5 L 5.3 5.5 Z`}
               fill="none" 
               stroke="#9CA3AF" 
               strokeWidth="1.5" 
               strokeLinejoin="round"
            />
          </svg>
          <span>Discount Price</span>
        </div>
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
                <th className="px-4 py-3 font-semibold w-28 sm:w-36">Date</th>
                <th className="px-4 py-3 font-semibold">Store</th>
                <th className="px-4 py-3 font-semibold">Price</th>
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
                  <td className="px-4 py-3">
                    {editingEntryId === entry.id ? (
                      <Input value={editForm?.store} onChange={e => setEditForm(f => f ? {...f, store: e.target.value} : null)} className="h-8 text-xs px-2" />
                    ) : entry.store}
                  </td>
                  <td className="px-4 py-3">
                    {editingEntryId === entry.id ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <div className="flex flex-col">
                            <Label className="text-[9px] text-gray-400">Total $</Label>
                            <Input type="number" step="any" value={editForm?.price} onChange={e => setEditForm(f => f ? {...f, price: Number(e.target.value)} : null)} className="h-8 text-xs px-2 w-16" />
                          </div>
                          <div className="flex flex-col">
                            <Label className="text-[9px] text-gray-400">Qty</Label>
                            <Input type="number" step="any" value={editForm?.quantity} onChange={e => setEditForm(f => f ? {...f, quantity: Number(e.target.value)} : null)} className="h-8 text-xs px-2 w-12" />
                          </div>
                        </div>
                        <Input value={editForm?.unitStr} onChange={e => setEditForm(f => f ? {...f, unitStr: e.target.value} : null)} placeholder="Unit" className="h-7 text-[10px] px-2 w-full" />
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-1">
                          <span className="font-medium">${entry.price.toFixed(2)}</span>
                          <span className="text-[10px] text-gray-400">for {entry.quantity || 1}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 italic">
                          ${(entry.price / (entry.quantity || 1)).toFixed(2)} / {entry.unitStr}
                        </span>
                      </div>
                    )}
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
