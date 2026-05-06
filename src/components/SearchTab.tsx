/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useEffect } from "react";
import { GroceryItem, PriceEntry } from "../types";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { Button } from "./ui/button";
import { Trash2, Edit2, Check, X, Search, ChevronLeft, Box } from "lucide-react";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion";

interface SearchTabProps {
  items: GroceryItem[];
  onUpdateItem: (itemId: string, fields: Partial<GroceryItem>) => Promise<void>;
}

export function SearchTab({ items, onUpdateItem }: SearchTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"aggregate" | "splitByStore">("aggregate");
  const [timeRange, setTimeRange] = useState<"All" | "P12M" | "P3M">("All");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PriceEntry | null>(null);

  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => 
       item.name.toLowerCase().includes(q) || 
       item.category.toLowerCase().includes(q) ||
       (item.notes || "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const groupedSearchResults = useMemo(() => {
    const groups: Record<string, GroceryItem[]> = {};
    searchResults.forEach(item => {
      const cat = item.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    // Sort categories alphabetically
    return Object.keys(groups).sort().map(cat => ({
      category: cat,
      items: groups[cat].sort((a, b) => a.name.localeCompare(b.name))
    }));
  }, [searchResults]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedCategories(groupedSearchResults.map(g => g.category));
    } else {
      setExpandedCategories([]);
    }
  }, [searchQuery, groupedSearchResults]);


  const selectedItem = useMemo(() => {
    return items.find(i => i.id === selectedItemId) || null;
  }, [items, selectedItemId]);

  const allEntriesSorted = useMemo(() => {
    if (!selectedItem) return [];
    const entries: (PriceEntry & { itemId: string; itemName: string })[] = [];
    (selectedItem.priceHistory || []).forEach(ph => {
      entries.push({ ...ph, itemId: selectedItem.id!, itemName: selectedItem.name });
    });
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedItem]);

  const data = useMemo(() => {
    if (!selectedItem) return [];
    const allEntries: (PriceEntry & { itemName?: string })[] = [];
    (selectedItem.priceHistory || []).forEach(ph => {
        allEntries.push({ ...ph, itemName: selectedItem.name });
    });

    allEntries.sort((a, b) => a.date.localeCompare(b.date));

    interface DataPoint {
      date: string;
      ts: number;
      [key: string]: any;
    }

    const groupedByDate: Record<string, DataPoint> = {};

    allEntries.forEach(entry => {
      if (!groupedByDate[entry.date]) {
        groupedByDate[entry.date] = { 
          date: entry.date, 
          ts: new Date(entry.date).getTime() 
        };
      }
      const p = groupedByDate[entry.date];
      
      const pricePerUnit = entry.price / (entry.quantity || 1);
      const actualPricePerUnit = pricePerUnit;

      if (!p.Aggregate) {
         p.Aggregate = actualPricePerUnit;
         p.Aggregate_info = Object.assign({}, entry);
         p.Aggregate_store = entry.store;
         if (entry.isDiscount) {
            p.Aggregate_discount = true;
         }
      } else {
         if (actualPricePerUnit < p.Aggregate) {
            p.Aggregate = actualPricePerUnit;
            p.Aggregate_info = Object.assign({}, entry);
            p.Aggregate_store = entry.store;
            if (entry.isDiscount) {
               p.Aggregate_discount = true;
            } else {
               p.Aggregate_discount = false;
            }
         }
      }

      const storeKey = entry.store;
      if (!p[storeKey]) {
         p[storeKey] = actualPricePerUnit;
         p[`${storeKey}_info`] = Object.assign({}, entry);
         if (entry.isDiscount) {
            p[`${storeKey}_discount`] = true;
         }
      } else {
         if (actualPricePerUnit < p[storeKey]) {
             p[storeKey] = actualPricePerUnit;
             p[`${storeKey}_info`] = Object.assign({}, entry);
             if (entry.isDiscount) {
                p[`${storeKey}_discount`] = true;
             } else {
                p[`${storeKey}_discount`] = false;
             }
         }
      }
    });

    let dataPoints = Object.values(groupedByDate).sort((a, b) => a.ts - b.ts);

    if (timeRange !== "All" && dataPoints.length > 0) {
       const now = new Date();
       const cutoff = new Date();
       if (timeRange === "P12M") cutoff.setMonth(now.getMonth() - 12);
       if (timeRange === "P3M") cutoff.setMonth(now.getMonth() - 3);
       const cutoffTs = cutoff.getTime();
       dataPoints = dataPoints.filter(d => d.ts >= cutoffTs);
    }
    
    return dataPoints;
  }, [selectedItem, timeRange]);

  const maxPrice = useMemo(() => {
    if (data.length === 0) return 10;
    let max = 0;
    data.forEach(d => {
       Object.keys(d).forEach(k => {
           if (k !== 'date' && k !== 'ts' && !k.endsWith('_info') && k !== 'Aggregate_store' && !k.endsWith('_discount')) {
               if (d[k] > max) max = d[k];
           }
       });
    });
    return Math.ceil(max * 1.2 * 10) / 10 || 10;
  }, [data]);

  const yAxisTicks = useMemo(() => {
     const count = 5;
     const step = maxPrice / count;
     let stepSize = 0.1;
     if (step > 0.5) stepSize = 0.5;
     if (step > 1) stepSize = 1;
     if (step > 5) stepSize = 5;
     if (step > 10) stepSize = 10;

     const ticks = [];
     for(let i=0; i<=maxPrice; i+=stepSize) {
         ticks.push(parseFloat(i.toFixed(2)));
     }
     if (ticks[ticks.length - 1] === maxPrice) {
         ticks.push(ticks[ticks.length - 1] + stepSize);
     }
     return ticks;
  }, [maxPrice]);

  const existingStores = useMemo(() => {
    const stores = new Set<string>();
    if (selectedItem) {
      (selectedItem.priceHistory || []).forEach(ph => stores.add(ph.store));
    }
    return Array.from(stores);
  }, [selectedItem]);

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
             const info = p.payload[infoKey];
             const storeName = storeKey ? p.payload[storeKey] : p.dataKey;
             const isDiscount = p.payload[discountKey];
             
             if (!info) return null;

             return (
                 <div key={idx} className="mb-2 last:mb-0">
                    <div style={{ color: p.color }} className="font-semibold flex items-center gap-1">
                       {storeName} 
                       {isDiscount && <Badge variant="secondary" className="bg-red-100 text-red-700 text-[9px] px-1 py-0 h-4 ml-1">SALE</Badge>}
                    </div>
                    <div className="text-gray-600 space-y-0.5 mt-0.5">
                       <div>Unit Price: ${p.value != null ? Number(p.value).toFixed(2) : '-'} / {info.unitStr}</div>
                       <div className="text-xs">
                          {info.quantity} {info.unitStr} for ${Number(info.price).toFixed(2)}
                          {info.isDiscount && ` (Deal: ${info.dealQuantity} for $${Number(info.dealPrice).toFixed(2)})`}
                       </div>
                       {info.brand && <div className="text-xs text-gray-500">Brand: {info.brand}</div>}
                    </div>
                 </div>
             )
          })}
        </div>
      );
    }
    return null;
  };

  const handleUpdateEntry = async (entry: PriceEntry & { itemId: string }) => {
     if (!selectedItem) return;
     const newHistory = (selectedItem.priceHistory || []).map(ph => {
        if (ph.id === entry.id) {
           const { dealPrice: _1, dealQuantity: _2, ...restform } = editForm!;
           const updated = {
               ...restform,
               price: Number(editForm!.price),
               quantity: Number(editForm!.quantity),
               ...(editForm!.dealPrice ? { dealPrice: Number(editForm!.dealPrice) } : {}),
               ...(editForm!.dealQuantity ? { dealQuantity: Number(editForm!.dealQuantity) } : {})
           };
           return updated;
        }
        return ph;
     });
     await onUpdateItem(selectedItem.id!, { priceHistory: newHistory });
     setEditingEntryId(null);
     setEditForm(null);
  };

  const handleDeleteEntry = async (entry: PriceEntry & { itemId: string }) => {
     if (!selectedItem) return;
     const newHistory = (selectedItem.priceHistory || []).filter(ph => ph.id !== entry.id);
     await onUpdateItem(selectedItem.id!, { priceHistory: newHistory });
  };

  if (!selectedItem) {
    return (
      <div className="space-y-6">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input 
            type="text" 
            placeholder="Search items by name, category..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 text-lg shadow-sm"
            autoFocus
          />
        </div>

        {searchQuery.trim() && searchResults.length === 0 && (
           <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
              No items found matching "{searchQuery}"
           </div>
        )}

        {groupedSearchResults.length > 0 && (
           <Accordion type="multiple" value={expandedCategories} onValueChange={setExpandedCategories} className="space-y-4 w-full">
             {groupedSearchResults.map(group => (
               <AccordionItem key={group.category} value={group.category} className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden data-[state=open]:pb-4">
                 <AccordionTrigger className="hover:no-underline px-4 py-4 font-semibold text-lg text-gray-800 transition-colors hover:bg-gray-50/50">
                    <div className="flex items-center gap-2">
                       {group.category} <Badge variant="secondary" className="ml-2 bg-gray-100 text-gray-600 border-none font-medium">{group.items.length}</Badge>
                    </div>
                 </AccordionTrigger>
                 <AccordionContent className="px-4 pt-2">
                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                     {group.items.map(item => (
                        <div 
                           key={item.id} 
                           onClick={() => setSelectedItemId(item.id!)}
                           className="bg-white p-4 rounded-xl shadow-sm ring-1 ring-gray-900/5 cursor-pointer hover:shadow-md transition-shadow flex flex-col gap-2"
                        >
                           <div className="font-semibold text-lg text-gray-900 truncate">{item.name}</div>
                           <div className="flex gap-2">
                             <div className="text-xs text-gray-400 bg-gray-50 self-start px-2 py-0.5 rounded-md">{item.category}</div>
                           </div>
                           <div className="text-sm font-medium mt-1 flex gap-4 text-gray-600">
                             <div className="flex items-center gap-1.5 border border-gray-100 bg-gray-50 px-2 py-1 rounded"><Box className="w-3.5 h-3.5 text-gray-400"/> Inventory: <span className="text-gray-900">{item.inventoryQuantity}</span></div>
                           </div>
                        </div>
                     ))}
                   </div>
                 </AccordionContent>
               </AccordionItem>
             ))}
           </Accordion>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" onClick={() => setSelectedItemId(null)} className="-ml-2 text-gray-500 hover:text-gray-900">
           <ChevronLeft className="w-4 h-4 mr-1" /> Back to Search
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-6">
        <div className="border-b border-gray-100 pb-4 mb-4">
           <h2 className="text-2xl font-bold text-gray-900">{selectedItem.name}</h2>
           <div className="text-gray-500 text-sm mt-1">{selectedItem.category}</div>
        </div>

        <div>
           <h3 className="font-semibold text-lg text-gray-900 flex items-center gap-2 mb-3">
             <Box className="w-5 h-5 text-gray-400" />
             Inventory Locations
           </h3>
           {(selectedItem.inventoryEntries || []).length === 0 ? (
              <div className="text-sm text-gray-500">None in inventory.</div>
           ) : (
              <div className="space-y-2">
                 {(selectedItem.inventoryEntries || []).map(entry => (
                    <div key={entry.id} className="flex justify-between items-center bg-gray-50 p-2.5 rounded-lg text-sm border border-gray-100">
                       <div className="font-medium text-gray-700">
                          {entry.location || 'Unassigned'}
                           {entry.label && <span className="text-gray-500 font-normal ml-2">({entry.label})</span>}
                       </div>
                       <div className="flex items-center gap-3 text-gray-600">
                          {entry.isOpened && <Badge variant="outline" className="text-[10px] h-5 bg-orange-50 text-orange-600 border-none">OPENED</Badge>}
                          <div className="font-bold">
                             {entry.isOpened && entry.unit === 'pcs' ? (entry.amount || 0) : entry.quantity} {entry.unit || selectedItem.unit || ''}
                          </div>
                          {entry.expiryDate && (
                             <div className={`text-xs ${new Date(entry.expiryDate) < new Date() ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                               Exp: {entry.expiryDate}
                             </div>
                          )}
                       </div>
                    </div>
                 ))}
              </div>
           )}
        </div>

        <div className="pt-6 border-t border-gray-100">
           <h3 className="font-semibold text-lg text-gray-900 flex items-center gap-2 mb-3">
             <LineChart className="w-5 h-5 text-gray-400" />
             Price History
           </h3>
           
           {(selectedItem.priceHistory || []).length === 0 ? (
              <div className="text-sm text-gray-500">No price history available.</div>
           ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div className="flex bg-gray-100 rounded-lg p-1">
                    {(["All", "P12M", "P3M"] as const).map(tr => (
                      <button
                        key={tr}
                        onClick={() => setTimeRange(tr)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${timeRange === tr ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        {tr === "All" ? "All Time" : tr === "P12M" ? "Past 12M" : "Past 3M"}
                      </button>
                    ))}
                  </div>
                  <div className="flex bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setViewMode("aggregate")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "aggregate" ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Lowest Price
                    </button>
                    <button
                      onClick={() => setViewMode("splitByStore")}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "splitByStore" ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      By Store
                    </button>
                  </div>
                </div>

                <div className="h-[300px] w-full mt-4 bg-white">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(val) => {
                           const d = new Date(val);
                           return `${d.getMonth()+1}/${d.getDate().toString().padStart(2, '0')}`;
                        }}
                        tick={{ fill: '#6B7280', fontSize: 12 }}
                        tickMargin={10}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        tickFormatter={(val) => `$${val}`} 
                        tick={{ fill: '#6B7280', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        ticks={yAxisTicks}
                        domain={[0, maxPrice]}
                      />
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
                               dot={{ r: 4, strokeWidth: 2 }}
                               activeDot={{ r: 6 }}
                               connectNulls
                           />
                         ))
                      ) : (
                         <Line 
                             type="monotone" 
                             dataKey="Aggregate" 
                             name="Lowest Price" 
                             stroke="#2563EB" 
                             strokeWidth={3}
                             dot={{ r: 4, strokeWidth: 2, fill: "#2563EB" }}
                             activeDot={{ r: 6 }}
                         />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-8">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 uppercase tracking-wider">Entry Log</h4>
                  <div className="space-y-2">
                    {allEntriesSorted.map((entry) => (
                      <div key={entry.id} className="bg-white border rounded-lg p-3 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:border-blue-200 transition-colors">
                        {editingEntryId === entry.id ? (
                            <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2">
                              <Input type="date" value={editForm?.date || ''} onChange={e => setEditForm({...editForm!, date: e.target.value})} className="h-8 max-w-[140px]" />
                              <Input placeholder="Store" value={editForm?.store || ''} onChange={e => setEditForm({...editForm!, store: e.target.value})} className="h-8 max-w-[140px]" list="stores-list" />
                              <Input type="number" step="0.01" placeholder="Price $" value={editForm?.price || ''} onChange={e => setEditForm({...editForm!, price: parseFloat(e.target.value)})} className="h-8 max-w-[90px]" />
                              <Input type="number" step="0.01" placeholder="Deal $ (opt)" value={editForm?.dealPrice || ''} onChange={e => setEditForm({...editForm!, dealPrice: parseFloat(e.target.value), isDiscount: true })} className="h-8 max-w-[90px]" />
                              <div className="flex items-center gap-1">
                                <Input type="number" placeholder="Qty" value={editForm?.quantity || ''} onChange={e => setEditForm({...editForm!, quantity: parseFloat(e.target.value)})} className="h-8 w-16" />
                                <span className="text-gray-500">{entry.unitStr}</span>
                              </div>
                              <div className="flex items-center gap-1 mt-2 sm:mt-0 ml-auto">
                                <Button size="sm" variant="outline" className="h-8 bg-green-50 text-green-700 hover:bg-green-100 border-none" onClick={() => handleUpdateEntry(entry)}><Check className="w-4 h-4" /></Button>
                                <Button size="sm" variant="ghost" className="h-8 text-gray-500" onClick={() => { setEditingEntryId(null); setEditForm(null); }}><X className="w-4 h-4" /></Button>
                              </div>
                           </div>
                        ) : (
                           <>
                             <div className="flex gap-4 sm:gap-6 flex-1 flex-wrap sm:flex-nowrap">
                                <div className="w-[85px] shrink-0 text-gray-500 tabular-nums">
                                  {new Date(entry.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}
                                </div>
                                <div className="font-semibold text-gray-800 w-[120px] shrink-0 truncate" title={entry.store}>{entry.store}</div>
                                <div className="flex items-center gap-2">
                                  <span className={`tabular-nums font-bold ${entry.isDiscount ? 'text-gray-400 line-through text-xs' : 'text-gray-900'}`}>${Number(entry.price || 0).toFixed(2)}</span>
                                  {entry.isDiscount && (
                                     <span className="text-red-600 font-bold tabular-nums flex items-center gap-1">
                                        ${Number(entry.dealPrice || 0).toFixed(2)} 
                                        <Badge variant="secondary" className="bg-red-100 text-red-700 h-4 px-1 text-[9px] border-none py-0">SALE</Badge>
                                     </span>
                                  )}
                                  <span className="text-gray-400 text-xs ml-1">for {entry.isDiscount ? (entry.dealQuantity || entry.quantity) : entry.quantity} {entry.unitStr}</span>
                                </div>
                                {entry.brand && <div className="text-xs text-gray-500 hidden md:block w-32 truncate">Brand: {entry.brand}</div>}
                             </div>
                             <div className="flex items-center gap-1 sm:opacity-0 transition-opacity group-hover:opacity-100 border-t sm:border-t-0 pt-2 sm:pt-0 mt-2 sm:mt-0 w-full sm:w-auto">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-600" onClick={() => { setEditingEntryId(entry.id); setEditForm(entry); }}>
                                   <Edit2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteEntry(entry)}>
                                   <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                             </div>
                           </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
           )}
        </div>
      </div>
    </div>
  );
}
