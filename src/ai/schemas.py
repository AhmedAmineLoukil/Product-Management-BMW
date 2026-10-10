from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


class FindingExtraction(BaseModel):
    finding_type: Literal["complaint", "unmet_need", "positive_feedback", "unclear"]
    category: Literal["Comfort", "Technology", "Safety", "Performance", "Other"]
    summary: str
    evidence_quote: str
    needs_review: bool
    uncertainties: list[str]


class FeedbackRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    source_id: str
    vehicle: str
    text: str
    market: str | None = None
    source_type: str | None = None
    source_file: str | None = None
    source_location: str | None = None

    @field_validator("source_id")
    @classmethod
    def nonempty_source_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("source_id must be non-empty")
        return value


class ExtractionBatch(BaseModel):
    findings: list[FindingExtraction]


class RequirementDraft(BaseModel):
    description: str
    category: Literal["Comfort", "Technology", "Safety", "Performance", "Other"]
    linked_finding_ids: list[str]
    linked_source_ids: list[str]
    assumptions: list[str]
    uncertainties: list[str]


class RequirementBatch(BaseModel):
    requirements: list[RequirementDraft]
