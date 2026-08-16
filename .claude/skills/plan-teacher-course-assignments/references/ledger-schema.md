# 配課檢核總帳格式

## 目錄

- 最小結構
- 人員欄位
- 班級與配課欄位
- 共同授課與替代課
- 執行檢核

## 最小結構

```json
{
  "meta": {
    "school": "範例國小",
    "school_year": "115",
    "stage": "final"
  },
  "inactive_teachers": ["已離職教師"],
  "teachers": [],
  "classes": []
}
```

`stage` 使用 `planning` 或 `final`。最終版若仍有 `proposed`、`open` 或 `conflict` 配課，檢核器會報錯。

## 人員欄位

```json
{
  "name": "王老師",
  "role": "導師",
  "base_periods": 15,
  "reductions": [
    {"reason": "學年主任", "periods": 1}
  ],
  "target_periods": 14,
  "other_periods": 0,
  "allow_overload": true,
  "participates": true,
  "allowed_grades": [5, 6],
  "max_distinct_grades": 2
}
```

- `target_periods` 可省略；省略時以基本節數減減課自動計算。
- `other_periods` 記錄不在班級配課帳內但應納入個人負擔的社團或其他課。
- 不參與一般配課的行政可設 `participates: false`；若仍被配課會報錯。
- 待聘代理或代課也要在 `teachers` 宣告，例如名稱為「自然代理（待聘1）」，才能精確計算缺額。

## 班級與配課欄位

```json
{
  "id": "501",
  "grade": 5,
  "type": "普通班",
  "weekly_total": 32,
  "required_slots": {
    "國語": 5,
    "數學": 4,
    "綜合": 3,
    "自然": 3,
    "其他": 17
  },
  "assignments": [
    {
      "slot": "國語",
      "label": "國語",
      "teachers": ["王老師"],
      "periods": 5,
      "status": "confirmed"
    },
    {
      "slot": "綜合",
      "label": "國際教育",
      "teachers": ["外師", "英語教師"],
      "periods": 1,
      "co_teaching": true,
      "status": "confirmed"
    }
  ]
}
```

- `weekly_total` 是班級課表的實際時段總數。
- `required_slots` 可省略；若提供，檢核器會逐槽位比對。
- `slot` 是被占用的正式課程槽位；`label` 是實際教學內容。
- `counts_for_class` 與 `counts_for_teacher` 預設均為 `true`。
- 配課由多人共同授課時設 `co_teaching: true`。班級仍只加 `periods` 一次，每位教師各加同樣節數。
- 若各教師負擔不同，使用 `teacher_periods` 取代 `teachers`：

```json
{
  "slot": "分部",
  "periods": 2,
  "teacher_periods": {"導師甲": 2, "管樂教師乙": 2},
  "co_teaching": true,
  "status": "confirmed"
}
```

## 共同授課與替代課

- 共同授課：一筆 assignment、多位教師、班級計一次、每位教師各計入。
- 替代課：`slot` 填原課程槽位，`label` 填實際教學內容；不要另建第二筆新增課。
- 不列入教師基本負擔的觀課或支援，可設 `counts_for_teacher: false`。
- 不占班級課表但要算教師負擔的工作，優先放在人員的 `other_periods`；只有確有班級課程紀錄需求時才設 `counts_for_class: false`。

## 執行檢核

```powershell
python "<skill-directory>/scripts/audit_schedule.py" schedule-ledger.json
python "<skill-directory>/scripts/audit_schedule.py" schedule-ledger.json --json-out audit-result.json
python "<skill-directory>/scripts/audit_schedule.py" schedule-ledger.json --strict-warnings
```

`<skill-directory>` 代表包含本 Skill `SKILL.md` 的實際目錄；執行前要換成絕對路徑。

退出碼：`0` 表示無錯誤；`1` 表示有錯誤；`2` 表示使用 `--strict-warnings` 且仍有警告。
