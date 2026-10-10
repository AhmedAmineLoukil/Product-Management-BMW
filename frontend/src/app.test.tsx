import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./main";
import type { Workspace, Detail } from "./api";

vi.mock("recharts", () => ({
  ResponsiveContainer: () => null,
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
}));
const req = {
  requirement_id: "FIXTURE-REQ",
  description: "Improve seat comfort on long journeys",
  category: "Comfort",
  status: "pending",
  version: 1,
  market: "GB",
  updated_at: "2026-10-10T12:00:00Z",
  evidence_level: "supported",
  evidence_confidence: "supported",
  linked_source_ids: ["FIXTURE-SOURCE"],
  linked_finding_ids: ["FIXTURE-FINDING"],
  priority_assessment: {
    score: null,
    priority: "unscored",
    ratings: {},
    rationales: {},
    missing_factors: ["customer_impact"],
    policy_version: "F70-PM-v1",
  },
  uncertainties: ["Fixture sample is not representative"],
  assumptions: [],
  conflict_ids: [],
};
const finding = {
  finding_id: "FIXTURE-FINDING",
  source_id: "FIXTURE-SOURCE",
  category: "Comfort",
  summary: "Seat discomfort on long trips",
  evidence_quote: "Fictional seat comfort feedback",
  evidence_valid: true,
};
const workspace: Workspace = {
  runs: [],
  selected_run: null,
  requirements: [req],
  findings: [finding],
  sources: [
    { source_id: "FIXTURE-SOURCE", text: "Fictional seat comfort feedback" },
  ],
  inventory: [],
  warnings: [],
  weights: { customer_impact: 25 },
};
const selectedRun = {
  run_id: "RUN-1",
  created_at: "2026-10-10T12:00:00Z",
  settings: { mode: "synthetic" },
  summary: {},
};
const detail: Detail = {
  requirement: req,
  evidence: { findings: [finding], sources: workspace.sources },
  audit: [],
  warnings: [],
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  location.hash = "";
  fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
    let data: unknown = input.includes("/audit")
      ? []
      : input.includes("/requirements/")
        ? detail
        : workspace;
    if (options?.method === "POST") {
      const payload = JSON.parse(String(options.body));
      data = {
        ...detail,
        requirement: {
          ...req,
          status: payload.action === "reject" ? "rejected" : "under_review",
          version: 2,
        },
      };
    }
    return { ok: true, json: async () => data };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("premium workspace", () => {
  it("loads the selected vehicle and market from the backend", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Vehicle" }),
      "G60",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Market" }),
      "DE",
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("/workspace?vehicle=G60&market=DE"),
        ),
      ).toBe(true),
    );
  });
  it("navigates all six pages and preserves encoded navigation labels", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(
      "Customer signals. Traceable requirements. Informed decisions.",
    );
    for (const page of [
      "Data Sources",
      "AI Findings",
      "Requirements",
      "PM Decisions",
      "Audit History",
      "Overview",
    ]) {
      await user.click(
        screen.getByRole("button", { name: new RegExp("^" + page) }),
      );
      await waitFor(() =>
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
          page,
        ),
      );
    }
    expect(fetchMock).toHaveBeenCalled();
  });
  it("filters requirements and opens exact evidence", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Requirements" }));
    await screen.findByRole("button", { name: req.description });
    await user.type(
      screen.getByRole("textbox", { name: "Search requirements" }),
      "missing",
    );
    expect(screen.queryByRole("button", { name: req.description })).toBeNull();
    await user.clear(
      screen.getByRole("textbox", { name: "Search requirements" }),
    );
    await user.click(screen.getByRole("button", { name: req.description }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Improve seat comfort on long journeys", {
      selector: "h2",
    });
    await user.click(within(dialog).getByRole("tab", { name: /Evidence/ }));
    expect(
      await within(dialog).findAllByText("Fictional seat comfort feedback", {
        selector: "blockquote",
      }),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("tab", { name: "Priority" }));
    expect(within(dialog).getByText("PM assessment required")).toBeTruthy();
  });
  it("confirms a PM action with identity, rationale and opened version then refreshes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Requirements" }));
    await user.click(
      await screen.findByRole("button", { name: req.description }),
    );
    const requirementDialog = await screen.findByRole("dialog");
    await user.click(
      await within(requirementDialog).findByRole("button", { name: "Reject" }),
    );
    const dialogs = screen.getAllByRole("dialog");
    const decisionDialog = dialogs[dialogs.length - 1];
    await user.type(
      within(decisionDialog).getByLabelText("Responsible product manager"),
      "Fixture PM",
    );
    await user.type(
      within(decisionDialog).getByLabelText("Decision rationale"),
      "Fixture evidence is insufficient",
    );
    await user.click(
      within(decisionDialog).getByRole("button", { name: "Confirm & save" }),
    );
    await screen.findByRole("status");
    const call = fetchMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith("/decisions"),
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String(call![1]?.body));
    expect(body).toMatchObject({
      actor: "Fixture PM",
      action: "reject",
      expected_version: 1,
      rationale: "Fixture evidence is insufficient",
    });
    expect(screen.getByRole("status").textContent).toContain(
      "Audit history updated",
    );
  });
  it("shows API failures without presenting invented metrics", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      json: async () => ({ detail: "Fixture server unavailable" }),
    }));
    render(<App />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Fixture server unavailable",
    );
  });
  it("reloads synthetic demo data with the created run id", async () => {
    const user = userEvent.setup();
    const emptyWorkspace = {
      ...workspace,
      runs: [],
      selected_run: null,
      requirements: [],
      findings: [],
      sources: [],
    };
    const savedWorkspace = {
      ...workspace,
      runs: [selectedRun],
      selected_run: selectedRun,
    };
    fetchMock.mockImplementation(async (input: string, options?: RequestInit) => {
      let data: unknown = input.includes("/audit")
        ? []
        : input.includes("/workspace") && input.includes("run_id=RUN-1")
          ? savedWorkspace
          : input.includes("/workspace")
            ? emptyWorkspace
            : detail;
      if (options?.method === "POST") {
        data = input.includes("/analysis/synthetic")
          ? { run_id: "RUN-1" }
          : {
              ...detail,
              requirement: {
                ...req,
                status: "under_review",
                version: 2,
              },
            };
      }
      return { ok: true, json: async () => data };
    });
    render(<App />);
    await screen.findByText("Awaiting analysis");
    await user.click(screen.getByRole("button", { name: /Synthetic demo/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("/workspace?vehicle=F70&market=GB&run_id=RUN-1"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Analysis saved")).toBeTruthy();
    expect(screen.getByText("Synthetic demonstration")).toBeTruthy();
    expect(screen.getByText("1 FINDINGS")).toBeTruthy();
  });
});
