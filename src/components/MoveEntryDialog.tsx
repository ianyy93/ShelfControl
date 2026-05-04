import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { GroceryItem, InventoryEntry } from "../types";

interface MoveEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  item: GroceryItem | null;
  entryId: string | null;
  newLocation: string | null;
  onConfirm: (quantityToMove: number) => void;
}

export function MoveEntryDialog({ isOpen, onOpenChange, item, entryId, newLocation, onConfirm }: MoveEntryDialogProps) {
  const [quantity, setQuantity] = useState<string>("1");
  
  const entry = item?.inventoryEntries?.find(e => e.id === entryId);
  const max = entry ? entry.quantity : 1;

  useEffect(() => {
    if (isOpen) {
      setQuantity(max.toString());
    }
  }, [isOpen, max]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(quantity);
    if (!isNaN(parsed) && parsed > 0 && parsed <= max) {
        onConfirm(parsed);
        onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
                <DialogTitle>Move Items</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                <p className="text-sm text-gray-500">
                    How many items do you want to move to <span className="font-semibold text-gray-800">{newLocation}</span>?
                </p>
                <div className="space-y-2">
                    <Label>Quantity to Move (Max: {max})</Label>
                    <Input 
                        type="number" 
                        step="any"
                        min="0.01"
                        max={max}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        required
                    />
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="submit">Move</Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
  );
}
