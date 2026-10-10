"""Contracts for AI extraction; do not let an LLM issue PM decisions."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, field_validator

Category = Literal[
    'Comfort', 'Space & Practicality', 'Usability',
    'Infotainment & Digital Services', 'Design & Perceived Quality',
    'Driving Experience', 'Range & Charging', 'Equipment & Packages',
    'Other',
    # Legacy categories remain accepted for compatibility with initial tests.
    'Technology', 'Safety', 'Performance',
]

class FindingExtraction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    finding_type: Literal['complaint', 'unmet_need', 'positive_feedback', 'unclear']
    category: Category
    summary: str
    evidence_quote: str
    needs_review: bool
    uncertainties: list[str]

class FeedbackRecord(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    source_id: str
    vehicle: str
    text: str
    market: str | None = None  # country-code (e.g. GB), NOT fabricated EU/DE
    source_type: str | None = None
    source_file: str | None = None
    source_location: str | None = None
    metadata: dict | None = None  # source rows/classifications, read-only context

    @field_validator('source_id', 'vehicle')
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('source_id and vehicle must be non-empty')
        return value

class ExtractionBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    findings: list[FindingExtraction]

class RequirementDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    description: str
    category: Category
    linked_finding_ids: list[str]
    linked_source_ids: list[str]
    assumptions: list[str]
    uncertainties: list[str]

class RequirementBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requirements: list[RequirementDraft]
