"""Postgres/SQLite models. Student names live only in Student.name_enc (encrypted); everything else uses IDs."""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint, create_engine)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from . import config

_url = config.DATABASE_URL
if _url.startswith("postgresql://"):
    _url = "postgresql+psycopg://" + _url[len("postgresql://"):]  # psycopg 3 driver
if _url.startswith("sqlite"):
    engine = create_engine(_url, connect_args={"check_same_thread": False})
else:
    # Small pool behind a hosted pooler (Supabase/Cloud SQL). pre_ping survives connections dropped while the
    # container was scaled to zero.
    engine = create_engine(_url, pool_size=3, max_overflow=2, pool_pre_ping=True, pool_recycle=300)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def uid() -> str:
    return uuid.uuid4().hex[:16]


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class School(Base):
    __tablename__ = "schools"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    state: Mapped[str] = mapped_column(String(80))
    udise_code: Mapped[str | None] = mapped_column(String(20), nullable=True)


class Teacher(Base):
    __tablename__ = "teachers"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    phone_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    phone_last4: Mapped[str] = mapped_column(String(4))
    language: Mapped[str] = mapped_column(String(8), default="hi")
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id"))
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pseudo_id: Mapped[str] = mapped_column(String(16), default=uid)  # random, for public counters only
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    school: Mapped[School] = relationship()
    classes: Mapped[list["ClassSection"]] = relationship(back_populates="teacher", cascade="all, delete-orphan",
                                                         order_by="ClassSection.grade")


class ClassSection(Base):
    __tablename__ = "class_sections"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"))
    grade: Mapped[int] = mapped_column(Integer)
    section: Mapped[str | None] = mapped_column(String(4), nullable=True)

    teacher: Mapped[Teacher] = relationship(back_populates="classes")
    students: Mapped[list["Student"]] = relationship(back_populates="klass", cascade="all, delete-orphan",
                                                     order_by="Student.roll_no")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("class_id", "roll_no"),)
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    class_id: Mapped[str] = mapped_column(ForeignKey("class_sections.id"))
    roll_no: Mapped[int] = mapped_column(Integer)
    name_enc: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    klass: Mapped[ClassSection] = relationship(back_populates="students")


class LoginCode(Base):
    __tablename__ = "login_codes"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    phone_hash: Mapped[str] = mapped_column(String(64), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class VoiceNote(Base):
    __tablename__ = "voice_notes"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"), index=True)
    channel: Mapped[str] = mapped_column(String(16), default="web")
    channel_message_id: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)  # idempotency
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    transcript: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(8), default="hi")
    asr_engine: Mapped[str] = mapped_column(String(40), default="")
    extractor: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(12), default="received")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    minutes_saved: Mapped[float | None] = mapped_column(Float, nullable=True)  # self-reported, once per note
    audio_uri: Mapped[str | None] = mapped_column(String(200), nullable=True)  # always None: audio never persisted
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DailyRecord(Base):
    __tablename__ = "daily_records"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"), index=True)
    class_id: Mapped[str] = mapped_column(ForeignKey("class_sections.id"), index=True)
    source_note_id: Mapped[str | None] = mapped_column(ForeignKey("voice_notes.id"), nullable=True)
    record_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    enrolled: Mapped[int | None] = mapped_column(Integer, nullable=True)
    present: Mapped[int | None] = mapped_column(Integer, nullable=True)
    absent_count_spoken: Mapped[int | None] = mapped_column(Integer, nullable=True)
    absent_student_ids: Mapped[list] = mapped_column(JSON, default=list)
    unresolved: Mapped[list] = mapped_column(JSON, default=list)  # [{spoken, candidate_ids: [...]}]
    meals_served: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lessons: Mapped[list] = mapped_column(JSON, default=list)
    field_confidence: Mapped[dict] = mapped_column(JSON, default=dict)
    missing_fields: Mapped[list] = mapped_column(JSON, default=list)
    extracted_fields: Mapped[int] = mapped_column(Integer, default=0)  # for first-pass accuracy
    status: Mapped[str] = mapped_column(String(12), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)
    previous_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    klass: Mapped[ClassSection] = relationship()
    flags: Mapped[list["ValidationFlag"]] = relationship(cascade="all, delete-orphan",
                                                         order_by="ValidationFlag.created_at")


class ValidationFlag(Base):
    __tablename__ = "validation_flags"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    record_id: Mapped[str] = mapped_column(ForeignKey("daily_records.id"), index=True)
    rule_id: Mapped[str] = mapped_column(String(8))
    severity: Mapped[str] = mapped_column(String(8))
    field: Mapped[str | None] = mapped_column(String(32), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    resolution: Mapped[str] = mapped_column(String(20), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Correction(Base):
    __tablename__ = "corrections"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    record_id: Mapped[str] = mapped_column(ForeignKey("daily_records.id"), index=True)
    field: Mapped[str] = mapped_column(String(32))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    via: Mapped[str] = mapped_column(String(12))  # edit | text | voice | name
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    period: Mapped[str] = mapped_column(String(7))
    filename: Mapped[str] = mapped_column(String(120))
    file_uri: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class UsageEvent(Base):
    """Anonymous counters. No names, no phone numbers; teacher_pseudo_id is random."""
    __tablename__ = "usage_events"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    day: Mapped[date] = mapped_column(Date, index=True)
    event_type: Mapped[str] = mapped_column(String(24))
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    teacher_pseudo_id: Mapped[str] = mapped_column(String(16))
    value: Mapped[float | None] = mapped_column(Float, nullable=True)


class StudentContact(Base):
    """A parent's phone for absence follow-up. Encrypted like names; entered by the teacher, never shared."""
    __tablename__ = "student_contacts"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    phone_enc: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FollowUpAction(Base):
    """What the teacher did about a child who keeps missing school, and what they learned."""
    __tablename__ = "followup_actions"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    action: Mapped[str] = mapped_column(String(16))  # call | visit | message | spoke_child | other
    reason: Mapped[str | None] = mapped_column(String(16), nullable=True)  # illness | work | migration | ...
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)  # will_return | returned | unreachable
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LearningLevel(Base):
    """One ASER-style reading and maths level per child per month, said or tapped by the teacher."""
    __tablename__ = "learning_levels"
    __table_args__ = (UniqueConstraint("student_id", "month"),)
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teachers.id"), index=True)
    class_id: Mapped[str] = mapped_column(ForeignKey("class_sections.id"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    month: Mapped[str] = mapped_column(String(7))
    reading: Mapped[str | None] = mapped_column(String(12), nullable=True)
    maths: Mapped[str | None] = mapped_column(String(12), nullable=True)
    source: Mapped[str] = mapped_column(String(8), default="tap")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def init_db():
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
