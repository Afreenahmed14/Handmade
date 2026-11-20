import { Bell, Flower2, Heart, Menu, Package, Search, User, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { useAuth } from "../../context/AuthContext";
import { useStoreSettings } from "../../context/StoreSettingsContext";
import { formatINR } from "../../utils/currency";

export default function Header() {
  const { wishlistCount } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [term, setTerm] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { settings, configured } = useStoreSettings();
  const badge = (count: number) => count > 99 ? "99+" : count;

  useEffect(() => { setSearchOpen(false); setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (searchOpen) {
      setTerm(location.pathname === "/shop" ? new URLSearchParams(location.search).get("q") ?? "" : "");
      searchRef.current?.focus();
    }
  }, [searchOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = term.replace(/\s+/g, " ").trim().slice(0, 100);
    setSearchOpen(false);
    navigate(query ? `/shop?q=${encodeURIComponent(query)}` : "/shop");
  }

  const announcement = !configured ? "A little something lovely for your home" : settings.free_shipping_threshold_inr !== null
    ? `Complimentary shipping on orders above ${formatINR(settings.free_shipping_threshold_inr)}`
    : settings.shipping_charge_inr === 0 ? "Complimentary shipping on every order" : settings.estimated_delivery_text;

  const navClass = (active: boolean) => `whitespace-nowrap text-[10px] font-bold uppercase tracking-[.16em] transition hover:text-[#A45E78] ${active ? "text-[#A45E78]" : "text-[#5C4650]"}`;

  return (
    <header className="sticky top-0 z-40 border-b border-[#EADBD7] bg-[#FFFCF8]/95 shadow-[0_5px_22px_rgba(89,52,65,.045)] backdrop-blur-xl">
      <div className="bg-[#713B58] px-4 py-2 text-center text-[9px] font-bold uppercase tracking-[.2em] text-[#FFF8F2] sm:text-[10px]">✦ &nbsp;{announcement}&nbsp; ✦</div>
      <div className="container-x flex h-[76px] items-center justify-between gap-3 sm:h-[88px]">
        <Link to="/" aria-label="CasaLoom home" className="flex shrink-0 items-center gap-2.5 text-[#713B58]">
          <Flower2 size={34} strokeWidth={1.35} />
          <span className="leading-none"><span className="block font-display text-[31px] font-semibold tracking-[-.045em] sm:text-[36px]">CasaLoom</span><span className="mt-1.5 block text-[8px] font-bold uppercase tracking-[.31em] text-[#9B7880]">Home & Lifestyle</span></span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-4 xl:flex 2xl:gap-5">
          <Link to="/" className={navClass(location.pathname === "/")}>Home</Link>
          <Link to="/shop" className={navClass(location.pathname === "/shop")}>Shop all</Link>
          <Link to="/personalised-gifts" className={navClass(location.pathname === "/personalised-gifts")}>Personalised gifts</Link>
        </nav>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button type="button" aria-label="Search" aria-expanded={searchOpen} aria-controls="header-search" onClick={() => setSearchOpen((open) => !open)} className="icon-button"><Search size={19} strokeWidth={1.7} /></button>
          <Link to={user ? "/profile" : "/login"} aria-label="My account" className="icon-button"><User size={19} strokeWidth={1.7} /></Link>
          {user && <Link to="/my-orders" aria-label="My orders" className="icon-button hidden sm:inline-flex"><Package size={19} strokeWidth={1.7} /></Link>}
          {user && <Link to="/notifications" aria-label="Notifications" className="icon-button"><Bell size={19} strokeWidth={1.7} /></Link>}
          <Link to="/wishlist" aria-label={wishlistCount ? `Wishlist, ${wishlistCount} saved` : "Wishlist"} className="icon-button"><Heart size={19} strokeWidth={1.7} />{wishlistCount > 0 && <b aria-hidden="true" className="absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-[#A45E78] px-1 text-[9px] text-white">{badge(wishlistCount)}</b>}</Link>
          <button type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} onClick={() => setMobileOpen((open) => !open)} className="icon-button xl:hidden">{mobileOpen ? <X size={21} /> : <Menu size={21} />}</button>
        </div>
      </div>

      {searchOpen && <div id="header-search" className="border-t border-[#EADBD7] bg-[#FFFCF8]"><form role="search" onSubmit={submitSearch} className="container-x flex gap-2 py-3"><label className="sr-only" htmlFor="header-search-input">Search CasaLoom</label><input id="header-search-input" ref={searchRef} type="search" value={term} maxLength={100} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }} placeholder="Search pretty things for your home..." className="min-w-0 flex-1 rounded-full border border-[#E5CECA] bg-white px-5 py-3 text-sm text-[#49343D] outline-none focus:border-[#A45E78]" /><button type="submit" className="rounded-full bg-[#713B58] px-6 py-2 text-xs font-bold text-white">Search</button></form></div>}

      {mobileOpen && <nav aria-label="Mobile navigation" className="border-t border-[#EADBD7] bg-[#FFFCF8] px-5 py-4 shadow-lg xl:hidden"><div className="grid gap-1">
        <Link to="/" className="rounded-xl px-4 py-3 text-sm font-bold text-[#713B58] hover:bg-[#F8EAE7]">Home</Link>
        <Link to="/shop" className="rounded-xl px-4 py-3 text-sm font-bold text-[#5C4650] hover:bg-[#F8EAE7]">Shop all</Link>
        <Link to="/personalised-gifts" className="rounded-xl px-4 py-3 text-sm text-[#5C4650] hover:bg-[#F8EAE7]">Personalised gifts</Link>
        <Link to="/wishlist" className="rounded-xl px-4 py-3 text-sm text-[#5C4650] hover:bg-[#F8EAE7]">Wishlist</Link>
        {user && <Link to="/my-orders" className="rounded-xl px-4 py-3 text-sm text-[#5C4650] hover:bg-[#F8EAE7]">My orders</Link>}
        {user && <Link to="/notifications" className="rounded-xl px-4 py-3 text-sm text-[#5C4650] hover:bg-[#F8EAE7]">Notifications</Link>}
        <Link to={user ? "/profile" : "/login"} className="rounded-xl px-4 py-3 text-sm text-[#5C4650] hover:bg-[#F8EAE7]">{user ? "My account" : "Sign in"}</Link>
      </div></nav>}
    </header>
  );
}
