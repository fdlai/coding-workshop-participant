from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class EmployeeWorkTerms(Base):
    __tablename__ = "employee_work_terms"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    weekly_hours: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=40
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)

    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from"),
    )

    employee: Mapped["User"] = relationship(
        "User", back_populates="work_terms"
    )
