import { useState, useEffect, useCallback } from "react";
import {
  Bell,
  BookOpen,
  Utensils,
  Zap,
  Pin,
  User,
  CheckCircle2,
  Plus,
  X,
  Megaphone,
  Clock,
  MapPin,
  Timer,
  KeyRound,
  ShieldCheck,
  Mail,
  Phone,
  Copy,
  CreditCard,
  Flag,
  AlertTriangle,
} from "lucide-react";

const TASKS_KEY = "freshy_tasks_v1";
const CODES_KEY = "freshy_codes_v1";
const ME_KEY = "freshy_me_v1";
const OWNER_KEY = "freshy_owner_v1";
const REPORTS_KEY = "freshy_reports_v1";

const REPORT_REASONS = [
  "Didn't complete the order",
  "Rude or inappropriate messages",
  "Misused my contact info",
  "Harassment, threats, or unwanted physical contact",
  "Asked for something unsafe or against school rules",
  "Something else",
];

// Tutoring ladders, easiest first. A freshy can tutor their own level and below.
const SUBJECTS = [
  {
    id: "math",
    label: "Math",
    levels: [
      "Pre-Algebra",
      "Algebra 1",
      "Honors Algebra 1",
      "Geometry",
      "Honors Geometry",
      "Algebra 2",
      "Honors Algebra 2",
      "Pre-Calculus",
      "Honors Pre-Calculus",
      "AP Calculus AB",
      "AP Calculus BC",
      "AP Statistics",
    ],
  },
  {
    id: "language",
    label: "English",
    levels: [
      "English 9",
      "Honors English 9",
      "English 10",
      "Honors English 10",
      "English 11",
      "Honors English 11",
      "AP Lang",
      "AP Lit",
    ],
  },
  {
    id: "biology",
    label: "Biology",
    levels: ["Biology", "Honors Biology", "AP Biology"],
  },
  {
    id: "chemistry",
    label: "Chemistry",
    levels: ["Chemistry", "Honors Chemistry", "AP Chemistry"],
  },
  {
    id: "physics",
    label: "Physics",
    levels: ["Physics", "Honors Physics", "Advanced Physics", "AP Physics 1", "AP Physics C"],
  },
  {
    id: "spanish",
    label: "Spanish",
    levels: [
      "Spanish 1",
      "Spanish 2",
      "Spanish 3",
      "Honors Spanish 3",
      "Spanish 4",
      "Honors Spanish 4",
      "AP Spanish",
    ],
  },
  {
    id: "latin",
    label: "Latin",
    levels: [
      "Latin 1",
      "Latin 2",
      "Latin 3",
      "Honors Latin 3",
      "Latin 4",
      "Honors Latin 4",
      "AP Latin",
    ],
  },
  {
    id: "chinese",
    label: "Chinese",
    levels: [
      "Chinese 1",
      "Chinese 2",
      "Chinese 3",
      "Honors Chinese 3",
      "Chinese 4",
      "Honors Chinese 4",
      "AP Chinese",
    ],
  },
];

function getSubject(id) {
  return SUBJECTS.find((s) => s.id === id) || SUBJECTS[0];
}

// Reasons where the app is not enough on its own.
const SERIOUS_REASONS = [
  "Harassment, threats, or unwanted physical contact",
  "Asked for something unsafe or against school rules",
];

// Orders can only be scheduled inside campus hours.
const OPEN_TIME = "08:00";
const CLOSE_TIME = "19:30";

// Change this to whatever you want your owner PIN to be.
// Paste the logo here once you have the file from the school.
// Either a URL ("https://.../lfa-logo.png") or a base64 data URI
// ("data:image/png;base64,iVBORw0KG..."). Leave "" to show the text badge.
const LOGO_URL = "data:image/png;base64,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";

const OWNER_PIN = "1455";
const FRESHY_SHARE = 0.6; // freshy keeps 60% of the order price
const OWNER_SHARE = 0.4;  // owner keeps 40% of the order price
// Tips are never split — 100% goes to the freshy.
const OWNER_EMAIL = "stonemeyers11@gmail.com";
const OWNER_PHONE = "(224) 760-9361";
const OWNER_PHONE_RAW = "+12247609361";

const CATEGORIES = [
  {
    id: "tutoring",
    label: "Tutoring",
    icon: BookOpen,
    rate: 16,
    hourly: true,
    bg: "bg-blue-600",
    text: "text-blue-700",
    light: "bg-blue-50",
    chip: "bg-blue-100 text-blue-800 border-blue-300",
  },
  {
    id: "food",
    label: "Food Grab",
    icon: Utensils,
    rate: 5,
    hourly: false,
    bg: "bg-orange-600",
    text: "text-orange-700",
    light: "bg-orange-50",
    chip: "bg-orange-100 text-orange-800 border-orange-300",
  },
  {
    id: "run",
    label: "Emergency Run",
    icon: Zap,
    rate: 7,
    hourly: false,
    bg: "bg-red-600",
    text: "text-red-700",
    light: "bg-red-50",
    chip: "bg-red-100 text-red-800 border-red-300",
  },
];

// Basic school-appropriate language filter. Catches common profanity including
// simple letter-substitution tricks. Not a substitute for a maintained
// moderation service if this ships to real students.
const BLOCKED_WORDS = [
  "fuck", "fuk", "fuc", "shit", "sht", "bitch", "btch", "asshole", "bastard",
  "dick", "piss", "crap", "damn", "cunt", "slut", "whore", "douche", "twat",
  "prick", "cock", "wtf", "stfu",
];

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[$5]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z]/g, "");
}

function containsBlockedWord(text) {
  if (!text) return false;
  const norm = normalize(text);
  return BLOCKED_WORDS.some((w) => norm.includes(w));
}

function priceFor(categoryId, hours) {
  const cat = getCategory(categoryId);
  return cat.hourly ? cat.rate * (Number(hours) || 1) : cat.rate;
}

