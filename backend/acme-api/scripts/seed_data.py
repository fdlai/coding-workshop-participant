"""Deterministic demo dataset for the ACME seed utility.

Pure data and pure functions: nothing here touches a database. ``scripts/seed.py``
turns these definitions into rows. To expand or change the demo company, edit the
lists below. Rules the data relies on (and the tests check):

* The first 23 people and the first five projects are the original demo records and
  keep their positions, so databases seeded earlier are never contradicted.
* Project dates are day offsets relative to the seed date.
* Staffing only uses employees who report to the project's manager, and no employee
  is booked on two overlapping assignments.
"""

from decimal import Decimal

# --------------------------------------------------------------------------- people

ADMINS = [
    ("Avery", "Brooks", "Chief Operating Officer"),
    ("Nadia", "Hussain", "Director of People Operations"),
    ("Theodore", "Whitfield", "IT Systems Administrator"),
]
ADMIN = ADMINS[0]

MANAGERS = [
    ("Morgan", "Hayes", "Engineering Manager"),
    ("Priya", "Natarajan", "Product Delivery Manager"),
    ("Daniel", "Okafor", "Infrastructure Manager"),
    ("Elena", "Rossi", "Design Manager"),
    ("Marcus", "Delgado", "Platform Engineering Manager"),
    ("Yuki", "Nakamura", "Data and Analytics Manager"),
    ("Fatima", "Al-Sayed", "Quality Engineering Manager"),
    ("Connor", "Gallagher", "Security and Compliance Manager"),
    ("Amara", "Okonkwo", "Product Management Manager"),
    ("Henrik", "Larsen", "Customer Solutions Manager"),
    ("Leila", "Rahimi", "Mobile Engineering Manager"),
    ("Victor", "Kowalski", "Business Systems Manager"),
]

_ORIGINAL_EMPLOYEES = [
    ("Liam", "Anderson", "Software Engineer"),
    ("Sofia", "Martinez", "Senior Software Engineer"),
    ("Noah", "Kim", "Frontend Developer"),
    ("Aisha", "Khan", "Backend Developer"),
    ("Ethan", "Walker", "DevOps Engineer"),
    ("Mia", "Nguyen", "QA Engineer"),
    ("Lucas", "Fischer", "Data Engineer"),
    ("Olivia", "Dubois", "UX Designer"),
    ("James", "Tanaka", "Software Engineer"),
    ("Hannah", "Cohen", "Business Analyst"),
    ("Mateo", "Silva", "Site Reliability Engineer"),
    ("Chloe", "Johansson", "Product Designer"),
    ("Ravi", "Patel", "Senior Backend Developer"),
    ("Grace", "Oyelaran", "QA Engineer"),
    ("Samuel", "Lindgren", "Frontend Developer"),
    ("Zoe", "Carter", "Technical Writer"),
    ("Omar", "Haddad", "Security Engineer"),
    ("Isabel", "Moreau", "Data Analyst"),
]

