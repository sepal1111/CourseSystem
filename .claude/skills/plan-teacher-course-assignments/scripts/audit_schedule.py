#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


SEVERITY_ORDER = {"ERROR": 0, "WARN": 1, "INFO": 2}


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    location: str = ""


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def fmt_number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def add_issue(issues: list[Issue], severity: str, code: str, message: str, location: str = "") -> None:
    issues.append(Issue(severity, code, message, location))


def audit(data: dict[str, Any]) -> tuple[list[Issue], dict[str, Any]]:
    issues: list[Issue] = []
    meta = data.get("meta", {})
    stage = meta.get("stage", "planning") if isinstance(meta, dict) else "planning"
    if stage not in {"planning", "final"}:
        add_issue(issues, "ERROR", "INVALID_STAGE", "meta.stage 必須是 planning 或 final", "meta.stage")

    raw_teachers = data.get("teachers", [])
    raw_classes = data.get("classes", [])
    inactive = data.get("inactive_teachers", [])
    if not isinstance(raw_teachers, list):
        add_issue(issues, "ERROR", "INVALID_TEACHERS", "teachers 必須是陣列", "teachers")
        raw_teachers = []
    if not isinstance(raw_classes, list):
        add_issue(issues, "ERROR", "INVALID_CLASSES", "classes 必須是陣列", "classes")
        raw_classes = []
    if not isinstance(inactive, list) or any(not isinstance(x, str) for x in inactive):
        add_issue(issues, "ERROR", "INVALID_INACTIVE", "inactive_teachers 必須是姓名字串陣列", "inactive_teachers")
        inactive = []
    inactive_set = set(inactive)

    teachers: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(raw_teachers):
        loc = f"teachers[{index}]"
        if not isinstance(raw, dict):
            add_issue(issues, "ERROR", "INVALID_TEACHER", "教師資料必須是物件", loc)
            continue
        name = raw.get("name")
        if not isinstance(name, str) or not name.strip():
            add_issue(issues, "ERROR", "MISSING_TEACHER_NAME", "教師缺少有效姓名", loc)
            continue
        name = name.strip()
        if name in teachers:
            add_issue(issues, "ERROR", "DUPLICATE_TEACHER", f"教師 {name} 重複宣告", loc)
            continue
        teachers[name] = raw
        if name in inactive_set:
            add_issue(issues, "ERROR", "ACTIVE_AND_INACTIVE", f"教師 {name} 同時出現在 teachers 與 inactive_teachers", loc)

    class_ids: set[str] = set()
    teacher_loads: defaultdict[str, float] = defaultdict(float)
    teacher_grades: defaultdict[str, set[int]] = defaultdict(set)
    class_summaries: list[dict[str, Any]] = []

    for class_index, raw_class in enumerate(raw_classes):
        loc = f"classes[{class_index}]"
        if not isinstance(raw_class, dict):
            add_issue(issues, "ERROR", "INVALID_CLASS", "班級資料必須是物件", loc)
            continue
        class_id = raw_class.get("id")
        if not isinstance(class_id, str) or not class_id.strip():
            add_issue(issues, "ERROR", "MISSING_CLASS_ID", "班級缺少有效 id", loc)
            continue
        class_id = class_id.strip()
        class_loc = f"class:{class_id}"
        if class_id in class_ids:
            add_issue(issues, "ERROR", "DUPLICATE_CLASS", f"班級 {class_id} 重複宣告", class_loc)
            continue
        class_ids.add(class_id)

        grade = raw_class.get("grade")
        if not isinstance(grade, int) or isinstance(grade, bool) or grade <= 0:
            add_issue(issues, "ERROR", "INVALID_GRADE", f"班級 {class_id} 的 grade 必須是正整數", class_loc)
            grade = None
        weekly_total = raw_class.get("weekly_total")
        if not is_number(weekly_total) or weekly_total <= 0:
            add_issue(issues, "ERROR", "INVALID_WEEKLY_TOTAL", f"班級 {class_id} 缺少有效 weekly_total", class_loc)
            weekly_total = 0.0
        weekly_total = float(weekly_total)

        required = raw_class.get("required_slots", {})
        if required is None:
            required = {}
        if not isinstance(required, dict):
            add_issue(issues, "ERROR", "INVALID_REQUIRED_SLOTS", f"班級 {class_id} 的 required_slots 必須是物件", class_loc)
            required = {}
        normalized_required: dict[str, float] = {}
        for slot, periods in required.items():
            if not isinstance(slot, str) or not slot or not is_number(periods) or periods < 0:
                add_issue(issues, "ERROR", "INVALID_REQUIRED_SLOT", f"班級 {class_id} 有無效課程槽位", class_loc)
                continue
            normalized_required[slot] = float(periods)

        assignments = raw_class.get("assignments", [])
        if not isinstance(assignments, list):
            add_issue(issues, "ERROR", "INVALID_ASSIGNMENTS", f"班級 {class_id} 的 assignments 必須是陣列", class_loc)
            assignments = []
        class_total = 0.0
        slot_totals: defaultdict[str, float] = defaultdict(float)
        signatures: Counter[tuple[str, tuple[str, ...], float]] = Counter()

        for assignment_index, assignment in enumerate(assignments):
            assignment_loc = f"{class_loc}.assignments[{assignment_index}]"
            if not isinstance(assignment, dict):
                add_issue(issues, "ERROR", "INVALID_ASSIGNMENT", "配課資料必須是物件", assignment_loc)
                continue
            slot = assignment.get("slot")
            if not isinstance(slot, str) or not slot.strip():
                add_issue(issues, "ERROR", "MISSING_SLOT", "配課缺少有效 slot", assignment_loc)
                continue
            slot = slot.strip()
            periods = assignment.get("periods")
            if not is_number(periods) or periods <= 0:
                add_issue(issues, "ERROR", "INVALID_PERIODS", "配課 periods 必須是正數", assignment_loc)
                continue
            periods = float(periods)
            counts_for_class = assignment.get("counts_for_class", True)
            counts_for_teacher = assignment.get("counts_for_teacher", True)
            if not isinstance(counts_for_class, bool) or not isinstance(counts_for_teacher, bool):
                add_issue(issues, "ERROR", "INVALID_COUNT_FLAGS", "計數旗標必須是布林值", assignment_loc)
                continue
            status = assignment.get("status", "confirmed")
            if status not in {"confirmed", "proposed", "open", "conflict"}:
                add_issue(issues, "ERROR", "INVALID_STATUS", f"無效配課狀態 {status!r}", assignment_loc)
            elif stage == "final" and status != "confirmed":
                add_issue(issues, "ERROR", "UNCONFIRMED_FINAL", f"最終版仍含 {status} 配課", assignment_loc)

            teacher_periods = assignment.get("teacher_periods")
            if teacher_periods is not None:
                if not isinstance(teacher_periods, dict) or not teacher_periods:
                    add_issue(issues, "ERROR", "INVALID_TEACHER_PERIODS", "teacher_periods 必須是非空物件", assignment_loc)
                    teacher_periods = {}
                normalized_teacher_periods: dict[str, float] = {}
                for teacher_name, load in teacher_periods.items():
                    if not isinstance(teacher_name, str) or not teacher_name.strip() or not is_number(load) or load < 0:
                        add_issue(issues, "ERROR", "INVALID_TEACHER_LOAD", "teacher_periods 含無效姓名或節數", assignment_loc)
                        continue
                    normalized_teacher_periods[teacher_name.strip()] = float(load)
            else:
                teacher_names = assignment.get("teachers", [])
                if not isinstance(teacher_names, list) or any(not isinstance(x, str) or not x.strip() for x in teacher_names):
                    add_issue(issues, "ERROR", "INVALID_ASSIGNMENT_TEACHERS", "teachers 必須是非空姓名字串陣列", assignment_loc)
                    teacher_names = []
                normalized_teacher_periods = {name.strip(): periods for name in teacher_names}

            if counts_for_teacher and not normalized_teacher_periods:
                add_issue(issues, "ERROR", "MISSING_ASSIGNMENT_TEACHER", "計入教師負擔的配課沒有教師", assignment_loc)
            if len(normalized_teacher_periods) > 1 and not assignment.get("co_teaching", False):
                add_issue(issues, "WARN", "MULTI_TEACHER_NOT_MARKED", "多人授課但未標示 co_teaching", assignment_loc)

            signature = (slot, tuple(sorted(normalized_teacher_periods)), periods)
            signatures[signature] += 1
            if signatures[signature] > 1:
                add_issue(issues, "WARN", "POSSIBLE_DUPLICATE_ASSIGNMENT", f"班級 {class_id} 可能重複配入 {slot}", assignment_loc)

            if counts_for_class:
                class_total += periods
                slot_totals[slot] += periods
            if counts_for_teacher:
                for teacher_name, load in normalized_teacher_periods.items():
                    if teacher_name in inactive_set:
                        add_issue(issues, "ERROR", "INACTIVE_ASSIGNED", f"已不在職教師 {teacher_name} 仍被配課", assignment_loc)
                    if teacher_name not in teachers:
                        add_issue(issues, "ERROR", "UNKNOWN_TEACHER", f"未在 teachers 宣告的教師或待聘名稱：{teacher_name}", assignment_loc)
                    else:
                        teacher_loads[teacher_name] += load
                        if grade is not None and load > 0:
                            teacher_grades[teacher_name].add(grade)

        if not math.isclose(class_total, weekly_total, abs_tol=1e-9):
            add_issue(
                issues,
                "ERROR",
                "CLASS_TOTAL_MISMATCH",
                f"班級 {class_id} 實配 {fmt_number(class_total)} 節，不等於 weekly_total {fmt_number(weekly_total)} 節",
                class_loc,
            )
        for slot in sorted(set(normalized_required) | set(slot_totals)):
            actual = slot_totals.get(slot, 0.0)
            expected = normalized_required.get(slot)
            if expected is None:
                add_issue(issues, "WARN", "UNDECLARED_SLOT", f"班級 {class_id} 配入未宣告槽位 {slot}：{fmt_number(actual)} 節", class_loc)
            elif not math.isclose(actual, expected, abs_tol=1e-9):
                add_issue(
                    issues,
                    "ERROR",
                    "SLOT_TOTAL_MISMATCH",
                    f"班級 {class_id} 的 {slot} 實配 {fmt_number(actual)} 節，應為 {fmt_number(expected)} 節",
                    class_loc,
                )
        class_summaries.append({"id": class_id, "weekly_total": weekly_total, "assigned": class_total})

    teacher_summaries: list[dict[str, Any]] = []
    for name, teacher in teachers.items():
        loc = f"teacher:{name}"
        base = teacher.get("base_periods", 0)
        if not is_number(base) or base < 0:
            add_issue(issues, "ERROR", "INVALID_BASE_PERIODS", f"教師 {name} 的 base_periods 無效", loc)
            base = 0.0
        base = float(base)
        reductions = teacher.get("reductions", [])
        if reductions is None:
            reductions = []
        if not isinstance(reductions, list):
            add_issue(issues, "ERROR", "INVALID_REDUCTIONS", f"教師 {name} 的 reductions 必須是陣列", loc)
            reductions = []
        reduction_total = 0.0
        for index, reduction in enumerate(reductions):
            if not isinstance(reduction, dict) or not is_number(reduction.get("periods")) or reduction["periods"] < 0:
                add_issue(issues, "ERROR", "INVALID_REDUCTION", f"教師 {name} 有無效減課資料", f"{loc}.reductions[{index}]")
                continue
            reduction_total += float(reduction["periods"])
        target = teacher.get("target_periods", base - reduction_total)
        if not is_number(target) or target < 0:
            add_issue(issues, "ERROR", "INVALID_TARGET", f"教師 {name} 的有效目標節數無效", loc)
            target = max(0.0, base - reduction_total)
        target = float(target)
        other = teacher.get("other_periods", 0)
        if not is_number(other) or other < 0:
            add_issue(issues, "ERROR", "INVALID_OTHER_PERIODS", f"教師 {name} 的 other_periods 無效", loc)
            other = 0.0
        assigned = teacher_loads.get(name, 0.0) + float(other)
        participates = teacher.get("participates", True)
        if not isinstance(participates, bool):
            add_issue(issues, "ERROR", "INVALID_PARTICIPATES", f"教師 {name} 的 participates 必須是布林值", loc)
            participates = True
        if not participates and assigned > 0:
            add_issue(issues, "ERROR", "NONPARTICIPANT_ASSIGNED", f"不參與配課的 {name} 仍有 {fmt_number(assigned)} 節", loc)

        allowed_grades = teacher.get("allowed_grades")
        actual_grades = teacher_grades.get(name, set())
        if allowed_grades is not None:
            if not isinstance(allowed_grades, list) or any(not isinstance(x, int) or isinstance(x, bool) for x in allowed_grades):
                add_issue(issues, "ERROR", "INVALID_ALLOWED_GRADES", f"教師 {name} 的 allowed_grades 無效", loc)
            else:
                forbidden = sorted(actual_grades - set(allowed_grades))
                if forbidden:
                    add_issue(issues, "ERROR", "GRADE_NOT_ALLOWED", f"教師 {name} 被配至未允許年級：{forbidden}", loc)
        max_grades = teacher.get("max_distinct_grades")
        if max_grades is not None:
            if not isinstance(max_grades, int) or isinstance(max_grades, bool) or max_grades <= 0:
                add_issue(issues, "ERROR", "INVALID_MAX_GRADES", f"教師 {name} 的 max_distinct_grades 無效", loc)
            elif len(actual_grades) > max_grades:
                add_issue(issues, "ERROR", "TOO_MANY_GRADES", f"教師 {name} 跨 {len(actual_grades)} 個年級 {sorted(actual_grades)}，上限為 {max_grades}", loc)

        if participates:
            if assigned < target - 1e-9:
                add_issue(issues, "WARN", "UNDERLOAD", f"教師 {name} 實配 {fmt_number(assigned)}，低於有效目標 {fmt_number(target)}", loc)
            elif assigned > target + 1e-9:
                if teacher.get("allow_overload", False):
                    add_issue(issues, "INFO", "OVERLOAD_ALLOWED", f"教師 {name} 實配 {fmt_number(assigned)}，高於有效目標 {fmt_number(target)}", loc)
                else:
                    add_issue(issues, "ERROR", "OVERLOAD_NOT_ALLOWED", f"教師 {name} 實配 {fmt_number(assigned)}，高於有效目標 {fmt_number(target)}，但未允許超鐘點", loc)
        teacher_summaries.append(
            {
                "name": name,
                "base_periods": base,
                "reduction_periods": reduction_total,
                "target_periods": target,
                "assigned_periods": assigned,
                "grades": sorted(actual_grades),
            }
        )

    issues.sort(key=lambda x: (SEVERITY_ORDER[x.severity], x.location, x.code, x.message))
    summary = {
        "school": meta.get("school") if isinstance(meta, dict) else None,
        "school_year": meta.get("school_year") if isinstance(meta, dict) else None,
        "stage": stage,
        "counts": dict(Counter(issue.severity for issue in issues)),
        "classes": class_summaries,
        "teachers": teacher_summaries,
    }
    return issues, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a teacher course-assignment ledger")
    parser.add_argument("ledger", type=Path)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--strict-warnings", action="store_true")
    args = parser.parse_args()

    try:
        data = json.loads(args.ledger.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR INPUT: {exc}", file=sys.stderr)
        return 1
    if not isinstance(data, dict):
        print("ERROR INPUT: ledger root must be an object", file=sys.stderr)
        return 1

    issues, summary = audit(data)
    for issue in issues:
        location = f" [{issue.location}]" if issue.location else ""
        print(f"{issue.severity} {issue.code}{location}: {issue.message}")
    counts = Counter(issue.severity for issue in issues)
    print(
        "SUMMARY "
        f"ERROR={counts.get('ERROR', 0)} WARN={counts.get('WARN', 0)} INFO={counts.get('INFO', 0)} "
        f"CLASSES={len(summary['classes'])} TEACHERS={len(summary['teachers'])}"
    )

    if args.json_out:
        result = {"issues": [asdict(issue) for issue in issues], "summary": summary}
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    if counts.get("ERROR", 0):
        return 1
    if args.strict_warnings and counts.get("WARN", 0):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
