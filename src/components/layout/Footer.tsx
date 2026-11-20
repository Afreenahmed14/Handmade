import { Flower2, Instagram, Mail, MapPin, Phone, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useStoreSettings } from "../../context/StoreSettingsContext";

export default function Footer() {
  const { settings } = useStoreSettings();
  const email = settings.support_email ?? settings.contact_email;
  const phone = settings.support_phone ?? settings.contact_phone;
  return (
    <footer className="relative z-10 mt-8 isolate !bg-[#3B2632] text-[#F9EDE8]/75">
      <div className="container-x grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_.8fr_1fr] lg:py-16">
        <div>
          <Link to="/" className="inline-flex items-center gap-2.5 text-[#FFF8F2]"><Flower2 size={31} strokeWidth={1.3} /><span><span className="block font-display text-3xl font-semibold leading-none">CasaLoom</span><span className="mt-1.5 block text-[8px] font-bold uppercase tracking-[.3em] text-[#D8AEB1]">Home & Lifestyle</span></span></Link>
          <p className="mt-5 max-w-sm text-sm leading-7 text-[#F9EDE8]/65">Pretty little details, thoughtful gifts and timeless pieces to make every corner feel a little more like you.</p>
          <a href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram" className="mt-5 inline-grid h-10 w-10 place-items-center rounded-full border border-[#E9C9C5]/30 text-[#F8D9D5] transition hover:bg-white/10"><Instagram size={17} /></a>
        </div>
        <div><h3 className="mb-4 flex items-center gap-2 font-heading text-xl text-[#FFF8F2]">Explore <Sparkles size={14} className="text-[#D8AEB1]" /></h3><div className="flex flex-col gap-3 text-sm"><Link to="/shop" className="transition hover:text-white">Shop all</Link><Link to="/personalised-gifts" className="transition hover:text-white">Personalised gifts</Link><Link to="/wishlist" className="transition hover:text-white">Wishlist</Link><Link to="/my-orders" className="transition hover:text-white">My orders</Link></div></div>
        <div><h3 className="mb-4 font-heading text-xl text-[#FFF8F2]">A note from us</h3><div className="flex flex-col gap-3 text-sm">{settings.business_address && <p className="flex gap-2"><MapPin size={15} className="mt-1 shrink-0 text-[#D8AEB1]" /><span className="whitespace-pre-line">{settings.business_address}</span></p>}{email && <a href={`mailto:${email}`} className="flex items-center gap-2 transition hover:text-white"><Mail size={15} className="text-[#D8AEB1]" />{email}</a>}{phone && <a href={`tel:${phone.replace(/\s+/g, "")}`} className="flex items-center gap-2 transition hover:text-white"><Phone size={15} className="text-[#D8AEB1]" />{phone}</a>}<Link to="/profile" className="mt-1 transition hover:text-white">My account</Link></div></div>
      </div>
      <p className="border-t border-white/10 py-5 text-center text-[10px] tracking-[.12em] text-[#F9EDE8]/45">© {new Date().getFullYear()} CasaLoom. Made with love for lovely homes.</p>
    </footer>
  );
}