_FIRST_NAMES = [
    "Adrian", "Bianca", "Caleb", "Dalia", "Emeka", "Fiona", "Gabriel", "Hana", "Ivan",
    "Jasmine", "Kwame", "Lena", "Mohammed", "Nina", "Oscar", "Paloma", "Quentin", "Rosa",
    "Stefan", "Tamara", "Umar", "Valentina", "Wesley", "Ximena", "Yusuf", "Zara", "Andre",
    "Beatrice", "Carlos", "Diana", "Elias", "Farah", "Gustavo", "Helena", "Idris", "Julia",
    "Kenji", "Laura", "Mei", "Nikhil", "Ofelia", "Patrick", "Qiang", "Rebecca", "Santiago",
    "Tessa", "Uri", "Vanessa", "Walter", "Xavier", "Yasmin", "Zane", "Amelia", "Benjamin",
    "Camila", "Dmitri", "Esther", "Felix", "Gianna", "Hugo", "Ingrid", "Jonah", "Keiko",
    "Leo", "Maya", "Nolan", "Olga",
]
_LAST_NAMES = [
    "Abbott", "Banerjee", "Castillo", "Dimitrov", "Eriksson", "Fontaine", "Goldberg",
    "Hartmann", "Ibrahim", "Jovanovic", "Kapoor", "Lombardi", "Mbeki", "Novak", "Oyelowo",
    "Petrov", "Quinn", "Ramires", "Sorensen", "Takahashi", "Underwood", "Vasquez", "Wojcik",
    "Xu", "Yilmaz", "Zhang", "Archer", "Bellamy", "Calloway", "Duarte", "Echevarria",
    "Fitzgerald", "Gutierrez", "Hoffmann", "Iyer", "Jensen", "Kowalczyk", "Laurent",
    "Mahlangu", "Nakagawa", "Ortega", "Pereira", "Quigley", "Rasmussen", "Sandoval",
    "Thorne", "Ueda", "Valdez", "Whitaker", "Yamamoto", "Zielinski", "Abernathy", "Brennan",
    "Cardenas", "Donovan", "Eastwood", "Farrell", "Grayson", "Holloway", "Ito", "Jaramillo",
    "Kessler", "Lindqvist", "Montgomery", "Nwosu",
]
# Job titles for the eight newer managers' teams (index = manager index - 4).
_TEAM_TITLES = [
    ["Platform Engineer", "Site Reliability Engineer", "Cloud Architect", "DevOps Engineer",
     "Infrastructure Engineer", "Systems Engineer"],
    ["Data Engineer", "Data Analyst", "Analytics Engineer", "Machine Learning Engineer",
     "BI Developer", "Data Scientist"],
    ["QA Engineer", "Test Automation Engineer", "SDET", "QA Analyst",
     "Performance Test Engineer", "Release Engineer"],
    ["Security Engineer", "Security Analyst", "Compliance Analyst",
     "Application Security Engineer", "IAM Specialist", "Risk Analyst"],
    ["Product Manager", "Product Analyst", "Business Analyst", "UX Researcher",
     "Product Owner", "Technical Program Manager"],
    ["Solutions Engineer", "Technical Account Manager", "Customer Success Engineer",
     "Implementation Consultant", "Support Engineer", "Technical Writer"],
    ["iOS Developer", "Android Developer", "Mobile Engineer", "React Native Developer",
     "Frontend Developer", "UI Engineer"],
    ["ERP Analyst", "Integration Developer", "Backend Developer", "Senior Software Engineer",
     "Systems Analyst", "Software Engineer"],
]

