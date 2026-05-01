import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState, useMemo } from "react";
import { auth, db, signIn, signOut, handleFirestoreError } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, onSnapshot, query, addDoc, serverTimestamp, doc, deleteDoc, updateDoc, where, getDoc, arrayUnion } from "firebase/firestore";
import { GroceryItem, GroceryList, CATEGORIES, InventoryEntry, PRESET_LOCATIONS, PriceEntry } from "./types";
import { Button } from "./components/ui/button";
import { Plus, LogOut, Trash2, Edit, ShoppingCart, Check, Minus, Users, Link as LinkIcon, LineChart } from "lucide-react";
import { GroceriesIcon } from "./components/GroceriesIcon";
import { ItemDialog } from "./components/ItemDialog";
import { ReceiveStockDialog } from "./components/ReceiveStockDialog";
import { CheckOffDialog } from "./components/CheckOffDialog";
import { PriceAnalysisTab } from "./components/PriceAnalysisTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Badge } from "./components/ui/badge";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [items, setItems] = useState<GroceryItem[]>([]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | undefined>();

  const [receivingItem, setReceivingItem] = useState<{ item: GroceryItem, defaultAmount: number } | undefined>();
  const [checkingOffItem, setCheckingOffItem] = useState<GroceryItem | undefined>();

  const [activeTab, setActiveTab] = useState<'shopping' | 'inventory' | 'prices'>('shopping');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string, override?: boolean) => {
    setExpandedItems(prev => ({ ...prev, [id]: override !== undefined ? override : !prev[id] }));
  };

  // View Options for All Tabs
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [groupBy, setGroupBy] = useState<'category' | 'location'>('category');
  const [sortBy, setSortBy] = useState<'name' | 'quantity' | 'expiryDate' | 'dateBought' | 'dateAdded'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterCat, setFilterCat] = useState<string>('All');
  const [filterLoc, setFilterLoc] = useState<string>('All');
  const [filterTag, setFilterTag] = useState<string>('All');

  const locations = useMemo(() => Array.from(new Set([...PRESET_LOCATIONS, ...items.flatMap(i => i.locations || [i.location]).filter(Boolean) as string[]])), [items]);
  const tags = useMemo(() => Array.from(new Set(items.flatMap(i => i.inventoryEntries?.flatMap(e => e.tags || []) || []))), [items]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
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
        // Create an initial list
        addDoc(collection(db, "lists"), {
          name: "My Household",
          ownerId: user.uid,
          members: [user.uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }).catch(e => console.error("Error creating initial list", e));
      } else if (!activeListId || !dbLists.find(l => l.id === activeListId)) {
        setActiveListId(dbLists[0].id!);
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

  const handleSaveItem = async (data: Partial<GroceryItem> & { newPriceEntry?: Omit<PriceEntry, 'id'> }) => {
    if (!user || !activeListId) return;
    const { newPriceEntry, ...updatedFields } = data;
    
    try {
      if (editingItem?.id) {
        const updateData: Partial<GroceryItem> = {
          ...updatedFields,
          updatedAt: serverTimestamp()
        };
        if (newPriceEntry) {
          updateData.priceHistory = arrayUnion({
            ...newPriceEntry,
            id: crypto.randomUUID()
          }) as unknown as PriceEntry[];
        }
        await updateDoc(doc(db, "lists", activeListId, "items", editingItem.id), updateData);
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
               updatedAt: serverTimestamp()
           };

           if (newPriceEntry) {
             updateData.priceHistory = arrayUnion({
               ...newPriceEntry,
               id: crypto.randomUUID()
             }) as unknown as PriceEntry[];
           }

           await updateDoc(doc(db, "lists", activeListId, "items", existingMatch.id), updateData);
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

           await addDoc(collection(db, "lists", activeListId, "items"), newItem as GroceryItem);
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

  const updateQuantities = async (item: GroceryItem, invDelta: number, shopDelta: number) => {
    if (!user || !activeListId || !item.id) return;
    const newInv = Math.max(0, item.inventoryQuantity + invDelta);
    const newShop = Math.max(0, item.shoppingQuantity + shopDelta);
    
    let newEntries = [...(item.inventoryEntries || [])];

    if (invDelta > 0) {
      const defaultLoc = item.location || item.locations?.[0] || 'Unassigned';
      const entry = newEntries.find(e => !e.label && !e.expiryDate && e.location === defaultLoc);
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
      newEntries = newEntries.filter(e => e.quantity > 0);
    }
    
    const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), {
        inventoryQuantity: newInv,
        shoppingQuantity: newShop,
        inventoryEntries: newEntries,
        locations: newLocs,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating quantities:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const handleUpdateItem = async (itemId: string, fields: Partial<GroceryItem>) => {
    if (!user || !activeListId) return;
    try {
      await updateDoc(doc(db, "lists", activeListId, "items", itemId), {
        ...fields,
        updatedAt: serverTimestamp()
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

        await updateDoc(doc(db, "lists", activeListId, "items", item.id), updateData);
      }
      setCheckingOffItem(undefined);
    } catch (error) {
      console.error("Error checking off item:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const updateEntryQuantity = async (item: GroceryItem, entryId: string, delta: number) => {
    if (!user || !activeListId || !item.id) return;
    const newEntries = (item.inventoryEntries || []).map(e => {
        if (e.id === entryId) {
            return { ...e, quantity: Math.max(0, e.quantity + delta) };
        }
        return e;
    }).filter(e => e.quantity > 0);
    
    const newInv = newEntries.reduce((sum, e) => sum + e.quantity, 0);
    const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), {
        inventoryQuantity: newInv,
        inventoryEntries: newEntries,
        locations: newLocs,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating entry quantity:", error);
      handleFirestoreError(error, 'update', `lists/${activeListId}/items/${item.id}`);
    }
  };

  const handleReceiveStock = async (entries: Omit<InventoryEntry, 'id'>[], processAmount: number) => {
    if (!user || !activeListId || !receivingItem?.item?.id) return;
    const item = receivingItem.item;
    
    // Add IDs to new entries
    const newAddedEntries = entries.map(e => ({ ...e, id: Math.random().toString(36).substr(2, 9) }));
    
    // Sum quantites of added pieces
    const totalAddedQuantity = newAddedEntries.reduce((sum, e) => sum + e.quantity, 0);
    
    const newInv = Math.max(0, item.inventoryQuantity + totalAddedQuantity);
    const newUnprocessed = Math.max(0, (item.unprocessedQuantity || 0) - processAmount);
    
    const newEntries = [...(item.inventoryEntries || []), ...newAddedEntries];
    const newLocs = Array.from(new Set(newEntries.map(e => e.location).filter(Boolean)));

    try {
      await updateDoc(doc(db, "lists", activeListId, "items", item.id), {
        inventoryQuantity: newInv,
        unprocessedQuantity: newUnprocessed,
        inventoryEntries: newEntries,
        locations: newLocs,
        updatedAt: serverTimestamp()
      });
      setReceivingItem(undefined);
    } catch (error) {
      console.error("Error receiving stock:", error);
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
  const suggestedItems = useMemo(() => items.filter(i => i.shoppingQuantity === 0 && i.inventoryQuantity === 0 && !i.unprocessedQuantity), [items]);
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
          <div className="text-sm text-gray-500 hidden sm:block">
            {activeTab === 'shopping' ? `${shoppingItems.length} items to buy` : `${inventoryItems.length} total items`}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm text-sm">
               <div className="flex flex-col gap-1.5">
                 <label className="font-semibold text-gray-700 text-xs uppercase tracking-wider">Group by</label>
                 <select value={groupBy} onChange={e => setGroupBy(e.target.value as 'category' | 'location')} className="bg-gray-50 border rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                   <option value="category">Category</option>
                   <option value="location">Location</option>
                 </select>
               </div>
               
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

  const renderInventoryItems = () => {
    const filteredItems = inventoryItems.filter(item => {
      if (filterCat !== 'All' && item.category !== filterCat) return false;
      
      const itemLocs = item.locations || [];
      if (item.location && !itemLocs.includes(item.location)) itemLocs.push(item.location);
      if (filterLoc !== 'All' && itemLocs.length > 0 && !itemLocs.includes(filterLoc)) return false;
      if (filterLoc !== 'All' && itemLocs.length === 0 && filterLoc !== 'Unassigned') return false;
      
      const itemTags = item.inventoryEntries?.flatMap(e => e.tags || []) || [];
      if (filterTag !== 'All' && !itemTags.includes(filterTag)) return false;

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

    if (groupBy === 'category') {
      const g = filteredItems.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {} as Record<string, GroceryItem[]>);
      groups = CATEGORIES.filter(c => g[c]?.length > 0).map(c => ({ name: c, items: g[c] }));
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
      <div className="space-y-8 mt-6">
        {groups.map(group => (
          <div key={group.name} className="space-y-4">
            <h3 className="font-semibold text-lg text-gray-800 border-b pb-2">{group.name}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.items.map(item => (
                <div key={`${group.name}-${item.id}`} onClick={() => toggleExpanded(item.id!)} className="bg-white p-4 rounded-xl shadow-sm ring-1 ring-gray-900/5 flex flex-col gap-3 cursor-pointer hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</div>
                      {groupBy === 'category' && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(item.locations || [item.location]).filter(Boolean).map(loc => (
                            <Badge key={loc!} variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-50">{loc}</Badge>
                          ))}
                        </div>
                      )}
                      {groupBy === 'location' && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-50">{item.category}</Badge>
                          </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-lg font-bold text-gray-900">{item.inventoryQuantity} <span className="text-xs text-gray-500 font-normal">count</span></span>
                      </div>
                      {item.shoppingQuantity > 0 && <span className="text-xs text-blue-600 font-medium">+{item.shoppingQuantity} {item.unit || ""} to buy</span>}
                      <div className="flex gap-1 mt-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-blue-600" onClick={() => { setEditingItem(item); setIsDialogOpen(true); }}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-700" onClick={() => handleDelete(item.id!)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  {expandedItems[item.id!] && item.inventoryEntries && item.inventoryEntries.length > 0 && (
                    <div className="bg-gray-50/50 rounded-lg text-xs mt-3 border border-gray-100 divide-y divide-gray-100" onClick={e => e.stopPropagation()}>
                       {item.inventoryEntries.map(entry => (
                         <div key={entry.id} className="p-2 flex justify-between items-center hover:bg-gray-50 transition-colors">
                           <div className="flex flex-col gap-0.5">
                             <div className="flex items-center gap-1.5 pl-1.5 border-l-2 border-gray-300">
                                 <span className="font-semibold text-gray-700">{entry.amount ? `${entry.amount} ${entry.unit || item.unit || ''}` : `${entry.unit || item.unit || 'Count'}`}</span>
                                 {entry.location && <span className="text-gray-400">at {entry.location}</span>}
                             </div>
                             {entry.label && <span className="text-gray-500 pl-2">{entry.label}</span>}
                             {entry.expiryDate && <span className={`pl-2 ${new Date(entry.expiryDate) < new Date() ? "text-red-500 font-medium" : "text-gray-400"}`}>Exp: {entry.expiryDate}</span>}
                             {(entry.dateBought || entry.dateAdded) && <div className="text-[10px] text-gray-400 pl-2">Bought: {entry.dateBought || entry.dateAdded}</div>}
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
                              <span className="text-sm font-medium w-6 text-center text-gray-800">{entry.quantity}</span>
                              <Button variant="outline" size="icon" className="h-6 w-6 text-gray-500 border-gray-300" onClick={(e) => { e.stopPropagation(); updateEntryQuantity(item, entry.id, 1); }} title="Increase count">
                                 <Plus className="w-3.5 h-3.5" />
                              </Button>
                           </div>
                         </div>
                       ))}
                    </div>
                  )}

                  {expandedItems[item.id!] && item.notes && <div className="text-xs text-gray-500 mt-1 line-clamp-2 italic border-t pt-2" title={item.notes}>{item.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
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

    if (groupBy === 'category') {
      const g = filteredItems.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {} as Record<string, GroceryItem[]>);
      groups = CATEGORIES.filter(c => g[c]?.length > 0).map(c => ({ name: c, items: g[c] }));
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
      <div className="space-y-8">
        {groups.map(group => (
          <div key={group.name} className="space-y-4">
            <h3 className="font-semibold text-lg text-gray-800 border-b pb-2">{group.name}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.items.map(item => (
                <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm ring-1 ring-gray-900/5 flex flex-col gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</div>
                      {(item.locations && item.locations.length > 0) ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.locations.map(loc => (
                            <Badge key={loc} variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-50">{loc}</Badge>
                          ))}
                        </div>
                      ) : item.location ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                           <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-gray-50">{item.location}</Badge>
                        </div>
                      ) : null}
                      {item.notes && <div className="text-xs text-gray-500 mt-1 line-clamp-2" title={item.notes}>{item.notes}</div>}
                    </div>
                    <div className="flex gap-1" style={{ flexShrink: 0 }}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingItem(item); setIsDialogOpen(true); }}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => handleDelete(item.id!)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-auto pt-2">
                    {isSuggested ? (
                       <Button variant="secondary" size="sm" className="h-8 gap-1.5 w-full text-blue-600 bg-blue-50 hover:bg-blue-100" onClick={() => updateQuantities(item, 0, 1)}>
                          <Plus className="w-3.5 h-3.5" />
                          Add to Shopping List
                       </Button>
                    ) : isShoppingList ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantities(item, 0, -1)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="text-sm font-medium w-6 text-center">{item.shoppingQuantity} <span className="text-xs text-gray-500 font-normal">{item.unit}</span></span>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantities(item, 0, 1)}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <Button size="sm" className="h-8 gap-1.5" onClick={() => handleCheckOff(item)}>
                          <Check className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Got It</span>
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantities(item, -1, 0)}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="text-sm font-medium w-6 text-center">{item.inventoryQuantity} <span className="text-xs text-gray-500 font-normal">{item.unit}</span></span>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantities(item, 1, 0)}>
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
              ))}
            </div>
          </div>
        ))}
      </div>
    );
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
          <Button onClick={signIn} className="w-full h-12 text-md rounded-xl" size="lg">Sign in with Google</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center">
                <GroceriesIcon className="w-8 h-8 text-gray-900" />
              </div>
              <h1 className="text-xl font-bold tracking-tight hidden sm:block">Shelf Control</h1>
            </div>
            
            <div className="h-6 w-px bg-gray-200 hidden sm:block mx-2"></div>
            
            <div className="flex items-center gap-2">
              <select 
                className="bg-transparent border border-gray-300 rounded-lg text-sm p-1.5 focus:ring-blue-500 focus:border-blue-500 font-medium"
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
              <Button variant="ghost" size="icon" onClick={copyShareLink} title="Copy share link" className="h-8 w-8 text-blue-600 bg-blue-50 hover:bg-blue-100 hidden sm:flex">
                {copiedLink ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="default" size="sm" onClick={() => { setEditingItem(undefined); setIsDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Item
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="text-gray-500 hidden sm:flex">
              <LogOut className="w-4 h-4 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 pb-8 pt-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'shopping' | 'inventory' | 'prices')} className="w-full">
          <div className="sticky top-16 z-20 bg-gray-50 pt-6 pb-4 mb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200/50">
            {currentList && (
               <div className="flex items-center justify-between gap-4 mb-4">
                 <div className="flex items-center gap-2 text-sm text-gray-500">
                   <Users className="w-4 h-4" />
                   <span>Shared by {currentList.members.length} member{currentList.members.length !== 1 ? 's' : ''}</span>
                 </div>
                 <div className="flex items-center gap-2">
                   <Button variant="outline" size="sm" onClick={copyShareLink} className="h-8 text-blue-600 border-blue-200 bg-white">
                      <LinkIcon className="w-3.5 h-3.5 mr-1" />
                      Invite
                   </Button>
                 </div>
               </div>
            )}

            <TabsList className="grid w-full lg:w-[898px] max-w-full grid-cols-3 bg-gray-200/50 rounded-xl h-auto min-h-[52px] sm:min-h-[42px] p-1 gap-1">
            <TabsTrigger value="shopping" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <ShoppingCart className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Shopping List</span>
              {shoppingItems.length > 0 && <Badge variant="secondary" className="hidden sm:flex ml-2 bg-blue-100 text-blue-700 shrink-0">{shoppingItems.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="inventory" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <GroceriesIcon className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Pantry Inventory</span>
            </TabsTrigger>
            <TabsTrigger value="prices" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm py-2 px-1 flex-col sm:flex-row h-auto min-h-full">
              <LineChart className="w-4 h-4 mb-1 sm:mb-0 sm:mr-2 shrink-0" />
              <span className="text-[10px] sm:text-sm leading-tight text-center sm:text-left break-words max-w-full">Price Analysis</span>
            </TabsTrigger>
          </TabsList>
          </div>

        {items.filter(item => (item.unprocessedQuantity || 0) > 0).length > 0 && (
          <div className="bg-orange-50/50 border border-orange-200 rounded-xl p-5 mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
            <h3 className="font-semibold text-lg text-orange-900 mb-4 flex items-center gap-2">
              <GroceriesIcon className="w-5 h-5 text-orange-600" />
              Action Required: To Be Processed
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.filter(item => (item.unprocessedQuantity || 0) > 0).map(item => (
                <div key={`unprocessed-global-${item.id}`} className="bg-white p-4 rounded-xl shadow-sm ring-1 ring-orange-900/10 flex flex-col gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</div>
                      <div className="text-sm text-orange-700 font-medium mt-1">
                        {item.unprocessedQuantity} {item.unit} pending
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setReceivingItem({ item, defaultAmount: item.unprocessedQuantity || 0 })} className="bg-orange-600 hover:bg-orange-700 text-white shrink-0">
                      Process
                    </Button>
                  </div>
                </div>
              ))}
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
                <h2 className="text-lg font-bold mb-4 text-gray-500 flex items-center gap-2">
                   <GroceriesIcon className="w-5 h-5" />
                   Suggested (Out of Stock)
                </h2>
                {renderGroupedItems(suggestedItems, false, true)}
              </div>
            )}
          </TabsContent>
          <TabsContent value="inventory" className="focus-visible:outline-none">
            {renderControls()}
            {renderInventoryItems()}
          </TabsContent>
          <TabsContent value="prices" className="focus-visible:outline-none">
            <PriceAnalysisTab items={items} onUpdateItem={handleUpdateItem} />
          </TabsContent>
        </Tabs>
      </main>

      <ItemDialog 
        isOpen={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        onSave={handleSaveItem} 
        item={editingItem}
        existingItems={items}
        locations={locations}
        title={editingItem ? "Edit Item" : "Add New Item"}
        defaultMode={activeTab}
      />
      
      <ReceiveStockDialog
        open={!!receivingItem}
        onOpenChange={(open) => { if (!open) setReceivingItem(undefined); }}
        item={receivingItem?.item}
        defaultAmount={receivingItem?.defaultAmount}
        locations={locations}
        onReceive={handleReceiveStock}
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
    </div>
  );
}
