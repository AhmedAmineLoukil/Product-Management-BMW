const initialRequirements = [
  {
    id: "REQ-001",
    priority: "P1 · HIGH",
    score: 84,
    confidence: "Medium confidence",
    title: "Customers should be able to find frequently used cabin controls with fewer steps.",
    category: "Usability",
    finding: "Several sample comments describe difficulty finding everyday controls.",
    evidence: [
      { quote: "I had to tap around to find the seat settings.", source: "Synthetic example S-004" },
      { quote: "The climate menu is hard to find while I am parked.", source: "Synthetic example S-009" }
    ],
    scoreReason: "Appears in multiple sample comments; likely affects a common task.",
    status: "Needs review"
  },
  {
    id: "REQ-002",
    priority: "P2 · MEDIUM",
    score: 71,
    confidence: "Low confidence",
    title: "Customers should have an easy place to store everyday items within reach.",
    category: "Storage",
    finding: "Sample comments suggest that small-item storage is inconvenient.",
    evidence: [
      { quote: "My phone and keys end up sliding around.", source: "Synthetic example S-002" },
      { quote: "I wish the front storage was easier to use.", source: "Synthetic example S-011" }
    ],
    scoreReason: "A recurring inconvenience, but the sample does not yet show its market impact.",
    status: "Needs review"
  },
  {
    id: "REQ-003",
    priority: "P2 · MEDIUM",
    score: 67,
    confidence: "Low confidence",
    title: "Customers should be able to understand the vehicle’s charging status at a glance.",
    category: "Charging experience",
    finding: "Sample comments ask for clearer information during charging.",
    evidence: [
      { quote: "I am not sure how long charging will take.", source: "Synthetic example S-006" }
    ],
    scoreReason: "Potentially important, but based on one example and needs more evidence.",
    status: "Needs review"
  }
];

const dataKey = "product-signal-demo-requirements-v1";
const auditKey = "product-signal-demo-audit-v1";
let requirements = readStore(dataKey, initialRequirements);
let audit = readStore(auditKey, []);
let editingId = null;

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function save() {
  localStorage.setItem(dataKey, JSON.stringify(requirements));
  localStorage.setItem(auditKey, JSON.stringify(audit));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function logAction(requirement, action, reason) {
  const vehicle = document.querySelector("#vehicle").value;
  const market = document.querySelector("#market").value;
  audit.unshift({
    id: requirement.id,
    action,
    reason,
    vehicle,
    market,
    at: new Date().toISOString()
  });
  audit = audit.slice(0, 12);
}

function renderRequirements() {
  const filter = document.querySelector("#statusFilter").value;
  const visible = requirements.filter(item => filter === "all" || item.status === filter);
  const list = document.querySelector("#requirementList");
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">No requirements match this filter.</div>';
  } else {
    list.innerHTML = visible.map(item => {
      const statusClass = item.status === "Approved" ? "approved" : item.status === "Rejected" ? "rejected" : "";
      const priorityClass = item.priority.includes("MEDIUM") ? "medium" : "";
      const evidenceHtml = item.evidence.map(entry => `<div class="quote-row"><q>${escapeHtml(entry.quote)}</q><span class="source-ref">${escapeHtml(entry.source)}</span></div>`).join("");
      const actions = item.status === "Needs review" ? `
        <div class="req-actions">
          <button class="button button-primary" data-action="approve" data-id="${item.id}">Approve</button>
          <button class="button button-secondary" data-action="edit" data-id="${item.id}">Edit</button>
          <button class="button button-danger" data-action="reject" data-id="${item.id}">Reject</button>
        </div>` : `<div class="req-actions"><button class="button button-secondary" data-action="reopen" data-id="${item.id}">Return to review</button></div>`;
      return `<article class="requirement-card">
        <div class="req-top"><span class="req-id">${item.id}</span><span class="priority ${priorityClass}">${escapeHtml(item.priority)}</span></div>
        <h3 class="req-title">${escapeHtml(item.title)}</h3>
        <div class="req-meta"><span class="tag">${escapeHtml(item.category)}</span><span class="status ${statusClass}">${escapeHtml(item.status)}</span></div>
        <div class="req-evidence"><div class="evidence-head">LINKED FINDING &amp; EVIDENCE</div><div class="side-copy">${escapeHtml(item.finding)}</div>${evidenceHtml}</div>
        <div class="reason-row"><span class="score-number">${item.score}</span><div class="meter" aria-label="Example priority score ${item.score} out of 100"><span style="width:${item.score}%"></span></div><span class="certainty">${escapeHtml(item.confidence)}</span></div>
        <div class="side-copy">${escapeHtml(item.scoreReason)}</div>
        ${actions}
      </article>`;
    }).join("");
  }
  const waiting = requirements.filter(item => item.status === "Needs review").length;
  document.querySelector("#reviewCount").textContent = waiting;
  document.querySelector("#requirementCount").textContent = requirements.length;
}

function renderAudit() {
  document.querySelector("#auditCount").textContent = audit.length;
  const list = document.querySelector("#auditList");
  if (!audit.length) {
    list.innerHTML = '<p class="audit-empty">No decisions yet. Approve, edit, or reject a suggestion to see the history.</p>';
    return;
  }
  list.innerHTML = audit.map(entry => {
    const time = new Date(entry.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    return `<div class="audit-item"><strong>${escapeHtml(entry.id)}</strong> · ${escapeHtml(entry.action)}<br>${escapeHtml(entry.reason)}<span class="audit-time">PM · ${escapeHtml(entry.vehicle)} / ${escapeHtml(entry.market)} · ${escapeHtml(time)}</span></div>`;
  }).join("");
}

function render() {
  renderRequirements();
  renderAudit();
  save();
}

document.querySelector("#requirementList").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = requirements.find(requirement => requirement.id === button.dataset.id);
  if (!item) return;
  switch (button.dataset.action) {
    case "approve":
      item.status = "Approved";
      logAction(item, "approved requirement", "PM accepted the proposed wording.");
      break;
    case "reject":
      item.status = "Rejected";
      logAction(item, "rejected requirement", "PM rejected the suggestion; add the detailed reason in the real workflow.");
      break;
    case "reopen":
      item.status = "Needs review";
      logAction(item, "returned requirement to review", "PM reopened this suggestion.");
      break;
    case "edit":
      editingId = item.id;
      document.querySelector("#requirementText").value = item.title;
      document.querySelector("#editReason").value = "";
      document.querySelector("#editDialog").showModal();
      return;
  }
  render();
});

document.querySelector("#editForm").addEventListener("submit", event => {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const item = requirements.find(requirement => requirement.id === editingId);
  if (!item) return;
  const reason = document.querySelector("#editReason").value.trim();
  item.title = document.querySelector("#requirementText").value.trim();
  item.status = "Needs review";
  logAction(item, "edited requirement", reason);
  document.querySelector("#editDialog").close();
  render();
});

document.querySelector("#statusFilter").addEventListener("change", renderRequirements);
document.querySelector("#dismissNotice").addEventListener("click", () => document.querySelector(".notice").remove());
document.querySelector("#clearAudit").addEventListener("click", () => {
  audit = [];
  localStorage.removeItem(auditKey);
  renderAudit();
});

render();
