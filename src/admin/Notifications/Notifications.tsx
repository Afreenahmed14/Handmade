import { useEffect, useState } from "react";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { getSimpleOrderNotifications, markSimpleOrderNotificationRead, type SimpleOrderNotification } from "../../services/simpleOrders";

export default function Notifications() {
  const [items, setItems] = useState<SimpleOrderNotification[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() { setItems(await getSimpleOrderNotifications()); }
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "Unable to load notifications")).finally(() => setLoading(false)); }, []);
  async function markRead(id: string) {
    try { await markSimpleOrderNotificationRead(id); setItems(current => current.map(item => item.id === id ? {...item, is_read:true} : item)); }
    catch(e) { setError(e instanceof Error ? e.message : "Unable to update notification"); }
  }
  return <section className="space-y-5">
    <div className="flex items-end justify-between border-b border-brass/40 pb-5"><div><p className="text-sm text-walnut/70">Order activity</p><h1 className="mt-1 font-display text-3xl text-walnut">Notifications</h1></div><button onClick={() => {setLoading(true); void load().catch(e=>setError(e.message)).finally(()=>setLoading(false));}} className="btn-outline"><RefreshCw size={15}/> Refresh</button></div>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {loading ? <p className="py-10 text-center text-walnut/60">Loading notifications...</p> : items.length === 0 ? <div className="rounded-xl border border-brass/30 bg-white p-8 text-center"><Bell className="mx-auto text-walnut/50"/><p className="mt-2 text-espresso/70">You're all caught up.</p></div> : <div className="space-y-3">{items.map(item => <article key={item.id} className={`rounded-xl border p-4 ${item.is_read ? "border-brass/20 bg-white" : "border-brass/60 bg-[#f7edf2]"}`}><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium text-walnut">{item.title}</h2><p className="mt-1 text-sm text-espresso/75">{item.message}</p><p className="mt-2 text-xs text-espresso/50">{new Date(item.created_at).toLocaleString("en-IN")}</p></div>{!item.is_read && <button onClick={() => void markRead(item.id)} title="Mark as read" className="rounded-full p-2 text-walnut hover:bg-white"><CheckCheck size={17}/></button>}</div></article>)}</div>}
  </section>;
}
