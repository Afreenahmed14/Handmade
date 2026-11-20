// import { useEffect, useState } from "react";
// import { Bell, CheckCheck } from "lucide-react";
// import { getSimpleOrderNotifications, markSimpleOrderNotificationRead, type SimpleOrderNotification } from "../../services/simpleOrders";
// export default function CustomerNotifications() {
//   const [items,setItems]=useState<SimpleOrderNotification[]>([]);
//   const [error,setError]=useState("");
//   useEffect(()=>{void getSimpleOrderNotifications().then(setItems).catch(e=>setError(e instanceof Error?e.message:"Unable to load notifications"));},[]);
//   async function read(id:string){try{await markSimpleOrderNotificationRead(id);setItems(v=>v.map(n=>n.id===id?{...n,is_read:true}:n));}catch(e){setError(e instanceof Error?e.message:"Unable to update notification");}}
//   return <section className="container-x py-12"><div className="border-b border-brass/40 pb-5"><p className="text-xs uppercase tracking-widest text-walnut/60">CasaLoom updates</p><h1 className="mt-2 font-display text-4xl text-walnut">Notifications</h1></div>{error&&<p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}{!items.length?<div className="mt-6 rounded-xl border border-brass/30 bg-white p-8 text-center"><Bell className="mx-auto text-walnut/60"/><p className="mt-2 text-sm text-espresso/70">No updates yet. We'll let you know when your order is reviewed.</p></div>:<div className="mt-6 space-y-3">{items.map(n=><article key={n.id} className={`rounded-xl border p-4 ${n.is_read?"border-brass/30 bg-white":"border-brass/60 bg-[#f7edf2]"}`}><div className="flex justify-between gap-3"><div><h2 className="font-medium text-walnut">{n.title}</h2><p className="mt-1 text-sm text-espresso/75">{n.message}</p><p className="mt-2 text-xs text-espresso/50">{new Date(n.created_at).toLocaleString("en-IN")}</p></div>{!n.is_read&&<button onClick={()=>void read(n.id)} aria-label="Mark as read" className="p-2 text-walnut"><CheckCheck size={17}/></button>}</div></article>)}</div>}</section>;
// }
import { useEffect, useState } from "react";
import {
  Bell,
  CheckCheck,
  CreditCard,
  Package,
  Truck,
  CalendarDays,
} from "lucide-react";

import {
  getSimpleOrderNotifications,
  markSimpleOrderNotificationRead,
  type SimpleOrderNotification,
} from "../../services/simpleOrders";

import "./CustomerPages.css";

function getNotificationStyle(title: string) {
  const value = title.toLowerCase();

  if (value.includes("payment")) {
    return { tone: "payment", Icon: CreditCard };
  }

  if (value.includes("deliver")) {
    return { tone: "delivery", Icon: Truck };
  }

  return { tone: "order", Icon: Package };
}

export default function CustomerNotifications() {
  const [items, setItems] = useState<SimpleOrderNotification[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSimpleOrderNotifications()
      .then(setItems)
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "Unable to load notifications",
        ),
      );
  }, []);

  async function read(id: string) {
    try {
      await markSimpleOrderNotificationRead(id);

      setItems((current) =>
        current.map((n) =>
          n.id === id ? { ...n, is_read: true } : n,
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to update notification",
      );
    }
  }

  const unreadCount = items.filter((item) => !item.is_read).length;

  return (
    <main className="customer-art-page notifications-page">
      <div className="customer-art-container">

        <header className="notification-hero">
          <div className="hero-decoration flower-one">✿</div>
          <div className="hero-decoration flower-two">✿</div>
          <div className="hero-decoration sparkle-one">✧</div>

          <div className="notification-hero-content">
            <p className="art-eyebrow">CASALOOM UPDATES</p>

            <h1>Notifications</h1>

            <p className="art-subtitle">
              Your requests, payment choices and delivery updates in one place.
            </p>
          </div>

          <div className="hero-icon-box notification-icon">
            <Bell size={38} strokeWidth={1.5} />
            {unreadCount > 0 && (
              <span className="notification-count">
                {unreadCount}
              </span>
            )}
          </div>
        </header>

        {error && (
          <p role="alert" className="art-error">
            {error}
          </p>
        )}

        {!items.length ? (
          <div className="art-empty-state">
            <Bell size={38} />
            <h2>No updates yet</h2>
            <p>
              We'll let you know when your order is reviewed.
            </p>
          </div>
        ) : (
          <div className="notification-list">
            {items.map((item) => {
              const { tone, Icon } = getNotificationStyle(item.title);

              return (
                <article
                  key={item.id}
                  className={`notification-card ${tone} ${
                    item.is_read ? "is-read" : ""
                  }`}
                >
                  <div className="notification-symbol">
                    <Icon size={28} strokeWidth={1.8} />
                  </div>

                  <div className="notification-copy">
                    <h2>{item.title}</h2>

                    <p>{item.message}</p>

                    <span className="notification-date">
                      <CalendarDays size={14} />
                      {new Date(item.created_at).toLocaleString("en-IN")}
                    </span>
                  </div>

                  <div className="notification-action">
                    {item.is_read ? (
                      <span className="read-indicator">
                        <CheckCheck size={21} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void read(item.id)}
                        aria-label="Mark as read"
                        title="Mark as read"
                        className="notification-read-button"
                      >
                        <CheckCheck size={21} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}