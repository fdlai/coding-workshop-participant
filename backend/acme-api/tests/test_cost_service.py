"""Pure unit tests for the labor-cost engine (no database).

Reference calendar: 2030-06-12 is a Wednesday; 06-15/16 is a weekend.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from services.cost_service import (
    count_weekdays,
    daily_cost,
    money,
    window_cost,
    _range_cost,
)

TODAY = date(2030, 6, 12)
RATE = Decimal("320")  # 40/h * 40h / 5


def brute_weekdays(start, end):
    days, d = 0, start
    while d <= end:
        days += d.weekday() < 5
        d += timedelta(days=1)
    return days


@pytest.mark.parametrize("offset", range(0, 7))
@pytest.mark.parametrize("length", [0, 1, 2, 5, 6, 7, 8, 13, 14, 15, 100])
def test_count_weekdays_matches_brute_force(offset, length):
    start = date(2030, 6, 3) + timedelta(days=offset)
    end = start + timedelta(days=length)
    assert count_weekdays(start, end) == brute_weekdays(start, end)


def test_count_weekdays_empty_and_weekend_only():
    assert count_weekdays(date(2030, 6, 10), date(2030, 6, 9)) == 0
    assert count_weekdays(date(2030, 6, 15), date(2030, 6, 16)) == 0


def test_daily_cost_decimal_formula():
    assert daily_cost(Decimal("40.00"), Decimal("40")) == Decimal("320")
    assert daily_cost(Decimal("33.33"), Decimal("37.50")) == Decimal("249.975")
    assert money(Decimal("249.975")) == Decimal("249.98")  # half-up
    assert daily_cost(Decimal("50"), Decimal("0")) == 0


def test_accrued_excludes_today_and_projected_includes_it():
    history = [(date(2030, 1, 1), RATE)]
    # Mon 06-10 .. Fri 06-14: accrued Mon,Tue; projected Wed,Thu,Fri.
    r = window_cost((date(2030, 6, 10), date(2030, 6, 14)), history, TODAY)
    assert (r.accrued_days, r.projected_days) == (2, 3)
    assert r.accrued == 640 and r.projected == 960
    assert r.accrued_days + r.projected_days == count_weekdays(date(2030, 6, 10), date(2030, 6, 14))


def test_window_entirely_past_or_future():
    history = [(date(2030, 1, 1), RATE)]
    past = window_cost((date(2030, 6, 3), date(2030, 6, 7)), history, TODAY)
    assert (past.accrued, past.projected) == (1600, 0)
    future = window_cost((date(2030, 6, 17), date(2030, 6, 21)), history, TODAY)
    assert (future.accrued, future.projected) == (0, 1600)


def test_single_day_today_is_projected_only():
    r = window_cost((TODAY, TODAY), [(date(2030, 1, 1), RATE)], TODAY)
    assert (r.accrued, r.projected) == (0, 320)


def test_cancelled_window_costs_zero():
    r = window_cost(None, [(date(2030, 1, 1), RATE)], TODAY)
    assert r.accrued == r.projected == 0 and r.unpriced_days == 0


def test_weekend_only_window_costs_zero():
    r = window_cost((date(2030, 6, 15), date(2030, 6, 16)), [(date(2030, 1, 1), RATE)], TODAY)
    assert r.projected == 0 and r.projected_days == 0


def test_mid_assignment_raise_splits_at_effective_date():
    history = [(date(2030, 1, 1), RATE), (date(2030, 6, 12), Decimal("400"))]
    # Mon 06-10, Tue 06-11 at 320; Wed 06-12 onward at 400.
    r = window_cost((date(2030, 6, 10), date(2030, 6, 14)), history, TODAY)
    assert r.accrued == 640
    assert r.projected == 1200


def test_effective_date_boundaries_are_inclusive_on_start():
    history = [(date(2030, 6, 11), RATE)]
    cost, priced, unpriced = _range_cost(date(2030, 6, 10), date(2030, 6, 11), history)
    assert (cost, priced, unpriced) == (320, 1, 1)  # 06-10 unpriced, 06-11 priced


def test_terms_effective_after_window_end_leave_all_days_unpriced():
    history = [(date(2030, 7, 1), RATE)]
    cost, priced, unpriced = _range_cost(date(2030, 6, 10), date(2030, 6, 14), history)
    assert (cost, priced, unpriced) == (0, 0, 5)


def test_missing_terms_cost_zero_and_are_reported():
    r = window_cost((date(2030, 6, 10), date(2030, 6, 14)), [], TODAY)
    assert r.accrued == r.projected == 0
    assert r.unpriced_days == 5


def test_zero_hour_terms_cost_zero_but_are_priced():
    r = window_cost((date(2030, 6, 10), date(2030, 6, 14)), [(date(2030, 1, 1), Decimal("0"))], TODAY)
    assert r.accrued == r.projected == 0
    assert r.unpriced_days == 0 and r.accrued_days + r.projected_days == 5


def test_zero_rate_then_raise():
    history = [(date(2030, 1, 1), Decimal("0")), (date(2030, 6, 13), RATE)]
    r = window_cost((date(2030, 6, 12), date(2030, 6, 14)), history, TODAY)
    assert r.projected == 640


def test_multiple_terms_in_one_range_sum_exactly():
    history = [
        (date(2030, 1, 1), Decimal("100")),
        (date(2030, 6, 5), Decimal("200")),
        (date(2030, 6, 7), Decimal("300")),
    ]
    # 06-03 Mon .. 06-07 Fri: Mon,Tue,Wed @100 (06-03,04 before 06-05 -> 2 days @100, 06-05,06 @200, 06-07 @300)
    cost, priced, unpriced = _range_cost(date(2030, 6, 3), date(2030, 6, 7), history)
    assert cost == 2 * 100 + 2 * 200 + 300
    assert (priced, unpriced) == (5, 0)
