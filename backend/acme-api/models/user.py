from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class EmployeeManager(Base):
    __tablename__ = "employee_managers"

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), primary_key=True
    )
    manager_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), primary_key=True
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="employee")
    job_title: Mapped[str | None] = mapped_column(String(150))
    profile_picture_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    managers: Mapped[list["User"]] = relationship(
        "User",
        secondary="employee_managers",
        primaryjoin="User.id == EmployeeManager.employee_id",
        secondaryjoin="User.id == EmployeeManager.manager_id",
        back_populates="employees",
    )

    employees: Mapped[list["User"]] = relationship(
        "User",
        secondary="employee_managers",
        primaryjoin="User.id == EmployeeManager.manager_id",
        secondaryjoin="User.id == EmployeeManager.employee_id",
        back_populates="managers",
    )

    managed_projects: Mapped[list["Project"]] = relationship(
        "Project",
        foreign_keys="Project.manager_id",
        back_populates="manager",
    )

    milestone_assignments: Mapped[list["MilestoneAssignment"]] = relationship(
        "MilestoneAssignment", back_populates="employee"
    )

    work_terms: Mapped[list["EmployeeWorkTerms"]] = relationship(
        "EmployeeWorkTerms", back_populates="employee"
    )
