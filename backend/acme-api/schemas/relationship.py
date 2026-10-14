"""Pydantic schemas for employee-manager relationship endpoints."""

from pydantic import BaseModel, ConfigDict, Field


class EmployeeAssignRequest(BaseModel):
    """Payload for assigning an employee to a manager."""

    employee_id: int = Field(..., gt=0)

    model_config = ConfigDict(extra="forbid")


class RelationshipRemovalResult(BaseModel):
    """Summary returned after an employee is removed from a manager."""

    manager_id: int
    employee_id: int
    ended_assignment_ids: list[int]
