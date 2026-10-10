import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Database,
  Sparkles,
  ListChecks,
  CircleCheck,
  History,
  Search,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Car,
  Plus,
  Check,
  Ban,
  Clock,
  Pencil,
  MessageSquare,
  FileText,
  AlertCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import * as Tabs from "@radix-ui/react-tabs";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import {
  api,
  type Workspace,
  type Requirement,
  type Detail,
  type Audit,
  type Source,
  type Finding,
} from "./api";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./style.css";

const pages = [
  ["Overview", LayoutDashboard],
  ["Data Sources", Database],
  ["AI Findings", Sparkles],
  ["Requirements", ListChecks],
  ["PM Decisions", CircleCheck],
  ["Audit History", History],
] as const;
const human = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function Badge({ value }: { value: string }) {
  return <span className={"badge badge-" + value}>{human(value)}</span>;
}
function Empty({
  title = "No data in this scope",
  text = "Select an existing analysis or create an explicitly labeled synthetic demonstration.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FileText size={24} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Notes({ title, items }: { title: string; items?: unknown[] }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {items?.length ? (
        <ul className="notes">
          {items.map((x, i) => (
            <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">None recorded.</p>
      )}
    </section>
  );
}
function SourceView({ source }: { source: Source }) {
  return (
    <div className="source-inspect">
      <div className="section-heading">
        <h3>{source.source_file || source.source_id}</h3>
        <Badge value={source.verification_status || "source_record"} />
      </div>
      {(source.text_original || source.text) && (
        <blockquote>{source.text_original || source.text}</blockquote>
      )}
      <dl>
        {Object.entries(source)
          .filter(
            ([k]) => !["text", "text_original", "original_rows"].includes(k),
          )
          .map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>{human(k)}</dt>
              <dd>
                {typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}
              </dd>
            </React.Fragment>
          ))}
      </dl>
    </div>
  );
}
function FindingView({
  finding,
  sources,
}: {
  finding: Finding;
  sources: Source[];
}) {
  return (
    <section className="finding-detail">
      <div className="eyebrow">AI interpretation · {finding.finding_id}</div>
      <h3>{finding.summary}</h3>
      <div className="quote-label">
        <ShieldCheck size={15} />
        {finding.evidence_valid
          ? "Verbatim quote validated"
          : "Quote needs verification"}
      </div>
      <blockquote>{finding.evidence_quote}</blockquote>
      <p className="muted">Source {finding.source_id}</p>
      <Notes title="Uncertainty" items={finding.uncertainties} />
      <details>
        <summary>Inspect original source and reference</summary>
        {sources.find((s) => s.source_id === finding.source_id) ? (
          <SourceView
            source={sources.find((s) => s.source_id === finding.source_id)!}
          />
        ) : (
          <pre>{JSON.stringify(finding.source_reference, null, 2)}</pre>
        )}
      </details>
    </section>
  );
}
function Timeline({ events }: { events: Audit[] }) {
  return events.length ? (
    <div className="timeline">
      {events.map((e) => (
        <article key={e.event_id}>
          <div className="timeline-dot">
            <History size={13} />
          </div>
          <div className="section-heading">
            <h3>{human(e.event_type)}</h3>
            <time>{date(e.timestamp)}</time>
          </div>
          <p>{e.rationale}</p>
          <div className="muted">
            {e.actor_id} · {e.requirement_id}
          </div>
          <details>
            <summary>View recorded changes</summary>
            <dl>
              {Object.keys(e.new_json || {})
                .filter(
                  (k) =>
                    JSON.stringify(e.old_json?.[k]) !==
                    JSON.stringify(e.new_json?.[k]),
                )
                .map((k) => (
                  <React.Fragment key={k}>
                    <dt>{human(k)}</dt>
                    <dd>
                      <span className="muted">
                        Before: {JSON.stringify(e.old_json?.[k] ?? null)}
                      </span>
                      <br />
                      After: {JSON.stringify(e.new_json?.[k])}
                    </dd>
                  </React.Fragment>
                ))}
            </dl>
          </details>
        </article>
      ))}
    </div>
  ) : (
    <Empty
      title="No activity yet"
      text="Generation and PM decisions will appear here with their actor, time and rationale."
    />
  );
}
export function App() {
  const [page, setPage] = useState(
      decodeURIComponent(location.hash.slice(1)) || "Overview",
    ),
    [vehicle, setVehicle] = useState("F70"),
    [market, setMarket] = useState("GB"),
    [run, setRun] = useState(""),
    [state, setState] = useState<Workspace | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [actor, setActor] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [opening, setOpening] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [action, setAction] = useState(""),
    [rationale, setRationale] = useState(""),
    [description, setDescription] = useState(""),
    [reviewDate, setReviewDate] = useState(""),
    [ratings, setRatings] = useState<Record<string, number>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All"),
    [status, setStatus] = useState("All"),
    [priority, setPriority] = useState("All"),
    [confidence, setConfidence] = useState("All"),
    [sort, setSort] = useState("updated"),
    [audit, setAudit] = useState<Audit[]>([]),
    [source, setSource] = useState<Source | null>(null),
    [finding, setFinding] = useState<Finding | null>(null);
  const query = (selectedRun = run) =>
    `?vehicle=${vehicle}&market=${market}${
      selectedRun ? "&run_id=" + encodeURIComponent(selectedRun) : ""
    }`;
  const loadVersion = useRef(0);
  async function load(selectedRun = run) {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const scopedQuery = query(selectedRun);
      const next = await api<Workspace>("/workspace" + scopedQuery);
      const events = await api<Audit[]>("/audit" + scopedQuery);
      if (version !== loadVersion.current) return;
      setState(next);
      setAudit(events);
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    setState(null);
    setAudit([]);
    setNotice("");
    setSelected(null);
    setDetail(null);
    setSource(null);
    setFinding(null);
    void load();
  }, [vehicle, market, run]);
  useEffect(() => {
    const listener = () =>
      setPage(decodeURIComponent(location.hash.slice(1)) || "Overview");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  function navigate(p: string) {
    setPage(p);
    location.hash = p;
    setSearch("");
    setCategory("All");
    setStatus("All");
  }
  async function open(r: Requirement) {
    setNotice("");
    setSelected(r.requirement_id);
    setDetail(null);
    setOpening(true);
    setError("");
    try {
      setDetail(
        await api<Detail>(
          "/requirements/" + encodeURIComponent(r.requirement_id),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      setSelected(null);
    } finally {
      setOpening(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ run_id: string }>("/analysis/synthetic", {
        vehicle,
        market,
      });
      setRun(r.run_id);
      await load(r.run_id);
      setNotice(
        "Fictional demonstration analysis saved. No customer data was sent.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function prepare(a: string) {
    setAction(a);
    setRationale("");
    setDescription(detail?.requirement.description || "");
    setRatings(detail?.requirement.priority_assessment.ratings || {});
    setReasons(detail?.requirement.priority_assessment.rationales || {});
    setReviewDate("");
    setError("");
  }
  async function decide(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Detail>(
        "/requirements/" +
          encodeURIComponent(detail.requirement.requirement_id) +
          "/decisions",
        {
          actor,
          action,
          rationale,
          expected_version: detail.requirement.version,
          ...(action === "edit" ? { description } : {}),
          ...(action === "postpone" ? { review_date: reviewDate || null } : {}),
          ...(action === "score" ? { ratings, score_rationales: reasons } : {}),
        },
      );
      setDetail(updated);
      setAction("");
      await load();
      setNotice(
        `${human(action)} saved · version ${updated.requirement.version}. Audit history updated.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reqs = state?.requirements || [],
    findings = state?.findings || [];
  const filtered = reqs
    .filter(
      (r) =>
        (page !== "PM Decisions" ||
          ["pending", "under_review", "postponed"].includes(r.status)) &&
        (category === "All" || r.category === category) &&
        (status === "All" || r.status === status) &&
        (priority === "All" || r.priority_assessment.priority === priority) &&
        (confidence === "All" ||
          (r.evidence_confidence || r.evidence_level) === confidence) &&
        (!search ||
          `${r.description} ${r.requirement_id}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "score"
        ? (b.priority_assessment.score ?? -1) -
          (a.priority_assessment.score ?? -1)
        : sort === "sources"
          ? b.linked_source_ids.length - a.linked_source_ids.length
          : b.updated_at.localeCompare(a.updated_at),
    );
  const counts = (values: string[]) =>
    Object.entries(
      values.reduce<Record<string, number>>(
        (a, v) => ({ ...a, [v]: (a[v] || 0) + 1 }),
        {},
      ),
    ).map(([name, value]) => ({ name: human(name), value }));
  const categories = counts(findings.map((f) => f.category)),
    priorities = counts(reqs.map((r) => r.priority_assessment.priority)),
    confidences = counts(
      reqs.map((r) => r.evidence_confidence || r.evidence_level),
    );
  const feedback =
    state?.sources.filter(
      (s) => s.record_type === "customer_feedback" || "text" in s,
    ).length || 0;
  function table(rows: Requirement[]) {
    return rows.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Confidence</th>
              <th>Status</th>
              <th>Sources</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requirement_id} onClick={() => void open(r)}>
                <td>
                  <button
                    className="row-title"
                    onClick={(e) => {
                      e.stopPropagation();
                      void open(r);
                    }}
                  >
                    {r.title || r.description}
                  </button>
                  <span className="row-id">{r.requirement_id}</span>
                </td>
                <td>{human(r.category)}</td>
                <td>
                  <Badge value={r.priority_assessment.priority} />
                  <span className="score">
                    {r.priority_assessment.score !== null
                      ? `${r.priority_assessment.score}/100`
                      : ""}
                  </span>
                </td>
                <td>
                  <span className="confidence-dot" />
                  {human(r.evidence_confidence || r.evidence_level)}
                </td>
                <td>
                  <Badge value={r.status} />
                </td>
                <td className="numeric">{r.linked_source_ids.length}</td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty
        title="No requirements to display"
        text={
          reqs.length
            ? "Try adjusting the filters."
            : "Run an analysis to generate evidence-linked proposals."
        }
      />
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            B<span>M</span>W
          </div>
          <div>
            Requirements<span>PRODUCT INTELLIGENCE</span>
          </div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {pages.map(([p, Icon]) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              onClick={() => navigate(p)}
            >
              <Icon size={18} />
              {p}
              {p === "PM Decisions" &&
                reqs.filter((r) =>
                  ["pending", "under_review"].includes(r.status),
                ).length > 0 && (
                  <span className="nav-count">
                    {
                      reqs.filter((r) =>
                        ["pending", "under_review"].includes(r.status),
                      ).length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <div>
            Human-led decisions<span>Evidence before approval</span>
          </div>
        </div>
        <div className="sidebar-footer">
          BMW · Requirements Copilot<span>Local demonstration workspace</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="scope">
            <Car size={18} />
            <select
              aria-label="Vehicle"
              value={vehicle}
              onChange={(e) => {
                setVehicle(e.target.value);
                setRun("");
              }}
            >
              <option value="F70">BMW 1 Series F70</option>
              <option value="G60">BMW 5 Series G60</option>
              <option value="G70">BMW 7 Series G70</option>
            </select>
            <span className="top-divider" />
            <select
              aria-label="Market"
              value={market}
              onChange={(e) => {
                setMarket(e.target.value);
                setRun("");
              }}
            >
              {[
                ["GB", "United Kingdom"],
                ["DE", "Germany"],
                ["FR", "France"],
                ["JP", "Japan"],
                ["EU", "Europe"],
                ["US", "United States"],
                ["CN", "China"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="top-actions">
            <span className="analysis-state">
              <i />
              {loading
                ? "Loading"
                : state?.selected_run
                  ? "Analysis saved"
                  : "Awaiting analysis"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() => void load()}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
            <div className="identity">
              <span>PM</span>
              <input
                aria-label="Product manager identity"
                placeholder="Your PM name"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
              />
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">PRODUCT REQUIREMENTS COPILOT</div>
              <h1>{page}</h1>
              <p>
                {page === "Overview"
                  ? "Customer signals. Traceable requirements. Informed decisions."
                  : page === "Requirements"
                    ? "Turn customer evidence into the next product decision."
                    : page === "PM Decisions"
                      ? "Review, assess and decide with the evidence in view."
                      : page === "AI Findings"
                        ? "Explore AI interpretations and their original customer evidence."
                        : page === "Data Sources"
                          ? "Inspect the records behind your product intelligence."
                          : "A traceable record of how every requirement evolves."}
              </p>
            </div>
            <div className="heading-actions">
              {state && state.runs.length > 0 && (
                <select
                  aria-label="Selected analysis"
                  value={run || state.selected_run?.run_id || ""}
                  onChange={(e) => setRun(e.target.value)}
                >
                  {state.runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {date(r.created_at)} · {r.settings.mode}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="outline"
                onClick={() => void demo()}
                disabled={busy}
              >
                <Plus size={15} />
                {busy ? "Creating…" : "Synthetic demo"}
              </Button>
            </div>
          </div>
          {state?.selected_run?.settings.mode === "synthetic" && (
            <div className="demo-banner">
              <Sparkles size={15} />
              <strong>Synthetic demonstration</strong>
              <span>
                Fictional records demonstrate the workflow; these are not BMW
                customer insights.
              </span>
            </div>
          )}
          {error && !action && (
            <div role="alert" className="alert error">
              <AlertCircle size={16} />
              {error}
              <Button variant="ghost" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={16} />
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {loading && !state ? (
            <div className="loading">
              <RefreshCw className="spin" />
              Loading local workspace…
            </div>
          ) : (
            <>
              {page === "Overview" && (
                <>
                  <div className="kpi-grid">
                    {[
                      [
                        "Customer feedback",
                        feedback,
                        MessageSquare,
                        "Records in this analysis",
                      ],
                      [
                        "AI findings",
                        findings.length,
                        Sparkles,
                        "Traceable customer signals",
                      ],
                      [
                        "Requirements",
                        reqs.length,
                        ListChecks,
                        "Evidence-linked proposals",
                      ],
                      [
                        "Pending decisions",
                        reqs.filter((r) =>
                          ["pending", "under_review"].includes(r.status),
                        ).length,
                        Clock,
                        "Awaiting PM assessment",
                      ],
                    ].map(([label, value, Icon, caption]) => {
                      const I = Icon as typeof Clock;
                      return (
                        <div className="kpi" key={String(label)}>
                          <div>
                            {String(label)}
                            <I size={17} />
                          </div>
                          <strong>{String(value)}</strong>
                          <span>{String(caption)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="analytics-grid">
                    <section className="panel category-chart">
                      <div className="section-heading">
                        <div>
                          <h2>Customer signals by category</h2>
                          <p>Findings in the selected analysis</p>
                        </div>
                        <span className="small-label">
                          {findings.length} FINDINGS
                        </span>
                      </div>
                      {categories.length ? (
                        <ResponsiveContainer width="100%" height={235}>
                          <BarChart
                            data={categories}
                            layout="vertical"
                            margin={{ left: 5, right: 35, top: 16, bottom: 8 }}
                          >
                            <XAxis
                              type="number"
                              allowDecimals={false}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={130}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 11, fill: "#64748B" }}
                            />
                            <Tooltip cursor={{ fill: "#F6F8FA" }} />
                            <Bar
                              dataKey="value"
                              fill="#2563EB"
                              radius={[0, 4, 4, 0]}
                              barSize={18}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <Empty title="No findings yet" />
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Requirements by priority</h2>
                          <p>Documented PM assessments</p>
                        </div>
                      </div>
                      {priorities.length ? (
                        <>
                          <ResponsiveContainer width="100%" height={185}>
                            <PieChart>
                              <Pie
                                data={priorities}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={57}
                                outerRadius={77}
                                paddingAngle={3}
                              >
                                {priorities.map((x, i) => (
                                  <Cell
                                    key={x.name}
                                    fill={
                                      [
                                        "#2563EB",
                                        "#94A3B8",
                                        "#CBD5E1",
                                        "#0B1220",
                                      ][i % 4]
                                    }
                                  />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="legend">
                            {priorities.map((p, i) => (
                              <span key={p.name}>
                                <i
                                  style={{
                                    background: [
                                      "#2563EB",
                                      "#94A3B8",
                                      "#CBD5E1",
                                      "#0B1220",
                                    ][i % 4],
                                  }}
                                />
                                {p.name}
                                <b>{p.value}</b>
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <Empty title="No priorities yet" />
                      )}
                    </section>
                  </div>
                  <div className="secondary-grid">
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Top customer concerns</h2>
                          <p>Ranked by linked source count</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => navigate("Requirements")}
                        >
                          View all <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {reqs.length ? (
                        [...reqs]
                          .sort(
                            (a, b) =>
                              b.linked_source_ids.length -
                              a.linked_source_ids.length,
                          )
                          .slice(0, 4)
                          .map((r, i) => (
                            <button
                              className="concern"
                              key={r.requirement_id}
                              onClick={() => void open(r)}
                            >
                              <span className="rank">0{i + 1}</span>
                              <span>
                                {r.description}
                                <small>
                                  {human(r.category)} ·{" "}
                                  {r.linked_source_ids.length} sources
                                </small>
                              </span>
                              <ChevronRight size={15} />
                            </button>
                          ))
                      ) : (
                        <Empty title="No concerns identified" />
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Evidence confidence</h2>
                          <p>Confidence is separate from priority</p>
                        </div>
                        <ShieldCheck size={18} className="muted" />
                      </div>
                      {confidences.length ? (
                        confidences.map((c) => (
                          <div className="confidence-row" key={c.name}>
                            <span>{c.name}</span>
                            <b>{c.value}</b>
                            <div>
                              <i
                                style={{
                                  width: `${(c.value / reqs.length) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <Empty title="No evidence assessed" />
                      )}
                    </section>
                  </div>
                  <section className="panel activity-panel">
                    <div className="section-heading">
                      <div>
                        <h2>Recent requirement activity</h2>
                        <p>The latest recorded changes in this scope</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("Audit History")}
                      >
                        Full audit trail <ArrowUpRight size={14} />
                      </button>
                    </div>
                    {audit.length ? (
                      <div>
                        {audit.slice(0, 4).map((e) => (
                          <div className="activity-row" key={e.event_id}>
                            <span className="activity-icon">
                              <History size={16} />
                            </span>
                            <div>
                              <strong>{human(e.event_type)}</strong>
                              <span>{e.rationale}</span>
                            </div>
                            <span>{e.actor_id}</span>
                            <time>{date(e.timestamp)}</time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="No requirement activity" />
                    )}
                  </section>
                </>
              )}
              {["Requirements", "PM Decisions"].includes(page) && (
                <section className="panel workspace-panel">
                  <div className="workspace-tabs">
                    <span>
                      <ListChecks size={16} />
                      {page === "PM Decisions"
                        ? "Decision queue"
                        : "All requirements"}
                      <b>{filtered.length}</b>
                    </span>
                    <span className="muted">
                      {reqs.length} in selected analysis
                    </span>
                  </div>
                  <div className="filters">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search requirements"
                        placeholder="Search requirements…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <SlidersHorizontal size={15} className="muted" />
                    <select
                      aria-label="Category filter"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="All">All categories</option>
                      {[...new Set(reqs.map((r) => r.category))].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Status filter"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="All">All statuses</option>
                      {[
                        "pending",
                        "under_review",
                        "approved",
                        "rejected",
                        "postponed",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {human(s)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Priority filter"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      <option value="All">All priorities</option>
                      {["high", "medium", "low", "unscored"].map((s) => (
                        <option key={s} value={s}>
                          {human(s)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Confidence filter"
                      value={confidence}
                      onChange={(e) => setConfidence(e.target.value)}
                    >
                      <option value="All">All confidence</option>
                      {[
                        ...new Set(
                          reqs.map(
                            (r) => r.evidence_confidence || r.evidence_level,
                          ),
                        ),
                      ].map((s) => (
                        <option key={s} value={s}>
                          {human(s)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Sort requirements"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="updated">Last updated</option>
                      <option value="score">Priority score</option>
                      <option value="sources">Source count</option>
                    </select>
                  </div>
                  {table(filtered)}
                  <div className="table-footer">
                    <span>
                      {filtered.length} of {reqs.length} requirements
                    </span>
                    <span>
                      <ShieldCheck size={13} />
                      AI proposes · PM decides
                    </span>
                  </div>
                </section>
              )}
              {page === "AI Findings" && (
                <section className="panel workspace-panel">
                  <div className="filters">
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search findings"
                        placeholder="Search customer signals…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Finding category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option>All</option>
                      {[...new Set(findings.map((f) => f.category))].map(
                        (c) => (
                          <option key={c}>{c}</option>
                        ),
                      )}
                    </select>
                  </div>
                  {findings.length ? (
                    <div className="findings-list">
                      {findings
                        .filter(
                          (f) =>
                            (category === "All" || f.category === category) &&
                            f.summary
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )
                        .map((f) => (
                          <button
                            className="finding-row"
                            key={f.finding_id}
                            onClick={() => setFinding(f)}
                          >
                            <span className="signal-icon">
                              <Sparkles size={18} />
                            </span>
                            <span>
                              <strong>{f.summary}</strong>
                              <small>
                                {human(f.category)} · {f.finding_id} · AI
                                interpretation
                              </small>
                              <span className="quote-preview">
                                “{f.evidence_quote}”
                              </span>
                            </span>
                            <Badge
                              value={
                                f.evidence_valid
                                  ? "verified_quote"
                                  : "needs_review"
                              }
                            />
                            <ChevronRight size={16} />
                          </button>
                        ))}
                    </div>
                  ) : (
                    <Empty title="No AI findings yet" />
                  )}
                </section>
              )}
              {page === "Data Sources" && (
                <>
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>Source inventory</h2>
                        <p>Original local records and references</p>
                      </div>
                      <span className="small-label">
                        {state?.inventory.length || 0} INVENTORY RECORDS
                      </span>
                    </div>
                    <div className="filters">
                      <label className="search">
                        <Search size={16} />
                        <input
                          aria-label="Search sources"
                          placeholder="Search source IDs or filenames…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                    </div>
                    {[
                      ...(state?.sources || []),
                      ...(state?.inventory || []).filter(
                        (s) =>
                          !state?.sources.some(
                            (x) => x.source_id === s.source_id,
                          ),
                      ),
                    ].length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Source reference</th>
                              <th>Record type</th>
                              <th>Verification</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              ...(state?.sources || []),
                              ...(state?.inventory || []).filter(
                                (s) =>
                                  !state?.sources.some(
                                    (x) => x.source_id === s.source_id,
                                  ),
                              ),
                            ]
                              .filter((s) =>
                                `${s.source_id} ${s.source_file}`
                                  .toLowerCase()
                                  .includes(search.toLowerCase()),
                              )
                              .map((s) => (
                                <tr
                                  key={s.source_id}
                                  onClick={() => setSource(s)}
                                >
                                  <td>
                                    <button
                                      className="row-title"
                                      onClick={() => setSource(s)}
                                    >
                                      {s.source_file || s.source_id}
                                    </button>
                                    <span className="row-id">
                                      {s.source_id}
                                    </span>
                                  </td>
                                  <td>
                                    {human(
                                      s.record_type || "customer_feedback",
                                    )}
                                  </td>
                                  <td>
                                    <Badge
                                      value={
                                        s.verification_status || "not_assessed"
                                      }
                                    />
                                  </td>
                                  <td>
                                    <ChevronRight size={16} />
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="No sources available" />
                    )}
                  </section>
                  {state?.warnings.map((w) => (
                    <div className="alert" key={w}>
                      <AlertCircle size={16} />
                      {w}
                    </div>
                  ))}
                </>
              )}
              {page === "Audit History" && (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Decision history</h2>
                      <p>
                        Append-only events · {audit.length} recorded changes
                      </p>
                    </div>
                    <History size={18} />
                  </div>
                  <Timeline events={audit} />
                </section>
              )}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>BMW Product Intelligence</span>
          <span>
            Local workspace · Decisions attributed to unauthenticated demo
            identities
          </span>
        </footer>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) {
            setSelected(null);
            setDetail(null);
          }
        }}
      >
        <DialogContent wide>
          <DialogTitle className="drawer-title">
            Requirement workspace
          </DialogTitle>
          <DialogDescription className="muted">
            Review the recommendation, examine evidence and record your
            decision.
          </DialogDescription>
          {opening ? (
            <div className="loading">Loading requirement…</div>
          ) : (
            detail && (
              <>
                {notice && (
                  <div className="alert success" role="status">
                    <Check size={16} />
                    {notice}
                  </div>
                )}
                <div className="requirement-hero">
                  <div className="eyebrow">
                    {detail.requirement.requirement_id} · V
                    {detail.requirement.version}
                  </div>
                  <h2>
                    {detail.requirement.title || detail.requirement.description}
                  </h2>
                  <div className="badge-line">
                    <Badge value={detail.requirement.status} />
                    <Badge
                      value={detail.requirement.priority_assessment.priority}
                    />
                    <Badge value={detail.requirement.category} />
                  </div>
                  <div className="detail-metrics">
                    <div>
                      <span>Priority score</span>
                      <strong>
                        {detail.requirement.priority_assessment.score ??
                          "Unscored"}
                        {detail.requirement.priority_assessment.score !==
                          null && <small> /100</small>}
                      </strong>
                    </div>
                    <div>
                      <span>Evidence confidence</span>
                      <strong>
                        {human(
                          detail.requirement.evidence_confidence ||
                            detail.requirement.evidence_level,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Linked sources</span>
                      <strong>
                        {detail.requirement.linked_source_ids.length}
                      </strong>
                    </div>
                  </div>
                </div>
                <Tabs.Root defaultValue="overview">
                  <Tabs.List className="tabs">
                    {[
                      "overview",
                      "evidence",
                      "uncertainty",
                      "priority",
                      "history",
                    ].map((t) => (
                      <Tabs.Trigger key={t} value={t}>
                        {human(t)}
                        {t === "evidence" && (
                          <small>{detail.evidence.findings.length}</small>
                        )}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                  <Tabs.Content value="overview">
                    <section className="detail-section">
                      <h3>Recommendation</h3>
                      <p>{detail.requirement.description}</p>
                      <h3>Customer benefit</h3>
                      <p>
                        {detail.requirement.customer_benefit ||
                          "No separate benefit statement is recorded. Review the proposal and linked customer needs."}
                      </p>
                    </section>
                    <section className="detail-section">
                      <h3>Why the AI recommends this</h3>
                      <p className="muted">
                        Linked findings are AI interpretations grounded in the
                        original quotations.
                      </p>
                      {detail.evidence.findings.map((f) => (
                        <div className="linked-finding" key={f.finding_id}>
                          <Sparkles size={16} />
                          <div>
                            {f.summary}
                            <small>
                              {f.finding_id} · {f.source_id}
                            </small>
                          </div>
                        </div>
                      ))}
                    </section>
                    <Notes
                      title="Assumptions"
                      items={detail.requirement.assumptions}
                    />
                    {detail.requirement.challenges?.map((c, i) => (
                      <div className="alert" key={i}>
                        {c.question} · {human(c.state)}
                      </div>
                    ))}
                  </Tabs.Content>
                  <Tabs.Content value="evidence">
                    {detail.evidence.findings.map((f) => (
                      <FindingView
                        key={f.finding_id}
                        finding={f}
                        sources={detail.evidence.sources}
                      />
                    ))}
                    {[
                      ["supporting_evidence", "Supporting reference evidence"],
                      [
                        "contradictory_evidence",
                        "Potentially conflicting evidence",
                      ],
                      [
                        "contextual_evidence",
                        "Context and equipment associations",
                      ],
                    ].map(([key, title]) => (
                      <section className="detail-section" key={key}>
                        <h3>{title}</h3>
                        {(
                          detail.requirement[key as keyof Requirement] as
                            Source[] | undefined
                        )?.length ? (
                          (
                            detail.requirement[
                              key as keyof Requirement
                            ] as Source[]
                          ).map((link, i) => (
                            <details key={i}>
                              <summary>{link.source_id}</summary>
                              <pre>{JSON.stringify(link, null, 2)}</pre>
                              {detail.evidence.sources.find(
                                (s) => s.source_id === link.source_id,
                              ) && (
                                <SourceView
                                  source={detail.evidence.sources.find(
                                    (s) => s.source_id === link.source_id,
                                  )!}
                                />
                              )}
                            </details>
                          ))
                        ) : (
                          <p className="muted">
                            No reference evidence of this type recorded.
                          </p>
                        )}
                      </section>
                    ))}
                    {detail.evidence.sources.map((s) => (
                      <details key={s.source_id}>
                        <summary>Original source · {s.source_id}</summary>
                        <SourceView source={s} />
                      </details>
                    ))}
                  </Tabs.Content>
                  <Tabs.Content value="uncertainty">
                    <Notes
                      title="Uncertainty and missing evidence"
                      items={detail.requirement.uncertainties}
                    />
                    <Notes
                      title="Assumptions"
                      items={detail.requirement.assumptions}
                    />
                    <Notes title="Market limitations" items={detail.warnings} />
                    <Notes
                      title="Conflicting evidence"
                      items={state?.selected_run?.summary.conflicts?.filter(
                        (c) =>
                          detail.requirement.conflict_ids.includes(
                            String(c.conflict_id),
                          ),
                      )}
                    />
                  </Tabs.Content>
                  <Tabs.Content value="priority">
                    <section className="detail-section">
                      <div className="section-heading">
                        <h3>Explainable priority</h3>
                        <Button
                          variant="outline"
                          onClick={() => prepare("score")}
                        >
                          Assess priority
                        </Button>
                      </div>
                      <p className="muted">
                        {detail.requirement.priority_assessment.policy_version}{" "}
                        · Prototype policy, not BMW policy. Score = Σ(weight ×
                        rating / 5).
                      </p>
                      <table className="score-table">
                        <thead>
                          <tr>
                            <th>Factor</th>
                            <th>Weight</th>
                            <th>Rating</th>
                            <th>Rationale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(state?.weights || {}).map(
                            ([f, w]) => (
                              <tr key={f}>
                                <td>{human(f)}</td>
                                <td>{w}%</td>
                                <td>
                                  {detail.requirement.priority_assessment
                                    .ratings[f] ?? "—"}
                                  /5
                                </td>
                                <td>
                                  {detail.requirement.priority_assessment
                                    .rationales[f] || "PM assessment required"}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                      <Notes
                        title="Missing PM inputs"
                        items={detail.requirement.priority_assessment.missing_factors.map(
                          human,
                        )}
                      />
                      <details>
                        <summary>
                          Observed evidence and scoring assumptions
                        </summary>
                        <pre>
                          {JSON.stringify(
                            detail.requirement.scoring_observations,
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </section>
                  </Tabs.Content>
                  <Tabs.Content value="history">
                    <Timeline events={detail.audit} />
                  </Tabs.Content>
                </Tabs.Root>
                <div className="decision-bar">
                  {[
                    ["approve", Check],
                    ["reject", Ban],
                    ["postpone", Clock],
                    ["edit", Pencil],
                    ["challenge", MessageSquare],
                  ].map(([a, I]) => {
                    const Icon = I as typeof Check;
                    return (
                      <Button
                        key={String(a)}
                        variant={a === "approve" ? "default" : "outline"}
                        onClick={() => prepare(String(a))}
                      >
                        <Icon size={14} />
                        {a === "challenge" ? "Challenge AI" : human(String(a))}
                      </Button>
                    );
                  })}
                </div>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v && !busy) setAction("");
        }}
      >
        <DialogContent>
          <DialogTitle>
            {action === "score"
              ? "Assess requirement priority"
              : action === "challenge"
                ? "Challenge AI recommendation"
                : human(action) + " requirement"}
          </DialogTitle>
          <DialogDescription className="muted">
            This action persists through the existing service and records your
            rationale in the audit trail.
          </DialogDescription>
          <form onSubmit={(e) => void decide(e)} className="decision-form">
            <label>
              Responsible product manager
              <input
                required
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                placeholder="Enter your name"
              />
            </label>
            {action === "edit" && (
              <label>
                Revised requirement
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            )}
            {action === "postpone" && (
              <label>
                Review date (optional)
                <input
                  type="date"
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                />
              </label>
            )}
            {action === "score" &&
              Object.entries(state?.weights || {}).map(([f, w]) => (
                <div className="rating-input" key={f}>
                  <label>
                    {human(f)} · {w}%
                    <select
                      required
                      value={ratings[f] ?? ""}
                      onChange={(e) =>
                        setRatings({ ...ratings, [f]: Number(e.target.value) })
                      }
                    >
                      <option value="" disabled>
                        Unassessed
                      </option>
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} / 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Factor rationale
                    <input
                      required
                      value={reasons[f] || ""}
                      onChange={(e) =>
                        setReasons({ ...reasons, [f]: e.target.value })
                      }
                    />
                  </label>
                </div>
              ))}
            <label>
              {action === "challenge"
                ? "Evidence-grounded question"
                : "Decision rationale"}
              <textarea
                required
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Document why this is the right next step…"
              />
            </label>
            {action === "approve" &&
              detail?.requirement.priority_assessment.score === null && (
                <div className="alert">
                  Complete documented priority scoring before approval.
                </div>
              )}
            {action === "challenge" && (
              <p className="muted">
                The question and linked evidence are saved for later AI review.
                This action makes no external request.
              </p>
            )}
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setAction("")}
              >
                Cancel
              </Button>
              <Button disabled={busy || !actor.trim() || !rationale.trim()}>
                {busy ? "Saving…" : "Confirm & save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!source || !!finding}
        onOpenChange={(v) => {
          if (!v) {
            setSource(null);
            setFinding(null);
          }
        }}
      >
        <DialogContent wide>
          <DialogTitle>
            {finding ? "Evidence explorer" : "Original source"}
          </DialogTitle>
          <DialogDescription className="muted">
            Original records and AI interpretations are shown separately.
          </DialogDescription>
          {source && <SourceView source={source} />}{" "}
          {finding && (
            <FindingView finding={finding} sources={state?.sources || []} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