function emailValid(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

function phoneDigits(v) {
  return v.replace(/\D/g, "");
}

function formatPhone(v) {
  const d = phoneDigits(v).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function minutesOf(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function withinHours(t) {
  if (!t) return false;
  const mins = minutesOf(t);
  return mins >= minutesOf(OPEN_TIME) && mins <= minutesOf(CLOSE_TIME);
}

function payout(task) {
  const price = task.price || 0;
  const tip = task.tip || 0;
  const owner = price * OWNER_SHARE;
  return { gross: price + tip, tip, freshy: price * FRESHY_SHARE + tip, owner };
}

function luhnValid(num) {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function expiryValid(exp) {
  const m = exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const end = new Date(year, month, 1);
  return end > now;
}

function formatCardNumber(v) {
  return v.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(t) {
  if (!t || t === "ASAP") return "ASAP";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function rotationFor(id) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return (((sum % 5) - 2) * 0.9).toFixed(2);
}

function uid() {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

function makeCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function Doodles() {
  // Hand-drawn marginalia, the stuff that ends up on graph paper in class.
  const stroke = {
    fill: "none",
    stroke: "#1d4ed8",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  const items = [
    // stick figure waving
    { top: "6%", left: "4%", rot: -8, size: 62, svg: (
      <g {...stroke}>
        <circle cx="24" cy="10" r="7" />
        <path d="M24 17v18M24 22l-11 -7M24 22l11 -4M24 35l-8 13M24 35l8 13" />
      </g>
    )},
    // dog
    { top: "18%", right: "5%", rot: 7, size: 66, svg: (
      <g {...stroke}>
        <path d="M10 30h26v12H10z" />
        <path d="M13 42v7M22 42v7M33 42v7" />
        <path d="M36 30l8 -6v18z" />
        <circle cx="14" cy="24" r="7" />
        <path d="M9 19l-3 -6 6 2M19 19l3 -6 -6 2" />
        <circle cx="12" cy="24" r="1.4" fill="#1d4ed8" />
        <path d="M8 27h4" />
      </g>
    )},
    // pi
    { top: "30%", left: "7%", rot: 5, size: 44, svg: (
      <g {...stroke}>
        <path d="M6 12h30M13 12v22M27 12v18c0 4 4 4 6 2" />
      </g>
    )},
    // paper airplane
    { top: "42%", right: "8%", rot: -14, size: 58, svg: (
      <g {...stroke}>
        <path d="M4 22L44 6 30 44l-9 -13z" />
        <path d="M4 22l26 9" />
      </g>
    )},
    // summation
    { top: "54%", left: "5%", rot: -6, size: 46, svg: (
      <g {...stroke}>
        <path d="M32 8H10l12 13L10 36h22" />
      </g>
    )},
    // cat
    { top: "64%", right: "6%", rot: 9, size: 60, svg: (
      <g {...stroke}>
        <circle cx="22" cy="24" r="12" />
        <path d="M12 16l-2 -10 9 5M32 16l2 -10 -9 5" />
        <circle cx="18" cy="23" r="1.4" fill="#1d4ed8" />
        <circle cx="26" cy="23" r="1.4" fill="#1d4ed8" />
        <path d="M22 27l-2 2M22 27l2 2M8 26h-6M8 30h-6M36 26h6M36 30h6" />
      </g>
    )},
    // lightning bolt
    { top: "74%", left: "8%", rot: 12, size: 42, svg: (
      <g {...stroke}>
        <path d="M22 4L8 24h10L14 40 30 18H19z" />
      </g>
    )},
    // burger
    { top: "86%", right: "7%", rot: -5, size: 58, svg: (
      <g {...stroke}>
        <path d="M8 20c0-7 7-11 14-11s14 4 14 11z" />
        <path d="M7 25h30M7 31h30" />
        <path d="M8 34c0 5 6 7 14 7s14-2 14-7z" />
      </g>
    )},
    // plus/minus doodle
    { top: "12%", left: "44%", rot: 14, size: 36, svg: (
      <g {...stroke}>
        <path d="M6 12h14M13 5v14M24 26h14M24 20l14 12M24 32l14-12" />
      </g>
    )},
    // spiral
    { top: "48%", left: "45%", rot: 0, size: 40, svg: (
      <g {...stroke}>
        <path d="M20 20a4 4 0 1 1-4-4 8 8 0 1 1 8 8 12 12 0 1 1-12-12" />
      </g>
    )},
    // second stick figure, running
    { top: "92%", left: "40%", rot: -10, size: 58, svg: (
      <g {...stroke}>
        <circle cx="22" cy="9" r="6" />
        <path d="M22 15l-3 16M19 22l-10 3M19 22l11 -2M19 31l-8 11M19 31l10 9" />
      </g>
    )},
  ];

  return (
    <div className="doodle-layer" aria-hidden="true">
      {items.map((d, i) => (
        <svg
          key={i}
          viewBox="0 0 48 48"
          width={d.size}
          height={d.size}
          style={{
            position: "absolute",
            top: d.top,
            left: d.left,
            right: d.right,
            transform: `rotate(${d.rot}deg)`,
          }}
        >
          {d.svg}
        </svg>
      ))}
    </div>
  );
}

function Tack({ colorClass = "bg-blue-600" }) {
  return (
    <div
      className={`absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full tack flex items-center justify-center ${colorClass}`}
    >
      <Pin size={12} className="text-white -rotate-45" />
    </div>
  );
}

const emptyForm = {
  title: "",
  category: "tutoring",
  details: "",
  location: "",
  asap: false,
  time: "",
  hours: "1",
  subject: "math",
  level: 0,
};

export default function App() {
  const [me, setMe] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [nameError, setNameError] = useState("");
  const [tasks, setTasks] = useState([]);
  const [codes, setCodes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [payingOrder, setPayingOrder] = useState(null);
  const [stampId, setStampId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showApply, setShowApply] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [codeError, setCodeError] = useState("");
  const [tipDrafts, setTipDrafts] = useState({});
  const [showOwner, setShowOwner] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinError, setPinError] = useState("");
  const [copied, setCopied] = useState(null);
  const [boardError, setBoardError] = useState("");
  const [card, setCard] = useState({ number: "", exp: "", cvc: "", zip: "" });
  const [payError, setPayError] = useState("");
  const [paying, setPaying] = useState(false);
  const [owner, setOwner] = useState(null);
  const [view, setView] = useState("board");
  const [prefDraft, setPrefDraft] = useState(["tutoring", "food", "run"]);
  const [levelDraft, setLevelDraft] = useState(
    Object.fromEntries(SUBJECTS.map((sub) => [sub.id, -1]))
  );
  const [reports, setReports] = useState([]);
  const [reportFor, setReportFor] = useState(null);
  const [reportDraft, setReportDraft] = useState({ reason: REPORT_REASONS[0], note: "" });
  const [reportSent, setReportSent] = useState(null);
  const [expandedFreshy, setExpandedFreshy] = useState(null);
  const [revokeConfirm, setRevokeConfirm] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await window.storage.get(ME_KEY, false);
      if (res) setMe(JSON.parse(res.value));
    } catch (e) {
      /* no identity yet */
    }
  }, []);

  const loadBoard = useCallback(async () => {
    try {
      const res = await window.storage.get(TASKS_KEY, true);
      if (res) setTasks(JSON.parse(res.value));
    } catch (e) {
      // Key not written yet, or storage hiccuped. Keep what's on screen
      // rather than blanking the board.
    }
    try {
      const res = await window.storage.get(CODES_KEY, true);
      if (res) setCodes(JSON.parse(res.value));
    } catch (e) {
      /* same */
    }
    try {
      const res = await window.storage.get(OWNER_KEY, true);
      if (res) setOwner(JSON.parse(res.value));
    } catch (e) {
      /* owner not claimed yet */
    }
    try {
      const res = await window.storage.get(REPORTS_KEY, true);
      if (res) setReports(JSON.parse(res.value));
    } catch (e) {
      /* none filed yet */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!me || !me.isFreshy || codes.length === 0) return;
    const stillApproved = codes.some((c) => c.usedBy === me.name);
    if (!stillApproved) {
      saveIdentity({ ...me, isFreshy: false });
      setView("board");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, me]);

  useEffect(() => {
    loadMe();
    loadBoard();
    const interval = setInterval(loadBoard, 5000);
    return () => clearInterval(interval);
  }, [loadMe, loadBoard]);

  async function persistTasks(next) {
    setTasks(next);
    try {
      const res = await window.storage.set(TASKS_KEY, JSON.stringify(next), true);
      if (!res) throw new Error("no result");
      setBoardError("");
      return true;
    } catch (e) {
      setBoardError("Couldn't reach the board. Check your connection and try again.");
      return false;
    }
  }

  async function persistCodes(next) {
    setCodes(next);
    try {
      await window.storage.set(CODES_KEY, JSON.stringify(next), true);
    } catch (e) {
      console.error("Could not save codes", e);
    }
  }

  async function persistReports(next) {
    setReports(next);
    try {
      await window.storage.set(REPORTS_KEY, JSON.stringify(next), true);
      return true;
    } catch (e) {
      setBoardError("Couldn't file that report. Try again in a moment.");
      return false;
    }
  }

  async function saveIdentity(next) {
    setMe(next);
    try {
      await window.storage.set(ME_KEY, JSON.stringify(next), false);
    } catch (e) {
      console.error("Could not save your profile", e);
    }
  }

  function handleSetName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    if (containsBlockedWord(trimmed)) {
      setNameError("Pick a school-appropriate name to continue.");
      return;
    }
    const email = emailDraft.trim();
    const phone = phoneDigits(phoneDraft);
    if (!email && !phone) {
      setNameError("Add an email or phone number so your freshy can reach you.");
      return;
    }
    if (email && !emailValid(email)) {
      setNameError("That email doesn't look right.");
      return;
    }
    if (phone && phone.length !== 10) {
      setNameError("Phone numbers need 10 digits.");
      return;
    }
    setNameError("");
    saveIdentity({
      name: trimmed,
      email: email || null,
      phone: phone || null,
      isFreshy: false,
      isOwner: false,
    });
  }

  async function checkOwnerPin(value) {
    const entered = String(value ?? pinDraft).replace(/[^0-9]/g, "");
    if (entered !== OWNER_PIN) {
      setPinError("That PIN doesn't match.");
      return false;
    }
    if (owner && owner.name !== me.name) {
      setPinError("This console is already claimed.");
      return false;
    }
    setPinError("");
    setPinDraft("");
    const record = owner || { name: me.name, claimedAt: Date.now() };
    setOwner(record);
    try {
      await window.storage.set(OWNER_KEY, JSON.stringify(record), true);
    } catch (e) {
      /* keep local access even if the write fails */
    }
    saveIdentity({ ...(me || {}), isOwner: true });
    return true;
  }

  function onPinChange(raw) {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 4);
    setPinDraft(digits);
    setPinError("");
    if (digits.length === 4) checkOwnerPin(digits);
  }

  function issueCode() {
    let code = makeCode();
    const taken = new Set(codes.filter((c) => !c.usedBy).map((c) => c.code));
    let guard = 0;
    while (taken.has(code) && guard++ < 50) code = makeCode();
    persistCodes([{ code, createdAt: Date.now(), usedBy: null }, ...codes]);
  }

  function revokeCode(code) {
    persistCodes(codes.filter((c) => c.code !== code));
  }

  function redeemCode() {
    const entered = codeDraft.trim();
    const match = codes.find((c) => c.code === entered && !c.usedBy);
    if (!match) {
      setCodeError("That code isn't valid or has already been used.");
      return;
    }
    setCodeError("");
    setCodeDraft("");
    setShowApply(false);
    if (prefDraft.length === 0) {
      setCodeError("Pick at least one type of order you'll take.");
      return;
    }
    if (
      prefDraft.includes("tutoring") &&
      SUBJECTS.every((sub) => (levelDraft[sub.id] ?? -1) < 0)
    ) {
      setCodeError("Set your level in at least one subject to tutor.");
      return;
    }
    persistCodes(
      codes.map((c) =>
        c.code === entered
          ? { ...c, usedBy: me.name, usedAt: Date.now(), categories: prefDraft, levels: levelDraft }
          : c
      )
    );
    saveIdentity({ ...me, isFreshy: true });
    setView("freshy");
  }

  function reviewOrder(e) {
    e.preventDefault();
    if (!me) return;
    if (!form.title.trim() || !form.location.trim()) return;
    if (!form.asap && !form.time) {
      setFormError("Add a time, or mark it ASAP.");
      return;
    }
    if (!form.asap && !withinHours(form.time)) {
      setFormError("Freshy runs 8:00 AM to 7:30 PM. Pick a time in that window.");
      return;
    }
    if (containsBlockedWord(`${form.title} ${form.details} ${form.location}`)) {
      setFormError("Keep order slips school-appropriate — please edit your wording.");
      return;
    }
    setFormError("");
    setPayingOrder({
      title: form.title.trim(),
      category: form.category,
      details: form.details.trim(),
      location: form.location.trim(),
      time: form.asap ? "ASAP" : form.time,
      hours: getCategory(form.category).hourly ? Number(form.hours) || 1 : null,
      subject: form.category === "tutoring" ? form.subject : null,
      level: form.category === "tutoring" ? form.level : null,
      price: priceFor(form.category, form.hours),
    });
  }

  async function payAndPost() {
    if (!luhnValid(card.number)) {
      setPayError("That card number doesn't look right.");
      return;
    }
    if (!expiryValid(card.exp)) {
      setPayError("Check the expiration date (MM/YY).");
      return;
    }
    if (!/^\d{3,4}$/.test(card.cvc)) {
      setPayError("CVC should be 3 or 4 digits.");
      return;
    }
    if (!/^\d{5}$/.test(card.zip)) {
      setPayError("Enter a 5-digit ZIP code.");
      return;
    }
    const match = nextFreshy(
      payingOrder.category,
      [],
      me.name,
      payingOrder.subject,
      payingOrder.level ?? 0
    );
    if (!match) {
      setPayError("No qualified freshy is available, so we didn't charge your card.");
      return;
    }
    setPayError("");
    setPaying(true);
    const task = {
      ...payingOrder,
      id: uid(),
      postedBy: me.name,
      postedByEmail: me.email || null,
      postedByPhone: me.phone || null,
      status: "assigned",
      paid: true,
      cardLast4: card.number.replace(/\D/g, "").slice(-4),
      tip: 0,
      claimedBy: null,
      passedBy: [],
      createdAt: Date.now(),
    };
    task.assignedTo = match;
    const ok = await persistTasks([task, ...tasks]);
    setPaying(false);
    if (!ok) {
      setPayError("Payment held, but the order didn't reach the board. Try again.");
      return;
    }
    setForm(emptyForm);
    setCard({ number: "", exp: "", cvc: "", zip: "" });
    setPayingOrder(null);
    setShowForm(false);
  }

  function approvedFreshys() {
    return [...new Set(codes.filter((c) => c.usedBy).map((c) => c.usedBy))];
  }

  function qualifies(codeRecord, category, subject, level) {
    if (category !== "tutoring") return true;
    const theirs = codeRecord.levels?.[subject];
    return typeof theirs === "number" && theirs >= 0 && theirs >= level;
  }

  function nextFreshy(category, excludeNames = [], skipPoster = null, subject = null, level = 0) {
    const roster = codes
      .filter(
        (c) =>
          c.usedBy &&
          (!c.categories || c.categories.includes(category)) &&
          qualifies(c, category, subject, level) &&
          !excludeNames.includes(c.usedBy) &&
          c.usedBy !== skipPoster
      )
      .map((c) => c.usedBy);
    if (roster.length === 0) return null;
    const load = {};
    roster.forEach((n) => (load[n] = 0));
    tasks.forEach((t) => {
      if (t.assignedTo && load[t.assignedTo] !== undefined && t.status !== "closed") {
        load[t.assignedTo] += 1;
      }
    });
    return roster.sort((a, b) => load[a] - load[b])[0];
  }

  async function submitReport() {
    if (!reportFor || !me) return;
    const t = reportFor.task;
    const about = reportFor.about;
    const report = {
      id: "r_" + Date.now().toString(36),
      orderId: t.id,
      orderTitle: t.title,
      about,
      by: me.name,
      byContact: me.email || me.phone || null,
      reason: reportDraft.reason,
      note: reportDraft.note.trim(),
      status: "open",
      createdAt: Date.now(),
    };
    const ok = await persistReports([report, ...reports]);
    if (ok) {
      setReportFor(null);
      setReportDraft({ reason: REPORT_REASONS[0], note: "" });
      setReportSent(t.id);
      setTimeout(() => setReportSent((c) => (c === t.id ? null : c)), 3000);
    }
  }

  function resolveReport(id, status) {
    persistReports(reports.map((r) => (r.id === id ? { ...r, status, resolvedAt: Date.now() } : r)));
  }

  function removeFreshy(name) {
    persistCodes(codes.filter((c) => c.usedBy !== name));
  }

  function updateMyCategories(cats) {
    setPrefDraft(cats);
    if (!me || !me.isFreshy) return;
    persistCodes(codes.map((c) => (c.usedBy === me.name ? { ...c, categories: cats } : c)));
  }

  function updateMyLevels(levels) {
    setLevelDraft(levels);
    if (!me || !me.isFreshy) return;
    persistCodes(codes.map((c) => (c.usedBy === me.name ? { ...c, levels } : c)));
  }

  function declineTask(id) {
    if (!me) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const passed = [...(task.passedBy || []), me.name];
    const next = nextFreshy(task.category, passed, task.postedBy, task.subject, task.level ?? 0);
    persistTasks(
      tasks.map((t) =>
        t.id === id
          ? { ...t, passedBy: passed, assignedTo: next, status: next ? "assigned" : "unassigned" }
          : t
      )
    );
  }

  function acceptTask(id) {
    if (!me) return;
    const next = tasks.map((t) =>
      t.id === id
        ? {
            ...t,
            status: "claimed",
            claimedBy: me.name,
            claimedByEmail: me.email || null,
            claimedByPhone: me.phone || null,
            claimedAt: Date.now(),
          }
        : t
    );
    persistTasks(next);
    setStampId(id);
    setTimeout(() => setStampId((cur) => (cur === id ? null : cur)), 700);
  }

  function completeTask(id) {
    persistTasks(tasks.map((t) => (t.id === id ? { ...t, status: "done" } : t)));
    setStampId(id);
    setTimeout(() => setStampId((cur) => (cur === id ? null : cur)), 700);
  }

  function setTipFor(id, amount) {
    setTipDrafts((d) => ({ ...d, [id]: amount }));
  }

  function releasePayment(id) {
    const tip = tipDrafts[id] ?? 0;
    persistTasks(tasks.map((t) => (t.id === id ? { ...t, status: "closed", tip, closedAt: Date.now() } : t)));
    setStampId(id);
    setTimeout(() => setStampId((cur) => (cur === id ? null : cur)), 700);
  }

  function cancelTask(id) {
    persistTasks(tasks.filter((t) => t.id !== id));
  }

  function copyCode(code) {
    try {
      navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch (e) {
      /* clipboard unavailable */
    }
  }

  const visible = tasks
    .filter((t) => filter === "all" || t.category === filter)
    .sort((a, b) => {
      const order = { assigned: 0, unassigned: 1, claimed: 2, done: 3, closed: 4 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.createdAt - a.createdAt;
    });

  const latestOpen = tasks
    .filter((t) => t.status === "assigned" || t.status === "unassigned")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const myLevels =
    (me && codes.find((c) => c.usedBy === me.name)?.levels) || Object.fromEntries(SUBJECTS.map((sub) => [sub.id, -1]));

  const myCategories =
    (me && codes.find((c) => c.usedBy === me.name)?.categories) || ["tutoring", "food", "run"];

  const myQueue = me
    ? tasks
        .filter(
          (t) =>
            (t.assignedTo === me.name && t.status === "assigned") ||
            ((t.claimedBy === me.name) && t.status !== "closed")
        )
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];

  const myHistory = me ? tasks.filter((t) => t.claimedBy === me.name && t.status === "closed") : [];
  const myEarned = myHistory.reduce((sum, t) => sum + payout(t).freshy, 0);

  const openCodes = codes.filter((c) => !c.usedBy);
  const usedCodes = codes.filter((c) => c.usedBy);

  return (
    <div className="min-h-screen campus-bg pb-24">
      <style>{`
        .campus-bg {
          background-color: #F5F9FF;
          background-image:
            linear-gradient(rgba(37,99,235,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(37,99,235,0.07) 1px, transparent 1px);
          background-size: 26px 26px;
        }
        .doodle-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.13;
          z-index: 0;
        }
        .pin-card {
          background: #FFFFFF;
          box-shadow: 0 6px 14px rgba(30,64,175,0.13);
        }
        .tack { box-shadow: 0 2px 4px rgba(30,64,175,0.35); }
        @keyframes stampIn {
          0% { transform: scale(2.4) rotate(-18deg); opacity: 0; }
          55% { transform: scale(0.88) rotate(-9deg); opacity: 1; }
          100% { transform: scale(1) rotate(-7deg); opacity: 1; }
        }
        .stamp-anim { animation: stampIn 0.55s ease-out; }
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .marquee-track { display: inline-block; animation: marquee 16s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .stamp-anim { animation: none; }
          .marquee-track { animation: none; }
        }
      `}</style>

      <Doodles />

      <header className="relative z-10 border-b-4 border-orange-500 px-4 py-3 sticky top-0 z-20 bg-blue-600">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="text-orange-400" size={22} />
              <h1 className="text-2xl font-black uppercase tracking-tight text-white">Freshy</h1>
            </div>
            <p className="text-blue-100 text-xs mt-0.5">Campus errands, on demand.</p>
          </div>
          <div className="flex items-center gap-2">
            {LOGO_URL ? (
              <img
                src={LOGO_URL}
                alt="Lake Forest Academy"
                className="h-10 w-auto object-contain drop-shadow-sm"
              />
            ) : (
              <div className="flex flex-col items-center justify-center bg-white/95 rounded-sm px-2 py-1 leading-none">
                <span className="text-[15px] font-black tracking-tight text-blue-700">LFA</span>
                <span className="text-[7px] font-bold uppercase tracking-widest text-slate-500">Caxys</span>
              </div>
            )}
          {me && (!owner || owner.name === me.name) && (
            <button
              onClick={() => setShowOwner((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-blue-100 border border-blue-400 rounded-sm px-2 py-1"
            >
              <ShieldCheck size={12} /> {me.isOwner ? "Admin" : "Owner"}
              {me.isOwner && reports.some((r) => r.status === "open") && (
                <span className="bg-red-500 text-white text-[9px] px-1 rounded-full">
                  {reports.filter((r) => r.status === "open").length}
                </span>
              )}
            </button>
          )}
          </div>
        </div>
      </header>

      <div className="relative z-10 bg-orange-500 text-slate-900 overflow-hidden whitespace-nowrap py-1.5 px-2 flex items-center gap-2 text-sm font-semibold">
        <Megaphone size={16} className="shrink-0" />
        <div className="overflow-hidden w-full">
          <span className="marquee-track">
            {latestOpen
              ? `NOW DISPATCHING — ${latestOpen.postedBy} needs "${latestOpen.title}" · $${latestOpen.price.toFixed(2)} · prepaid`
              : "Dispatch board is quiet... post the first order!"}
          </span>
        </div>
      </div>

      <main className="relative z-10 px-3 pt-4 max-w-md mx-auto">
        {reportFor && (
          <div className="fixed inset-0 z-30 bg-slate-900/50 flex items-end sm:items-center justify-center px-3 pb-6">
            <div className="bg-white rounded-sm w-full max-w-md p-4 shadow-xl">
              <div className="flex items-start justify-between mb-2">
                <h2 className="font-black uppercase text-sm tracking-wide text-red-700 flex items-center gap-1">
                  <Flag size={15} /> Report {reportFor.about}
                </h2>
                <button onClick={() => setReportFor(null)} className="text-slate-400">
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                About "{reportFor.task.title}". This goes straight to Freshy HQ — the person you're
                reporting won't see it.
              </p>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                What happened?
              </label>
              <div className="space-y-1.5 mt-1.5 mb-3">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReportDraft({ ...reportDraft, reason: r })}
                    className={`w-full text-left text-sm px-2.5 py-2 rounded-sm border ${
                      reportDraft.reason === r
                        ? "bg-red-50 text-red-800 border-red-300 font-semibold"
                        : "bg-white text-slate-600 border-slate-200"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Anything else? (optional)
              </label>
              <textarea
                value={reportDraft.note}
                onChange={(e) => setReportDraft({ ...reportDraft, note: e.target.value })}
                rows={3}
                placeholder="Details help HQ sort this out."
                className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1 mb-3"
              />
              {SERIOUS_REASONS.includes(reportDraft.reason) && (
                <div className="border-2 border-orange-400 bg-orange-50 rounded-sm p-3 mb-3">
                  <p className="text-sm font-bold text-orange-900 flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={15} /> Please tell an adult too
                  </p>
                  <p className="text-xs text-orange-900 leading-relaxed">
                    For anything like harassment, threats, or being touched without your consent, this
                    app isn't enough on its own. Tell a teacher, counselor, coach, parent, or another
                    adult you trust — today if you can. They can do things Freshy can't. If you're in
                    immediate danger, call 911.
                  </p>
                  <p className="text-xs text-orange-900 leading-relaxed mt-1.5">
                    What happened isn't your fault, and you're not in trouble for saying something.
                  </p>
                </div>
              )}

              <button
                onClick={submitReport}
                className="w-full bg-red-600 text-white font-bold uppercase tracking-wide text-sm py-2.5 rounded-sm"
              >
                Send report
              </button>
              <p className="text-[11px] text-slate-400 text-center mt-2">
                Serious? Tell a teacher, counselor, or trusted adult too — don't wait on this queue.
              </p>
            </div>
          </div>
        )}

        {boardError && (
          <div className="bg-red-50 border border-red-300 text-red-700 text-xs font-semibold rounded-sm px-3 py-2 mb-3">
            {boardError}
          </div>
        )}
        {/* Owner panel */}
        {me && showOwner && (
          <div className="pin-card rounded-sm p-4 mb-4 border-2 border-blue-600 relative">
            <button onClick={() => setShowOwner(false)} className="absolute top-2 right-2 text-slate-400">
              <X size={16} />
            </button>
            <h2 className="font-black uppercase text-sm tracking-wide text-blue-700 mb-2 flex items-center gap-1">
              <ShieldCheck size={15} /> Owner console
            </h2>
            {owner && owner.name !== me.name ? (
              <p className="text-xs text-slate-600">
                This console belongs to {owner.name}. Only they can issue Freshy codes.
              </p>
            ) : !me.isOwner ? (
              <div>
                <p className="text-xs text-slate-600 mb-2">
                  {owner
                    ? "Enter your PIN to get back into your console."
                    : "Enter the owner PIN to claim this console. Once claimed, no one else can open it."}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    maxLength={4}
                    value={pinDraft}
                    onChange={(e) => onPinChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && checkOwnerPin()}
                    placeholder="4-digit PIN"
                    className="flex-1 border border-slate-300 rounded-sm px-2 py-2 text-lg font-black tracking-[0.4em] text-center bg-white"
                  />
                  <button onClick={() => checkOwnerPin()} className="bg-blue-600 text-white text-sm font-semibold px-4 rounded-sm">
                    Unlock
                  </button>
                </div>
                {pinError && <p className="text-red-600 text-xs mt-1.5">{pinError}</p>}
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-600 mb-3">
                  Interview an applicant, then generate a code and send it to them yourself. Each code works once.
                </p>
                <button
                  onClick={issueCode}
                  className="w-full bg-orange-600 text-white font-bold uppercase tracking-wide text-xs py-2 rounded-sm mb-3 flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Generate a 4-digit code
                </button>

                {openCodes.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1">Unused codes</p>
                    <div className="space-y-1.5 mb-3">
                      {openCodes.map((c) => (
                        <div key={c.code} className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-sm px-2.5 py-1.5">
                          <span className="font-black text-lg tracking-[0.3em] text-blue-800">{c.code}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => copyCode(c.code)} className="text-blue-700 p-1" aria-label="Copy code">
                              {copied === c.code ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                            </button>
                            <button onClick={() => revokeCode(c.code)} className="text-slate-400 p-1" aria-label="Revoke code">
                              <X size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {(() => {
                  const openReports = reports.filter((r) => r.status === "open");
                  const pastReports = reports.filter((r) => r.status !== "open");
                  if (reports.length === 0) {
                    return (
                      <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 mb-3">
                        <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Reports</p>
                        <p className="text-xs text-slate-500 mt-1">No reports filed. All quiet.</p>
                      </div>
                    );
                  }
                  return (
                    <div className="mb-3">
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} className={openReports.length ? "text-red-600" : "text-slate-400"} />
                        Reports
                        {openReports.length > 0 && (
                          <span className="bg-red-600 text-white text-[10px] px-1.5 rounded-full">
                            {openReports.length} new
                          </span>
                        )}
                      </p>
                      <div className="space-y-2">
                        {openReports.map((r) => (
                          <div key={r.id} className="border border-red-200 bg-red-50 rounded-sm p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-red-900">{r.about}</span>
                              <span className="text-[10px] text-red-400">{timeAgo(r.createdAt)}</span>
                            </div>
                            <p className="text-xs text-red-800 font-semibold mt-0.5">{r.reason}</p>
                            {SERIOUS_REASONS.includes(r.reason) && (
                              <p className="text-[11px] font-bold text-orange-800 bg-orange-100 border border-orange-300 rounded-sm px-2 py-1 mt-1.5">
                                Loop in a school adult — this one isn't yours to handle alone.
                              </p>
                            )}
                            {r.note && <p className="text-xs text-slate-600 mt-1">{r.note}</p>}
                            <p className="text-[11px] text-slate-500 mt-1.5">
                              From {r.by}
                              {r.byContact ? ` · ${r.byContact}` : ""} · order "{r.orderTitle}"
                            </p>
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={() => resolveReport(r.id, "dismissed")}
                                className="flex-1 text-[11px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-sm border border-slate-300 bg-white text-slate-600"
                              >
                                Dismiss
                              </button>
                              <button
                                onClick={() => resolveReport(r.id, "warned")}
                                className="flex-1 text-[11px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-sm bg-orange-600 text-white"
                              >
                                Warned
                              </button>
                              {codes.some((c) => c.usedBy === r.about) && (
                                <button
                                  onClick={() => {
                                    removeFreshy(r.about);
                                    resolveReport(r.id, "removed");
                                  }}
                                  className="flex-1 text-[11px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-sm bg-red-600 text-white"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {pastReports.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] uppercase font-bold text-slate-300 tracking-wide mb-1">
                            Handled
                          </p>
                          {pastReports.map((r) => (
                            <div key={r.id} className="flex items-center justify-between text-[11px] text-slate-400 px-1 py-0.5">
                              <span>{r.about} — {r.reason}</span>
                              <span className="uppercase font-bold">{r.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {(() => {
                  const closed = tasks.filter((t) => t.status === "closed");
                  const totals = closed.reduce(
                    (acc, t) => {
                      const sp = payout(t);
                      acc.gross += sp.gross;
                      acc.owner += sp.owner;
                      acc.freshy += sp.freshy;
                      return acc;
                    },
                    { gross: 0, owner: 0, freshy: 0 }
                  );
                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-sm p-3 mb-3">
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1.5">
                        Earnings · {closed.length} completed order{closed.length === 1 ? "" : "s"}
                      </p>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Your cut (40%)</span>
                        <span className="font-black text-emerald-700">${totals.owner.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs mt-0.5">
                        <span className="text-slate-400">Paid to freshys (60% + tips)</span>
                        <span className="font-semibold text-slate-500">${totals.freshy.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs mt-0.5 pt-1 border-t border-slate-200">
                        <span className="text-slate-400">Total volume</span>
                        <span className="font-semibold text-slate-500">${totals.gross.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}

                {usedCodes.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1.5">
                      Freshy roster · {usedCodes.length}
                    </p>
                    <div className="space-y-2">
                      {usedCodes.map((c) => {
                        const theirs = tasks.filter((t) => t.claimedBy === c.usedBy || t.assignedTo === c.usedBy);
                        const active = theirs.filter((t) => t.status === "assigned" || t.status === "claimed" || t.status === "done");
                        const done = theirs.filter((t) => t.status === "closed");
                        const earned = done.reduce((sum, t) => sum + payout(t).freshy, 0);
                        const passed = tasks.filter((t) => (t.passedBy || []).includes(c.usedBy)).length;
                        const flags = reports.filter((r) => r.about === c.usedBy);
                        const openFlags = flags.filter((r) => r.status === "open").length;
                        const expanded = expandedFreshy === c.usedBy;
                        return (
                          <div key={c.code} className="border border-slate-200 rounded-sm">
                            <button
                              onClick={() => setExpandedFreshy(expanded ? null : c.usedBy)}
                              className="w-full flex items-center justify-between px-2.5 py-2 text-left"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm text-slate-800">{c.usedBy}</span>
                                {openFlags > 0 && (
                                  <span className="bg-red-600 text-white text-[9px] font-bold px-1.5 rounded-full">
                                    {openFlags}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                <span>{active.length} active</span>
                                <span className="text-emerald-700 font-bold">${earned.toFixed(2)}</span>
                              </div>
                            </button>

                            {expanded && (
                              <div className="px-2.5 pb-2.5 border-t border-slate-100 pt-2">
                                <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                                  <div className="bg-slate-50 rounded-sm py-1.5">
                                    <p className="text-sm font-black text-slate-700">{done.length}</p>
                                    <p className="text-[9px] uppercase font-bold text-slate-400">Done</p>
                                  </div>
                                  <div className="bg-slate-50 rounded-sm py-1.5">
                                    <p className="text-sm font-black text-slate-700">{passed}</p>
                                    <p className="text-[9px] uppercase font-bold text-slate-400">Passed</p>
                                  </div>
                                  <div className="bg-slate-50 rounded-sm py-1.5">
                                    <p className="text-sm font-black text-slate-700">{flags.length}</p>
                                    <p className="text-[9px] uppercase font-bold text-slate-400">Reports</p>
                                  </div>
                                </div>

                                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Takes</p>
                                <p className="text-xs text-slate-600 mb-2">
                                  {(c.categories || ["tutoring", "food", "run"])
                                    .map((id) => getCategory(id).label)
                                    .join(" · ")}
                                </p>
                                {(c.categories || []).includes("tutoring") && c.levels && (
                                  <>
                                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">
                                      Tutors up to
                                    </p>
                                    <p className="text-xs text-slate-600 mb-2">
                                      {SUBJECTS.filter((sub) => (c.levels[sub.id] ?? -1) >= 0)
                                        .map((sub) => `${sub.label}: ${sub.levels[c.levels[sub.id]]}`)
                                        .join(" · ") || "No subjects set"}
                                    </p>
                                  </>
                                )}

                                {active.length > 0 && (
                                  <>
                                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">
                                      Current orders
                                    </p>
                                    <div className="space-y-1 mb-2">
                                      {active.map((t) => (
                                        <div key={t.id} className="flex items-center justify-between text-xs">
                                          <span className="text-slate-600 truncate pr-2">{t.title}</span>
                                          <span className="text-[10px] uppercase font-bold text-blue-600 shrink-0">
                                            {t.status}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}

                                <button
                                  onClick={() => {
                                    if (revokeConfirm === c.usedBy) {
                                      removeFreshy(c.usedBy);
                                      setRevokeConfirm(null);
                                      setExpandedFreshy(null);
                                    } else {
                                      setRevokeConfirm(c.usedBy);
                                    }
                                  }}
                                  className={`w-full text-[11px] font-bold uppercase tracking-wide py-1.5 rounded-sm ${
                                    revokeConfirm === c.usedBy
                                      ? "bg-red-600 text-white"
                                      : "border border-red-300 text-red-600 bg-white"
                                  }`}
                                >
                                  {revokeConfirm === c.usedBy
                                    ? "Tap again to confirm"
                                    : "Revoke freshy status"}
                                </button>
                                {active.length > 0 && revokeConfirm === c.usedBy && (
                                  <p className="text-[10px] text-orange-700 text-center mt-1">
                                    They have {active.length} order{active.length === 1 ? "" : "s"} in
                                    progress — reassign or close those first.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Identity card */}
        <div className="pin-card rounded-sm px-4 py-3 mb-4 relative">
          <Tack />
          {!me ? (
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                What should we call you?
              </label>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Your name"
                className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1.5 mb-3"
              />

              <label className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                How can your freshy reach you?
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5 mb-1.5">
                Email, phone, or both — at least one. Only shared once someone takes your order.
              </p>
              <div className="flex items-center gap-1.5 mb-2">
                <Mail size={14} className="text-slate-400 shrink-0" />
                <input
                  type="email"
                  inputMode="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="you@school.edu"
                  className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white"
                />
              </div>
              <div className="flex items-center gap-1.5 mb-3">
                <Phone size={14} className="text-slate-400 shrink-0" />
                <input
                  type="tel"
                  inputMode="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(formatPhone(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && handleSetName()}
                  placeholder="(555) 123-4567"
                  className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white"
                />
              </div>
              <button
                onClick={handleSetName}
                className="w-full bg-blue-600 text-white text-sm font-bold uppercase tracking-wide py-2 rounded-sm"
              >
                Create profile
              </button>
              {nameError && <p className="text-red-600 text-xs mt-1.5">{nameError}</p>}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-slate-500" />
                  <div>
                    <span className="font-bold text-slate-800 block leading-tight">{me.name}</span>
                    <span className="text-[11px] text-slate-400">
                      {me.email || (me.phone ? formatPhone(me.phone) : "No contact saved")}
                    </span>
                  </div>
                </div>
                {me.isFreshy ? (
                  <span className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-sm bg-emerald-600 text-white flex items-center gap-1">
                    <CheckCircle2 size={13} /> Approved Freshy
                  </span>
                ) : (
                  <button
                    onClick={() => setShowApply((v) => !v)}
                    className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-sm border bg-white text-blue-700 border-blue-300"
                  >
                    Become a Freshy
                  </button>
                )}
              </div>

              {!me.isFreshy && showApply && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-xs text-slate-600 mb-2">
                    Every freshy is interviewed first. Reach out to set one up:
                  </p>
                  <div className="flex flex-col gap-1.5 mb-3">
                    <a href={`mailto:${OWNER_EMAIL}`} className="flex items-center gap-1.5 text-sm text-blue-700 font-semibold">
                      <Mail size={14} /> {OWNER_EMAIL}
                    </a>
                    <a href={`tel:${OWNER_PHONE_RAW}`} className="flex items-center gap-1.5 text-sm text-blue-700 font-semibold">
                      <Phone size={14} /> {OWNER_PHONE}
                    </a>
                  </div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Which orders will you take?
                  </label>
                  <div className="flex gap-1.5 mt-1.5 mb-3">
                    {CATEGORIES.map((c) => {
                      const Icon = c.icon;
                      const on = prefDraft.includes(c.id);
                      return (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() =>
                            setPrefDraft(
                              on ? prefDraft.filter((x) => x !== c.id) : [...prefDraft, c.id]
                            )
                          }
                          className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-sm border text-[11px] font-semibold ${
                            on ? `${c.light} ${c.text} border-current` : "bg-white text-slate-400 border-slate-200"
                          }`}
                        >
                          <Icon size={15} /> {c.label}
                        </button>
                      );
                    })}
                  </div>
                  {prefDraft.includes("tutoring") && (
                    <div className="mb-3">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Your highest level
                      </label>
                      <p className="text-[11px] text-slate-400 mt-0.5 mb-1.5">
                        You'll only get students at your level or below.
                      </p>
                      {SUBJECTS.map((sub) => (
                        <div key={sub.id} className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-slate-600 w-20 shrink-0">
                            {sub.label}
                          </span>
                          <select
                            value={levelDraft[sub.id] ?? -1}
                            onChange={(e) =>
                              setLevelDraft({ ...levelDraft, [sub.id]: Number(e.target.value) })
                            }
                            className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white"
                          >
                            <option value={-1}>Don't tutor this</option>
                            {sub.levels.map((lvl, i) => (
                              <option key={lvl} value={i}>
                                {lvl}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <KeyRound size={12} /> Got your code after the interview?
                  </label>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={codeDraft}
                      onChange={(e) => setCodeDraft(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && redeemCode()}
                      placeholder="4-digit code"
                      className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white tracking-[0.3em] font-bold"
                    />
                    <button onClick={redeemCode} className="bg-emerald-600 text-white text-sm font-semibold px-3 rounded-sm">
                      Verify
                    </button>
                  </div>
                  {codeError && <p className="text-red-600 text-xs mt-1.5">{codeError}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {me && me.isFreshy && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setView("board")}
              className={`flex-1 text-xs font-bold uppercase tracking-wide py-2 rounded-sm border ${
                view === "board" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-200"
              }`}
            >
              Order board
            </button>
            <button
              onClick={() => setView("freshy")}
              className={`flex-1 text-xs font-bold uppercase tracking-wide py-2 rounded-sm border flex items-center justify-center gap-1 ${
                view === "freshy" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-200"
              }`}
            >
              My shifts
              {myQueue.length > 0 && (
                <span className={`text-[10px] px-1.5 rounded-full ${view === "freshy" ? "bg-white text-emerald-700" : "bg-emerald-600 text-white"}`}>
                  {myQueue.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Freshy dashboard */}
        {me && me.isFreshy && view === "freshy" && (
          <div className="mb-4">
            <div className="pin-card rounded-sm p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Earned</p>
                  <p className="text-2xl font-black text-emerald-700">${myEarned.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">Completed</p>
                  <p className="text-2xl font-black text-slate-700">{myHistory.length}</p>
                </div>
              </div>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1.5">
                Orders you accept
              </p>
              <div className="flex gap-1.5">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  const on = myCategories.includes(c.id);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() =>
                        updateMyCategories(
                          on ? myCategories.filter((x) => x !== c.id) : [...myCategories, c.id]
                        )
                      }
                      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-sm border text-[11px] font-semibold ${
                        on ? `${c.light} ${c.text} border-current` : "bg-white text-slate-400 border-slate-200"
                      }`}
                    >
                      <Icon size={15} /> {c.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Turn one off and those orders stop coming to you.
              </p>

              {myCategories.includes("tutoring") && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1.5">
                    Your tutoring levels
                  </p>
                  {SUBJECTS.map((sub) => {
                    const current = myLevels[sub.id] ?? -1;
                    return (
                      <div key={sub.id} className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-slate-600 w-20 shrink-0">{sub.label}</span>
                        <select
                          value={current}
                          onChange={(e) =>
                            updateMyLevels({ ...myLevels, [sub.id]: Number(e.target.value) })
                          }
                          className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white"
                        >
                          <option value={-1}>Don't tutor this</option>
                          {sub.levels.map((lvl, i) => (
                            <option key={lvl} value={i}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <h2 className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2 px-1">
              Your queue
            </h2>
            {myQueue.length === 0 && (
              <div className="pin-card rounded-sm p-6 text-center">
                <p className="text-slate-600 text-sm font-medium">
                  No orders right now. You'll see them here the moment one comes in.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        {view === "board" && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
          <button
            onClick={() => setFilter("all")}
            className={`shrink-0 text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-full border ${
              filter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-200"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = filter === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={`shrink-0 flex items-center gap-1 text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-full border ${
                  active ? `${c.bg} text-white border-transparent` : "bg-white text-blue-700 border-blue-200"
                }`}
              >
                <Icon size={13} /> {c.label}
              </button>
            );
          })}
        </div>
        )}

        {/* Checkout step */}
        {view === "board" && payingOrder ? (
          <div className="pin-card rounded-sm p-4 mb-4 border-2 border-orange-500">
            <h2 className="font-black uppercase text-sm tracking-wide text-slate-700 mb-3 flex items-center gap-1">
              <CreditCard size={15} /> Pay to post
            </h2>
            <div className="bg-blue-50 rounded-sm p-3 mb-3">
              <p className="font-bold text-slate-800 text-sm">{payingOrder.title}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
                <span className="flex items-center gap-1"><MapPin size={11} /> {payingOrder.location}</span>
                <span className="flex items-center gap-1"><Timer size={11} /> {formatTime(payingOrder.time)}</span>
                {payingOrder.hours && <span>{payingOrder.hours} hr session</span>}
              </div>
            </div>
            {(() => {
              const match = nextFreshy(
                payingOrder.category,
                [],
                me.name,
                payingOrder.subject,
                payingOrder.level ?? 0
              );
              if (match) return null;
              const isTutoring = payingOrder.category === "tutoring";
              return (
                <div className="border-2 border-orange-400 bg-orange-50 rounded-sm p-3 mb-3">
                  <p className="text-sm font-bold text-orange-900 flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={15} /> No freshy available
                  </p>
                  <p className="text-xs text-orange-900 leading-relaxed">
                    {isTutoring
                      ? `Nobody on shift right now tutors ${getSubject(payingOrder.subject).label} at ${
                          getSubject(payingOrder.subject).levels[payingOrder.level ?? 0]
                        } or above. You won't be charged — try a different time or check back later.`
                      : "Nobody is on shift for this kind of order right now. You won't be charged."}
                  </p>
                </div>
              );
            })()}

            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-slate-500">Order total</span>
              <span className="font-black text-slate-800 text-lg">${payingOrder.price.toFixed(2)}</span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              We hold your payment until your freshy delivers. You can add a tip when it's done — your freshy keeps 60% of the order and 100% of any tip.
            </p>
            <div className="space-y-2 mb-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Card number</label>
                <input
                  inputMode="numeric"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })}
                  placeholder="1234 5678 9012 3456"
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1 tracking-wider"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Expires</label>
                  <input
                    inputMode="numeric"
                    value={card.exp}
                    onChange={(e) => {
                      let v = e.target.value.replace(/\D/g, "").slice(0, 4);
                      if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
                      setCard({ ...card, exp: v });
                    }}
                    placeholder="MM/YY"
                    className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1"
                  />
                </div>
                <div className="w-20">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">CVC</label>
                  <input
                    inputMode="numeric"
                    value={card.cvc}
                    onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    placeholder="123"
                    className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1"
                  />
                </div>
                <div className="w-24">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">ZIP</label>
                  <input
                    inputMode="numeric"
                    value={card.zip}
                    onChange={(e) => setCard({ ...card, zip: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                    placeholder="60045"
                    className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1"
                  />
                </div>
              </div>
            </div>

            {payError && <p className="text-red-600 text-xs mb-2">{payError}</p>}

            <button
              onClick={payAndPost}
              disabled={
                paying ||
                !nextFreshy(
                  payingOrder.category,
                  [],
                  me.name,
                  payingOrder.subject,
                  payingOrder.level ?? 0
                )
              }
              className="w-full bg-emerald-600 disabled:opacity-60 text-white font-bold uppercase tracking-wide text-sm py-2.5 rounded-sm mb-2"
            >
              {paying ? "Processing..." : `Pay $${payingOrder.price.toFixed(2)} & post`}
            </button>
            <button
              onClick={() => setPayingOrder(null)}
              className="w-full text-slate-500 font-semibold text-xs uppercase tracking-wide py-1"
            >
              Back to edit
            </button>
          </div>
        ) : view === "board" && !showForm ? (
          <button
            onClick={() => setShowForm(true)}
            disabled={!me}
            className="w-full mb-4 flex items-center justify-center gap-2 bg-orange-600 disabled:opacity-50 text-white font-bold uppercase tracking-wide text-sm py-2.5 rounded-sm shadow"
          >
            <Plus size={16} /> Post an order
          </button>
        ) : view === "board" ? (
          <form onSubmit={reviewOrder} className="pin-card rounded-sm p-4 mb-4 relative">
            <button type="button" onClick={() => setShowForm(false)} className="absolute top-2 right-2 text-slate-400">
              <X size={18} />
            </button>
            <h2 className="font-black uppercase text-sm tracking-wide text-slate-700 mb-3">New order slip</h2>

            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What do you need?</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder='e.g. "Grab my charger from locker 214"'
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1 mb-3"
              required
            />

            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</label>
            <div className="flex gap-2 mt-1 mb-3">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const active = form.category === c.id;
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setForm({ ...form, category: c.id })}
                    className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-sm border text-xs font-semibold ${
                      active ? `${c.light} ${c.text} border-current` : "bg-white text-slate-500 border-slate-200"
                    }`}
                  >
                    <Icon size={16} /> {c.label}
                    <span className="text-[10px] font-bold opacity-70">
                      ${c.rate}{c.hourly ? "/hr" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Where?</label>
            <div className="flex items-center gap-1 mt-1 mb-3">
              <MapPin size={14} className="text-slate-400 shrink-0" />
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Room B12 / front quad / locker 214"
                className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white"
                required
              />
            </div>

            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">When do you need it?</label>
            <div className="flex items-center gap-2 mt-1 mb-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, asap: !form.asap, time: "" })}
                className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wide px-3 py-2 rounded-sm border ${
                  form.asap ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-500 border-slate-200"
                }`}
              >
                <Zap size={13} /> ASAP
              </button>
              {!form.asap && (
                <div className="flex-1 flex items-center gap-1">
                  <Timer size={14} className="text-slate-400 shrink-0" />
                  <input
                    type="time"
                    min={OPEN_TIME}
                    max={CLOSE_TIME}
                    step={900}
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                    className="flex-1 border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white"
                    required={!form.asap}
                  />
                </div>
              )}
            </div>

            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Details (optional)</label>
            <textarea
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              placeholder="Anything a freshy should know"
              rows={2}
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-sm bg-white mt-1 mb-3"
            />

            {form.category === "tutoring" && (
              <>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Subject</label>
                <div className="grid grid-cols-3 gap-1.5 mt-1 mb-3">
                  {SUBJECTS.map((sub) => (
                    <button
                      type="button"
                      key={sub.id}
                      onClick={() => setForm({ ...form, subject: sub.id, level: 0 })}
                      className={`text-xs font-bold px-2 py-2 rounded-sm border ${
                        form.subject === sub.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-300"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  What class are you in?
                </label>
                <select
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded-sm px-2 py-2 text-sm bg-white mt-1 mb-3"
                >
                  {getSubject(form.subject).levels.map((lvl, i) => (
                    <option key={lvl} value={i}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </>
            )}

            {getCategory(form.category).hourly && (
              <>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">How many hours?</label>
                <div className="flex gap-1.5 mt-1 mb-3">
                  {[1, 1.5, 2, 3].map((h) => (
                    <button
                      type="button"
                      key={h}
                      onClick={() => setForm({ ...form, hours: String(h) })}
                      className={`flex-1 text-xs font-bold px-2 py-1.5 rounded-sm border ${
                        form.hours === String(h)
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-300"
                      }`}
                    >
                      {h} hr{h > 1 ? "s" : ""}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-sm px-3 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Set price</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {getCategory(form.category).hourly
                    ? `$${getCategory(form.category).rate}/hr × ${form.hours} hr`
                    : `Flat rate — ${getCategory(form.category).label}`}
                </p>
              </div>
              <span className="text-2xl font-black text-blue-800">
                ${priceFor(form.category, form.hours).toFixed(2)}
              </span>
            </div>

            {formError && <p className="text-red-600 text-xs mt-2">{formError}</p>}

            <button type="submit" className="w-full bg-blue-600 text-white font-bold uppercase tracking-wide text-sm py-2.5 rounded-sm mt-3">
              Continue to payment
            </button>
          </form>
        ) : null}

        {/* Board */}
        {!loaded ? (
          <p className="text-center text-slate-500 text-sm py-8">Loading the board...</p>
        ) : (view === "freshy" ? myQueue : visible).length === 0 ? (
          view === "freshy" ? null : (
          <div className="pin-card rounded-sm p-6 text-center relative">
            <Tack />
            <p className="text-slate-600 text-sm font-medium">Nothing posted in this category yet. Be the first!</p>
          </div>
          )
        ) : (
          <div className="space-y-5">
            {(view === "freshy" ? myQueue : visible).map((t) => {
              const cat = getCategory(t.category);
              const Icon = cat.icon;
              const rot = rotationFor(t.id);
              const mine = me && t.postedBy === me.name;
              const assignedToMe = me && me.isFreshy && t.assignedTo === me.name && t.status === "assigned";
              const canComplete = me && t.status === "claimed" && t.claimedBy === me.name;
              const canCancel = me && (t.status === "assigned" || t.status === "unassigned") && mine;
              const split = payout(t);
              return (
                <div key={t.id} className="pin-card rounded-sm relative" style={{ transform: `rotate(${rot}deg)` }}>
                  <Tack colorClass={cat.bg} />
                  {canCancel && (
                    <button onClick={() => cancelTask(t.id)} className="absolute top-2 right-2 text-slate-400" aria-label="Cancel order">
                      <X size={16} />
                    </button>
                  )}
                  <div className="p-4 pb-3">
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <div className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cat.chip}`}>
                        <Icon size={11} /> {cat.label}
                      </div>
                      {t.paid && t.status !== "closed" && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300">
                          <CheckCircle2 size={11} /> Prepaid{t.cardLast4 ? ` ••${t.cardLast4}` : ""}
                        </div>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-800 leading-snug pr-4">{t.title}</h3>
                    {t.details && <p className="text-sm text-slate-500 mt-1">{t.details}</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-2">
                      <span className="flex items-center gap-1"><MapPin size={11} /> {t.location}</span>
                      <span className="flex items-center gap-1"><Timer size={11} /> {formatTime(t.time)}</span>
                      {t.hours && <span>{t.hours} hr</span>}
                      {t.subject && (
                        <span className="font-semibold text-blue-700">
                          {getSubject(t.subject).label} · {getSubject(t.subject).levels[t.level ?? 0]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                      <Clock size={11} /> Posted by {t.postedBy} · {timeAgo(t.createdAt)}
                    </div>
                  </div>

                  <div className="border-t-2 border-dashed border-slate-200 mx-3" />

                  <div className="p-4 pt-3 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black text-slate-800">
                        ${t.price.toFixed(2)}
                        {t.status === "closed" && t.tip > 0 && (
                          <span className="text-sm font-bold text-emerald-600"> +${t.tip.toFixed(2)} tip</span>
                        )}
                      </span>
                      {t.status === "assigned" && assignedToMe && (
                        <div className="flex gap-1.5">
                          <button onClick={() => declineTask(t.id)} className="text-slate-500 text-xs font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-sm border border-slate-300">
                            Pass
                          </button>
                          <button onClick={() => acceptTask(t.id)} className="bg-emerald-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-sm">
                            Accept
                          </button>
                        </div>
                      )}
                      {t.status === "assigned" && !assignedToMe && (
                        <span className="text-xs text-blue-600 font-semibold uppercase">
                          Sent to {t.assignedTo}
                        </span>
                      )}
                      {t.status === "unassigned" && (
                        <span className="text-xs text-orange-600 font-bold uppercase">
                          No freshy available
                        </span>
                      )}
                      {t.status === "claimed" && (
                        <>
                          <span className="text-xs text-slate-500 font-semibold">Claimed by {t.claimedBy}</span>
                          {canComplete && (
                            <button onClick={() => completeTask(t.id)} className="bg-blue-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-sm flex items-center gap-1">
                              <CheckCircle2 size={13} /> Delivered
                            </button>
                          )}
                        </>
                      )}
                      {t.status === "done" && !mine && (
                        <span className="text-xs text-orange-600 font-bold uppercase">Awaiting confirmation</span>
                      )}
                      {t.status === "closed" && (
                        <span className="text-xs text-emerald-700 font-bold uppercase flex items-center gap-1">
                          <CheckCircle2 size={13} /> Paid out
                        </span>
                      )}
                      {stampId === t.id && t.status !== "assigned" && (
                        <div
                          className={`absolute right-3 -top-2 border-4 rounded-md px-2 py-0.5 font-black uppercase text-xs tracking-widest stamp-anim ${
                            t.status === "closed"
                              ? "border-emerald-600 text-emerald-600"
                              : t.status === "done"
                              ? "border-orange-600 text-orange-600"
                              : "border-blue-600 text-blue-600"
                          }`}
                          style={{ transform: "rotate(-7deg)" }}
                        >
                          {t.status === "closed" ? "Paid" : t.status === "done" ? "Delivered" : "Claimed"}
                        </div>
                      )}
                    </div>

                    {me && (assignedToMe || t.claimedBy === me.name || mine) &&
                      t.status !== "unassigned" && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide mb-1.5">
                            {mine ? `Your freshy` : `Customer`}
                          </p>
                          {(() => {
                            const who = mine
                              ? { name: t.claimedBy, email: t.claimedByEmail, phone: t.claimedByPhone }
                              : { name: t.postedBy, email: t.postedByEmail, phone: t.postedByPhone };
                            if (mine && !t.claimedBy) {
                              return (
                                <p className="text-xs text-slate-400">
                                  Contact details appear once a freshy accepts.
                                </p>
                              );
                            }
                            return (
                              <div className="flex flex-col gap-1">
                                <span className="text-sm font-bold text-slate-700">{who.name}</span>
                                {who.email && (
                                  <a href={`mailto:${who.email}`} className="flex items-center gap-1.5 text-xs text-blue-700 font-semibold">
                                    <Mail size={12} /> {who.email}
                                  </a>
                                )}
                                {who.phone && (
                                  <div className="flex items-center gap-2">
                                    <a href={`tel:${who.phone}`} className="flex items-center gap-1.5 text-xs text-blue-700 font-semibold">
                                      <Phone size={12} /> {formatPhone(who.phone)}
                                    </a>
                                    <a href={`sms:${who.phone}`} className="text-[10px] font-bold uppercase tracking-wide text-white bg-blue-600 px-2 py-0.5 rounded-full">
                                      Text
                                    </a>
                                  </div>
                                )}
                                {!who.email && !who.phone && (
                                  <span className="text-xs text-slate-400">No contact on file.</span>
                                )}
                                {who.name && (
                                  <button
                                    onClick={() => {
                                      setReportFor({ task: t, about: who.name });
                                      setReportDraft({ reason: REPORT_REASONS[0], note: "" });
                                    }}
                                    className="flex items-center gap-1 text-[11px] font-semibold text-red-600 mt-1 self-start"
                                  >
                                    <Flag size={11} /> Report {who.name}
                                  </button>
                                )}
                                {reportSent === t.id && (
                                  <span className="text-[11px] text-emerald-700 font-semibold mt-1">
                                    Report sent to Freshy HQ.
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                    {(t.status === "claimed" || t.status === "done" || t.status === "closed") && (
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                        <span>
                          Freshy ${split.freshy.toFixed(2)} (60%{split.tip > 0 ? " + tip" : ""})
                        </span>
                        <span>Freshy HQ ${split.owner.toFixed(2)} (40%)</span>
                      </div>
                    )}

                    {t.status === "done" && mine && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold mb-1.5">
                          Add a tip for {t.claimedBy}?
                        </p>
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {[0, 1, 2, 5].map((amt) => (
                            <button
                              key={amt}
                              type="button"
                              onClick={() => setTipFor(t.id, amt)}
                              className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                                (tipDrafts[t.id] ?? 0) === amt
                                  ? "bg-orange-600 text-white border-orange-600"
                                  : "bg-white text-slate-600 border-slate-300"
                              }`}
                            >
                              {amt === 0 ? "No tip" : `$${amt}`}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => releasePayment(t.id)}
                          className="w-full bg-emerald-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 rounded-sm"
                        >
                          Release ${(t.price * FRESHY_SHARE + (tipDrafts[t.id] ?? 0)).toFixed(2)} to {t.claimedBy}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!me && (
          <p className="text-center text-slate-500 text-xs mt-6">
            Add your name above to post orders or become a Freshy.
          </p>
        )}
      </main>
    </div>
  );
}
