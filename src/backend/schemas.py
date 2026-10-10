from typing import Literal
from pydantic import BaseModel

Status = Literal["pending", "approved", "rejected", "challenged"]

Category = Literal[
    "Interior and comfort",
    "Exterior and design",
    "Infotainment and digital services",
    "Space and practicality",
    "Driving experience",
    "Range and charging",
    "Equipment and packages",
    "Perceived quality",
    "Other",                 
]

class Requirement(BaseModel):
    requirement_id: str
    vehicle: str
    market: str
    category: Category = "Other"
    description: str
    finding_ids: list[str] = []
    sources: list[str] = []
    priority_score: float = 0
    prioritization_rationale: str = ""
    evidence_level: str = "Low"
    future_assumptions: list[str] = []
    uncertainties: list[str] = []
    decision_status: Status = "pending"

class ReviewAction(BaseModel):      # body for approve / reject / challenge
    actor: str
    rationale: str = ""

class EditRequest(BaseModel):       # body for edit
    actor: str
    rationale: str
    changes: dict                   # e.g. {"description": "new text"}