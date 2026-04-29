/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from "react";
import { GroceryItem, PriceEntry } from "../types";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

interface PriceAnalysisTabProps {
  items: GroceryItem[];
}

export function PriceAnalysisTab({ items }: PriceAnalysisTabProps) {
  const [selectedItemId, setSelectedItemId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"aggregate" | "splitByStore">("aggregate");

  const itemsWithPriceHistory = useMemo(() => {
    return items.filter(i => (i.priceHistory || []).length > 0);
  }, [items]);

  const targetItems = useMemo(() => {
    if (selectedItemId === "all") return itemsWithPriceHistory;
    return itemsWithPriceHistory.filter(i => i.id === selectedItemId);
  }, [itemsWithPriceHistory, selectedItemId]);

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
            className="bg-gray-50 border rounded-md p-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="bg-gray-50 border rounded-md p-2 text-sm w-full sm:w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
    </div>
  );
}
