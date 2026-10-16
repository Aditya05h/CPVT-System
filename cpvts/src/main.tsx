import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  LogIn,
  LogOut,
  Search,
  ChartNoAxesColumn,
  Car,
  Bike,
  ParkingSquare,
  RefreshCw,
  Plus,
  Check,
  Clock,
  MapPin,
  ReceiptText,
  Printer,
  Info,
  Menu,
  CalendarDays,
  IndianRupee,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "./api";
import type { ParkingRecord, Snapshot, VehicleType } from "./types";
import "./styles.css";

type Page = "dashboard" | "check-in" | "check-out" | "finder" | "summary" | "vip";
const navigation: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "check-in", label: "Vehicle check-in", icon: LogIn },
  { id: "check-out", label: "Vehicle check-out", icon: LogOut },
  { id: "finder", label: "Vehicle finder", icon: Search },
  { id: "summary", label: "Daily summary", icon: ChartNoAxesColumn },
  { id: "vip", label: "Reserve VIP slot", icon: ShieldCheck },
];
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
const hour = (n: number) => `${String(n).padStart(2, "0")}:00`;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const currentHour = () =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
const dateLabel = (d: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(d + "T12:00:00Z"));
const vehicleLabel = (v: VehicleType) =>
  v === "two_wheeler" ? "Two-wheeler" : "Four-wheeler";
