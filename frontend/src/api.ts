export interface Assessment {
  score: number | null;
  priority: string;
  ratings: Record<string, number>;
  rationales: Record<string, string>;
  missing_factors: string[];
  policy_version: string;
}
export interface Requirement {
  requirement_id: string;
  description: string;
  title?: string;
  customer_benefit?: string;
  category: string;
  status: string;
  version: number;
  market: string;
  updated_at: string;
  evidence_level: string;
  evidence_confidence?: string;
  linked_source_ids: string[];
  linked_finding_ids: string[];
  priority_assessment: Assessment;
  uncertainties: string[];
  assumptions: string[];
  conflict_ids: string[];
  supporting_evidence?: Source[];
  contradictory_evidence?: Source[];
  contextual_evidence?: Source[];
  scoring_observations?: Record<string, unknown>;
  challenges?: { question: string; state: string }[];
}
export interface Source {
  source_id: string;
  record_type?: string;
  text?: string;
  text_original?: string;
  source_file?: string;
  source_ref?: string;
  verification_status?: string;
  [key: string]: unknown;
}
export interface Finding {
  finding_id: string;
  source_id: string;
  category: string;
  summary: string;
  evidence_quote: string;
  evidence_valid: boolean;
  uncertainties?: string[];
  source_reference?: Record<string, unknown>;
}
export interface Audit {
  event_id: number;
  requirement_id: string;
  event_type: string;
  actor_id: string;
  timestamp: string;
  rationale: string;
  old_json: Record<string, unknown> | null;
  new_json: Record<string, unknown> | null;
}
export interface Run {
  run_id: string;
  created_at: string;
  settings: { mode: string };
  summary: {
    conflicts?: Record<string, unknown>[];
    evidence_links?: Record<string, unknown>[];
  };
}
export interface Workspace {
  runs: Run[];
  selected_run: Run | null;
  requirements: Requirement[];
  findings: Finding[];
  sources: Source[];
  inventory: Source[];
  warnings: string[];
  weights: Record<string, number>;
}
export interface Detail {
  requirement: Requirement;
  evidence: { findings: Finding[]; sources: Source[] };
  audit: Audit[];
  warnings: string[];
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined
      ? { method: "POST", body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Server unavailable" }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "Check the submitted fields.",
    );
  }
  return response.json();
}
