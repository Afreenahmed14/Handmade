import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2,
  ClipboardList,
  Globe2,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Phone,
  Save,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { logout } from "../../services/auth";

interface ProfileFields {
  full_name: string;
  mobile_number: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

const emptyProfile: ProfileFields = {
  full_name: "",
  mobile_number: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "India",
};

const fields: {
  key: keyof ProfileFields;
  label: string;
  icon: typeof UserRound;
  wide?: boolean;
}[] = [
  { key: "full_name", label: "Full name", icon: UserRound },
  { key: "mobile_number", label: "Mobile number", icon: Phone },
  { key: "address_line1", label: "Address line 1", icon: MapPin, wide: true },
  { key: "address_line2", label: "Address line 2", icon: MapPin, wide: true },
  { key: "city", label: "City", icon: Building2 },
  { key: "state", label: "State", icon: MapPin },
  { key: "postal_code", label: "Postal code", icon: Building2 },
  { key: "country", label: "Country", icon: Globe2 },
];

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<ProfileFields>(emptyProfile);
  const [originalProfile, setOriginalProfile] = useState<ProfileFields>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error: queryError } = await supabase
        .from("profiles")
        .select("full_name,mobile_number,address_line1,address_line2,city,state,postal_code,country")
        .eq("id", user.id)
        .single();

      if (!active) return;

      if (queryError) {
        setError(queryError.message);
      } else if (data) {
        const loaded: ProfileFields = {
          ...emptyProfile,
          ...data,
          mobile_number: data.mobile_number ?? "",
          address_line1: data.address_line1 ?? "",
          address_line2: data.address_line2 ?? "",
          city: data.city ?? "",
          state: data.state ?? "",
          postal_code: data.postal_code ?? "",
          country: data.country ?? "India",
        };
        setProfile(loaded);
        setOriginalProfile(loaded);
      }

      setLoading(false);
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, [user]);

  function updateField(field: keyof ProfileFields, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  function cancelEditing() {
    setProfile(originalProfile);
    setEditing(false);
    setError("");
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setPending(true);
    setError("");
    setNotice("");

    const { error: saveError } = await supabase
      .from("profiles")
      .update(profile)
      .eq("id", user.id);

    if (saveError) {
      setError(saveError.message);
    } else {
      setOriginalProfile(profile);
      setEditing(false);
      setNotice("Your profile has been updated successfully.");
    }

    setPending(false);
  }

  async function signOut() {
    try {
      await logout();
      navigate("/", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign out.");
    }
  }

  if (loading) {
    return (
      <div className="casaloom-profile-loading">
        <span className="casaloom-profile-loading-mark"><Sparkles size={18} /></span>
        <p>Preparing your little corner...</p>
      </div>
    );
  }

  const displayName = profile.full_name || user?.email?.split("@")[0] || "CasaLoom guest";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className="casaloom-profile-page">
      <div className="casaloom-profile-glow casaloom-profile-glow-one" />
      <div className="casaloom-profile-glow casaloom-profile-glow-two" />
      <div className="casaloom-profile-shell">
        <header className="casaloom-profile-heading">
          <div>
            <p className="casaloom-profile-kicker"><Sparkles size={13} /> YOUR LITTLE CORNER</p>
            <h1>My <em>Profile</em></h1>
            <p className="casaloom-profile-subtitle">
              Your account, your details, your CasaLoom experience.
            </p>
          </div>
          <div className="casaloom-profile-heading-actions">
            <Link to="/my-orders" className="casaloom-profile-quick-link">
              <Package size={16} /> My orders
            </Link>
            <Link to="/my-requests" className="casaloom-profile-quick-link">
              <ClipboardList size={16} /> My requests
            </Link>
            <button type="button" onClick={signOut} className="casaloom-profile-quick-link">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </header>

        <div className="casaloom-profile-layout">
          <aside className="casaloom-profile-aside">
            <div className="casaloom-profile-user-card">
              <div className="casaloom-profile-avatar">{initials || <UserRound size={34} />}</div>
              <span className="casaloom-profile-member-tag">CASALOOM MEMBER</span>
              <h2>{displayName}</h2>
              <p>{user?.email}</p>
              <div className="casaloom-profile-divider"><span>✦</span></div>
              <div className="casaloom-profile-aside-note">
                <span className="casaloom-profile-note-icon"><Sparkles size={16} /></span>
                <span>Lovely little things, made to feel like yours.</span>
              </div>
            </div>

            <div className="casaloom-profile-side-links">
              <Link to="/my-orders"><Package size={17} /> <span>My orders</span><span className="casaloom-profile-link-arrow">↗</span></Link>
              <Link to="/my-requests"><ClipboardList size={17} /> <span>My requests</span><span className="casaloom-profile-link-arrow">↗</span></Link>
              <button type="button" onClick={signOut}><LogOut size={17} /> <span>Sign out</span><span className="casaloom-profile-link-arrow">↗</span></button>
            </div>
          </aside>

          <section className="casaloom-profile-details-card">
            <div className="casaloom-profile-card-heading">
              <div className="casaloom-profile-card-title">
                <span className="casaloom-profile-title-icon"><UserRound size={21} /></span>
                <div>
                  <p className="casaloom-profile-card-eyebrow">ACCOUNT DETAILS</p>
                  <h2>Personal information</h2>
                  <p>Manage your basic account information.</p>
                </div>
              </div>

              {!editing ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    setNotice("");
                    setError("");
                  }}
                  className="casaloom-profile-edit-button"
                >
                  <Pencil size={15} /> Edit profile
                </button>
              ) : (
                <div className="casaloom-profile-edit-actions">
                  <button type="button" onClick={cancelEditing} disabled={pending} className="casaloom-profile-cancel-button">
                    <X size={15} /> Cancel
                  </button>
                  <button type="submit" form="casaloom-profile-form" disabled={pending} className="casaloom-profile-edit-button">
                    <Save size={15} /> {pending ? "Saving..." : "Save changes"}
                  </button>
                </div>
              )}
            </div>

            <form id="casaloom-profile-form" onSubmit={save}>
              <div className="casaloom-profile-fields">
                {fields.map(({ key, label, icon: Icon, wide }) => (
                  <label key={key} className={`casaloom-profile-field${wide ? " is-wide" : ""}`}>
                    <span className="casaloom-profile-field-icon"><Icon size={17} /></span>
                    <span className="casaloom-profile-field-content">
                      <span className="casaloom-profile-field-label">{label}</span>
                      {editing ? (
                        <input
                          value={profile[key]}
                          onChange={(event) => updateField(key, event.target.value)}
                          placeholder={`Enter ${label.toLowerCase()}`}
                          autoComplete={key === "full_name" ? "name" : key === "mobile_number" ? "tel" : "off"}
                        />
                      ) : (
                        <span className="casaloom-profile-field-value">{profile[key] || "Not provided"}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              {notice && <p role="status" className="casaloom-profile-message is-success">{notice}</p>}
              {error && <p role="alert" className="casaloom-profile-message is-error">{error}</p>}

              {editing && (
                <div className="casaloom-profile-mobile-actions">
                  <button type="submit" disabled={pending} className="casaloom-profile-edit-button">
                    <Save size={15} /> {pending ? "Saving..." : "Save changes"}
                  </button>
                  <button type="button" onClick={cancelEditing} disabled={pending} className="casaloom-profile-cancel-button">
                    Cancel
                  </button>
                </div>
              )}
            </form>
          </section>
        </div>
        <p className="casaloom-profile-footer-note">A little more lovely, every time you visit. <span>♡</span></p>
      </div>
    </main>
  );
}