_NEW_EMPLOYEE_MANAGER_BASE = 4  # new employees are spread across managers 4..11
_NEW_EMPLOYEES = [
    (
        _FIRST_NAMES[i],
        _LAST_NAMES[(i * 13 + 5) % len(_LAST_NAMES)],
        _TEAM_TITLES[i % 8][(i // 8) % 6],
    )
    for i in range(len(_FIRST_NAMES))
]
EMPLOYEES = _ORIGINAL_EMPLOYEES + _NEW_EMPLOYEES

# Original employees (by index) who also report to a second manager (by index).
SECOND_MANAGER = {1: 1, 3: 2, 4: 2, 7: 0, 11: 0, 12: 3, 14: 1}


def primary_manager(employee_index: int) -> int:
    """Return the index of the manager an employee primarily reports to."""
    if employee_index < len(_ORIGINAL_EMPLOYEES):
        return employee_index % 4
    new_index = employee_index - len(_ORIGINAL_EMPLOYEES)
    return _NEW_EMPLOYEE_MANAGER_BASE + new_index % 8


def reporting_lines() -> list[tuple[int, int, bool]]:
    """Return (employee index, manager index, is_primary) for every reporting line."""
    lines = []
    for index in range(len(EMPLOYEES)):
        primary = primary_manager(index)
        lines.append((index, primary, True))
        if index < len(_ORIGINAL_EMPLOYEES):
            if index in SECOND_MANAGER:
                lines.append((index, SECOND_MANAGER[index], False))
        elif (index - len(_ORIGINAL_EMPLOYEES)) % 3 == 0:
            second = (index * 5 + 1) % len(MANAGERS)
            if second == primary:
                second = (second + 1) % len(MANAGERS)
            lines.append((index, second, False))
    return lines


def team_of(manager_index: int) -> list[int]:
    """Return the employee indexes who report to a manager, in index order."""
    return [e for e, m, _ in reporting_lines() if m == manager_index]


# Employees who deliberately receive no project work (available for scheduling demos).
BENCH = {i for i in range(len(_ORIGINAL_EMPLOYEES), len(EMPLOYEES)) if i % 11 == 10}

# ------------------------------------------------------------------------- projects

# Original demo projects. Do not reorder or edit: databases seeded earlier contain them.
_ORIGINAL_PROJECTS = [
    {
        "name": "Demo: Customer Portal Redesign",
        "manager": 0,
        "status": "active",
        "archived": False,
        "start": -60,
        "end": 120,
        "budget": "80000.00",
        "milestones": [
            ("Discovery and UX research", -60, -31, True),
            ("Core build", -30, 30, False),
            ("Beta hardening", 31, 90, False),
        ],
        "assignments": [
            (0, 0, -60, -31, None),
            (0, 1, -30, 30, None),
            (4, 1, -20, 30, None),
            (8, 2, 31, 90, None),
            (0, 2, 31, 60, None),
        ],
    },
    {
        "name": "Demo: Data Platform Migration",
        "manager": 1,
        "status": "active",
        "archived": False,
        "start": -45,
        "end": 60,
        "budget": "120000.00",
        "milestones": [
            ("Source inventory", -45, -1, True),
            ("Pipeline cutover", 0, 60, False),
        ],
        "assignments": [
            (1, 0, -45, -1, None),
            (5, 1, 0, 40, None),
            (9, 1, 5, 60, None),
        ],
    },
    {
        "name": "Demo: Legacy CRM Sunset",
        "manager": 2,
        "status": "completed",
        "archived": False,
        "start": -200,
        "end": -30,
        "budget": "90000.00",
        "milestones": [
            ("Data export", -200, -120, True),
            ("Decommission", -119, -30, True),
        ],
        "assignments": [(2, 0, -190, -125, None), (6, 1, -115, -40, None)],
    },
    {
        "name": "Demo: Mobile App Prototype",
        "manager": 3,
        "status": "abandoned",
        "archived": False,
        "start": -80,
        "end": 40,
        "budget": "60000.00",
        "milestones": [("Prototype build", -80, 40, False)],
        "assignments": [(3, 0, -50, 30, -25)],
    },
    {
        "name": "Demo: Intranet Refresh",
        "manager": 0,
        "status": "completed",
        "archived": True,
        "start": -320,
        "end": -240,
        "budget": "15000.00",
        "milestones": [("Content migration", -320, -240, True)],
        "assignments": [(12, 0, -300, -250, None)],
    },
]

_PHASES = {
    "software": ["Requirements and discovery", "Architecture and design", "Core build",
                 "Integration and testing", "Pilot rollout", "Launch and handover"],
    "data": ["Source assessment", "Data model design", "Pipeline build",
             "Validation and reconciliation", "Dashboard delivery", "Cutover and monitoring"],
    "infra": ["Current-state assessment", "Target architecture", "Environment build",
              "Migration waves", "Hardening and failover testing", "Decommission and handover"],
    "design": ["Research and interviews", "Concept and wireframes", "Visual design system",
               "Prototype and usability testing", "Developer handoff", "Rollout support"],
    "compliance": ["Control gap analysis", "Policy and process updates",
                   "Control implementation", "Evidence collection",
                   "Internal audit readiness", "Sign-off and remediation"],
}

# (name, description, phase set, manager, kind, start offset, milestone lengths in days,
#  budget factor, late). ``kind``: done | archived | active | planned | abandoned.
# ``budget factor`` scales estimated labour cost into the estimated budget; a value
# below 1 gives an over-budget project, and about 1.0 to 1.05 gives one at risk (95% or
# more of budget). ``late`` leaves the milestone before
# the current one open, so it shows as overdue. Abandoned projects give the day the
# project was abandoned as ``late``.
_PROJECT_PLAN = [
    # Completed
    ("Payments Gateway Upgrade", "Replace the legacy card gateway with a PCI-compliant provider.", "software", 4, "done", -380, (40, 45, 60, 40, 25), 1.25, None),
    ("Employee Onboarding Portal", "Self-service portal that streamlines new-hire paperwork and equipment requests.", "software", 5, "done", -330, (30, 40, 50, 30), 1.30, None),
    ("Warehouse Data Lakehouse", "Consolidate operational data into a governed analytics lakehouse.", "data", 5, "done", -300, (35, 45, 60, 40, 30), 1.20, None),
    ("Cloud Cost Optimization", "Right-size compute and storage across all production accounts.", "infra", 4, "done", -260, (30, 40, 50, 35), 1.35, None),
    ("SOC 2 Type II Readiness", "Prepare controls and evidence for the annual SOC 2 audit.", "compliance", 7, "done", -350, (40, 50, 60, 45, 30), 1.15, None),
    ("Customer Feedback Analytics", "Sentiment dashboards built from support and survey data.", "data", 5, "done", -240, (30, 35, 45, 30), 1.40, None),
    ("Design System 2.0", "Unified component library and brand guidelines for all web products.", "design", 3, "done", -220, (35, 40, 45, 35, 25), 1.30, None),
    ("Mobile Banking Refresh", "Modernised navigation and accessibility for the customer mobile app.", "software", 10, "done", -290, (35, 45, 55, 40, 30), 0.97, None),
    ("Network Segmentation Program", "Isolate production workloads behind segmented network zones.", "infra", 2, "done", -270, (40, 50, 50, 40), 1.25, None),
    ("Vendor Risk Assessment Tool", "Questionnaire workflow and scoring for third-party vendors.", "compliance", 7, "done", -210, (30, 40, 40, 30), 1.45, None),
    ("ERP Invoice Automation", "Automated invoice capture and three-way matching.", "software", 11, "done", -250, (35, 40, 50, 35, 25), 1.20, None),
    ("Support Knowledge Base", "Searchable knowledge base to reduce repeat support tickets.", "software", 9, "done", -180, (25, 35, 40, 30), 1.50, None),
    ("API Gateway Consolidation", "Retire three legacy gateways behind one managed platform.", "infra", 1, "done", -230, (35, 40, 45, 40), 1.18, None),
    # Completed and archived
    ("Legacy HR System Retirement", "Decommission the pre-2015 HR platform after data migration.", "infra", 0, "archived", -370, (40, 50, 45, 35), 1.30, None),
    ("Brand Refresh Microsite", "Campaign microsite for the annual brand relaunch.", "design", 3, "archived", -340, (30, 35, 40, 30), 1.35, None),
    # Active
    ("Customer 360 Platform", "Single customer view across sales, support and billing systems.", "data", 5, "active", -90, (45, 45, 45, 45), 1.30, False),
    ("Zero Trust Access Rollout", "Move workforce applications behind identity-aware access.", "compliance", 7, "active", -150, (40, 50, 40, 40, 40), 0.97, True),
    ("Mobile Wallet Integration", "Add tap-to-pay wallets to the customer mobile app.", "software", 10, "active", -60, (30, 30, 30, 30, 30), 1.28, False),
    ("Self-Service Analytics Portal", "Governed self-service reporting for business teams.", "data", 5, "active", -30, (25, 35, 45, 45), 1.35, False),
    ("Kubernetes Platform Migration", "Move core services from virtual machines to managed Kubernetes.", "infra", 4, "active", -200, (50, 50, 50, 50, 40), 1.05, False),
    ("Partner API Program", "Public partner API with sandbox and developer documentation.", "software", 8, "active", -120, (30, 40, 40, 30, 30), 1.04, False),
    ("Fraud Detection Dashboard", "Near-real-time dashboard for the fraud operations team.", "data", 5, "active", -75, (35, 35, 35, 35), 0.72, False),
    ("Accessibility Remediation", "Bring internal tools to WCAG 2.2 AA.", "design", 3, "active", -15, (30, 40, 50, 40), 1.40, False),
    ("Customer Onboarding Revamp", "Shorter digital onboarding journey for new business customers.", "software", 9, "active", -45, (30, 30, 40, 40, 30), 1.30, False),
    ("Disaster Recovery Automation", "Automated failover runbooks and quarterly recovery tests.", "infra", 2, "active", -180, (45, 45, 45, 45, 45), 0.80, True),
    ("Finance Data Warehouse", "Governed finance marts for month-end reporting.", "data", 11, "active", -100, (40, 40, 40, 40), 1.25, False),
    ("Internal Developer Portal", "Service catalogue, templates and documentation hub for engineers.", "software", 4, "active", -10, (60, 60, 60, 40), 1.45, False),
    # Planned (start in the future)
    ("Loyalty Rewards Engine", "Points and rewards engine for the retail partner programme.", "software", 8, "planned", 14, (40, 45, 50, 40), 1.35, None),
    ("Data Residency Compliance", "Regional data residency controls for new market launches.", "compliance", 7, "planned", 30, (35, 40, 45, 35), 1.30, None),
    ("Edge Caching Rollout", "CDN caching tier to cut page load times for international users.", "infra", 4, "planned", 45, (30, 35, 40), 1.40, None),
    ("Voice Assistant Pilot", "Pilot a voice interface for balance and payment queries.", "software", 10, "planned", 7, (35, 40, 45, 35), 1.30, None),
    ("Partner Portal Redesign", "Refresh the partner-facing portal with the new design system.", "design", 3, "planned", 60, (30, 35, 40, 30), 1.35, None),
    # Abandoned (the "late" value is the offset of the day the project was abandoned)
    ("Blockchain Settlement Pilot", "Exploratory settlement pilot, stopped after the vendor withdrew.", "software", 11, "abandoned", -140, (35, 40, 45, 40), 1.25, -70),
    ("Legacy Mainframe Offload", "Offload batch workloads from the mainframe; stopped after a budget freeze.", "infra", 1, "abandoned", -200, (40, 40, 50, 40, 30), 1.20, -110),
    ("Chatbot Support Assistant", "Automated first-line support assistant, stopped after poor pilot results.", "software", 9, "abandoned", -90, (30, 30, 40, 40), 1.30, -40),
]


def _staffing_counts(project_no: int, milestone_no: int) -> int:
    """Return how many people a milestone is staffed with (deterministic 2 to 4)."""
    return (2, 3, 3, 4, 3, 2, 4)[(project_no * 3 + milestone_no) % 7]


def _overlaps(windows: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start <= w_end and w_start <= end for w_start, w_end in windows)


def _terms_plan(index: int) -> list[tuple[int, Decimal, Decimal]]:
    """Return deterministic (effective offset in days, hourly rate, weekly hours) for an employee.

    The first term predates every seeded assignment; some employees have a past raise
    and some a scheduled future raise so historical rates are exercised.
    """
    rate = Decimal(45 + (index * 7) % 35)
    hours = Decimal("32") if index % 5 == 3 else Decimal("40")
    plan = [(-400, rate, hours)]
    if index % 3 == 0:
        plan.append((-100, rate + Decimal("4"), hours))
    if index % 4 == 1:
        plan.append((30, rate + Decimal("6"), hours))
    return plan


def _approx_daily_cost(employee_index: int) -> Decimal:
    """Approximate calendar-day labour cost, used only to size project budgets."""
    _, rate, hours = _terms_plan(employee_index)[0]
    return rate * hours / Decimal(7)


def build_projects() -> list[dict]:
    """Return every demo project spec: the original five followed by the generated ones."""
    projects = list(_ORIGINAL_PROJECTS)
    busy: dict[int, list[tuple[int, int]]] = {}
    for project in _ORIGINAL_PROJECTS:
        for employee, _milestone, start, end, _ended in project["assignments"]:
            busy.setdefault(employee, []).append((start, end))

    for number, plan in enumerate(_PROJECT_PLAN):
        name, description, phases, manager, kind, start, lengths, factor, late = plan
        team = [e for e in team_of(manager) if e not in BENCH]
        milestones, assignments = [], []
        cursor = start
        today_index = None
        for position, length in enumerate(lengths):
            m_start, m_end = cursor, cursor + length - 1
            cursor = m_end + 1
            if today_index is None and m_start <= 0 <= m_end:
                today_index = position
            milestones.append([_PHASES[phases][position], m_start, m_end, False])

        abandoned_on = late if kind == "abandoned" else None
        for position, milestone in enumerate(milestones):
            m_end = milestone[2]
            if kind in ("done", "archived"):
                milestone[3] = True
            elif kind == "active":
                milestone[3] = m_end < 0 and not (late and position == (today_index or 0) - 1)
            elif kind == "abandoned":
                milestone[3] = m_end < abandoned_on

        last_staffed = len(milestones) - 1
        if kind == "planned":
            last_staffed = 1
        elif kind == "active":
            last_staffed = min(len(milestones) - 1, (today_index or 0) + 1)
        elif kind == "abandoned":
            last_staffed = max(
                i for i, m in enumerate(milestones) if m[1] <= abandoned_on
            )

        for position, (_, m_start, m_end, _completed) in enumerate(milestones):
            if position > last_staffed or not team:
                continue
            wanted = _staffing_counts(number, position)
            order_shift = (number + position) % max(1, len(team) - 2)
            chosen = 0
            for offset in range(len(team)):
                if chosen == wanted:
                    break
                employee = team[(order_shift + offset) % len(team)]
                a_start = m_start + (1 if (number + position + employee) % 4 == 0 else 0)
                a_end = m_end - (1 if (number + employee) % 5 == 0 else 0)
                if a_end < a_start or _overlaps(busy.get(employee, []), a_start, a_end):
                    continue
                ended = None
                if abandoned_on is not None and m_start <= abandoned_on <= m_end:
                    ended = abandoned_on
                busy.setdefault(employee, []).append((a_start, a_end))
                assignments.append((employee, position, a_start, a_end, ended))
                chosen += 1

        staffed_cost = sum(
            _approx_daily_cost(employee)
            * Decimal(max(0, ((ended - 1) if ended is not None else a_end) - a_start + 1))
            for employee, _p, a_start, a_end, ended in assignments
        )
        gap_cost = sum(
            Decimal(m[2] - m[1] + 1) * Decimal(680)
            for i, m in enumerate(milestones)
            if i > last_staffed or not any(a[1] == i for a in assignments)
        )
        budget = ((staffed_cost + gap_cost) * Decimal(str(factor)) / 1000).to_integral_value() * 1000
        budget = max(budget, Decimal(20000))

        status = {"done": "completed", "archived": "completed", "abandoned": "abandoned"}.get(
            kind, "active"
        )
        projects.append(
            {
                "name": name,
                "description": description,
                "manager": manager,
                "status": status,
                "archived": kind == "archived",
                "start": start,
                "end": milestones[-1][2] + (5 if kind in ("active", "planned") else 0),
                "budget": f"{budget:.2f}",
                "milestones": [
                    (m[0], m[1], m[2], m[3], f"{m[0]} for {name}.") for m in milestones
                ],
                "assignments": assignments,
            }
        )
    return projects


# ------------------------------------------------------------------------- showcase

# A small hand-built project for presenting how labor cost follows pay, staffing and
# account changes. It has its own employees, so the generated data above is unaffected.
# Each milestone is one scenario staffed by one person, so the Budget tab's
# "Cost by milestone" table shows each person's cost on its own.
#
# Day offsets are relative to the *Monday* of the seed week (not the seed date), so
# every scenario covers whole Monday-Friday weeks. Everyone earns $50/hr x 40 h =
# $400 per weekday = $2,000 per week, unless raised.
SHOWCASE_MANAGER = 0  # Morgan Hayes
SHOWCASE_EMPLOYEES = [
    ("Jordan", "Raines", "Software Engineer"),
    ("Casey", "Holt", "QA Engineer"),
    ("Riley", "Shaw", "Data Analyst"),
    ("Drew", "Kendall", "Frontend Developer"),
]
# (effective offset, hourly rate, weekly hours) per showcase employee index.
_SHOWCASE_BASE = (-400, Decimal("50.00"), Decimal(40))
SHOWCASE_TERMS = {
    0: [_SHOWCASE_BASE, (-7, Decimal("75.00"), Decimal(40))],  # raise from week 2's Monday
    1: [_SHOWCASE_BASE],
    2: [_SHOWCASE_BASE],
    3: [_SHOWCASE_BASE],
}
# Showcase employees whose accounts are deactivated, with the offset of that day.
SHOWCASE_DEACTIVATED = {2: -2}

SHOWCASE_PROJECT = {
    "name": "Showcase: Labor Cost Accuracy",
    "description": (
        "Each milestone is one scenario with one person. Everyone earns $50/hr x 40 h "
        "= $2,000 per week. "
        "(1) Jordan worked 2 weeks and got a raise to $75/hr after week 1: "
        "$2,000 + $3,000 = $5,000 (not $4,000 or $6,000). "
        "(2) Casey was scheduled for 2 weeks but removed after week 1: $2,000 (not $4,000). "
        "(3) Riley worked 2 weeks, then the account was deactivated: still $4,000. "
        "(4) Drew is still working: change pay or staffing live and watch accrued cost "
        "stay put while projected cost moves."
    ),
    "manager": SHOWCASE_MANAGER,
    "status": "active",
    "archived": False,
    "start": -14,
    "end": 18,
    "budget": "30000.00",
    "milestones": [
        ("1. Pay raise halfway through", -14, -3, True,
         "Jordan Raines: week 1 at $50/hr, week 2 at $75/hr. Expected $5,000."),
        ("2. Removed after one week", -14, -3, True,
         "Casey Holt: scheduled for 2 weeks, removed after week 1. Expected $2,000."),
        ("3. Deactivated after finishing", -14, -3, True,
         "Riley Shaw: worked 2 weeks, then the account was deactivated. Expected $4,000."),
        ("4. Live demo (in progress)", -7, 18, False,
         "Drew Kendall: 4 weeks at $50/hr. Change pay or staffing during the demo."),
    ],
    # (showcase employee index, milestone index, start, planned end, ended offset or None)
    "assignments": [
        (0, 0, -14, -3, None),
        (1, 1, -14, -3, -7),  # removed at the start of week 2's Monday
        (2, 2, -14, -3, None),
        (3, 3, -7, 18, None),
    ],
}
