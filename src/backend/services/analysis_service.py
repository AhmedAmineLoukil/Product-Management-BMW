from src.backend.schemas import Requirement
from src.backend.services.requirement_service import add_ai_proposal

def run_analysis(vehicle, market):
    # LATER, replace the fake line with the real pipeline:
    # records  = load_data(vehicle=vehicle, market=market)    # Member 1
    # result   = run_ai_pipeline(records)                      # Member 2
    # proposals = rank_requirements(result["requirements"])    # Member 3
    proposals = _fake_requirements(vehicle, market)
    saved = [add_ai_proposal(r) for r in proposals]
    return {"count": len(saved), "requirements": saved}

def _fake_requirements(vehicle, market):
    return [
        Requirement(requirement_id="REQ-001", vehicle=vehicle, market=market,
                    description="Improve long-distance seating comfort",
                    finding_ids=["FIND-001", "FIND-002"], sources=["SYNTH-0001"],
                    priority_score=82, prioritization_rationale="Synthetic demo data",
                    evidence_level="Medium"),
        Requirement(requirement_id="REQ-002", vehicle=vehicle, market=market,
                    description="Show clearer charging time estimates",
                    finding_ids=["FIND-003"], sources=["SYNTH-0002"],
                    priority_score=76, prioritization_rationale="Synthetic demo data",
                    evidence_level="Low", uncertainties=["Only one supporting record"]),
    ]