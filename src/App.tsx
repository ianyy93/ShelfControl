import { motion, AnimatePresence } from "motion/react";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { auth, db, signIn, signOut, handleFirestoreError, getUserProfiles, syncUserProfile } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, onSnapshot, query, addDoc, serverTimestamp, doc, deleteDoc, updateDoc, where, getDoc, arrayUnion, setDoc, arrayRemove } from "firebase/firestore";
import { GroceryItem, GroceryList, CATEGORIES, InventoryEntry, PRESET_LOCATIONS, PriceEntry, Category } from "./types";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Plus, LogOut, Trash2, Edit, ShoppingCart, Check, Minus, Users, Link as LinkIcon, LineChart, Box, ChevronRight, ChevronDown, EyeOff, X, Search, RotateCcw, Cog, AlertTriangle } from "lucide-react";
import { GroceriesIcon } from "./components/GroceriesIcon";
import { MoveEntryDialog } from "./components/MoveEntryDialog";
import { removeUndefined } from "./lib/utils";
import { ItemDialog } from "./components/ItemDialog";
import { CheckOffDialog } from "./components/CheckOffDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ReceiptScanDialog } from "./components/ReceiptScanDialog";
import { Sparkles, Receipt, GitMerge } from "lucide-react";
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
  
  const [memberProfiles, setMemberProfiles] = useState<Record<string, { displayName: string, email: string, photoURL?: string }>>({});
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>('All');

  useEffect(() => {
    const fetchMembers = async () => {
      if (!user) return;
      const currentList = lists.find(l => l.id === activeListId);
      if (currentList?.members && currentList.members.length > 0) {
        setLoadingProfiles(true);
        try {
          const profiles = await getUserProfiles(currentList.members);
          setMemberProfiles(profiles);
        } catch (e) {
          console.error("Error fetching member profiles:", e);
        } finally {
          setLoadingProfiles(false);
        }
      }
    };
    fetchMembers();
  }, [activeListId, lists, user]);

  const [newListName, setNewListName] = useState("");
  
  useEffect(() => {
    const currentList = lists.find(l => l.id === activeListId);
    if (isSettingsOpen && currentList) {
      setNewListName(currentList.name);
    }
  }, [isSettingsOpen, activeListId, lists]);

  const handleRenameList = async () => {
    if (!activeListId || !newListName.trim()) return;
    try {
      await updateDoc(doc(db, "lists", activeListId), {
        name: newListName.trim()
      });
    } catch (e) {
      console.error("Error renaming list:", e);
    }
  };

  const handleKickMember = async (memberId: string) => {
    if (!activeListId) return;
    try {
      await updateDoc(doc(db, "lists", activeListId), {
        members: arrayRemove(memberId)
      });
      setMemberProfiles(prev => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
    } catch (e) {
      console.error("Error kicking member:", e);
    }
  };

  const handleLeaveList = async () => {
    if (!activeListId || !user) return;
    try {
      await updateDoc(doc(db, "lists", activeListId), {
        members: arrayRemove(user.uid)
      });
      setIsSettingsOpen(false);
      const remainingLists = lists.filter(l => l.id !== activeListId);
      if (remainingLists.length > 0) {
        setActiveListId(remainingLists[0].id!);
      } else {
        setActiveListId(null);
      }
    } catch (e) {
      console.error("Error leaving list:", e);
    }
  };
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isScanDialogOpen, setIsScanDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | undefined>();
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const [focusedPriceId, setFocusedPriceId] = useState<string | null>(null);
  const [checkingOffItem, setCheckingOffItem] = useState<GroceryItem | undefined>();

  const [lastAction, setLastAction] = useState<{
    type: 'delete' | 'update' | 'create';
    itemId: string;
    itemData: GroceryItem;
    description: string;
  } | null>(null);

  const handleUndo = async () => {
    if (!lastAction || !activeListId) return;
    const action = lastAction;
    setLastAction(null);
    try {
      if (action.type === 'delete') {
        const { id, createdAt, updatedAt, ...dataToRestore } = action.itemData;
        await setDoc(doc(db, "lists", activeListId, "items", action.itemId), removeUndefined({
          ...dataToRestore,
          createdAt: createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp()
        }));
      } else if (action.type === 'update') {
        const { id, createdAt, updatedAt, ...dataToRestore } = action.itemData;
        await updateDoc(doc(db, "lists", activeListId, "items", action.itemId), removeUndefined({
          ...dataToRestore,
          updatedAt: serverTimestamp()
        }));
      } else if (action.type === 'create') {
        await deleteDoc(doc(db, "lists", activeListId, "items", action.itemId));
      }
    } catch (error) {
      console.error("Failed to undo action:", error);
    }
  };

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

  const [batchModeGroup, setBatchModeGroup] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState<Record<string, boolean>>({});

  // Read once on mount — URL params don't change after initial load
  const joinIdRef = useRef(new URLSearchParams(window.location.search).get('join'));
  const joinId = joinIdRef.current;

  useEffect(() => {
    setBatchModeGroup(null);
    setBatchSelected({});
  }, [groupBy, activeTab]);

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

  const duplicates = useMemo(() => {
    const nameMap = new Map<string, GroceryItem[]>();
    items.forEach(item => {
      if (item.isHiddenSuggestion) return;
      const key = item.name.toLowerCase().trim();
      if (!nameMap.has(key)) {
        nameMap.set(key, []);
      }
      nameMap.get(key)!.push(item);
    });
    
    const dupList: { name: string; items: GroceryItem[] }[] = [];
    nameMap.forEach((matchedItems, name) => {
      if (matchedItems.length > 1) {
        const displayName = matchedItems.find(i => i.name)?.name || name;
        dupList.push({ name: displayName, items: matchedItems });
      }
    });
    return dupList;
  }, [items]);

  useEffect(() => {
    console.log("onAuthStateChanged listener attached");
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth state changed:", currentUser ? `Logged in as ${currentUser.uid}` : "Logged out");
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        syncUserProfile(currentUser);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
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
      const dbLists: GroceryList[] = [];
      snapshot.forEach((doc) => {
        dbLists.push({ id: doc.id, ...doc.data() } as GroceryList);
      });
      setLists(dbLists);
      
      if (dbLists.length === 0) {
        // Only create an initial list if there's no ?join= parameter in the URL
        if (!joinId) {
          addDoc(collection(db, "lists"), {
            name: "My List",
            ownerId: user.uid,
            members: [user.uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }).catch(e => console.error("Error creating initial list", e));
        }
      } else if (!activeListId || !dbLists.find(l => l.id === activeListId)) {
        // If we have a join parameter, let the join effect handle setActiveListId
        if (!joinId) {
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

  const handleSaveItem = async (data: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'>, processQuantity?: number, editedPriceEntry?: PriceEntry, deletedPriceEntryId?: string }) => {
    if (!user || !activeListId) return;
    console.log("Saving Item with data:", data);
    const { newPriceEntry, processQuantity, editedPriceEntry, deletedPriceEntryId, ...updatedFields } = data;
    
    try {
      if (editingItem?.id) {
        const originalItem = items.find(i => i.id === editingItem.id);
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
            id: crypto.randomUUID()
          }) as unknown as PriceEntry[];
        } else if (editedPriceEntry) {
          if (editingItem.priceHistory) {
              updateData.priceHistory = editingItem.priceHistory.map(e => e.id === editedPriceEntry.id ? editedPriceEntry : e);
          }
        } else if (deletedPriceEntryId) {
          if (editingItem.priceHistory) {
              updateData.priceHistory = editingItem.priceHistory.filter(e => e.id !== deletedPriceEntryId);
          }
        }

        const existingMatch = items.find(i => 
          i.id !== editingItem.id && 
          i.name.toLowerCase().trim() === updatedFields.name?.toLowerCase().trim()
        );

        if (existingMatch && existingMatch.id) {
          const combinedEntries = [...(existingMatch.inventoryEntries || []), ...(updatedFields.inventoryEntries || editingItem.inventoryEntries || [])];
          const combinedLocs = Array.from(new Set(combinedEntries.map(e => e.location).filter(Boolean)));
          
          const combinedPriceHistory = [...(existingMatch.priceHistory || []), ...(editingItem.priceHistory || [])];
          if (newPriceEntry) {
            combinedPriceHistory.push({
              ...newPriceEntry,
              id: crypto.randomUUID()
            });
          } else if (editedPriceEntry) {
            const index = combinedPriceHistory.findIndex(e => e.id === editedPriceEntry.id);
            if (index !== -1) {
              combinedPriceHistory[index] = editedPriceEntry;
            } else {
              combinedPriceHistory.push(editedPriceEntry);
            }
          } else if (deletedPriceEntryId) {
            const filtered = combinedPriceHistory.filter(e => e.id !== deletedPriceEntryId);
            combinedPriceHistory.length = 0;
            combinedPriceHistory.push(...filtered);
          }

          const combinedUnprocessed = (existingMatch.unprocessedQuantity || 0) + 
            (processQuantity !== undefined ? Math.max(0, (editingItem.unprocessedQuantity || 0) - processQuantity) : (editingItem.unprocessedQuantity || 0));

          const mergeUpdate: Partial<GroceryItem> = {
            category: updatedFields.category || existingMatch.category,
            shoppingQuantity: (existingMatch.shoppingQuantity || 0) + (updatedFields.shoppingQuantity !== undefined ? Number(updatedFields.shoppingQuantity) : (editingItem.shoppingQuantity || 0)),
            inventoryQuantity: combinedEntries.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0),
            inventoryEntries: combinedEntries,
            locations: combinedLocs,
            notes: [existingMatch.notes, updatedFields.notes || editingItem.notes].filter(Boolean).join("\n"),
            unit: updatedFields.unit || existingMatch.unit || editingItem.unit,
            priceHistory: combinedPriceHistory,
            unprocessedQuantity: combinedUnprocessed > 0 ? combinedUnprocessed : undefined,
            isHiddenSuggestion: false,
            updatedAt: serverTimestamp()
          };

          await updateDoc(doc(db, "lists", activeListId, "items", existingMatch.id), removeUndefined(mergeUpdate));
          await deleteDoc(doc(db, "lists", activeListId, "items", editingItem.id));
          
          if (originalItem) {
            setLastAction({
              type: 'update',
              itemId: existingMatch.id,
              itemData: originalItem,
              description: `Merged "${editingItem.name}" into "${existingMatch.name}"`
            });
          }
        } else {
          await updateDoc(doc(db, "lists", activeListId, "items", editingItem.id), removeUndefined(updateData));
          if (originalItem) {
            setLastAction({
              type: 'update',
              itemId: editingItem.id,
              itemData: originalItem,
              description: `Saved "${editingItem.name}"`
            });
          }
        }
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
               id: crypto.randomUUID()
             }) as unknown as PriceEntry[];
           }

           await updateDoc(doc(db, "lists", activeListId, "items", existingMatch.id), removeUndefined(updateData));
           setLastAction({
             type: 'update',
             itemId: existingMatch.id,
             itemData: existingMatch,
             description: `Merged "${updatedFields.name}"`
           });
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
               id: crypto.randomUUID()
             }];
           }

           const docRef = await addDoc(collection(db, "lists", activeListId, "items"), removeUndefined(newItem) as GroceryItem);
           setLastAction({
             type: 'create',
             itemId: docRef.id,
             itemData: { ...newItem, id: docRef.id } as GroceryItem,
             description: `Added "${newItem.name}"`
           });
        }
      }
      setIsDialogOpen(false);
      setEditingItem(undefined);
    } catch (error) {
      console.error("Error saving item:", error);
      handleFirestoreError(error, editingItem?.id ? 'update' : 'create', `lists/${activeListId}/items`);
    }
  };

  const handleMergeDuplicate = async (dupName: string, duplicateList: GroceryItem[]) => {
    if (!user || !activeListId || duplicateList.length < 2) return;
    
    const target = duplicateList[0];
    const sourceItems = duplicateList.slice(1);
    
    try {
      const mergedEntries = duplicateList.flatMap(i => i.inventoryEntries || []);
      const mergedInventoryQuantity = mergedEntries.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
      const mergedShoppingQuantity = duplicateList.reduce((sum, i) => sum + (Number(i.shoppingQuantity) || 0), 0);
      const mergedLocs = Array.from(new Set(mergedEntries.map(e => e.location).filter(Boolean)));
      const mergedNotes = duplicateList.map(i => i.notes?.trim()).filter(Boolean).join("\n");
      const mergedPriceHistory = duplicateList.flatMap(i => i.priceHistory || []);
      const mergedUnprocessed = duplicateList.reduce((sum, i) => sum + (Number(i.unprocessedQuantity) || 0), 0);
      
      const mergedData: Partial<GroceryItem> = {
        inventoryEntries: mergedEntries,
        inventoryQuantity: mergedInventoryQuantity,
        shoppingQuantity: mergedShoppingQuantity,
        locations: mergedLocs,
        notes: mergedNotes,
        priceHistory: mergedPriceHistory,
        unprocessedQuantity: mergedUnprocessed > 0 ? mergedUnprocessed : undefined,
        updatedAt: serverTimestamp()
      };
      
      await updateDoc(doc(db, "lists", activeListId, "items", target.id!), removeUndefined(mergedData));
      
      for (const source of sourceItems) {
        await deleteDoc(doc(db, "lists", activeListId, "items", source.id!));
      }
      
      setLastAction({
        type: 'update',
        itemId: target.id!,
        itemData: target,
        description: `Successfully merged all duplicate entries of "${dupName}"`
      });
    } catch (error) {
      console.error("Error merging duplicate items:", error);
      alert("Failed to merge duplicate items.");
    }
  };

  const handleImportReceipt = async (scannedItems: Array<{
    name: string;
    quantity: number;
    category: Category;
    unit: string;
    price?: number;
    store?: string;
    dateBought?: string;
  }>) => {
    if (!user || !activeListId) return;

    const promises = scannedItems.map(async (scanned) => {
      const trimmedName = scanned.name.trim();
      const existingMatch = items.find(i => i.name.toLowerCase().trim() === trimmedName.toLowerCase());

      const todayStr = new Date().toISOString().split('T')[0];
      const purchaseDate = scanned.dateBought || todayStr;

      const entryId = crypto.randomUUID();
      const newEntry: InventoryEntry = {
        id: entryId,
        location: "", // Unassigned location as requested!
        quantity: scanned.quantity,
        unit: scanned.unit || "",
        dateBought: purchaseDate,
        dateAdded: todayStr
      };

      if (existingMatch && existingMatch.id) {
        const updatedEntries = [...(existingMatch.inventoryEntries || []), newEntry];
        const updatedLocations = Array.from(new Set(updatedEntries.map(e => e.location).filter(Boolean)));
        
        const updateData: any = {
          inventoryQuantity: (existingMatch.inventoryQuantity || 0) + scanned.quantity,
          inventoryEntries: updatedEntries,
          locations: updatedLocations,
          updatedAt: serverTimestamp()
        };

        if (scanned.price !== undefined && scanned.store) {
          const newPriceEntry: PriceEntry = {
            id: crypto.randomUUID(),
            store: scanned.store,
            date: purchaseDate,
            price: scanned.price,
            quantity: scanned.quantity,
            unitStr: scanned.unit || ""
          };
          updateData.priceHistory = arrayUnion(newPriceEntry);
        }

        await updateDoc(doc(db, "lists", activeListId, "items", existingMatch.id), removeUndefined(updateData));
      } else {
        const newItem: Partial<GroceryItem> = {
          name: trimmedName,
          category: scanned.category,
          inventoryQuantity: scanned.quantity,
          shoppingQuantity: 0,
          inventoryEntries: [newEntry],
          locations: [],
          location: "",
          unit: scanned.unit || "",
          notes: `Imported via Gemini Receipt Scan on ${purchaseDate}`,
          listId: activeListId,
          creatorId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        if (scanned.price !== undefined && scanned.store) {
          newItem.priceHistory = [{
            id: crypto.randomUUID(),
            store: scanned.store,
            date: purchaseDate,
            price: scanned.price,
            quantity: scanned.quantity,
            unitStr: scanned.unit || ""
          }];
        }

        await addDoc(collection(db, "lists", activeListId, "items"), removeUndefined(newItem) as GroceryItem);
      }
    });

    await Promise.all(promises);
  };

  const handleDelete = async (itemId: string) => {
    if (!user || !activeListId) return;
    const originalItem = items.find(i => i.id === itemId);
    if (!originalItem) return;
    try {
      await deleteDoc(doc(db, "lists", activeListId, "items", itemId));
      setLastAction({
        type: 'delete',
        itemId,
        itemData: originalItem,
        description: `Deleted "${originalItem.name}"`
      });
    } catch (error) {
      console.error("Error deleting item:", error);
      handleFirestoreError(error, 'delete', `lists/${activeListId}/items/${itemId}`);
    }
  };

  const updateQuantities = async (item: GroceryItem, invDelta: number, shopDelta: number, locationTrigger?: string) => {
    if (!user || !activeListId || !item.id) return;
    const itemBefore = JSON.parse(JSON.stringify(item));
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
          id: crypto.randomUUID(),
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
      setLastAction({
        type: 'update',
        itemId: item.id,
        itemData: itemBefore,
        description: `Updated quantity of "${item.name}"`
      });
    } catch (error) {
      console.error("Error updating quantities:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const handleUpdateItem = async (itemId: string, fields: Partial<GroceryItem>) => {
    if (!user || !activeListId) return;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const itemBefore = JSON.parse(JSON.stringify(item));
    try {
      const updateData: any = {
        ...fields,
        updatedAt: serverTimestamp()
      };
      
      if (fields.shoppingQuantity !== undefined && fields.shoppingQuantity > 0) {
        updateData.isHiddenSuggestion = false;
      }

      await updateDoc(doc(db, "lists", activeListId, "items", itemId), removeUndefined(updateData));
      setLastAction({
        type: 'update',
        itemId,
        itemData: itemBefore,
        description: `Updated "${itemBefore.name}"`
      });
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
    const itemBefore = JSON.parse(JSON.stringify(item));
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
            id: crypto.randomUUID()
          });
        }

        await updateDoc(doc(db, "lists", activeListId, "items", item.id), removeUndefined(updateData));
        setLastAction({
          type: 'update',
          itemId: item.id,
          itemData: itemBefore,
          description: `Checked off "${item.name}"`
        });
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
    const itemBefore = JSON.parse(JSON.stringify(item));
    
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
                newEntries.push({ ...restE, id: "temp-" + crypto.randomUUID(), quantity: quantityToMove, location: newLocation, isOpened: false });
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
      setLastAction({
        type: 'update',
        itemId: item.id,
        itemData: itemBefore,
        description: `Moved "${item.name}" to ${newLocation || 'Unassigned'}`
      });
    } catch (error) {
      console.error("Error moving entry:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const handleBatchMove = async (sourceLocation: string, targetLocation: string) => {
    if (!user || !activeListId) return;
    
    const itemsToUpdate = items.filter(item => {
      const relevant = (item.inventoryEntries || []).filter(e => (e.location || 'Unassigned') === sourceLocation || (!e.location && sourceLocation === 'Unassigned'));
      return relevant.some(e => batchSelected[`${item.id}_${e.id}`]);
    });

    if (itemsToUpdate.length === 0) return;

    try {
      const targetLocValue = targetLocation === 'Unassigned' ? '' : targetLocation;
      const promises = itemsToUpdate.map(async (item) => {
        const newEntries = (item.inventoryEntries || []).map(e => {
          const isSelected = batchSelected[`${item.id}_${e.id}`];
          if (isSelected) {
            return { ...e, location: targetLocValue };
          }
          return e;
        });

        const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));
        
        await updateDoc(doc(db, "lists", activeListId, "items", item.id!), removeUndefined({
          inventoryEntries: newEntries,
          locations: newLocs,
          updatedAt: serverTimestamp()
        }));
      });

      await Promise.all(promises);
      
      setBatchModeGroup(null);
      setBatchSelected({});
    } catch (error) {
      console.error("Error executing batch move:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items-batch`);
    }
  };

  const updateEntryQuantity = async (item: GroceryItem, entryId: string, delta: number) => {
    if (!user || !activeListId || !item.id) return;
    const itemBefore = JSON.parse(JSON.stringify(item));
    
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
      setLastAction({
        type: 'update',
        itemId: item.id,
        itemData: itemBefore,
        description: `Updated entry quantity of "${item.name}"`
      });
    } catch (error) {
      console.error("Error updating entry quantity:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const toggleEntryStatus = async (item: GroceryItem, entryId: string) => {
    if (!user || !activeListId || !item.id) return;
    const itemBefore = JSON.parse(JSON.stringify(item));
    
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
                    id: "temp-" + crypto.randomUUID(), 
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
      setLastAction({
        type: 'update',
        itemId: item.id,
        itemData: itemBefore,
        description: `Toggled state of "${item.name}"`
      });
    } catch (error) {
      console.error("Error toggling status:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const updateEntryOpenedDate = async (item: GroceryItem, entryId: string, date: string) => {
    if (!user || !activeListId || !item.id) return;
    const itemBefore = JSON.parse(JSON.stringify(item));
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
      setLastAction({
        type: 'update',
        itemId: item.id,
        itemData: itemBefore,
        description: `Updated opened date of "${item.name}"`
      });
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
  
  const [isSharePanelOpen, setIsSharePanelOpen] = useState(false);
  const [copiedHousehold, setCopiedHousehold] = useState(false);
  const [copiedApp, setCopiedApp] = useState(false);

  const getShareUrl = (includeJoin: boolean) => {
    const url = new URL(window.location.href);
    // AI Studio dev-to-pre URL rewrite (keep existing logic)
    if (url.hostname.includes('ais-dev-')) {
      url.hostname = url.hostname.replace('ais-dev-', 'ais-pre-');
    }
    url.search = '';  // clear all params
    if (includeJoin && activeListId) {
      url.searchParams.set('join', activeListId);
    }
    return url.toString();
  };
  const copyHouseholdLink = () => {
    navigator.clipboard.writeText(getShareUrl(true));
    setCopiedHousehold(true);
    setTimeout(() => setCopiedHousehold(false), 2000);
  };
  const copyAppLink = () => {
    navigator.clipboard.writeText(getShareUrl(false));
    setCopiedApp(true);
    setTimeout(() => setCopiedApp(false), 2000);
  };

  const getExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return 'none';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryDate + 'T00:00:00');
    const diffTime = exp.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'expired';
    if (diffDays <= 3) return 'soon';
    return 'safe';
  };

  const expiredOrSoonItems = useMemo(() => {
    return items.filter(item => {
      return (item.inventoryEntries || []).some(entry => {
        const status = getExpiryStatus(entry.expiryDate);
        return status === 'expired' || status === 'soon';
      });
    });
  }, [items]);

  const replenishmentSuggestions = useMemo(() => {
    const suggestions: { item: GroceryItem; meanInterval: number; daysSince: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    items.forEach(item => {
      if (item.inventoryQuantity > 0 || item.shoppingQuantity > 0 || item.unprocessedQuantity) return;
      if (item.isHiddenSuggestion) return;

      const history = item.priceHistory || [];
      if (history.length < 2) return;

      const dates = Array.from(new Set(history.map(p => p.date)))
        .map(dStr => new Date(dStr + 'T00:00:00'))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());

      if (dates.length < 2) return;

      let totalDays = 0;
      for (let i = 0; i < dates.length - 1; i++) {
        const diffTime = dates[i + 1].getTime() - dates[i].getTime();
        totalDays += diffTime / (1000 * 60 * 60 * 24);
      }
      const meanInterval = totalDays / (dates.length - 1);
      if (meanInterval <= 0) return;

      const lastPurchaseDate = dates[dates.length - 1];
      const diffSince = today.getTime() - lastPurchaseDate.getTime();
      const daysSinceLastPurchase = diffSince / (1000 * 60 * 60 * 24);

      if (daysSinceLastPurchase >= meanInterval * 0.9) {
        suggestions.push({
          item,
          meanInterval: Math.round(meanInterval),
          daysSince: Math.round(daysSinceLastPurchase)
        });
      }
    });

    return suggestions;
  }, [items]);

  const inventoryItems = useMemo(() => items, [items]);
  const shoppingItems = useMemo(() => {
    return items.filter(i => {
      if (i.shoppingQuantity <= 0) return false;
      if (selectedStoreFilter !== 'All' && i.shoppingStore !== selectedStoreFilter) return false;
      return true;
    });
  }, [items, selectedStoreFilter]);
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
          {activeTab === 'shopping' && (
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider hidden lg:inline">Store:</span>
              <select
                value={selectedStoreFilter}
                onChange={(e) => setSelectedStoreFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-xs rounded-lg p-1.5 font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[110px] sm:max-w-[150px]"
              >
                <option value="All">All Stores</option>
                {stores.map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          )}
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
        if (item.inventoryQuantity === 0) {
          if (!g['Out of Stock']) g['Out of Stock'] = [];
          g['Out of Stock'].push(item);
          return;
        }
        
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
      groups = Object.keys(g).sort((a, b) => {
        if (a === 'Out of Stock') return 1;
        if (b === 'Out of Stock') return -1;
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b);
      }).map(k => ({ name: k, items: g[k] }));
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
              if (group.name === 'Out of Stock') {
                  relevantEntries = [];
                  displayInventoryQuantity = 0;
              } else {
                  relevantEntries = relevantEntries.filter(e => (e.location || 'Unassigned') === group.name || (!e.location && group.name === 'Unassigned'));
                  displayInventoryQuantity = relevantEntries.reduce((sum, e) => sum + e.quantity, 0);
                  // Special case if there are no entries at all
                  if (!item.inventoryEntries || item.inventoryEntries.length === 0) {
                      displayInventoryQuantity = item.inventoryQuantity;
                  }
              }
          }
          
          const openedPcsEntries = relevantEntries.filter(e => e.isOpened && e.unit === 'pcs');
          let openedPcsText = "";
          if (openedPcsEntries.length > 0) {
              const totalPcs = openedPcsEntries.reduce((sum, e) => sum + (e.amount || 0), 0);
              openedPcsText = `, ${totalPcs} pcs`;
          }

          const isThisGroupBatch = batchModeGroup === group.name;
          const itemRelevantEntries = (item.inventoryEntries || []).filter(e => (e.location || 'Unassigned') === group.name || (!e.location && group.name === 'Unassigned'));
          const isSelected = itemRelevantEntries.length > 0 && itemRelevantEntries.every(e => batchSelected[`${item.id}_${e.id}`]);
          
          const handleCardClick = (e: React.MouseEvent) => {
            if (isThisGroupBatch) {
              e.stopPropagation();
              const newSelected = { ...batchSelected };
              itemRelevantEntries.forEach(entry => {
                newSelected[`${item.id}_${entry.id}`] = !isSelected;
              });
              setBatchSelected(newSelected);
            } else {
              toggleExpanded(item.id!);
            }
          };

          const hasExpiredEntry = (item.inventoryEntries || []).some(e => getExpiryStatus(e.expiryDate) === 'expired');
          const hasSoonEntry = !hasExpiredEntry && (item.inventoryEntries || []).some(e => getExpiryStatus(e.expiryDate) === 'soon');
          
          let cardBgBorderClass = 'bg-white ring-gray-900/5';
          if (hasExpiredEntry) {
            cardBgBorderClass = 'bg-red-50/70 border border-red-200 ring-red-200';
          } else if (hasSoonEntry) {
            cardBgBorderClass = 'bg-amber-50/70 border border-amber-200 ring-amber-200';
          }

          return (
          <div key={`${group.name}-${item.id}`} onClick={handleCardClick} className={`p-3 sm:p-4 rounded-xl shadow-sm ring-1 flex flex-col gap-2 sm:gap-3 cursor-pointer hover:shadow-md transition-all duration-200 ${isThisGroupBatch ? (isSelected ? 'ring-blue-500 bg-blue-50/20' : 'ring-gray-200 hover:ring-blue-300') : cardBgBorderClass}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                {isThisGroupBatch && (
                  <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      checked={isSelected}
                      onChange={() => {
                        const newSelected = { ...batchSelected };
                        itemRelevantEntries.forEach(entry => {
                          newSelected[`${item.id}_${entry.id}`] = !isSelected;
                        });
                        setBatchSelected(newSelected);
                      }}
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</div>
                    {hasExpiredEntry && (
                      <Badge className="text-[9px] px-1.5 py-0 h-4 bg-red-600 text-white border-none font-bold shadow-sm">
                        EXPIRED
                      </Badge>
                    )}
                    {hasSoonEntry && (
                      <Badge className="text-[9px] px-1.5 py-0 h-4 bg-amber-500 text-white border-none font-bold shadow-sm">
                        EXPIRING SOON
                      </Badge>
                    )}
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
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {isThisGroupBatch ? (
                  <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-md border border-blue-100/60 mt-1">
                    {displayInventoryQuantity} {item.unit || "ct"}
                  </span>
                ) : (
                  <div className="flex items-center gap-2" onClick={(e) => { if (!expandedItems[item.id!]) { e.stopPropagation(); toggleExpanded(item.id!); } }}>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); updateQuantities(item, -1, 0, effectiveGroupBy === 'location' ? group.name : undefined); }}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="text-lg font-bold text-gray-900 text-center min-w-[2rem]">
                      {displayInventoryQuantity} <span className="text-[10px] text-gray-500 font-normal block -mt-1">{item.unit || "ct"}{openedPcsText}</span>
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); updateQuantities(item, 1, 0, effectiveGroupBy === 'location' ? group.name : undefined); }}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {item.shoppingQuantity > 0 && <span className="text-xs text-blue-600 font-medium">+{item.shoppingQuantity} {item.unit || ""} to buy</span>}
                {!isThisGroupBatch && (
                  <div className="flex gap-1 mt-1 -mr-2">
                    <Button variant="ghost" size="icon" className="h-10 w-10 text-gray-400 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setIsDialogOpen(true); }}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-10 w-10 text-red-400 hover:text-red-700" onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item.id!);
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            
            {!isThisGroupBatch && expandedItems[item.id!] && item.inventoryEntries && item.inventoryEntries.length > 0 && (
              <div className="bg-gray-50/50 rounded-lg text-xs mt-3 border border-gray-100 divide-y divide-gray-100" onClick={e => e.stopPropagation()}>
                 {item.inventoryEntries
                    .filter(entry => effectiveGroupBy !== 'location' || (entry.location || 'Unassigned') === group.name || (!entry.location && group.name === 'Unassigned'))
                    .map(entry => (
                    <div key={entry.id} className="p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-gray-100 transition-colors cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setFocusedEntryId(entry.id); setIsDialogOpen(true); }}>
                      <div className="flex flex-col gap-0.5 min-w-0 w-full sm:w-auto flex-1">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-1.5 border-l-2 border-gray-300">
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
                          <div className="relative flex items-center pl-2 mt-0.5" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] text-orange-600">
                              Opened {entry.openedDate || "yyyy-mm-dd"}
                            </span>
                            <input 
                              type="date" 
                              value={entry.openedDate || ""} 
                              onChange={(e) => updateEntryOpenedDate(item, entry.id, e.target.value)}
                              className="absolute inset-0 w-[100px] h-full opacity-0 cursor-pointer"
                            />
                            {entry.openedDate && (
                              <Button variant="ghost" size="icon" className="relative z-10 h-[14px] w-[14px] flex-shrink-0 text-orange-400 hover:text-orange-600 hover:bg-orange-100/50 p-0 ml-1" onClick={(e) => { e.stopPropagation(); updateEntryOpenedDate(item, entry.id, ""); }}>
                                <X className="w-2.5 h-2.5" />
                              </Button>
                            )}
                          </div>
                       )}
                       {entry.tags && entry.tags.length > 0 && (
                         <div className="flex flex-wrap gap-1 pl-2 mt-0.5">
                           {entry.tags.map(tag => (
                             <Badge key={tag} variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-gray-100">{tag}</Badge>
                           ))}
                         </div>
                       )}
                     </div>
                     <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto sm:ml-2">
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

            {!isThisGroupBatch && expandedItems[item.id!] && (
              <div className="bg-blue-50/30 rounded-lg text-xs mt-3 border border-blue-100" onClick={e => e.stopPropagation()}>
                <div className="p-2 border-b border-blue-100 font-semibold text-blue-800 uppercase tracking-wider text-[10px] flex items-center justify-between bg-blue-50/50 rounded-t-lg">
                   <span>Price History</span>
                   <Button variant="ghost" size="icon" className="h-5 w-5 text-blue-600 hover:text-blue-800 hover:bg-blue-100" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setFocusedPriceId('new'); setIsDialogOpen(true); }}>
                     <Plus className="w-3 h-3" />
                   </Button>
                </div>
                
                {(!item.priceHistory || item.priceHistory.length === 0) ? (
                   <div className="p-3 text-center text-gray-500 text-[10px] italic">
                     No price history available.
                   </div>
                ) : (
                  <>
                    {item.priceHistory.length > 1 && (
                      <div className="h-32 w-full p-2 pb-0">
                          <ResponsiveContainer width="100%" height="100%">
                              <RechartsLineChart data={[...item.priceHistory].sort((a, b) => a.date.localeCompare(b.date)).map(e => ({
                                  date: new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                                  unitPrice: Number((e.isDiscount && e.dealPrice && e.dealQuantity ? Number(e.dealPrice) / Number(e.dealQuantity) : Number(e.price) / (Number(e.quantity) || 1)).toFixed(2))
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
                        {[...item.priceHistory].sort((a, b) => b.date.localeCompare(a.date)).map(entry => (
                           <div key={entry.id} className="p-2 flex justify-between items-center bg-white hover:bg-gray-50 transition-colors cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setFocusedPriceId(entry.id); setIsDialogOpen(true); }}>
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
                </>
              )}
            </div>
          )}

            {!isThisGroupBatch && expandedItems[item.id!] && item.notes && <div className="text-xs text-gray-500 mt-1 line-clamp-2 italic border-t pt-2" title={item.notes}>{item.notes}</div>}
          </div>
        );
        })}
      </div>
      );

      let batchToolbar = null;
      if (effectiveGroupBy === 'location' && group.name !== 'Out of Stock') {
        const isThisGroupBatch = batchModeGroup === group.name;
        
        // Find all inventory entries in this group
        const groupEntries: { itemId: string; entryId: string }[] = [];
        group.items.forEach(item => {
          (item.inventoryEntries || []).forEach(e => {
            if ((e.location || 'Unassigned') === group.name || (!e.location && group.name === 'Unassigned')) {
              groupEntries.push({ itemId: item.id!, entryId: e.id });
            }
          });
        });

        const selectedCount = groupEntries.filter(ge => batchSelected[`${ge.itemId}_${ge.entryId}`]).length;
        const allSelected = groupEntries.length > 0 && selectedCount === groupEntries.length;

        if (isThisGroupBatch) {
          batchToolbar = (
            <div className="mb-4 p-3 bg-blue-50/60 border border-blue-100 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm" onClick={e => e.stopPropagation()}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  id={`batch-toggle-${group.name}`}
                  className="h-8 text-xs font-semibold bg-white border-blue-200 text-blue-700 hover:bg-blue-50"
                  onClick={() => {
                    const newSelected = { ...batchSelected };
                    if (allSelected) {
                      groupEntries.forEach(ge => {
                        delete newSelected[`${ge.itemId}_${ge.entryId}`];
                      });
                    } else {
                      groupEntries.forEach(ge => {
                        newSelected[`${ge.itemId}_${ge.entryId}`] = true;
                      });
                    }
                    setBatchSelected(newSelected);
                  }}
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </Button>
                <span className="font-semibold text-blue-900">
                  {selectedCount} of {groupEntries.length} items selected
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="relative inline-flex items-center">
                  <select
                    id={`batch-target-select-${group.name}`}
                    className="appearance-none bg-white border border-gray-300 text-xs font-medium rounded-lg pl-3 pr-8 py-1.5 cursor-pointer focus:ring-1 focus:ring-blue-500 max-w-[160px] truncate"
                    defaultValue=""
                    onChange={(e) => {
                      const target = e.target.value;
                      if (target) {
                        handleBatchMove(group.name, target);
                      }
                    }}
                  >
                    <option value="" disabled>Move selection to...</option>
                    {locations.filter(loc => loc !== group.name).map(loc => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500 absolute right-2 pointer-events-none" />
                </div>
                
                <Button
                  variant="ghost"
                  size="sm"
                  id={`batch-cancel-${group.name}`}
                  className="h-8 text-xs font-medium text-gray-500 hover:text-gray-800"
                  onClick={() => {
                    setBatchModeGroup(null);
                    setBatchSelected({});
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          );
        } else if (groupEntries.length > 0) {
          batchToolbar = (
            <div className="mb-3 flex justify-end" onClick={e => e.stopPropagation()}>
              <Button
                variant="outline"
                size="sm"
                id={`batch-enable-${group.name}`}
                className="h-8 text-xs font-semibold border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
                onClick={() => {
                  setBatchModeGroup(group.name);
                  setBatchSelected({});
                }}
              >
                Batch Move Items
              </Button>
            </div>
          );
        }
      }

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
            {batchToolbar}
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
      const walkthroughOrder = [
        "Produce",
        "Meat & Seafood",
        "Dairy & Eggs",
        "Pantry",
        "Frozen",
        "Beverages",
        "Snacks",
        "Household",
        "Dog Supplies",
        "Other"
      ];
      groups = walkthroughOrder
        .filter(c => g[c as Category]?.length > 0)
        .map(c => ({ name: c, items: g[c as Category] }));
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
                    <div className="flex gap-1 -mr-2" style={{ flexShrink: 0 }}>
                      {isSuggested && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-10 w-10 text-gray-400 hover:text-gray-600" 
                          onClick={(e) => { e.stopPropagation(); handleUpdateItem(item.id!, { isHiddenSuggestion: true }); }}
                          title="Hide from suggestions"
                        >
                          <EyeOff className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setIsDialogOpen(true); }}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      {!isSuggested && (
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-red-500 hover:text-red-700" onClick={(e) => {
                          e.stopPropagation();
                          if (isShoppingList) {
                              handleUpdateItem(item.id!, { shoppingQuantity: 0 });
                          } else {
                              handleDelete(item.id!);
                          }
                        }}>
                          <Trash2 className="w-4 h-4" />
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
                         <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-2 gap-2 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer rounded-lg border border-gray-100 group" onClick={(e) => { e.stopPropagation(); setEditingItem(item); setFocusedEntryId(entry.id); setIsDialogOpen(true); }}>
                           <div className="min-w-0 w-full sm:w-auto flex-1">
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
                                 <div className="relative flex items-center">
                                   <span className="text-[10px] text-orange-600">
                                     Opened {entry.openedDate || "yyyy-mm-dd"}
                                   </span>
                                   <input 
                                     type="date" 
                                     value={entry.openedDate || ""} 
                                     onChange={(e) => updateEntryOpenedDate(item, entry.id, e.target.value)}
                                     className="absolute inset-0 w-[100px] h-full opacity-0 cursor-pointer"
                                     onClick={(e) => e.stopPropagation()}
                                   />
                                   {entry.openedDate && (
                                     <Button variant="ghost" size="icon" className="relative z-10 h-[14px] w-[14px] flex-shrink-0 text-orange-400 hover:text-orange-600 hover:bg-orange-100/50 p-0 ml-1" onClick={(e) => { e.stopPropagation(); updateEntryOpenedDate(item, entry.id, ""); }}>
                                       <X className="w-2.5 h-2.5" />
                                     </Button>
                                   )}
                                 </div>
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
                           <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto sm:ml-2">
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
            
            <div className="flex items-center gap-1.5 sm:gap-2 relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSharePanelOpen(prev => !prev)}
                title="Share options"
                className="h-8 w-8 text-blue-600 bg-blue-50 hover:bg-blue-100 flex"
                id="header-share-btn"
              >
                <LinkIcon className="w-4 h-4" />
              </Button>
              {activeListId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSettingsOpen(true)}
                  title="Household Settings"
                  className="h-8 w-8 text-gray-600 bg-gray-50 hover:bg-gray-100 flex"
                  id="header-settings-btn"
                >
                  <Cog className="w-4 h-4" />
                </Button>
              )}
              <AnimatePresence>
                {isSharePanelOpen && (
                  <>
                    {/* Backdrop to close panel */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsSharePanelOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-10 z-50 w-72 bg-white rounded-xl shadow-xl border border-gray-200 p-3 space-y-2"
                    >
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 pb-1">Share Options</p>
                      {/* Household invite */}
                      <button
                        onClick={copyHouseholdLink}
                        className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                          <Users className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-900">Invite to this household</span>
                            {copiedHousehold && <span className="text-xs text-green-600 font-medium">Copied!</span>}
                          </div>
                          <span className="text-xs text-gray-500">Recipient joins your shared list directly</span>
                        </div>
                      </button>
                      <div className="border-t border-gray-100" />
                      {/* App share */}
                      <button
                        onClick={copyAppLink}
                        className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                          <LinkIcon className="w-4 h-4 text-gray-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-900">Share the app</span>
                            {copiedApp && <span className="text-xs text-green-600 font-medium">Copied!</span>}
                          </div>
                          <span className="text-xs text-gray-500">Recipient creates their own household</span>
                        </div>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={!lastAction}
              className={`h-8 gap-1.5 text-xs font-semibold shadow-sm transition-all ${lastAction ? 'text-blue-700 border-blue-200 bg-blue-50/80 hover:bg-blue-100' : 'text-gray-400 border-gray-200 bg-gray-50/50'}`}
              title={lastAction ? `Undo last action: ${lastAction.description}` : 'Nothing to undo'}
              id="header-undo-btn"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${lastAction ? 'text-blue-600 animate-pulse' : 'text-gray-400'}`} />
              <span className="hidden sm:inline">Undo{lastAction ? `: ${lastAction.description.substring(0, 15)}${lastAction.description.length > 15 ? '...' : ''}` : ''}</span>
              <span className="sm:hidden">Undo</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsScanDialogOpen(true)}
              className="h-8 gap-1.5 text-xs font-semibold shadow-sm border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100 flex items-center"
              title="Scan receipt with Gemini AI"
            >
              <Receipt className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden md:inline">Scan Receipt</span>
            </Button>
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
        <Tabs value={activeTab} onValueChange={(v) => { window.scrollTo({ top: 0 }); setActiveTab(v as 'shopping' | 'inventory' | 'search'); }} className="w-full">
          <div className="sticky top-14 z-20 bg-gray-50 pt-4 pb-2 mb-4 -mx-2 px-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200/50">
            <TabsList className="grid w-full lg:w-[600px] max-w-full grid-cols-2 bg-gray-200/50 rounded-xl h-auto min-h-[44px] sm:min-h-[42px] p-1 gap-1 mx-auto">
            <TabsTrigger value="shopping" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <ShoppingCart className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Shopping List</span>
              {shoppingItems.length > 0 && <Badge variant="secondary" className="hidden sm:flex ml-2 bg-blue-100 text-blue-700 shrink-0">{shoppingItems.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="inventory" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <Box className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Inventory & Search</span>
            </TabsTrigger>
          </TabsList>
          </div>

          {duplicates.length > 0 && (
             <div className="bg-amber-50/75 border border-amber-200/85 rounded-xl p-4 mb-6 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-2">
               <div className="flex items-center justify-between gap-4">
                 <div className="flex items-center gap-2.5 text-amber-800 font-bold">
                   <GitMerge className="w-5 h-5 text-amber-600" />
                   <span>Duplicate items detected</span>
                 </div>
                 <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider">
                   {duplicates.length} {duplicates.length === 1 ? 'pair' : 'pairs'}
                 </span>
               </div>
               <p className="text-xs text-amber-700">
                 We found multiple separate item records with the exact same name (likely due to corrected spellings or imports). Merge them to combine their quantities, inventory entries, price history, and notes.
               </p>
               <div className="flex flex-col gap-2 pt-1">
                 {duplicates.map(dup => {
                   const totalInv = dup.items.reduce((sum, i) => sum + (i.inventoryQuantity || 0), 0);
                   const totalShop = dup.items.reduce((sum, i) => sum + (i.shoppingQuantity || 0), 0);
                   return (
                     <div key={`dup-banner-${dup.name}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white/90 rounded-lg border border-amber-100 shadow-sm">
                       <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                         <span className="font-semibold text-gray-900 text-sm">{dup.name}</span>
                         <div className="flex items-center gap-1.5">
                           <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-800 px-1.5 py-0 bg-amber-50">
                             {dup.items.length} copies
                           </Badge>
                           <span className="text-xs text-gray-500">
                             (Combined: {totalInv} in stock, {totalShop} to buy)
                           </span>
                         </div>
                       </div>
                       <Button 
                         size="sm" 
                         variant="secondary"
                         onClick={() => handleMergeDuplicate(dup.name, dup.items)}
                         className="h-8 text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200/50 self-end sm:self-center font-semibold shrink-0 gap-1"
                       >
                         <GitMerge className="w-3.5 h-3.5" />
                         Merge Items
                       </Button>
                     </div>
                   );
                 })}
               </div>
             </div>
          )}

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

            {replenishmentSuggestions.length > 0 && (
              <div className="pt-8 border-t border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                     <Sparkles className="w-5 h-5 text-blue-600 animate-pulse" />
                     Replenishment Suggestions
                  </h2>
                </div>
                <p className="text-xs text-gray-500 -mt-2 mb-4">
                  Staple items predicted to be out of stock soon based on your purchase frequency. Click "Add to List" to restock.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {replenishmentSuggestions.map(({ item, meanInterval, daysSince }) => (
                    <div 
                      key={`replenish-${item.id}`} 
                      className="bg-white border border-blue-100 hover:border-blue-300 p-4 rounded-xl shadow-sm flex flex-col justify-between gap-3 transition-all"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-gray-900 text-sm truncate" title={item.name}>{item.name}</span>
                          <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border border-blue-100 text-[10px] capitalize shrink-0">
                            {item.category}
                          </Badge>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-gray-500">
                          <p>Purchased every <span className="font-semibold text-gray-700">{meanInterval} days</span> on average</p>
                          <p>Last purchased <span className="font-semibold text-gray-700">{daysSince} days ago</span></p>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => updateQuantities(item, 0, 1)} 
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 font-semibold rounded-lg shadow-sm"
                        >
                          Add to List
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-50 shrink-0 border border-gray-100 rounded-lg"
                          onClick={async () => {
                            await updateDoc(doc(db, "lists", activeListId!, "items", item.id!), {
                              isHiddenSuggestion: true,
                              updatedAt: serverTimestamp()
                            });
                          }}
                          title="Dismiss suggestion"
                        >
                          <EyeOff className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="inventory" className="focus-visible:outline-none">
            <div className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-3 sm:p-4 rounded-xl mb-6 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <h3 className="font-bold text-blue-900 flex items-center gap-2 text-base sm:text-lg">
                  <Sparkles className="w-5 h-5 text-blue-600 animate-pulse" />
                  AI Receipt Scanner
                </h3>
                <p className="text-xs sm:text-sm text-blue-700/80 max-w-xl">
                  Quickly populate your inventory! Upload a photo of a store receipt to parse items, quantities, categories, and prices automatically.
                </p>
              </div>
              <Button onClick={() => setIsScanDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 shadow-sm font-semibold gap-2 py-4 px-5 rounded-xl text-xs sm:text-sm">
                <Receipt className="w-4 h-4" />
                Scan Receipt
              </Button>
            </div>

            {expiredOrSoonItems.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 shadow-sm space-y-3">
                <div className="flex items-center gap-2 text-red-800 font-bold">
                  <AlertTriangle className="w-5 h-5 text-red-600 animate-bounce" />
                  <span>Expiry Warning: {expiredOrSoonItems.length} {expiredOrSoonItems.length === 1 ? 'item' : 'items'} need attention</span>
                </div>
                <p className="text-xs text-red-700 -mt-1">
                  The following items in your pantry are expired or will expire within the next 3 days. Click any item to view or edit details.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {expiredOrSoonItems.map(item => {
                    const isExpired = (item.inventoryEntries || []).some(e => getExpiryStatus(e.expiryDate) === 'expired');
                    return (
                      <button
                        key={`expiry-alert-${item.id}`}
                        onClick={() => {
                          setEditingItem(item);
                          setIsDialogOpen(true);
                        }}
                        className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors border shadow-sm ${
                          isExpired 
                            ? 'bg-red-100 hover:bg-red-200 border-red-300 text-red-800' 
                            : 'bg-amber-100 hover:bg-amber-200 border-amber-300 text-amber-800'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                        <span className="max-w-[120px] truncate">{item.name}</span>
                        <span className="text-[10px] opacity-80 uppercase tracking-wider font-bold">
                          {isExpired ? 'Expired' : 'Soon'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
            
            <div className="relative my-4">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input 
                type="text" 
                placeholder="Search items by name, category..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-12 text-lg shadow-sm"
              />
            </div>

            {searchQuery.trim() !== "" ? (
               <div className="mt-4">
                 <h3 className="font-semibold text-gray-700 mb-3">Search Results</h3>
                 {renderInventoryItems(searchQuery)}
               </div>
            ) : (
               renderInventoryItems()
            )}
          </TabsContent>
        </Tabs>
      </main>

      <ItemDialog 
        isOpen={isDialogOpen} 
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setFocusedEntryId(null);
            setFocusedPriceId(null);
          }
        }}
        onSave={handleSaveItem} 
        item={editingItem}
        existingItems={items}
        locations={locations}
        title={editingItem ? "Edit Item" : "Add New Item"}
        defaultMode={activeTab === 'shopping' ? 'shopping' : 'inventory'}
        focusedEntryId={focusedEntryId}
        focusedPriceId={focusedPriceId}
        restrictedMode={!!focusedEntryId || !!focusedPriceId}
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

      <ReceiptScanDialog
        isOpen={isScanDialogOpen}
        onOpenChange={(open) => setIsScanDialogOpen(open)}
        existingItems={items}
        onImport={handleImportReceipt}
      />

      <AnimatePresence>
        {lastAction && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 flex items-center justify-between gap-4 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl border border-gray-800"
            id="undo-toast"
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-950/50 shrink-0">
                <RotateCcw className="w-4 h-4 text-blue-400" />
              </div>
              <div className="min-w-0 pr-2">
                <p className="text-xs font-semibold truncate max-w-[180px] sm:max-w-[240px]">{lastAction.description}</p>
                <p className="text-[10px] text-gray-400">Persistent undo helper</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-gray-800">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleUndo} 
                className="h-8 text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-gray-800 px-3 cursor-pointer"
                id="undo-toast-btn"
              >
                Undo
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLastAction(null)}
                className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-800 cursor-pointer"
                id="undo-toast-close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSettingsOpen && currentList && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            />
            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md p-6 relative z-10 space-y-6 animate-in zoom-in-95 duration-200"
            >
              <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Household Settings
                </h3>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Rename List Section */}
              {currentList.owner === user?.uid ? (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Household List Name</label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="Rename household..."
                      className="flex-1"
                    />
                    <Button 
                      onClick={handleRenameList}
                      disabled={!newListName.trim() || newListName.trim() === currentList.name}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Household List</span>
                  <div className="font-semibold text-gray-800 text-lg bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                    {currentList.name}
                  </div>
                </div>
              )}

              {/* Members List Section */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Members & Participants</span>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {currentList.members?.map(memberId => {
                    const isCurrentUser = memberId === user?.uid;
                    const profile = isCurrentUser
                      ? {
                          displayName: user?.displayName || user?.email?.split('@')[0] || "You",
                          email: user?.email || "",
                          photoURL: user?.photoURL || undefined
                        }
                      : memberProfiles[memberId];
                    const isOwner = currentList.owner === memberId;
                    const isLoading = loadingProfiles && !profile;
                    
                    const displayName = profile?.displayName 
                      ? profile.displayName 
                      : isLoading 
                        ? "Loading..." 
                        : isCurrentUser 
                          ? "You" 
                          : `Member (${memberId.slice(0, 6)})`;
                    const email = profile?.email || (isCurrentUser ? user?.email : "") || "";

                    return (
                      <div key={memberId} className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50/70 border border-gray-100/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          {profile?.photoURL ? (
                            <img
                              src={profile.photoURL}
                              referrerPolicy="no-referrer"
                              alt={displayName}
                              className="w-8 h-8 rounded-full object-cover shadow-inner bg-gray-100"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center text-xs shadow-inner">
                              {displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold text-gray-900 truncate">
                                {displayName}
                              </span>
                              {isOwner && (
                                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border border-blue-100 text-[9px] px-1.5 py-0 h-4">
                                  Owner
                                </Badge>
                              )}
                              {isCurrentUser && (
                                <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100 border border-gray-200 text-[9px] px-1.5 py-0 h-4">
                                  You
                                </Badge>
                              )}
                            </div>
                            {email && (
                              <span className="text-xs text-gray-400 block truncate">{email}</span>
                            )}
                          </div>
                        </div>

                        {/* Kick Button */}
                        {currentList.owner === user?.uid && !isOwner && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleKickMember(memberId)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs font-semibold rounded-lg h-8 transition-colors"
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Leave List Button */}
              {currentList.owner !== user?.uid && (
                <div className="pt-2 border-t border-gray-100">
                  <Button
                    onClick={handleLeaveList}
                    className="w-full bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 hover:text-red-800 text-sm font-semibold py-2 rounded-xl flex items-center justify-center gap-2 transition-all"
                  >
                    Leave Household List
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