function Badge({
  children,
  kind = "green",
}: {
  children: React.ReactNode;
  kind?: "green" | "blue" | "amber" | "neutral";
}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="notice" role="alert">
      <Info size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
function Empty({
  title,
  description,
  icon: Icon = ParkingSquare,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
function HourSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {Array.from({ length: 24 }, (_, h) => (
          <option value={h} key={h}>
            {hour(h)}
          </option>
        ))}
      </select>
      <span className="field-hint">Whole hours · 24-hour format</span>
    </label>
  );
}

function App() {
  const [page, setPage] = useState<Page>(() =>
    navigation.some((n) => n.id === location.hash.slice(1))
      ? (location.hash.slice(1) as Page)
      : "dashboard",
  );
  const [data, setData] = useState<Snapshot | null>(null),
    [mode, setMode] = useState<"local" | "supabase">("local");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [mobile, setMobile] = useState(false);
  const [checkoutVehicle, setCheckoutVehicle] = useState("");
  async function refresh() {
    setLoading(true);
    try {
      const r = await api<Snapshot>("/dashboard");
      setData(r.data);
      setMode(r.meta?.mode ?? "local");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const hash = () => {
      const p = location.hash.slice(1);
      if (navigation.some((n) => n.id === p)) setPage(p as Page);
    };
    window.addEventListener("hashchange", hash);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: "read_parking_status",
            title: "Read campus parking status",
            description:
              "Read current parking availability and daily assessed fees, and refresh the visible dashboard.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
            async execute(input: unknown) {
              if (
                !input ||
                typeof input !== "object" ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error("Expected an empty object.");
              const r = await api<Snapshot>("/dashboard");
              setData(r.data);
              setMode(r.meta?.mode ?? "local");
              setError("");
              return {
                date: r.data.date,
                slots: r.data.slots.map((s) => ({
                  id: s.id,
                  status: s.status,
                })),
                summary: r.data.summary,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser capability; standard UI remains available. */
    }
    return () => lifecycle.abort();
  }, []);
  function navigate(p: Page) {
    setPage(p);
    location.hash = p;
    setMobile(false);
    window.scrollTo(0, 0);
  }
  function checkout(v: string) {
    setCheckoutVehicle(v);
    navigate("check-out");
  }
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#dashboard"
          onClick={() => navigate("dashboard")}
        >
          <span className="brand-icon">
            P<span />
          </span>
          <span>
            <strong>CPVTS</strong>
            <small>Campus parking</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              onClick={() => navigate(n.id)}
              className={page === n.id ? "nav-item selected" : "nav-item"}
              aria-current={page === n.id ? "page" : undefined}
            >
              <n.icon size={19} />
              {n.label}
              {page === n.id && <span className="nav-mark" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="campus-mark">
            <ParkingSquare size={20} />
            <div>
              <strong>Campus operations</strong>
              <small>Parking & vehicle tracking</small>
            </div>
          </div>
          <div className="version">
            CPVTS <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="top-meta">
            <span className="date">
              <CalendarDays size={15} />
              {dateLabel(data?.date ?? today())}
            </span>
            <Badge
              kind={error ? "amber" : mode === "local" ? "neutral" : "green"}
            >
              {error
                ? "Connection unavailable"
                : mode === "local"
                  ? "Local database"
                  : "Supabase connected"}
            </Badge>
          </div>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">CAMPUS PARKING & VEHICLE TRACKING</div>
              <h1>
                {
                  {
                    dashboard: "Parking overview",
                    "check-in": "Vehicle check-in",
                    "check-out": "Vehicle check-out",
                    finder: "Find a vehicle",
                    summary: "Daily summary",
                    vip: "Reserve VIP slot",
                  }[page]
                }
              </h1>
              <p>
                {
                  {
                    dashboard:
                      "A clear view of your campus, one parking space at a time.",
                    "check-in":
                      "Register an arrival. We’ll find the first available space.",
                    "check-out":
                      "Close a parking session and generate its receipt.",
                    finder: "Locate a parked vehicle in just a few seconds.",
                    summary:
                      "Review arrivals, departures and fees assessed for the day.",
                    vip: "Lock one space for an official guest, VIP or emergency vehicle.",
                  }[page]
                }
              </p>
            </div>
            {page === "dashboard" && (
              <div className="heading-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setCheckoutVehicle("");
                    navigate("check-out");
                  }}
                >
                  <LogOut size={17} />
                  Check out
                </button>
                <button
                  className="button primary"
                  onClick={() => navigate("check-in")}
                >
                  <Plus size={18} />
                  Check in vehicle
                </button>
              </div>
            )}
          </div>
          <ErrorBox message={error} />
          {page === "dashboard" &&
            (data ? (
              <Dashboard
                data={data}
                refresh={refresh}
                loading={loading}
                checkout={checkout}
                navigate={navigate}
                stale={!!error}
              />
            ) : (
              <div className="card">
                <Empty
                  title={
                    loading
                      ? "Loading parking status…"
                      : "Parking status unavailable"
                  }
                  description={
                    loading
                      ? "Connecting to the parking database."
                      : "Use refresh to reconnect. Occupancy has not been assumed."
                  }
                />
                <button
                  className="button centered"
                  onClick={() => void refresh()}
                >
                  Refresh
                </button>
              </div>
            ))}
          {page === "check-in" && (
            <CheckIn onChange={refresh} data={data} stale={!!error} />
          )}
          {page === "check-out" && (
            <CheckOut initialVehicle={checkoutVehicle} onChange={refresh} />
          )}
          {page === "finder" && <Finder checkout={checkout} />}
          {page === "summary" && <DailySummary />}
          {page === "vip" && <VipReservation data={data} onChange={refresh} />}
          <footer>
            <span>Campus Parking & Vehicle Tracking System</span>
            <span>
              Times in IST · Fees are assessed, not payment confirmations
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Stats({
  data,
  summaryOnly = false,
}: {
  data: Snapshot;
  summaryOnly?: boolean;
}) {
  const occupied = data.slots.filter((s) => s.status === "Occupied").length;
  const items = summaryOnly
    ? [
        {
          label: "Vehicles parked",
          value: data.summary.vehiclesParked,
          sub: "Arrivals on selected day",
          icon: Car,
          kind: "blue",
        },
        {
          label: "Completed check-outs",
          value: data.summary.completedCheckouts,
          sub: "Departures on selected day",
          icon: LogOut,
          kind: "green",
        },
        {
          label: "Fees assessed",
          value: money(data.summary.feesAssessed),
          sub: "From completed check-outs",
          icon: IndianRupee,
          kind: "amber",
        },
      ]
    : [
        {
          label: "Available spaces",
          value: data.slots.length - occupied,
          sub: `Across ${data.slots.length} campus spaces`,
          icon: ParkingSquare,
          kind: "green",
        },
        {
          label: "Currently parked",
          value: occupied,
          sub: `${data.slots.length ? Math.round((occupied / data.slots.length) * 100) : 0}% of total capacity`,
          icon: Car,
          kind: "blue",
        },
        {
          label: "Vehicles today",
          value: data.summary.vehiclesParked,
          sub: "Total check-ins today",
          icon: LogIn,
          kind: "blue",
        },
        {
          label: "Fees assessed today",
          value: money(data.summary.feesAssessed),
          sub: `${data.summary.completedCheckouts} completed check-outs`,
          icon: IndianRupee,
          kind: "amber",
        },
      ];
  return (
    <div className={`stats ${summaryOnly ? "three" : ""}`}>
      {items.map((i) => (
        <section className="stat card" key={i.label}>
          <div className="stat-top">
            <span>{i.label}</span>
            <span className={`stat-icon ${i.kind}`}>
              <i.icon size={19} />
            </span>
          </div>
          <strong className="stat-value">{i.value}</strong>
          <p>{i.sub}</p>
        </section>
      ))}
    </div>
  );
}
function Dashboard({
  data,
  refresh,
  loading,
  checkout,
  navigate,
  stale,
}: {
  data: Snapshot;
  refresh: () => Promise<void>;
  loading: boolean;
  checkout: (v: string) => void;
  navigate: (p: Page) => void;
  stale: boolean;
}) {
  const [zone, setZone] = useState("all");
  const active = data.records.filter((r) => r.status === "Parked");
  return (
    <>
      <Stats data={data} />
      <section className="card parking">
        <div className="section-heading">
          <div>
            <h2>Parking availability</h2>
            <p>Two zones. Every space accounted for.</p>
          </div>
          <button
            className="button quiet"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>
        <div className="parking-toolbar">
          <div className="segmented" aria-label="Filter parking zones">
            {[
              ["all", "All zones"],
              ["two_wheeler", "Two-wheelers"],
              ["four_wheeler", "Four-wheelers"],
            ].map(([v, t]) => (
              <button
                aria-pressed={zone === v}
                className={zone === v ? "active" : ""}
                key={v}
                onClick={() => setZone(v)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="legend">
            <span>
              <i className="available" />
              Available
            </span>
            <span>
              <i className="occupied" />
              Occupied
            </span>
          </div>
        </div>
        <div className="zone-grid">
          {(["two_wheeler", "four_wheeler"] as VehicleType[])
            .filter((v) => zone === "all" || zone === v)
            .map((v) => {
              const slots = data.slots.filter((s) => s.vehicleType === v),
                count = slots.filter((s) => s.status === "Available").length,
                Icon = v === "two_wheeler" ? Bike : Car;
              return (
                <div className="zone" key={v}>
                  <div className="zone-title">
                    <span className="zone-icon">
                      <Icon size={22} />
                    </span>
                    <div>
                      <h3>
                        {v === "two_wheeler"
                          ? "Two-wheeler zone"
                          : "Four-wheeler zone"}
                      </h3>
                      <p>
                        {slots.length} spaces · {slots.length - count} occupied
                      </p>
                    </div>
                    <Badge kind={count ? "green" : "amber"}>
                      {count} available
                    </Badge>
                  </div>
                  <div className="slots">
                    {slots.map((s) => (
                      <button
                        key={s.id}
                        className={`slot ${s.status === "Occupied" ? "taken" : s.status === "Reserved" ? "reserved" : "free"}`}
                        aria-label={`${s.id}, ${s.status}${s.record ? ", " + s.record.vehicleNumber : ""}`}
                        disabled={!s.record}
                        title={
                          s.record
                            ? `Check out ${s.record.vehicleNumber}`
                            : s.status === "Reserved" ? `Reserved for ${s.reservation?.vehicleNumber ?? "VIP vehicle"}` : "Available for automatic allocation"
                        }
                        onClick={() =>
                          s.record && checkout(s.record.vehicleNumber)
                        }
                      >
                        <Icon size={25} />
                        <strong>{s.id}</strong>
                        <span>
                          {s.status === "Available" ? "Available" : s.status === "Reserved" ? "VIP reserved" : s.record?.vehicleNumber}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="zone-foot">
                    <span>{v === "two_wheeler" ? "T" : "F"} ZONE</span>
                    <span>
                      {count === 0
                        ? "Zone at capacity"
                        : "First available space assigned at check-in"}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
        <div className="sync-line">
          <Clock size={14} />
          {stale
            ? "Last known status · connection interrupted"
            : "Updates every 15 seconds"}
          <span>•</span> Select an occupied space to check out
        </div>
      </section>
      <div className="lower-grid">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>
                Currently on campus{" "}
                <span className="count">{active.length}</span>
              </h2>
              <p>Active parking sessions</p>
            </div>
            <button className="text-button" onClick={() => navigate("finder")}>
              <Search size={15} />
              Find vehicle
            </button>
          </div>
          {active.length ? (
            <RecordTable records={active} checkout={checkout} />
          ) : (
            <Empty
              title="Ready for the first arrival"
              description="Checked-in vehicles will appear here with their assigned space."
              icon={Car}
            />
          )}
        </section>
        <Rates />
      </div>
    </>
  );
}
function Rates() {
  return (
    <aside className="card rates">
      <div className="section-heading">
        <div>
          <h2>Parking rates</h2>
          <p>Simple, category-based fees</p>
        </div>
        <ReceiptText size={20} />
      </div>
      <div className="rate-row">
        <Badge kind="green">Staff</Badge>
        <strong>Always free</strong>
        <p>Both vehicle types</p>
      </div>
      <div className="rate-row">
        <Badge kind="blue">Student</Badge>
        <strong>First 2 hours free</strong>
        <p>
          Then ₹10/hr for two-wheelers
          <br />
          ₹20/hr for four-wheelers
        </p>
      </div>
      <div className="rate-row">
        <Badge kind="neutral">Visitor</Badge>
        <strong>Charged per hour</strong>
        <p>
          ₹20/hr for two-wheelers
          <br />
          ₹40/hr for four-wheelers
        </p>
      </div>
      <div className="rate-note">
        <Info size={15} />
        Whole-hour parking. No overnight rollover.
      </div>
    </aside>
  );
}
function RecordTable({
  records,
  checkout,
  completed = false,
}: {
  records: ParkingRecord[];
  checkout?: (v: string) => void;
  completed?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Category</th>
            <th>Space</th>
            <th>{completed ? "Hours" : "Entry"}</th>
            <th>{completed ? "Fee assessed" : "Status"}</th>
            {checkout && (
              <th>
                <span className="sr-only">Action</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.vehicleNumber}</strong>
                <small>{vehicleLabel(r.vehicleType)}</small>
              </td>
              <td>{r.ownerCategory}</td>
              <td>
                <span className="space-tag">{r.slotId}</span>
              </td>
              <td>
                {completed
                  ? `${hour(r.entryHour)}–${hour(r.exitHour!)}`
                  : hour(r.entryHour)}
              </td>
              <td>
                {completed ? money(r.fee ?? 0) : <Badge>{r.status}</Badge>}
              </td>
              {checkout && (
                <td>
                  <button
                    className="text-button"
                    onClick={() => checkout(r.vehicleNumber)}
                  >
                    Check out
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CheckIn({
  onChange,
  data,
  stale,
}: {
  onChange: () => Promise<void>;
  data: Snapshot | null;
  stale: boolean;
}) {
  const [number, setNumber] = useState(""),
    [type, setType] = useState<VehicleType>("two_wheeler"),
    [owner, setOwner] = useState("Student"),
    [entry, setEntry] = useState(String(currentHour()));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<ParkingRecord | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api<ParkingRecord>("/check-ins", {
        vehicleNumber: number,
        vehicleType: type,
        ownerCategory: owner,
        entryHour: Number(entry),
      });
      setResult(r.data);
      setNumber("");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-layout">
      <section className="card form-card">
        <div className="section-heading">
          <div>
            <h2>Arrival details</h2>
            <p>All fields are required.</p>
          </div>
          <span className="step">01 / ENTRY</span>
        </div>
        {result && (
          <div className="success" role="status">
            <Check size={21} />
            <div>
              <strong>{result.vehicleNumber} is checked in</strong>
              <span>
                Space {result.slotId} · Entry {hour(result.entryHour)}
              </span>
            </div>
          </div>
        )}
        <ErrorBox message={error} />
        <form onSubmit={submit}>
          <label htmlFor="vehicle-number">
            Vehicle number
            <input
              id="vehicle-number"
              placeholder="e.g. KA-22-AB-1234"
              value={number}
              onChange={(e) => setNumber(e.target.value.toUpperCase())}
              required
              maxLength={40}
              autoComplete="off"
            />
            <span className="field-hint">
              Letters, numbers, spaces and hyphens accepted.
            </span>
          </label>
          <fieldset>
            <legend>Vehicle type</legend>
            <div className="choice-grid">
              {(["two_wheeler", "four_wheeler"] as VehicleType[]).map((v) => {
                const Icon = v === "two_wheeler" ? Bike : Car;
                return (
                  <label
                    className={`choice ${type === v ? "chosen" : ""}`}
                    key={v}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={v}
                      checked={type === v}
                      onChange={() => setType(v)}
                    />
                    <Icon size={24} />
                    <strong>{vehicleLabel(v)}</strong>
                    <span>
                      {data && !stale
                        ? `${data.slots.filter((s) => s.vehicleType === v && s.status === "Available").length} spaces available`
                        : "Availability checked on submission"}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="form-row">
            <label htmlFor="owner-category">
              Owner category
              <select
                id="owner-category"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                {["Staff", "Student", "Visitor"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <HourSelect
              id="entry-hour"
              label="Entry hour"
              value={entry}
              onChange={setEntry}
            />
          </div>
          <div className="form-note">
            <MapPin size={18} />
            <span>
              The first available space in the selected zone is assigned
              automatically.
            </span>
          </div>
          <button className="button primary submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <LogIn size={18} />
            )}{" "}
            {busy ? "Checking in…" : "Check in vehicle"}
          </button>
        </form>
      </section>
      <Rates />
    </div>
  );
}
function CheckOut({
  initialVehicle,
  onChange,
}: {
  initialVehicle: string;
  onChange: () => Promise<void>;
}) {
  const [kind, setKind] = useState("vehicle"),
    [value, setValue] = useState(initialVehicle),
    [exit, setExit] = useState(String(currentHour()));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<ParkingRecord | null>(null);
  useEffect(() => {
    setValue(initialVehicle);
    setKind("vehicle");
    setReceipt(null);
    setError("");
  }, [initialVehicle]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<ParkingRecord>("/check-outs", {
        [kind === "vehicle" ? "vehicleNumber" : "slotId"]: value,
        exitHour: Number(exit),
      });
      setReceipt(r.data);
      setValue("");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-layout checkout-layout">
      <section className="card form-card no-print">
        <div className="section-heading">
          <div>
            <h2>Departure details</h2>
            <p>Find the session using one identifier.</p>
          </div>
          <span className="step">02 / EXIT</span>
        </div>
        <ErrorBox message={error} />
        <form onSubmit={submit}>
          <fieldset>
            <legend>Look up by</legend>
            <div className="segmented wide">
              {[
                ["vehicle", "Vehicle number"],
                ["slot", "Space ID"],
              ].map(([v, t]) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={kind === v}
                  className={kind === v ? "active" : ""}
                  onClick={() => {
                    setKind(v);
                    setValue("");
                    setReceipt(null);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor="checkout-identifier">
            {kind === "vehicle" ? "Vehicle number" : "Space ID"}
            <input
              id="checkout-identifier"
              placeholder={
                kind === "vehicle" ? "e.g. KA-22-AB-1234" : "e.g. T-01"
              }
              value={value}
              onChange={(e) => {
                setValue(e.target.value.toUpperCase());
                setReceipt(null);
              }}
              required
              maxLength={40}
              autoComplete="off"
            />
          </label>
          <HourSelect
            id="exit-hour"
            label="Exit hour"
            value={exit}
            onChange={setExit}
          />
          <div className="form-note">
            <Clock size={18} />
            <span>
              Exit hour must be the same as or later than entry hour. Overnight
              rollover is not supported.
            </span>
          </div>
          <button className="button primary submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ReceiptText size={18} />
            )}{" "}
            {busy ? "Generating receipt…" : "Check out & create receipt"}
          </button>
        </form>
      </section>
      <section className={`card receipt ${receipt ? "has-receipt" : ""}`}>
        {receipt ? (
          <Receipt record={receipt} />
        ) : (
          <Empty
            title="Your receipt will appear here"
            description="Complete a check-out to view the fee breakdown and release the parking space."
            icon={ReceiptText}
          />
        )}
      </section>
    </div>
  );
}
function Receipt({ record: r }: { record: ParkingRecord }) {
  return (
    <>
      <div className="receipt-head">
        <span className="brand-icon">
          P<span />
        </span>
        <span>CPVTS · CAMPUS PARKING</span>
        <Badge>Check-out complete</Badge>
      </div>
      <h2>Parking receipt</h2>
      <p className="receipt-id">{r.id}</p>
      <dl className="receipt-details">
        <div>
          <dt>Vehicle number</dt>
          <dd>{r.vehicleNumber}</dd>
        </div>
        <div>
          <dt>Vehicle type</dt>
          <dd>{vehicleLabel(r.vehicleType)}</dd>
        </div>
        <div>
          <dt>Owner category</dt>
          <dd>{r.ownerCategory}</dd>
        </div>
        <div>
          <dt>Assigned space</dt>
          <dd>{r.slotId}</dd>
        </div>
        <div>
          <dt>Entry / exit hour</dt>
          <dd>
            {hour(r.entryHour)} / {hour(r.exitHour!)}
          </dd>
        </div>
        <div>
          <dt>Parking duration</dt>
          <dd>
            {r.duration} {r.duration === 1 ? "hour" : "hours"}
          </dd>
        </div>
      </dl>
      <div className="calculation">
        <h3>Fee calculation</h3>
        <p>
          <span>Free hours</span>
          <strong>{r.calculation!.freeHours} hrs · ₹0</strong>
        </p>
        <p>
          <span>
            {r.calculation!.billableHours} hrs ×{" "}
            {money(r.calculation!.ratePerHour)}/hr
          </span>
          <strong>{money(r.fee!)}</strong>
        </p>
      </div>
      <div className="receipt-total">
        <span>Total amount due</span>
        <strong>{money(r.fee!)}</strong>
      </div>
      <p className="receipt-note">
        <Check size={16} />
        Space {r.slotId} is now available.
      </p>
      <p className="field-hint">
        Fee assessed · This receipt does not confirm payment.
      </p>
      <button
        className="button secondary no-print"
        onClick={() => window.print()}
      >
        <Printer size={17} />
        Print receipt
      </button>
    </>
  );
}
function VipReservation({ data, onChange }: { data: Snapshot | null; onChange: () => Promise<void> }) {
  const [slotId, setSlotId] = useState("F-01");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [note, setNote] = useState("VIP / emergency reservation");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const selected = data?.slots.find((s) => s.id === slotId);
  async function reserve(e: React.FormEvent) {
    e.preventDefault(); if (selected?.status === "Reserved") { setError("That space already has a VIP reservation. Release it before creating another."); return; } setBusy(true); setError(""); setMessage("");
    try { const r = await api<{ slotId: string; vehicleNumber: string }>("/reservations", { slotId, vehicleNumber, note }); setMessage(`Space ${r.data.slotId} is reserved for ${r.data.vehicleNumber}.`); await onChange(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function release() {
    setBusy(true); setError(""); setMessage("");
    try { await api(`/reservations`, { slotId }, "DELETE"); setMessage(`VIP reservation released for ${slotId}.`); await onChange(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="card vip-panel">
    <div className="section-heading"><div><h2><ShieldCheck size={20} /> Security reservation</h2><p>Lock one specific space for an official campus guest, VIP or emergency vehicle.</p></div><Badge kind="amber">Security access</Badge></div>
    <div className="vip-warning"><Info size={18} /><span>Reserved spaces are excluded from automatic check-in allocation. Release the reservation after security confirms the space is no longer needed.</span></div>
    <form onSubmit={reserve} className="vip-form">
      <label htmlFor="vip-slot">Specific space<select id="vip-slot" value={slotId} onChange={(e) => setSlotId(e.target.value)}>{(data?.slots ?? []).map((s) => <option key={s.id} value={s.id}>{s.id} · {s.vehicleType === "four_wheeler" ? "Four-wheeler" : "Two-wheeler"} · {s.status}</option>)}</select></label>
      <label htmlFor="vip-vehicle">Official vehicle number<input id="vip-vehicle" required value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} placeholder="e.g. KA-22-VIP-01" maxLength={40} /></label>
      <label htmlFor="vip-note">Reservation note<input id="vip-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} /></label>
      {selected?.status === "Reserved" && <p className="field-hint">Currently reserved for {selected.reservation?.vehicleNumber}. Release this reservation before assigning the space again.</p>}
      <div className="vip-actions"><button className="button primary" disabled={busy || selected?.status === "Reserved"}><ShieldCheck size={17} />{busy ? "Saving…" : "Reserve VIP slot"}</button><button type="button" className="button secondary" disabled={busy || selected?.status !== "Reserved"} onClick={() => void release()}><Unlock size={17} />Release reservation</button></div>
    </form>
    <ErrorBox message={error} />{message && <div className="success" role="status"><Check size={17} />{message}</div>}
  </section>;
}

function Finder({ checkout }: { checkout: (v: string) => void }) {
  const [value, setValue] = useState(""),
    [result, setResult] = useState<ParkingRecord | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    setSearched(true);
    try {
      setResult(
        (await api<ParkingRecord>(`/vehicles/${encodeURIComponent(value)}`))
          .data,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card finder">
      <div className="section-heading">
        <div>
          <h2>Vehicle lookup</h2>
          <p>Search for a vehicle currently parked on campus.</p>
        </div>
        <Search size={22} />
      </div>
      <form onSubmit={submit}>
        <label htmlFor="find-number">Vehicle number</label>
        <div className="search-row">
          <input
            id="find-number"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setResult(null);
              setError("");
              setSearched(false);
            }}
            placeholder="e.g. KA-22-AB-1234"
            maxLength={40}
            required
            autoComplete="off"
          />
          <button className="button primary" disabled={busy}>
            <Search size={18} />
            {busy ? "Searching…" : "Find vehicle"}
          </button>
        </div>
      </form>
      <ErrorBox message={error} />
      {result && (
        <div className="found">
          <div className="found-space">
            <MapPin size={25} />
            <strong>{result.slotId}</strong>
            <span>Assigned space</span>
          </div>
          <div className="found-info">
            <Badge>Currently parked</Badge>
            <h2>{result.vehicleNumber}</h2>
            <p>
              {vehicleLabel(result.vehicleType)} · {result.ownerCategory}
            </p>
            <p>
              <Clock size={16} />
              Entry at {hour(result.entryHour)}
            </p>
            <button
              className="button secondary"
              onClick={() => checkout(result.vehicleNumber)}
            >
              <LogOut size={16} />
              Check out vehicle
            </button>
          </div>
        </div>
      )}
      {!result && !searched && (
        <Empty
          title="Every vehicle has its place"
          description="Enter a full vehicle number to see its space, entry hour and status."
          icon={MapPin}
        />
      )}
    </section>
  );
}
function DailySummary() {
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(today()),
    [data, setData] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setData(null);
    setError("");
    api<Snapshot>(`/summary?date=${encodeURIComponent(date)}`)
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [date, revision]);
  const completed =
    data?.records.filter(
      (r) =>
        r.checkedOutAt &&
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(r.checkedOutAt)) === date,
    ) ?? [];
  return (
    <>
      <div className="summary-toolbar">
        <label htmlFor="summary-date">
          Reporting date
          <input
            type="date"
            id="summary-date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        <p>
          <CalendarDays size={17} />
          Day boundaries follow India Standard Time.
        </p>
        <button
          className="button quiet"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />
          Refresh summary
        </button>
      </div>
      <ErrorBox message={error} />
      {data && <Stats data={data} summaryOnly />}
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Completed parking sessions</h2>
            <p>{dateLabel(date)} · Fees assessed at check-out</p>
          </div>
          <ReceiptText size={21} />
        </div>
        {busy ? (
          <Empty
            title="Loading daily summary…"
            description="Reading recorded arrivals and departures."
          />
        ) : completed.length ? (
          <RecordTable records={completed} completed />
        ) : (
          <Empty
            title={error ? "Summary unavailable" : "No completed sessions"}
            description={
              error
                ? "Check your connection and select the date again."
                : "Completed check-outs for this date will appear here."
            }
            icon={ReceiptText}
          />
        )}
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
