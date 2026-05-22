import { motion, AnimatePresence } from "motion/react";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { auth, db, signIn, signOut, handleFirestoreError } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, onSnapshot, query, addDoc, serverTimestamp, doc, deleteDoc, updateDoc, where, getDoc, arrayUnion } from "firebase/firestore";
import { GroceryItem, GroceryList, CATEGORIES, InventoryEntry, PRESET_LOCATIONS, PriceEntry } from "./types";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Plus, LogOut, Trash2, Edit, ShoppingCart, Check, Minus, Users, Link as LinkIcon, LineChart, Box, ChevronRight, ChevronDown, EyeOff, X, Search } from "lucide-react";
import { GroceriesIcon } from "./components/GroceriesIcon";
import { MoveEntryDialog } from "./components/MoveEntryDialog";
import { removeUndefined } from "./lib/utils";
import { ItemDialog } from "./components/ItemDialog";
import { CheckOffDialog } from "./components/CheckOffDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Badge } from "./components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./components/ui/accordion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [items, setItems] = useState<GroceryItem[]>([]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | undefined>();
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const [checkingOffItem, setCheckingOffItem] = useState<GroceryItem | undefined>();

  const [activeTab, setActiveTab] = useState<'shopping' | 'inventory' | 'search'>('shopping');
  const [searchQuery, setSearchQuery] = useState("");

  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string, override?: boolean) => {
    setExpandedItems(prev => ({ ...prev, [id]: override !== undefined ? override : !prev[id] }));
  };

  // View Options for All Tabs
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [groupBy, setGroupBy] = useState<'category' | 'location' | 'store'>('store');
  const [sortBy, setSortBy] = useState<'name' | 'quantity' | 'expiryDate' | 'dateBought' | 'dateAdded'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterCat, setFilterCat] = useState<string>('All');
  const [filterLoc, setFilterLoc] = useState<string>('All');
  const [filterTag, setFilterTag] = useState<string>('All');
  const [filterExpiry, setFilterExpiry] = useState<string>('All');

  useEffect(() => {
     if (activeTab === 'inventory' && groupBy === 'store') setGroupBy('location');
     if (activeTab === 'shopping' && groupBy === 'location') setGroupBy('store');
  }, [activeTab]);

  const locations = useMemo(() => Array.from(new Set([...PRESET_LOCATIONS, ...items.flatMap(i => i.locations || [i.location]).filter(Boolean) as string[]])), [items]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap(i => i.inventoryEntries?.flatMap(e => e.tags || []) || []))), [items]);
  const stores = useMemo(() => {
     const st = new Set<string>();
     items.forEach(i => {
         if (i.shoppingStore) st.add(i.shoppingStore);
         i.priceHistory?.forEach(p => {
             if (p.store) st.add(p.store);
         });
     });
     return Array.from(st).sort();
  }, [items]);

  useEffect(() => {
    console.log("onAuthStateChanged listener attached");
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth state changed:", currentUser ? `Logged in as ${currentUser.uid}` : "Logged out");
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // Check for ?join= parameter
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('join');
    
    if (joinId) {
      const joinList = async () => {
        try {
          const listRef = doc(db, 'lists', joinId);
          const listDoc = await getDoc(listRef);
          if (listDoc.exists()) {
            const data = listDoc.data();
            if (!data.members.includes(user.uid)) {
              await updateDoc(listRef, {
                members: arrayUnion(user.uid),
                updatedAt: serverTimestamp()
              });
            }
            setActiveListId(joinId);
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            console.warn('Shared list not found!');
          }
        } catch (e) {
          console.error("Error joining list:", e);
        }
      };
      joinList();
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLists([]);
      setActiveListId(null);
      return;
    }

    const q = query(collection(db, "lists"), where("members", "array-contains", user.uid));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      // Avoid a race condition where querying children of a purely local Document fails backend rules.
      if (snapshot.metadata.hasPendingWrites) return;
      
      const dbLists: GroceryList[] = [];
      snapshot.forEach((doc) => {
        dbLists.push({ id: doc.id, ...doc.data() } as GroceryList);
      });
      setLists(dbLists);
      
      if (dbLists.length === 0) {
        // Only create an initial list if there's no ?join= parameter in the URL
        const params = new URLSearchParams(window.location.search);
        if (!params.get('join')) {
          addDoc(collection(db, "lists"), {
            name: "My Household",
            ownerId: user.uid,
            members: [user.uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }).catch(e => console.error("Error creating initial list", e));
        }
      } else if (!activeListId || !dbLists.find(l => l.id === activeListId)) {
        // If we have a join parameter, let the join effect handle setActiveListId
        const params = new URLSearchParams(window.location.search);
        if (!params.get('join')) {
          setActiveListId(dbLists[0].id!);
        }
      }
    }, (error) => {
      console.error("Error fetching lists:", error);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !activeListId) {
      setItems([]);
      return;
    }

    const q = query(collection(db, "lists", activeListId, "items"));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      // Ignore initial optimistic response if the parent document might still be inflight
      if (snapshot.metadata.hasPendingWrites) return;
      
      const dbItems: GroceryItem[] = [];
      snapshot.forEach((doc) => {
        dbItems.push({ id: doc.id, ...doc.data() } as GroceryItem);
      });
      dbItems.sort((a, b) => a.name.localeCompare(b.name));
      setItems(dbItems);
    }, (error) => {
      console.error("Error fetching items:", error);
    });

    return () => unsubscribe();
  }, [user, activeListId]);

  const handleSaveItem = async (data: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'>, processQuantity?: number }) => {
    if (!user || !activeListId) return;
    console.log("Saving Item with data:", data);
    const { newPriceEntry, processQuantity, ...updatedFields } = data;
    
    try {
      if (editingItem?.id) {
        const updateData: Partial<GroceryItem> = {
          ...updatedFields,
          updatedAt: serverTimestamp()
        };
        
        if (updatedFields.shoppingQuantity && updatedFields.shoppingQuantity > 0) {
          updateData.isHiddenSuggestion = false;
        }
        
        if (processQuantity !== undefined && processQuantity > 0) {
          updateData.unprocessedQuantity = Math.max(0, (editingItem.unprocessedQuantity || 0) - processQuantity);
        }

        if (newPriceEntry) {
          updateData.priceHistory = arrayUnion({
            ...newPriceEntry,
            id: Math.random().toString(36).substr(2, 9)
          }) as unknown as PriceEntry[];
        }
        await updateDoc(doc(db, "lists", activeListId, "items", editingItem.id), removeUndefined(updateData));
      } else {
        const existingMatch = items.find(i => i.name.toLowerCase().trim() === updatedFields.name?.toLowerCase().trim());
        if (existingMatch && existingMatch.id) {
           const newEntries = [...(existingMatch.inventoryEntries || []), ...(updatedFields.inventoryEntries || [])];
           const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));
           
           const updateData: Partial<GroceryItem> = {
               category: updatedFields.category,
               shoppingQuantity: (existingMatch.shoppingQuantity || 0) + (updatedFields.shoppingQuantity || 0),
               inventoryQuantity: (existingMatch.inventoryQuantity || 0) + (updatedFields.inventoryQuantity || 0),
               inventoryEntries: newEntries,
               locations: newLocs,
               notes: [existingMatch.notes, updatedFields.notes].filter(Boolean).join("\n"),
               unit: updatedFields.unit || existingMatch.unit,
               isHiddenSuggestion: false,
               updatedAt: serverTimestamp()
           };

           if (newPriceEntry) {
             updateData.priceHistory = arrayUnion({
               ...newPriceEntry,
               id: Math.random().toString(36).substr(2, 9)
             }) as unknown as PriceEntry[];
           }

           await updateDoc(doc(db, "lists", activeListId, "items", existingMatch.id), removeUndefined(updateData));
        } else {
           const newItem: Partial<GroceryItem> = {
             ...updatedFields,
             listId: activeListId,
             creatorId: user.uid,
             createdAt: serverTimestamp(),
             updatedAt: serverTimestamp()
           };

           if (newPriceEntry) {
             newItem.priceHistory = [{
               ...newPriceEntry,
               id: Math.random().toString(36).substr(2, 9)
             }];
           }

           await addDoc(collection(db, "lists", activeListId, "items"), removeUndefined(newItem) as GroceryItem);
        }
      }
      setIsDialogOpen(false);
      setEditingItem(undefined);
    } catch (error) {
      console.error("Error saving item:", error);
      handleFirestoreError(error, editingItem?.id ? 'update' : 'create', `lists/${activeListId}/items`);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!user || !activeListId) return;
    try {
      await deleteDoc(doc(db, "lists", activeListId, "items", itemId));
    } catch (error) {
      console.error("Error deleting item:", error);
      handleFirestoreError(error, 'delete', `lists/${activeListId}/items/${itemId}`);
    }
  };

  const updateQuantities = async (item: GroceryItem, invDelta: number, shopDelta: number, locationTrigger?: string) => {
    if (!user || !activeListId || !item.id) return;
    const newInv = Math.max(0, item.inventoryQuantity + invDelta);
    const newShop = Math.max(0, item.shoppingQuantity + shopDelta);
    
    let newEntries = [...(item.inventoryEntries || [])];

    if (invDelta > 0) {
      let defaultLoc = locationTrigger || item.location || item.locations?.[0] || 'Unassigned';
      if (defaultLoc === 'Unassigned') defaultLoc = '';
      const entry = newEntries.find(e => !e.label && !e.expiryDate && (e.location || '') === defaultLoc);
      const today = new Date().toISOString().split('T')[0];
      if (entry) {
        entry.quantity += invDelta;
        entry.dateBought = today;
        entry.dateAdded = entry.dateAdded || today;
      } else {
        newEntries.push({
          id: Math.random().toString(36).substr(2, 9),
          location: defaultLoc,
          quantity: invDelta,
          dateBought: today,
          dateAdded: today
        });
      }
    } else if (invDelta < 0) {
      let remaining = Math.abs(invDelta);
      
      if (locationTrigger) {
         const trigLoc = locationTrigger === 'Unassigned' ? '' : locationTrigger;
         for (let i = 0; i < newEntries.length; i++) {
           if ((newEntries[i].location || '') === trigLoc) {
             if (newEntries[i].quantity > remaining) {
               newEntries[i].quantity -= remaining;
               remaining = 0;
               break;
             } else {
               remaining -= newEntries[i].quantity;
               newEntries[i].quantity = 0;
             }
           }
         }
      }

      if (remaining > 0) {
          for (let i = 0; i < newEntries.length; i++) {
            if (newEntries[i].quantity > remaining) {
              newEntries[i].quantity -= remaining;
              remaining = 0;
              break;
            } else {
              remaining -= newEntries[i].quantity;
              newEntries[i].quantity = 0;
            }
          }
      }
      newEntries = newEntries.filter(e => e.quantity > 0);
    }
    
    const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));

    const updateData: any = {
      inventoryQuantity: newInv,
      shoppingQuantity: newShop,
      inventoryEntries: newEntries,
      locations: newLocs,
      updatedAt: serverTimestamp()
    };

    if (newShop > 0 || newInv > 0) {
      updateData.isHiddenSuggestion = false;
    }

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined(updateData));
    } catch (error) {
      console.error("Error updating quantities:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const handleUpdateItem = async (itemId: string, fields: Partial<GroceryItem>) => {
    if (!user || !activeListId) return;
    try {
      const updateData: any = {
        ...fields,
        updatedAt: serverTimestamp()
      };
      
      if (fields.shoppingQuantity !== undefined && fields.shoppingQuantity > 0) {
        updateData.isHiddenSuggestion = false;
      }

      await updateDoc(doc(db, "lists", activeListId, "items", itemId), removeUndefined(updateData));
    } catch (error) {
      console.error("Error updating item:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${itemId}`);
    }
  };

  const handleCheckOff = (item: GroceryItem) => {
    setCheckingOffItem(item);
  };

  const confirmCheckOff = async (item: GroceryItem, priceEntry: Omit<PriceEntry, 'id'> | null) => {
    if (!user || !activeListId || !item.id) return;
    try {
      if (item.shoppingQuantity > 0) {
        const updateData: Record<string, unknown> = {
          unprocessedQuantity: (item.unprocessedQuantity || 0) + item.shoppingQuantity,
          shoppingQuantity: 0,
          updatedAt: serverTimestamp()
        };
        
        if (priceEntry) {
          updateData.priceHistory = arrayUnion({
            ...priceEntry,
            id: Math.random().toString(36).substr(2, 9)
          });
        }

        await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined(updateData));
      }
      setCheckingOffItem(undefined);
    } catch (error) {
      console.error("Error checking off item:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const [moveDialogState, setMoveDialogState] = useState<{item: GroceryItem, entryId: string, newLocation: string} | null>(null);

  const handleMoveEntry = async (item: GroceryItem, entryId: string, newLocation: string) => {
    if (!user || !activeListId || !item.id) return;
    
    const entry = (item.inventoryEntries || []).find(e => e.id === entryId);
    if (!entry) return;

    if (entry.quantity > 1) {
        setMoveDialogState({ item, entryId, newLocation });
        return;
    }
    
    await executeMoveEntry(item, entryId, newLocation, entry.quantity);
  };

  const executeMoveEntry = async (item: GroceryItem, entryId: string, newLocation: string, quantityToMove: number) => {
    if (!user || !activeListId || !item.id) return;
    
    let isModified = false;
    const newEntries: InventoryEntry[] = [];
    
    for (const e of (item.inventoryEntries || [])) {
        if (e.id === entryId && e.location !== newLocation) {
            isModified = true;
            if (quantityToMove >= e.quantity) {
                newEntries.push({ ...e, location: newLocation });
            } else {
                const remaining = e.quantity - quantityToMove;
                newEntries.push({ ...e, quantity: remaining });
                const { openedDate: _, ...restE } = e;
                newEntries.push({ ...restE, id: "temp-" + Date.now() + Math.random().toString(36).substr(2, 9), quantity: quantityToMove, location: newLocation, isOpened: false });
            }
        } else {
            newEntries.push(e);
        }
    }
    
    if (!isModified) return;
    
    const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));
    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined({
        inventoryEntries: newEntries,
        locations: newLocs,
        updatedAt: serverTimestamp()
      }));
    } catch (error) {
      console.error("Error moving entry:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const updateEntryQuantity = async (item: GroceryItem, entryId: string, delta: number) => {
    if (!user || !activeListId || !item.id) return;
    
    let newEntries: InventoryEntry[] = [];
    let isModified = false;
    
    for (const e of (item.inventoryEntries || [])) {
        if (e.id === entryId) {
            isModified = true;
            if (e.isOpened && e.unit === 'pcs') {
                // If it's opened and unit is pcs, +/- modifies the amount (e.g. number of pieces left)
                const newAmount = Math.max(0, (e.amount || 0) + delta);
                newEntries.push({ ...e, amount: newAmount });
            } else {
                 newEntries.push({ ...e, quantity: Math.max(0, e.quantity + delta) });
            }
        } else {
            newEntries.push(e);
        }
    }
    
    if (!isModified) return;

    // Filter out empty boxes!
    newEntries = newEntries.filter(e => {
        if (e.quantity <= 0) return false;
        if (e.unit === 'pcs' && (e.amount === undefined || e.amount <= 0)) return false;
        return true;
    });
    
    const newInv = newEntries.reduce((sum, e) => sum + e.quantity, 0);
    const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined({
        inventoryQuantity: newInv,
        inventoryEntries: newEntries,
        locations: newLocs,
        updatedAt: serverTimestamp()
      }));
    } catch (error) {
      console.error("Error updating entry quantity:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const toggleEntryStatus = async (item: GroceryItem, entryId: string) => {
    if (!user || !activeListId || !item.id) return;
    
    const newEntries: InventoryEntry[] = [];
    let isModified = false;

    for (const e of (item.inventoryEntries || [])) {
        if (e.id === entryId) {
            isModified = true;
            const isOpened = !e.isOpened;
            
            if (e.quantity > 1 && isOpened) {
                // Auto-split: Open only ONE item out of the multiple items
                const remainingBoxes = Number(e.quantity) - 1;
                
                // Keep untouched boxes
                newEntries.push({ ...e, quantity: remainingBoxes });
                
                // Add the ONE opened box
                newEntries.push({ 
                    ...e, 
                    id: "temp-" + Date.now() + Math.random(), 
                    quantity: 1, 
                    isOpened: true, 
                    openedDate: new Date().toISOString().split('T')[0] 
                });
            } else {
                newEntries.push({
                  ...e,
                  isOpened,
                  openedDate: isOpened ? (e.openedDate ? e.openedDate : new Date().toISOString().split('T')[0]) : (e.openedDate || "")
                });
            }
        } else {
            newEntries.push(e);
        }
    }

    if (!isModified) return;

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined({
        inventoryEntries: newEntries,
        updatedAt: serverTimestamp()
      }));
    } catch (error) {
      console.error("Error toggling status:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const updateEntryOpenedDate = async (item: GroceryItem, entryId: string, date: string) => {
    if (!user || !activeListId || !item.id) return;
    const newEntries = (item.inventoryEntries || []).map(e => {
      if (e.id === entryId) {
        return { ...e, openedDate: date };
      }
      return e;
    });

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined({
        inventoryEntries: newEntries,
        updatedAt: serverTimestamp()
      }));
    } catch (error) {
      console.error("Error updating opened date:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const createNewList = async () => {
    if (!user) return;
    const name = prompt("Enter a name for the new list:");
    if (name) {
      try {
         const docRef = await addDoc(collection(db, "lists"), {
            name,
            ownerId: user.uid,
            members: [user.uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
         });
         setActiveListId(docRef.id);
      } catch (e) {
         console.error("Failed to create list", e);
      }
    }
  };
  
  const [copiedLink, setCopiedLink] = useState(false);

  const copyShareLink = () => {
    if (!activeListId) return;
    const url = new URL(window.location.href);
    if (url.hostname.includes('ais-dev-')) {
      url.hostname = url.hostname.replace('ais-dev-', 'ais-pre-');
    }
    url.searchParams.set('join', activeListId);
    navigator.clipboard.writeText(url.toString());
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const inventoryItems = useMemo(() => items, [items]);
  const shoppingItems = useMemo(() => items.filter(i => i.shoppingQuantity > 0), [items]);
  const suggestedItems = useMemo(() => items.filter(i => i.shoppingQuantity === 0 && i.inventoryQuantity === 0 && !i.unprocessedQuantity && !i.isHiddenSuggestion), [items]);
  const currentList = lists.find(l => l.id === activeListId);

  const renderControls = () => (
    <div className="space-y-4 mb-6">
      <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="text-gray-600 hover:text-blue-600"
          >
            {isFilterExpanded ? "Hide Filters" : "Show Filters"}
          </Button>
          <div className="flex items-center bg-gray-100 rounded-lg p-1 ml-2">
             {activeTab === 'shopping' ? (
                <button onClick={() => setGroupBy('store')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${groupBy === 'store' ? 'bg-white shadow-sm text-gray-900 border border-gray-200/50' : 'text-gray-500 hover:text-gray-700'}`}>Store</button>
             ) : (
                <button onClick={() => setGroupBy('location')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${groupBy === 'location' ? 'bg-white shadow-sm text-gray-900 border border-gray-200/50' : 'text-gray-500 hover:text-gray-700'}`}>Location</button>
             )}
             <button onClick={() => setGroupBy('category')} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${groupBy === 'category' ? 'bg-white shadow-sm text-gray-900 border border-gray-200/50' : 'text-gray-500 hover:text-gray-700'}`}>Category</button>
          </div>
          <div className="text-sm text-gray-500 hidden sm:block ml-2">
            {activeTab === 'shopping' ? `${shoppingItems.length} to buy` : `${inventoryItems.length} items`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {filterCat !== 'All' && <Badge variant="secondary" className="bg-blue-50 text-blue-700">{filterCat}</Badge>}
          {filterLoc !== 'All' && <Badge variant="secondary" className="bg-blue-50 text-blue-700">{filterLoc}</Badge>}
        </div>
      </div>

      <AnimatePresence>
        {isFilterExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 bg-white p-3 sm:p-4 rounded-xl border border-gray-200 shadow-sm text-sm">
               <div className="flex flex-col gap-1.5">
                 <label className="font-semibold text-gray-700 text-xs uppercase tracking-wider">Sort by</label>
                 <div className="flex gap-2">
                   <select value={sortBy} onChange={e => setSortBy(e.target.value as 'name' | 'quantity' | 'expiryDate' | 'dateBought' | 'dateAdded')} className="flex-1 bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                     <option value="name">Name</option>
                     <option value="quantity">Quantity</option>
                     <option value="expiryDate">Expiry Date</option>
                     <option value="dateBought">Date Bought</option>
                     <option value="dateAdded">Date Added</option>
                   </select>
                   <select value={sortDir} onChange={e => setSortDir(e.target.value as 'asc' | 'desc')} className="w-24 bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                     <option value="asc">Asc</option>
                     <option value="desc">Desc</option>
                   </select>
                 </div>
               </div>

               <div className="flex flex-col gap-1.5">
                 <label className="font-semibold text-gray-700 text-xs uppercase tracking-wider">Category</label>
                 <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                   <option value="All">All Categories</option>
                   {CATEGORIES.map(cat => (
                     <option key={cat} value={cat}>{cat}</option>
                   ))}
                 </select>
               </div>

               <div className="flex flex-col gap-1.5">
                 <label className="font-semibold text-gray-700 text-xs uppercase tracking-wider">Location</label>
                 <select value={filterLoc} onChange={e => setFilterLoc(e.target.value)} className="bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                   <option value="All">All Locations</option>
                   <option value="Unassigned">Unassigned</option>
                   {locations.map(loc => (
                     <option key={loc} value={loc}>{loc}</option>
                   ))}
                 </select>
               </div>

               <div className="flex flex-col gap-1.5">
                 <label className="font-semibold text-gray-700 text-xs uppercase tracking-wider">Tag</label>
                 <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                   <option value="All">All Tags</option>
                   {tags.map(tag => (
                     <option key={tag} value={tag}>{tag}</option>
                   ))}
                 </select>
               </div>

               <div className="flex flex-col gap-1.5">
                 <label className="font-semibold text-gray-700 text-xs uppercase tracking-wider">Expiry</label>
                 <select value={filterExpiry} onChange={e => setFilterExpiry(e.target.value)} className="bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                   <option value="All">Any Expiry</option>
                   <option value="Expired">Expired</option>
                   <option value="1 Week">1 Week</option>
                   <option value="1 Month">1 Month</option>
                 </select>
               </div>

               <div className="flex items-end">
                  <Button variant="ghost" size="sm" onClick={() => {
                    setFilterCat('All');
                    setFilterLoc('All');
                    setFilterTag('All');
                    setGroupBy('category');
                    setSortBy('name');
                    setSortDir('asc');
                  }} className="text-blue-600 h-9 w-full">
                    Reset All
                  </Button>
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderInventoryItems = (searchString?: string) => {
    const itemsToFilter = searchString !== undefined ? items : inventoryItems;
    
    const filteredItems = itemsToFilter.filter(item => {
      if (searchString !== undefined) {
          const q = searchString.toLowerCase();
          const itemName = (item.name || "").toLowerCase();
          const itemCat = (item.category || "").toLowerCase();
          return itemName.includes(q) || itemCat.includes(q);
      }

      if (filterCat !== 'All' && item.category !== filterCat) return false;
      
      const itemLocs = item.locations || [];
      if (item.location && !itemLocs.includes(item.location)) itemLocs.push(item.location);
      if (filterLoc !== 'All' && itemLocs.length > 0 && !itemLocs.includes(filterLoc)) return false;
      if (filterLoc !== 'All' && itemLocs.length === 0 && filterLoc !== 'Unassigned') return false;
      
      const itemTags = item.inventoryEntries?.flatMap(e => e.tags || []) || [];
      if (filterTag !== 'All' && !itemTags.includes(filterTag)) return false;

      if (filterExpiry !== 'All') {
        const todayStr = new Date().toISOString().split('T')[0];
        const oneWeekObj = new Date(); oneWeekObj.setDate(oneWeekObj.getDate() + 7);
        const oneWeekStr = oneWeekObj.toISOString().split('T')[0];
        const oneMonthObj = new Date(); oneMonthObj.setMonth(oneMonthObj.getMonth() + 1);
        const oneMonthStr = oneMonthObj.toISOString().split('T')[0];
        
        const hasMatchingExpiry = item.inventoryEntries?.some(e => {
           if (!e.expiryDate) return false;
           if (filterExpiry === 'Expired') return e.expiryDate < todayStr;
           if (filterExpiry === '1 Week') return e.expiryDate >= todayStr && e.expiryDate <= oneWeekStr;
           if (filterExpiry === '1 Month') return e.expiryDate >= todayStr && e.expiryDate <= oneMonthStr;
           return false;
        });

        if (!hasMatchingExpiry) return false;
      }

      return true;
    });

    filteredItems.sort((a, b) => {
      let result = 0;
      if (sortBy === 'name') {
         result = a.name.localeCompare(b.name);
      } else if (sortBy === 'quantity') {
         result = a.inventoryQuantity - b.inventoryQuantity;
      } else if (sortBy === 'expiryDate') {
         const getEarliest = (it: GroceryItem) => {
             const dates = (it.inventoryEntries || []).map(e => e.expiryDate).filter(Boolean) as string[];
             if (dates.length === 0) return sortDir === 'asc' ? '9999-12-31' : '0000-00-00';
             dates.sort();
             return sortDir === 'asc' ? dates[0] : dates[dates.length - 1]; // respect order
         };
         result = getEarliest(a).localeCompare(getEarliest(b));
      } else if (sortBy === 'dateBought') {
         const getLatest = (it: GroceryItem) => {
             const dates = (it.inventoryEntries || []).map(e => e.dateBought || e.dateAdded).filter(Boolean) as string[];
             if (dates.length === 0) return sortDir === 'asc' ? '0000-00-00' : '9999-12-31';
             dates.sort();
             return sortDir === 'asc' ? dates[dates.length - 1] : dates[0];
         };
         result = getLatest(a).localeCompare(getLatest(b));
      } else if (sortBy === 'dateAdded') {
         const getLatest = (it: GroceryItem) => {
             const dates = (it.inventoryEntries || []).map(e => e.dateAdded).filter(Boolean) as string[];
             if (dates.length === 0) return sortDir === 'asc' ? '0000-00-00' : '9999-12-31';
             dates.sort();
             return sortDir === 'asc' ? dates[dates.length - 1] : dates[0];
         };
         result = getLatest(a).localeCompare(getLatest(b));
      }
      return sortDir === 'asc' ? result : -result;
    });

    if (filteredItems.length === 0) {
      return (
        <div className="text-center py-16 bg-white border border-dashed rounded-lg mt-6">
          <p className="text-gray-500">No items match your criteria.</p>
        </div>
      );
    }

    let groups: { name: string; items: GroceryItem[] }[] = [];
    const effectiveGroupBy = searchString !== undefined ? 'none' : groupBy;

    if (effectiveGroupBy === 'category') {
      const g = filteredItems.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {} as Record<string, GroceryItem[]>);
      groups = CATEGORIES.filter(c => g[c]?.length > 0).map(c => ({ name: c, items: g[c] }));
    } else if (effectiveGroupBy === 'location') {
      const g: Record<string, GroceryItem[]> = {};
      filteredItems.forEach(item => {
        const itemLocs = item.locations || [];
        if (item.location && !itemLocs.includes(item.location)) itemLocs.push(item.location);
        
        if (itemLocs.length === 0) {
          if (!g['Unassigned']) g['Unassigned'] = [];
          g['Unassigned'].push(item);
        } else {
          itemLocs.forEach(loc => {
            if (!g[loc]) g[loc] = [];
            g[loc].push(item);
          });
        }
      });
      groups = Object.keys(g).sort().map(k => ({ name: k, items: g[k] }));
    } else {
      groups = [{ name: 'Search Results', items: filteredItems }];
    }

    const content = groups.map(group => {
      const gridContent = (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {group.items.map(item => {
          let displayInventoryQuantity = item.inventoryQuantity;
          let relevantEntries = item.inventoryEntries || [];
          if (effectiveGroupBy === 'location') {
              relevantEntries = relevantEntries.filter(e => (e.location || 'Unassigned') === group.name || (!e.location && group.name === 'Unassigned'));
              displayInventoryQuantity = relevantEntries.reduce((sum, e) => sum + e.quantity, 0);
              // Special case if there are no entries at all
              if (!item.inventoryEntries || item.inventoryEntries.length === 0) {
                  displayInventoryQuantity = item.inventoryQuantity;
              }
          }
          
          const openedPcsEntries = relevantEntries.filter(e => e.isOpened && e.unit === 'pcs');
          let openedPcsText = "";
          if (openedPcsEntries.length > 0) {
              const totalPcs = openedPcsEntries.reduce((sum, e) => sum + (e.amount || 0), 0);
              openedPcsText = `, ${totalPcs} pcs`;
          }

          return (
          <div key={`${group.name}-${item.id}`} onClick={() => toggleExpanded(item.id!)} className="bg-white p-3 sm:p-4 rounded-xl shadow-sm ring-1 ring-gray-900/5 flex flex-col gap-2 sm:gap-3 cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</div>
                  {item.inventoryEntries?.some(e => e.isOpened) && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-orange-500 text-white border-none font-semibold shadow-sm">
                      OPENED
                    </Badge>
                  )}
                </div>
                {effectiveGroupBy === 'category' && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(item.locations || [item.location]).filter(Boolean).map(loc => (
                      <Badge key={loc!} variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-50">{loc}</Badge>
                    ))}
                  </div>
                )}
                {effectiveGroupBy === 'location' && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-50">{item.category}</Badge>
                    </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-1">
                  <span className="text-lg font-bold text-gray-900">{displayInventoryQuantity} <span className="text-xs text-gray-500 font-normal">count{openedPcsText}</span></span>
                </div>
                {item.shoppingQuantity > 0 && <span className="text-xs text-blue-600 font-medium">+{item.shoppingQuantity} {item.unit || ""} to buy</span>}
                <div className="flex gap-1 mt-1" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-blue-600" onClick={() => { setEditingItem(item); setIsDialogOpen(true); }}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-700" onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id!);
                  }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
            
            {expandedItems[item.id!] && item.inventoryEntries && item.inventoryEntries.length > 0 && (
              <div className="bg-gray-50/50 rounded-lg text-xs mt-3 border border-gray-100 divide-y divide-gray-100" onClick={e => e.stopPropagation()}>
                 {item.inventoryEntries
                    .filter(entry => effectiveGroupBy !== 'location' || (entry.location || 'Unassigned') === group.name || (!entry.location && group.name === 'Unassigned'))
                    .map(entry => (
                   <div key={entry.id} className="p-2 flex justify-between items-center hover:bg-gray-100 transition-colors cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setFocusedEntryId(entry.id); setIsDialogOpen(true); }}>
                     <div className="flex flex-col gap-0.5">
                       <div className="flex items-center gap-1.5 pl-1.5 border-l-2 border-gray-300">
                           <span className="font-semibold text-gray-700">
                             {entry.isOpened && entry.unit === 'pcs' ? 
                                (entry.amount ? `${entry.quantity} count, ${entry.amount} pcs` : `${entry.quantity} count, 1 pcs`) : 
                                (entry.amount ? `${entry.quantity} x ${entry.amount} ${entry.unit || item.unit || ''}` : `${entry.quantity} ${entry.unit || item.unit || 'Count'}`)
                             }
                           </span>
                           <div className="relative inline-flex items-center ml-1">
                             <select 
                                 value={entry.location || ''} 
                                 onChange={(e) => handleMoveEntry(item, entry.id, e.target.value)} 
                                 onClick={(e) => e.stopPropagation()}
                                 className="appearance-none bg-blue-50/50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-medium rounded pl-1.5 pr-4 py-0.5 cursor-pointer focus:ring-0 max-w-[120px] truncate"
                             >
                                 <option value="" disabled>Move...</option>
                                 {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                             </select>
                             <ChevronDown className="w-2.5 h-2.5 text-blue-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                           </div>
                           <Button 
                              variant={entry.isOpened ? "default" : "outline"} 
                              size="sm" 
                              className={`h-5 text-[10px] px-1.5 ml-1 ${entry.isOpened ? "bg-orange-500 hover:bg-orange-600 text-white" : "text-gray-500 border-gray-300"}`}
                              onClick={(e) => { e.stopPropagation(); toggleEntryStatus(item, entry.id); }}
                           >
                              {entry.isOpened ? "Opened" : "Unopened"}
                           </Button>
                       </div>
                       {entry.label && <span className="text-gray-500 pl-2">{entry.label}</span>}
                       {entry.expiryDate && <span className={`pl-2 ${new Date(entry.expiryDate) < new Date() ? "text-red-500 font-medium" : "text-gray-400"}`}>Exp: {entry.expiryDate}</span>}
                       {(entry.dateBought || entry.dateAdded) && <div className="text-[10px] text-gray-400 pl-2">Bought: {entry.dateBought || entry.dateAdded}</div>}
                       {entry.isOpened && (
                          <span className="text-[10px] text-orange-600 flex items-center gap-0.5 pl-2 mt-0.5">
                            <span className="font-semibold uppercase text-[9px]">Opened:</span> 
                            <input 
                              type="date" 
                              value={entry.openedDate || ""} 
                              onChange={(e) => updateEntryOpenedDate(item, entry.id, e.target.value)}
                              className="bg-transparent border-none p-0 text-[10px] focus:ring-0 w-[85px] h-[18px]"
                              onClick={(e) => e.stopPropagation()}
                            />
                            {entry.openedDate && (
                              <Button variant="ghost" size="icon" className="h-[14px] w-[14px] flex-shrink-0 text-orange-400 hover:text-orange-600 hover:bg-orange-100/50 p-0" onClick={(e) => { e.stopPropagation(); updateEntryOpenedDate(item, entry.id, ""); }}>
                                <X className="w-2.5 h-2.5" />
                              </Button>
                            )}
                          </span>
                       )}
                       {entry.tags && entry.tags.length > 0 && (
                         <div className="flex flex-wrap gap-1 pl-2 mt-0.5">
                           {entry.tags.map(tag => (
                             <Badge key={tag} variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-gray-100">{tag}</Badge>
                           ))}
                         </div>
                       )}
                     </div>
                     <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-6 w-6 text-gray-500 border-gray-300" onClick={(e) => { e.stopPropagation(); updateEntryQuantity(item, entry.id, -1); }} title="Decrease count">
                           <Minus className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-sm font-medium w-6 text-center text-gray-800">{entry.isOpened && entry.unit === 'pcs' ? (entry.amount || 0) : entry.quantity}</span>
                        <Button variant="outline" size="icon" className="h-6 w-6 text-gray-500 border-gray-300" onClick={(e) => { e.stopPropagation(); updateEntryQuantity(item, entry.id, 1); }} title="Increase count">
                           <Plus className="w-3.5 h-3.5" />
                        </Button>
                     </div>
                   </div>
                 ))}
              </div>
            )}

            {expandedItems[item.id!] && item.priceHistory && item.priceHistory.length > 0 && (
              <div className="bg-blue-50/30 rounded-lg text-xs mt-3 border border-blue-100" onClick={e => e.stopPropagation()}>
                <div className="p-2 border-b border-blue-100 font-semibold text-blue-800 uppercase tracking-wider text-[10px]">Price History</div>
                
                {item.priceHistory.length > 1 && (
                  <div className="h-32 w-full p-2 pb-0">
                      <ResponsiveContainer width="100%" height="100%">
                          <RechartsLineChart data={[...item.priceHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(e => ({
                              date: new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                              unitPrice: Number((e.isDiscount && e.dealPrice && e.dealQuantity ? Number(e.dealPrice) / Number(e.dealQuantity) : Number(e.price) / Number(e.quantity)).toFixed(2))
                          }))}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                              <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} tickMargin={8} minTickGap={15} />
                              <YAxis width={30} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                              <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px', padding: '4px 8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: number) => [`$${value.toFixed(2)}`, 'Unit Price']} labelStyle={{ color: '#6B7280', marginBottom: '2px' }} />
                              <Line type="monotone" dataKey="unitPrice" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3, fill: "#3B82F6", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                          </RechartsLineChart>
                      </ResponsiveContainer>
                  </div>
                )}

                <div className="divide-y divide-blue-50 max-h-[120px] overflow-y-auto">
                    {[...item.priceHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(entry => (
                       <div key={entry.id} className="p-2 flex justify-between items-center bg-white hover:bg-gray-50 transition-colors">
                           <div className="flex flex-col gap-0.5">
                               <span className="font-semibold text-gray-700">{entry.store || "Unknown Store"}</span>
                               <span className="text-[10px] text-gray-500">{entry.date}</span>
                           </div>
                           <div className="flex flex-col items-end gap-0.5">
                               {entry.isDiscount && entry.dealPrice && entry.dealQuantity ? (
                                   <>
                                       <span className="font-bold text-green-700">${Number(entry.dealPrice).toFixed(2)}</span>
                                       <span className="text-[9px] text-green-600">for {entry.dealQuantity}</span>
                                   </>
                               ) : (
                                   <>
                                       <span className="font-bold text-blue-700">${Number(entry.price).toFixed(2)}</span>
                                       <span className="text-[9px] text-gray-500">for {entry.quantity} {entry.unitStr}</span>
                                   </>
                               )}
                           </div>
                       </div>
                    ))}
                </div>
              </div>
            )}

            {expandedItems[item.id!] && item.notes && <div className="text-xs text-gray-500 mt-1 line-clamp-2 italic border-t pt-2" title={item.notes}>{item.notes}</div>}
          </div>
        );
        })}
      </div>
      );

      if (searchString !== undefined) {
        return <div key={group.name} className="mt-4">{gridContent}</div>;
      }

      return (
        <AccordionItem key={group.name} value={group.name} className="border border-gray-200 bg-white rounded-xl shadow-sm data-[state=open]:pb-4">
          <AccordionTrigger 
            className="hover:no-underline px-4 py-4 font-semibold text-lg text-gray-800 transition-colors hover:bg-gray-50/50 sticky top-0 z-10 data-[state=open]:bg-white/95 backdrop-blur-sm select-none rounded-t-xl data-[state=closed]:rounded-b-xl focus-visible:ring-0"
            onTouchStart={() => startLongPress(group.name)}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
            onContextMenu={(e) => handleContextMenu(e, group.name)}
          >
            <div className="flex items-center gap-2">
               {group.name} <Badge variant="secondary" className="ml-2 bg-gray-100 text-gray-600 border-none font-medium">{group.items.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pt-2">
            {gridContent}
          </AccordionContent>
        </AccordionItem>
      );
    });

    return searchString !== undefined ? (
       <div className="w-full">{content}</div>
    ) : (
      <Accordion className="space-y-4 mt-4 sm:mt-6 w-full">
        {content}
      </Accordion>
    );
  };

  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);

  const startLongPress = (groupName: string) => {
    if (groupBy !== 'location' || groupName === 'Unassigned') return;
    longPressTimer.current = setTimeout(() => {
       const newName = window.prompt("Rename location to:", groupName);
       if (newName && newName.trim() !== "" && newName !== groupName) {
         handleRenameLocation(groupName, newName.trim());
       }
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleContextMenu = (e: React.MouseEvent, groupName: string) => {
    if (groupBy !== 'location' || groupName === 'Unassigned') return;
    e.preventDefault();
    cancelLongPress();
    const newName = window.prompt("Rename location to:", groupName);
    if (newName && newName.trim() !== "" && newName !== groupName) {
      handleRenameLocation(groupName, newName.trim());
    }
  };

  const handleRenameLocation = async (oldName: string, newName: string) => {
    if (!user || !activeListId) return;

    try {
      const updates = items.map(async item => {
        let changed = false;
        let newLocations = item.locations || [];
        let newLocation = item.location;
        let newEntries = [...(item.inventoryEntries || [])];

        if (newLocation === oldName) {
           newLocation = newName;
           changed = true;
        }

        if (newLocations.includes(oldName)) {
           newLocations = newLocations.map(l => l === oldName ? newName : l);
           changed = true;
        }

        let entriesChanged = false;
        newEntries = newEntries.map(e => {
           if (e.location === oldName) {
              entriesChanged = true;
              return { ...e, location: newName };
           }
           return e;
        });

        if (entriesChanged) changed = true;

        if (changed) {
           newLocations = Array.from(new Set(newLocations));
           await updateDoc(doc(db, "lists", activeListId, "items", item.id!), {
              location: newLocation,
              locations: newLocations,
              inventoryEntries: newEntries
           });
        }
      });
      await Promise.all(updates);
    } catch (e) {
       console.error(e);
       alert("Failed to rename location.");
    }
  };

  const renderGroupedItems = (itemList: GroceryItem[], isShoppingList: boolean, isSuggested = false) => {
    const filteredItems = itemList.filter(item => {
      if (filterCat !== 'All' && item.category !== filterCat) return false;
      
      const itemLocs = item.locations || [];
      if (item.location && !itemLocs.includes(item.location)) itemLocs.push(item.location);
      if (filterLoc !== 'All' && itemLocs.length > 0 && !itemLocs.includes(filterLoc)) return false;
      if (filterLoc !== 'All' && itemLocs.length === 0 && filterLoc !== 'Unassigned') return false;
      
      const itemTags = item.inventoryEntries?.flatMap(e => e.tags || []) || [];
      if (filterTag !== 'All' && !itemTags.includes(filterTag)) return false;

      if (!isShoppingList && filterExpiry !== 'All') {
        const todayStr = new Date().toISOString().split('T')[0];
        const oneWeekObj = new Date(); oneWeekObj.setDate(oneWeekObj.getDate() + 7);
        const oneWeekStr = oneWeekObj.toISOString().split('T')[0];
        const oneMonthObj = new Date(); oneMonthObj.setMonth(oneMonthObj.getMonth() + 1);
        const oneMonthStr = oneMonthObj.toISOString().split('T')[0];
        
        const hasMatchingExpiry = item.inventoryEntries?.some(e => {
           if (!e.expiryDate) return false;
           if (filterExpiry === 'Expired') return e.expiryDate < todayStr;
           if (filterExpiry === '1 Week') return e.expiryDate >= todayStr && e.expiryDate <= oneWeekStr;
           if (filterExpiry === '1 Month') return e.expiryDate >= todayStr && e.expiryDate <= oneMonthStr;
           return false;
        });

        if (!hasMatchingExpiry) return false;
      }

      return true;
    });

    filteredItems.sort((a, b) => {
      let result = 0;
      if (sortBy === 'name') {
         result = a.name.localeCompare(b.name);
      } else if (sortBy === 'quantity') {
         const qA = isShoppingList ? a.shoppingQuantity : a.inventoryQuantity;
         const qB = isShoppingList ? b.shoppingQuantity : b.inventoryQuantity;
         result = qA - qB;
      } else if (sortBy === 'expiryDate') {
         const getEarliest = (it: GroceryItem) => {
             const dates = (it.inventoryEntries || []).map(e => e.expiryDate).filter(Boolean) as string[];
             if (dates.length === 0) return sortDir === 'asc' ? '9999-12-31' : '0000-00-00';
             dates.sort();
             return sortDir === 'asc' ? dates[0] : dates[dates.length - 1];
         };
         result = getEarliest(a).localeCompare(getEarliest(b));
      } else if (sortBy === 'dateBought') {
         const getLatest = (it: GroceryItem) => {
             const dates = (it.inventoryEntries || []).map(e => e.dateBought || e.dateAdded).filter(Boolean) as string[];
             if (dates.length === 0) return sortDir === 'asc' ? '0000-00-00' : '9999-12-31';
             dates.sort();
             return sortDir === 'asc' ? dates[dates.length - 1] : dates[0];
         };
         result = getLatest(a).localeCompare(getLatest(b));
      } else if (sortBy === 'dateAdded') {
         const getLatest = (it: GroceryItem) => {
             const dates = (it.inventoryEntries || []).map(e => e.dateAdded).filter(Boolean) as string[];
             if (dates.length === 0) return sortDir === 'asc' ? '0000-00-00' : '9999-12-31';
             dates.sort();
             return sortDir === 'asc' ? dates[dates.length - 1] : dates[0];
         };
         result = getLatest(a).localeCompare(getLatest(b));
      }
      return sortDir === 'asc' ? result : -result;
    });

    if (filteredItems.length === 0) {
      return (
        <div className="text-center py-16 bg-white border border-dashed rounded-lg">
          <p className="text-gray-500">No items match your filters.</p>
        </div>
      );
    }

    let groups: { name: string; items: GroceryItem[] }[] = [];

    let activeGroupBy = groupBy;
    if (isSuggested) activeGroupBy = 'category';

    if (activeGroupBy === 'category') {
      const g = filteredItems.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {} as Record<string, GroceryItem[]>);
      groups = CATEGORIES.filter(c => g[c]?.length > 0).map(c => ({ name: c, items: g[c] }));
    } else if (activeGroupBy === 'store') {
      const g = filteredItems.reduce((acc, item) => {
        const store = item.shoppingStore || 'Unassigned';
        if (!acc[store]) acc[store] = [];
        acc[store].push(item);
        return acc;
      }, {} as Record<string, GroceryItem[]>);
      groups = Object.keys(g).sort().map(k => ({ name: k, items: g[k] }));
    } else {
      const g: Record<string, GroceryItem[]> = {};
      filteredItems.forEach(item => {
        const itemLocs = item.locations || [];
        if (item.location && !itemLocs.includes(item.location)) itemLocs.push(item.location);
        
        if (itemLocs.length === 0) {
          if (!g['Unassigned']) g['Unassigned'] = [];
          g['Unassigned'].push(item);
        } else {
          itemLocs.forEach(loc => {
            if (!g[loc]) g[loc] = [];
            g[loc].push(item);
          });
        }
      });
      groups = Object.keys(g).sort().map(k => ({ name: k, items: g[k] }));
    }

    return (
      <Accordion type="multiple" className="space-y-4 w-full">
        {groups.map(group => (
          <AccordionItem key={group.name} value={group.name} className="border border-gray-200 bg-white rounded-xl shadow-sm data-[state=open]:pb-4">
            <AccordionTrigger 
              className="hover:no-underline px-4 py-4 font-semibold text-lg text-gray-800 transition-colors hover:bg-gray-50/50 sticky top-0 z-10 data-[state=open]:bg-white/95 backdrop-blur-sm select-none rounded-t-xl data-[state=closed]:rounded-b-xl focus-visible:ring-0"
              onTouchStart={() => startLongPress(group.name)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              onContextMenu={(e) => handleContextMenu(e, group.name)}
            >
              <div className="flex items-center gap-2">
                 {group.name} <Badge variant="secondary" className="ml-2 bg-gray-100 text-gray-600 border-none font-medium">{group.items.length}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {group.items.map(item => {
                let displayInventoryQuantity = item.inventoryQuantity;
                let relevantEntries = item.inventoryEntries || [];
                if (!isShoppingList && activeGroupBy === 'location') {
                    relevantEntries = relevantEntries.filter(e => (e.location || 'Unassigned') === group.name || (!e.location && group.name === 'Unassigned'));
                    displayInventoryQuantity = relevantEntries.reduce((sum, e) => sum + e.quantity, 0);
                    // Special case if there are no entries at all
                    if (!item.inventoryEntries || item.inventoryEntries.length === 0) {
                        displayInventoryQuantity = item.inventoryQuantity;
                    }
                }
                
                const openedPcsEntries = relevantEntries.filter(e => e.isOpened && e.unit === 'pcs');
                let openedPcsText = "";
                if (openedPcsEntries.length > 0) {
                    const totalPcs = openedPcsEntries.reduce((sum, e) => sum + (e.amount || 0), 0);
                    openedPcsText = `, ${totalPcs} pcs`;
                }

                let priceInsights = null;
                if (isShoppingList && item.priceHistory && item.priceHistory.length > 0) {
                  const sortedPrices = [...item.priceHistory].sort((a, b) => b.date.localeCompare(a.date));
                  const lastPurchase = sortedPrices.length ? sortedPrices[0] : null;
                  
                  const threeMonthsAgo = new Date();
                  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
                  const p3mStr = threeMonthsAgo.toISOString().split('T')[0];
                  const p3mEntries = sortedPrices.filter(e => e.date >= p3mStr);
                  const p3mLow = p3mEntries.length ? p3mEntries.reduce((min, e) => (e.price / (e.quantity || 1)) < (min.price / (min.quantity || 1)) ? e : min, p3mEntries[0]) : null;

                  const twelveMonthsAgo = new Date();
                  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
                  const p12mStr = twelveMonthsAgo.toISOString().split('T')[0];
                  const p12mEntries = sortedPrices.filter(e => e.date >= p12mStr);
                  const p12mLow = p12mEntries.length ? p12mEntries.reduce((min, e) => (e.price / (e.quantity || 1)) < (min.price / (min.quantity || 1)) ? e : min, p12mEntries[0]) : null;

                  priceInsights = { lastPurchase, p3mLow, p12mLow };
                }

                return (
                <div key={item.id} className={`${(isShoppingList || isSuggested) ? 'p-2.5 sm:p-3' : 'p-3 sm:p-4'} bg-white rounded-xl shadow-sm ring-1 ring-gray-900/5 flex flex-col gap-2`}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`${(isShoppingList || isSuggested) ? 'text-sm' : 'text-base'} font-medium text-gray-900 truncate`} title={item.name}>{item.name}</div>
                        {!isShoppingList && !isSuggested && item.inventoryEntries?.some(e => e.isOpened) && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-orange-500 text-white border-none font-semibold shadow-sm shrink-0">
                            OPENED
                          </Badge>
                        )}
                      </div>
                      {(item.locations && item.locations.length > 0) ? (
                        <div className={`flex flex-wrap gap-1 ${(isShoppingList || isSuggested) ? 'mt-1' : 'mt-1.5'}`}>
                          {item.locations.map(loc => (
                            <Badge key={loc} variant="outline" className={`${(isShoppingList || isSuggested) ? 'text-[8px] px-1 h-3.5' : 'text-[10px] px-1.5 h-4'} bg-gray-50 border-gray-200`}>{loc}</Badge>
                          ))}
                        </div>
                      ) : item.location ? (
                        <div className={`flex flex-wrap gap-1 ${(isShoppingList || isSuggested) ? 'mt-1' : 'mt-1.5'}`}>
                           <Badge variant="outline" className={`${(isShoppingList || isSuggested) ? 'text-[8px] px-1 h-3.5' : 'text-[10px] px-1.5 h-4'} bg-gray-50 border-gray-200`}>{item.location}</Badge>
                        </div>
                      ) : null}
                      {item.notes && <div className={`${(isShoppingList || isSuggested) ? 'text-[11px] leading-tight' : 'text-xs'} text-gray-500 mt-1 line-clamp-2`} title={item.notes}>{item.notes}</div>}
                    </div>
                    <div className="flex gap-1" style={{ flexShrink: 0 }}>
                      {isSuggested && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-gray-400 hover:text-gray-600" 
                          onClick={(e) => { e.stopPropagation(); handleUpdateItem(item.id!, { isHiddenSuggestion: true }); }}
                          title="Hide from suggestions"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setIsDialogOpen(true); }}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      {!isSuggested && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={(e) => {
                          e.stopPropagation();
                          if (isShoppingList) {
                              handleUpdateItem(item.id!, { shoppingQuantity: 0 });
                          } else {
                              handleDelete(item.id!);
                          }
                        }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {priceInsights && (
                    <div className={`mt-0.5 ${isShoppingList ? 'p-2' : 'p-2.5'} bg-slate-50 border border-slate-100 rounded-lg text-[11px] space-y-1.5`}>
                      <div className="grid grid-cols-2 gap-2 text-slate-600">
                        {priceInsights.lastPurchase && (
                          <div>
                            <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Last</span>
                            <span className="font-medium">${(priceInsights.lastPurchase.price / (priceInsights.lastPurchase.quantity || 1)).toFixed(2)}</span> 
                            <span className="text-slate-400 truncate block max-w-full" title={priceInsights.lastPurchase.store}>@ {priceInsights.lastPurchase.store}</span>
                          </div>
                        )}
                        {priceInsights.p3mLow && (
                          <div>
                             <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">3M Low</span>
                             <span className="font-medium">${(priceInsights.p3mLow.price / (priceInsights.p3mLow.quantity || 1)).toFixed(2)}</span> 
                             <span className="text-slate-400 truncate block max-w-full" title={priceInsights.p3mLow.store}>@ {priceInsights.p3mLow.store}</span>
                          </div>
                        )}
                        {!priceInsights.p3mLow && priceInsights.p12mLow && (
                          <div>
                             <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-semibold">12M Low</span>
                             <span className="font-medium">${(priceInsights.p12mLow.price / (priceInsights.p12mLow.quantity || 1)).toFixed(2)}</span> 
                             <span className="text-slate-400 truncate block max-w-full" title={priceInsights.p12mLow.store}>@ {priceInsights.p12mLow.store}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!isShoppingList && !isSuggested && expandedItems[item.id!] && (item.inventoryEntries || []).length > 0 && (
                    <div className="mt-1 space-y-2 pt-2 border-t border-gray-100">
                       {(item.inventoryEntries || [])
                          .filter(entry => groupBy !== 'location' || (entry.location || 'Unassigned') === group.name || (!entry.location && group.name === 'Unassigned'))
                          .map(entry => (
                         <div key={entry.id} className="flex items-center justify-between p-2 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer rounded-lg border border-gray-100 group" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setFocusedEntryId(entry.id); setIsDialogOpen(true); }}>
                           <div className="min-w-0 flex-1">
                             <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                               <span className="text-[11px] font-bold text-gray-800">
                                   {entry.isOpened && entry.unit === 'pcs' ? 
                                      (entry.amount ? `${entry.quantity} count, ${entry.amount} pcs` : `${entry.quantity} count, 1 pcs`) : 
                                      (entry.amount ? `${entry.quantity} x ${entry.amount} ${entry.unit || item.unit || ''}` : `${entry.quantity} ${entry.unit || item.unit || 'Count'}`)
                                   }
                               </span>
                               <div className="relative inline-flex items-center">
                                 <select 
                                     value={entry.location || ''} 
                                     onChange={(e) => handleMoveEntry(item, entry.id, e.target.value)} 
                                     onClick={(e) => e.stopPropagation()}
                                     className="appearance-none bg-blue-50/50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-medium rounded pl-1.5 pr-4 py-0.5 cursor-pointer focus:ring-0 max-w-[120px] truncate"
                                 >
                                     <option value="" disabled>Move...</option>
                                     {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                                 </select>
                                 <ChevronDown className="w-2.5 h-2.5 text-blue-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                               </div>
                               <Button 
                                 variant={entry.isOpened ? "default" : "outline"} 
                                 size="sm" 
                                 className={`h-5 text-[10px] px-1.5 ${entry.isOpened ? "bg-orange-500 hover:bg-orange-600 text-white" : "text-gray-500 border-gray-300"}`}
                                 onClick={(e) => { e.stopPropagation(); toggleEntryStatus(item, entry.id); }}
                               >
                                 {entry.isOpened ? "Opened" : "Unopened"}
                               </Button>
                             </div>
                             <div className="flex flex-wrap gap-y-1 gap-x-2 mt-1">
                               {entry.expiryDate && (
                                 <span className={`text-[10px] flex items-center gap-0.5 ${new Date(entry.expiryDate) < new Date() ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                                   <span className="font-semibold uppercase text-[9px]">Exp:</span> {entry.expiryDate}
                                 </span>
                               )}
                               {entry.isOpened && (
                                 <span className="text-[10px] text-orange-600 flex items-center gap-0.5">
                                   <span className="font-semibold uppercase text-[9px]">Opened:</span> 
                                   <input 
                                     type="date" 
                                     value={entry.openedDate || ""} 
                                     onChange={(e) => updateEntryOpenedDate(item, entry.id, e.target.value)}
                                     className="bg-transparent border-none p-0 text-[10px] focus:ring-0 w-[85px] h-[18px]"
                                   />
                                   {entry.openedDate && (
                                     <Button variant="ghost" size="icon" className="h-[14px] w-[14px] ml-0.5 text-orange-400 hover:text-orange-600 hover:bg-orange-100/50 p-0" onClick={(e) => { e.stopPropagation(); updateEntryOpenedDate(item, entry.id, ""); }}>
                                       <X className="w-2.5 h-2.5" />
                                     </Button>
                                   )}
                                 </span>
                               )}
                               {entry.tags && entry.tags.length > 0 && (
                                 <div className="flex gap-1">
                                   {entry.tags.map(tag => (
                                     <Badge key={tag} variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-gray-100">{tag}</Badge>
                                   ))}
                                 </div>
                               )}
                             </div>
                           </div>
                           <div className="flex items-center gap-1">
                              <Button variant="outline" size="icon" className="h-6 w-6 text-gray-500 border-gray-300" onClick={(e) => { e.stopPropagation(); updateEntryQuantity(item, entry.id, -1); }} title="Decrease count">
                                 <Minus className="w-3.5 h-3.5" />
                              </Button>
                              <span className="text-sm font-medium w-6 text-center text-gray-800">{entry.isOpened && entry.unit === 'pcs' ? (entry.amount || 0) : entry.quantity}</span>
                              <Button variant="outline" size="icon" className="h-6 w-6 text-gray-500 border-gray-300" onClick={(e) => { e.stopPropagation(); updateEntryQuantity(item, entry.id, 1); }} title="Increase count">
                                 <Plus className="w-3.5 h-3.5" />
                              </Button>
                           </div>
                         </div>
                       ))}
                    </div>
                  )}

                  <div className={`flex items-center justify-between ${isShoppingList ? 'mt-0.5 pt-1' : 'mt-auto pt-2'}`}>
                    {isSuggested ? (
                       <Button variant="secondary" size="sm" className="h-7 text-xs gap-1.5 w-full text-blue-600 bg-blue-50 hover:bg-blue-100" onClick={() => updateQuantities(item, 0, 1)}>
                          <Plus className="w-3 h-3" />
                          Add to Shopping List
                       </Button>
                    ) : isShoppingList ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantities(item, 0, -1)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="text-sm font-medium w-5 text-center">{item.shoppingQuantity} <span className="text-[10px] text-gray-500 font-normal">{item.unit}</span></span>
                          <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQuantities(item, 0, 1)}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <Button size="sm" className="h-7 text-xs gap-1 py-0 px-2.5" onClick={() => handleCheckOff(item)}>
                          <Check className="w-3 h-3" />
                          Got It
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2" onClick={(e) => { if (!expandedItems[item.id!]) { e.stopPropagation(); toggleExpanded(item.id!); } }}>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); updateQuantities(item, -1, 0, groupBy === 'location' ? group.name : undefined); }}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="text-sm font-medium whitespace-nowrap text-center cursor-pointer">{displayInventoryQuantity} <span className="text-xs text-gray-500 font-normal">{item.unit || "count"}{openedPcsText}</span></span>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); updateQuantities(item, 1, 0, groupBy === 'location' ? group.name : undefined); }}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100" onClick={() => updateQuantities(item, 0, 1)}>
                          <ShoppingCart className="w-3.5 h-3.5" />
                          Buy
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signIn();
    } catch (error: any) {
      if (error?.message?.includes('popup') || error?.code?.includes('popup')) {
        setAuthError("Login popup was blocked or closed. Please click 'Sign in' again, allow popups in your browser, or open the app in a new tab to sign in.");
      } else {
        setAuthError(error?.message || "Failed to sign in");
      }
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-gray-50 text-gray-900 rounded-full flex items-center justify-center mx-auto shadow-sm ring-1 ring-gray-900/5">
            <GroceriesIcon className="w-12 h-12" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Shelf Control</h1>
          <p className="text-gray-500">Smart grocery planning and inventory management for your home.</p>
          {authError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">
              {authError}
            </div>
          )}
          <Button onClick={handleSignIn} className="w-full h-12 text-md rounded-xl" size="lg">Sign in with Google</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-2 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center">
                <GroceriesIcon className="w-6 h-6 sm:w-8 sm:h-8 text-gray-900" />
              </div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight hidden sm:block">Shelf Control</h1>
            </div>
            
            <div className="h-6 w-px bg-gray-200 hidden sm:block mx-2"></div>
            
            <div className="flex items-center gap-1.5 sm:gap-2">
              <select 
                className="bg-transparent border border-gray-300 rounded-lg text-sm p-1 sm:p-1.5 focus:ring-blue-500 focus:border-blue-500 font-medium max-w-[140px] sm:max-w-[200px] truncate"
                value={activeListId || ''}
                onChange={(e) => {
                  if (e.target.value === 'new') {
                    createNewList();
                  } else {
                    setActiveListId(e.target.value);
                  }
                }}
              >
                {lists.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
                <option value="new">+ New Household/List...</option>
              </select>
              <Button variant="ghost" size="icon" onClick={copyShareLink} title="Copy share link" className="h-8 w-8 text-blue-600 bg-blue-50 hover:bg-blue-100 flex">
                {copiedLink ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Button variant="default" size="icon" className="h-8 w-8" onClick={() => { setEditingItem(undefined); setIsDialogOpen(true); }} title="Add Item">
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-gray-500" title="Sign out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-2 sm:px-6 lg:px-8 pb-8 pt-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'shopping' | 'inventory' | 'search')} className="w-full">
          <div className="sticky top-14 z-20 bg-gray-50 pt-4 pb-2 mb-4 -mx-2 px-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200/50">
            <TabsList className="grid w-full lg:w-[898px] max-w-full grid-cols-3 bg-gray-200/50 rounded-xl h-auto min-h-[44px] sm:min-h-[42px] p-1 gap-1">
            <TabsTrigger value="shopping" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <ShoppingCart className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Shopping List</span>
              {shoppingItems.length > 0 && <Badge variant="secondary" className="hidden sm:flex ml-2 bg-blue-100 text-blue-700 shrink-0">{shoppingItems.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="inventory" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <Box className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Pantry Inventory</span>
            </TabsTrigger>
            <TabsTrigger value="search" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <LineChart className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Item Search</span>
            </TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="shopping" className="focus-visible:outline-none space-y-12">
            {renderControls()}
            <div>
               <h2 className="sr-only">To Buy</h2>
               {renderGroupedItems(shoppingItems, true)}
            </div>
            {suggestedItems.length > 0 && (
              <div className="pt-8 border-t border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-500 flex items-center gap-2">
                     <Box className="w-5 h-5" />
                     Suggested (Out of Stock)
                  </h2>
                </div>
                {renderGroupedItems(suggestedItems, false, true)}
              </div>
            )}
          </TabsContent>
          <TabsContent value="inventory" className="focus-visible:outline-none">
            {items.filter(item => (item.unprocessedQuantity || 0) > 0).length > 0 && (
              <div className="bg-orange-50/50 border border-orange-200 rounded-xl p-3 sm:p-5 mb-6 sm:mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
                <h3 className="font-semibold text-base sm:text-lg text-orange-900 mb-3 sm:mb-4 flex items-center gap-2">
                  <Box className="w-5 h-5 text-orange-600" />
                  Action Required: To Be Processed
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {items.filter(item => (item.unprocessedQuantity || 0) > 0).map(item => (
                    <div key={`unprocessed-global-${item.id}`} className="bg-white p-3 sm:p-4 rounded-xl shadow-sm ring-1 ring-orange-900/10 flex flex-col gap-2 sm:gap-3">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</div>
                          <div className="text-sm text-orange-700 font-medium mt-1">
                            {item.unprocessedQuantity} {item.unit} pending
                          </div>
                        </div>
                        <Button size="sm" onClick={() => { setEditingItem(item); setIsDialogOpen(true); }} className="bg-orange-600 hover:bg-orange-700 text-white shrink-0">
                          Process
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {renderControls()}
            {renderInventoryItems()}
          </TabsContent>
          <TabsContent value="search" className="focus-visible:outline-none space-y-4 pt-2">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input 
                type="text" 
                placeholder="Search items by name, category..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-12 text-lg shadow-sm"
              />
            </div>
            {renderInventoryItems(searchQuery)}
          </TabsContent>
        </Tabs>
      </main>

      <ItemDialog 
        isOpen={isDialogOpen} 
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setFocusedEntryId(null);
          }
        }}
        onSave={handleSaveItem} 
        item={editingItem}
        existingItems={items}
        locations={locations}
        title={editingItem ? "Edit Item" : "Add New Item"}
        defaultMode={activeTab === 'shopping' ? 'shopping' : 'inventory'}
        focusedEntryId={focusedEntryId}
      />

      <MoveEntryDialog 
        isOpen={!!moveDialogState}
        onOpenChange={(open) => { if (!open) setMoveDialogState(null); }}
        item={moveDialogState?.item || null}
        entryId={moveDialogState?.entryId || null}
        newLocation={moveDialogState?.newLocation || null}
        onConfirm={(quantity) => {
           if (moveDialogState) {
               executeMoveEntry(moveDialogState.item, moveDialogState.entryId, moveDialogState.newLocation, quantity);
           }
        }}
      />
      
      <CheckOffDialog
        open={!!checkingOffItem}
        onOpenChange={(open) => { if (!open) setCheckingOffItem(undefined); }}
        item={checkingOffItem}
        onConfirm={confirmCheckOff}
      />
      <datalist id="units-list">
        <option value="g" />
        <option value="kg" />
        <option value="mL" />
        <option value="L" />
        <option value="lb" />
      </datalist>
      <datalist id="stores-list">
        {stores.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
