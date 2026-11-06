"""Typed contracts. ExtractedRecord is the schema the extractor (LLM or parser) must satisfy (PRD §Data model)."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field


class LessonProgress(BaseModel):
    subject: Optional[str] = None
    lesson_ref: Optional[str] = None  # e.g. "lesson 7"
    status: Optional[Literal["started", "completed"]] = None


class ClassDay(BaseModel):
    grade: Optional[int] = Field(None, ge=1, le=8)
    section: Optional[str] = None
    record_date: Optional[date] = None  # per-class date, for backfill notes naming several dates
    enrolled: Optional[int] = Field(None, ge=0)  # never trusted: always replaced by roster size
    present: Optional[int] = Field(None, ge=0)
    absent_count: Optional[int] = Field(None, ge=0)  # "4 absent", as spoken
    absent_names: list[str] = []
    meals_served: Optional[int] = Field(None, ge=0)
    lessons: list[LessonProgress] = []


class ExtractedRecord(BaseModel):
    record_date: Optional[date] = None
    classes: list[ClassDay] = []
    field_confidence: dict[str, float] = {}
    missing_fields: list[str] = []


# ---- request bodies ----

class PhoneIn(BaseModel):
    phone: str


class VerifyIn(BaseModel):
    phone: str
    code: str


class RecordPatch(BaseModel):
    record_date: Optional[date] = None
    present: Optional[int] = Field(None, ge=0)
    meals_served: Optional[int] = Field(None, ge=0)
    absent_student_ids: Optional[list[str]] = None
    lessons: Optional[list[LessonProgress]] = None


class CorrectionIn(BaseModel):
    patch: Optional[RecordPatch] = None
    text: Optional[str] = None


class ResolveNameIn(BaseModel):
    spoken: str
    student_id: Optional[str] = None


class ConfirmIn(BaseModel):
    acknowledge_warnings: bool = False


class TimeSavedIn(BaseModel):
    minutes: float = Field(ge=0, le=240)


class ReportIn(BaseModel):
    kind: Literal["attendance", "mdm", "summary", "csv"]
    month: str = Field(pattern=r"^\d{4}-\d{2}$")


class NewClass(BaseModel):
    grade: int = Field(ge=1, le=8)
    section: Optional[str] = Field(None, max_length=4)


class NewTeacher(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str
    language: Literal["hi", "en", "mr", "kn"] = "hi"
    school_name: str = Field(min_length=1, max_length=200)
    state: str = Field(min_length=1, max_length=80)
    udise_code: Optional[str] = Field(None, max_length=20)
    classes: list[NewClass] = Field(min_length=1)
