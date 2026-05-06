import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { GroceryItem, PriceEntry } from "../types";

export const STORES = [
  "Costco",
  "T&T",
  "No Frills",
  "RCS",
  "Walmart",
  "Loblaws",
  "Metro",
  "Sobeys",
  "Kroger",
  "Whole Foods",
  "Trader Joe's",
  "Target"
];

export const PRESET_UNITS = ["count", "g", "kg", "mL", "L", "lb"];

interface CheckOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: GroceryItem | undefined;
  onConfirm: (item: GroceryItem, priceEntry: Omit<PriceEntry, 'id'> | null) => Promise<void>;
}

export function CheckOffDialog({ open, onOpenChange, item, onConfirm }: CheckOffDialogProps) {
  const [loading, setLoading] = useState(false);
  const [trackPrice, setTrackPrice] = useState(true);
  
  const [price, setPrice] = useState("");
  const [store, setStore] = useState("");
  const [date, setDate] = useState("");
  const [priceUnit, setPriceUnit] = useState("");
  const [isDiscount, setIsDiscount] = useState(false);
  const [dealPrice, setDealPrice] = useState("");
  const [dealQuantity, setDealQuantity] = useState("");

  useEffect(() => {
    if (open && item) {
      setTrackPrice(true);
      setPrice("");
      setPriceUnit(item.unit || "");
      setStore(item.shoppingStore || "");
      setIsDiscount(false);
      setDealPrice("");
      setDealQuantity("");
      
      const tzOffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
      const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
      setDate(localISOTime);
    }
  }, [open, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    setLoading(true);
    let priceEntry: Omit<PriceEntry, 'id'> | null = null;
    
    if (trackPrice) {
      let finalPrice = Number(price);
      const finalUnit = priceUnit || item.unit || "unit";
      let finalQuantity = 1;
      
      if (isDiscount) {
          finalPrice = Number(dealPrice);
          finalQuantity = Number(dealQuantity);
      }

      priceEntry = {
        date,
        price: finalPrice,
        quantity: finalQuantity,
        unitStr: finalUnit,
        store: store || "Unknown",
        isDiscount: !!isDiscount
      };
      if (isDiscount) {
        priceEntry.dealPrice = Number(dealPrice);
        priceEntry.dealQuantity = Number(dealQuantity);
      }
    }

    try {
      await onConfirm(item, priceEntry);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Got {item.name}</DialogTitle>
          <DialogDescription>
            Marking {item.shoppingQuantity} {item.unit || 'count'} as purchased.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <input 
              type="checkbox" 
              id="trackPrice" 
              checked={trackPrice} 
              onChange={e => setTrackPrice(e.target.checked)} 
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <Label htmlFor="trackPrice">Track price for this purchase</Label>
          </div>

          {trackPrice && (
            <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50/50 rounded-xl border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs text-gray-600">Store / Merchant</Label>
                <Input 
                  value={store} 
                  onChange={e => setStore(e.target.value)} 
                  placeholder="e.g. Costco, Walmart" 
                  className="h-8 text-sm bg-white" 
                  required={trackPrice}
                  list="stores-list"
                />
              </div>

              <div className="space-y-1.5 col-span-2 mt-1">
                <Label className="text-xs text-gray-600">Date</Label>
                <Input 
                  type="date" 
                  value={date} 
                  onChange={e => setDate(e.target.value)} 
                  className="h-8 text-sm bg-white" 
                  required={trackPrice}
                />
              </div>

              <div className="flex items-center space-x-2 col-span-2 mt-2">
                <input
                  type="checkbox"
                  id="isDiscount"
                  checked={isDiscount}
                  onChange={(e) => setIsDiscount(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Label htmlFor="isDiscount" className="text-xs text-gray-600 cursor-pointer">
                  This is a bulk discount / deal (e.g., buy 2 for $5)
                </Label>
              </div>

              {!isDiscount ? (
                <div className="grid grid-cols-2 gap-3 col-span-2 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Price ($)</Label>
                    <Input 
                      type="number" step="0.01" min="0" 
                      value={price} 
                      onChange={e => setPrice(e.target.value)} 
                      placeholder="2.99" 
                      className="h-8 text-sm bg-white" 
                      required={trackPrice && !isDiscount}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Unit for price</Label>
                    <Input 
                      type="text" 
                      value={priceUnit} 
                      onChange={e => setPriceUnit(e.target.value)} 
                      placeholder={item.unit || "pcs"} 
                      className="h-8 text-sm bg-white" 
                    />
                  </div>
                </div>
              ) : (
                <div className="col-span-2 space-y-3">
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600">Deal Price ($)</Label>
                      <Input 
                        type="number" step="0.01" min="0" 
                        value={dealPrice} 
                        onChange={e => setDealPrice(e.target.value)} 
                        placeholder="e.g. 5.00" 
                        className="h-8 text-sm bg-white" 
                        required={trackPrice && isDiscount}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-600">Deal Quantity</Label>
                      <Input 
                        type="number" step="any" min="0" 
                        value={dealQuantity} 
                        onChange={e => setDealQuantity(e.target.value)} 
                        placeholder="e.g. 2" 
                        className="h-8 text-sm bg-white" 
                        required={trackPrice && isDiscount}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Unit for quantity</Label>
                    <Input 
                      type="text" 
                      value={priceUnit} 
                      onChange={e => setPriceUnit(e.target.value)} 
                      placeholder={item.unit || "pcs"} 
                      className="h-8 text-sm bg-white" 
                    />
                  </div>
                  {dealPrice && dealQuantity && Number(dealQuantity) > 0 && (
                    <div className="text-xs font-medium text-blue-800 bg-blue-100/50 p-2 rounded border border-blue-200">
                      Calculated Unit Price: ${ (Number(dealPrice) / Number(dealQuantity)).toFixed(2) } / {priceUnit || item.unit || "unit"}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
              {loading ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
