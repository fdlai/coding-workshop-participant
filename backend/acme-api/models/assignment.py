from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

"""Represents an assignment period between an employee and a milestone"""


class MilestoneAssignment(Base):
    __tablename__ = "milestone_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    milestone_id: Mapped[int] = mapped_column(
        ForeignKey("milestones.id"), nullable=False
    )
    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    planned_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    milestone: Mapped["Milestone"] = relationship(
        "Milestone", back_populates="assignments"
    )
    employee: Mapped["User"] = relationship(
        "User", back_populates="milestone_assignments"
    )
