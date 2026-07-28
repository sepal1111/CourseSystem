這是一份針對您的「國小智慧自動排課系統」所編寫的完整**系統開發與維運手冊**（含最新修正：科任教師改為 4 人、支援管理員線上人員管理與 Excel/CSV 名單匯入，以及動態配課架構）。

---

# 📘 國小智慧自動排課系統 — 開發與維運手冊

## 1. 系統架構與需求規格 (System Specifications)

### 1.1 全校課務節數需求矩陣

本系統依據台灣國小課程綱要規劃，全校共 **15 個班級**，每週總需求節數為 **429 節**：

* **低年級 (1-2年級)**：共 4 班（101, 102, 201, 202），每班 23 節 $\rightarrow$ **92 節**
* **中年級 (3-4年級)**：共 5 班（301, 302, 401, 402, 403），每班 29 節 $\rightarrow$ **145 節**
* **高年級 (5-6年級)**：共 6 班（501, 502, 503, 601, 602, 603），每班 32 節 $\rightarrow$ **192 節**

---

### 1.2 教師身分與基本節數負擔 (Staffing Rules)

系統定義五種教師身分，其中編制內教師基本授課總節數為 **395 節**，剩餘 **34 節** 由鐘點教師彈性補足：

| 身分識別 | 職務名稱 | 基本節數 (節/週) | 預設人數 | 合計基本節數 (節) | 說明與限制 |
| --- | --- | --- | --- | --- | --- |
| `director` | **主任** | 3 | 4 | 12 | 行政兼任，授課節數極少 |
| `leader` | **組長** | 9 | 7 | 63 | 行政兼任，排課優先避開開會時段 |
| `homeroom` | **導師** | 16 | 15 | 240 | 優先排定該班國、數、生活、綜合等主科 |
| `subject` | **科任** | 20 | **4** | **80** | 專科教室課程（自然、藝音、體育、電腦等） |
| `hourly` | **鐘點** | 無限制 ($0$) | 動態 | 34 (彈性) | 用於補足全校配課缺口，無授課上限限制 |

---

## 2. 資料結構設計 (Data Models)

### 2.1 教師資料 (Teacher Model)

```typescript
interface Teacher {
  id: string;             // 教師唯一編號 (例如: T001)
  name: string;           // 教師姓名
  role: 'director' | 'leader' | 'homeroom' | 'subject' | 'hourly';
  baseHours: number;      // 基本節數 (鐘點教師為 0)
  assignedHours: number;  // 目前已配課節數 (動態計算)
  targetClassId?: string; // 若為導師，對應之班級 ID (如: "101")
  specialties: string[];  // 可教授科目列表 (如: ["自然", "彈資"])
  busySlots: string[];    // 不可排課時段列表，格式: "Day-Period" (例: "1-3")
}

```

### 2.2 班級與配課關係 (Assignment Model)

```typescript
interface CourseAssignment {
  id: string;             // 配課編號
  classId: string;        // 班級 ID (如: "501")
  subject: string;        // 科目名稱 (如: "數學")
  weeklyHours: number;    // 週節數 (如: 4)
  teacherId: string;      // 指定授課教師 ID
  requiresRoom?: string;  // 特殊教室需求 (如: "computer_lab", "gym")
}

```

---

## 3. 管理員線上作業邏輯與流程 (Admin Workflows)

```
 [ 1. 名單匯入/新增 ] ──> [ 2. 線上動態配課 ] ──> [ 3. 衝突與節數檢查 ] ──> [ 4. 啟動自動排課 ]

```

### 3.1 人員名單 CSV/Excel 匯入規格

管理員可直接在前端上傳 CSV 檔進行人員批次匯入，欄位格式如下：

```csv
教師編號,姓名,身分職務,基本節數,帶班班級,專長科目
T001,張主任,主任,3,,國語;社會
T005,陳組長,組長,9,,英文;彈英
T012,李老師,導師,16,101,國語;數學;生活;綜合
T027,王老師,科任,20,,自然;彈資
T031,林老師,鐘點,0,,體育;健康

```

*解析演算法重點*：

1. 若 `身分職務` 未填寫 `基本節數`，系統自動依據身分帶入預設值（導師 $\rightarrow 16$，科任 $\rightarrow 20$）。
2. 若身分欄位為 `導師` 且填有 `帶班班級`，系統將自動將該班級的國語、數學、生活等導師科目預設關聯至該教師。

---

### 3.2 線上互動式配課介面 (Online Assignment UI)

前端建議採用 **雙欄互動卡片** 或 **表格下拉選單** 架構：

1. **配課狀態看板**：
* 顯示全校 429 節課務之配課進度（如：`已分配: 429/429 節 (100%)`）。
* 顯示每位教師的配課達標狀態指標：

$$\text{狀態} = \begin{cases}       \text{未達標 (黃色)}, & \text{assignedHours} < \text{baseHours} \\       \text{剛好達標 (綠色)}, & \text{assignedHours} == \text{baseHours} \\       \text{超節/兼課 (藍色)}, & \text{assignedHours} > \text{baseHours}       \end{cases}$$




2. **自動配課輔助 (Auto-Assign Helper)**：
* **導師一鍵綁定**：點擊後自動將 15 位導師帶班班級的主科（國、數、生活、綜合、閱讀）全數配入。
* **科任專長匹配**：根據科任與鐘點教師的 `specialties` 專長，自動充填自然、美勞、音樂、體育與電腦課。



---

## 4. 自動排課演算法設計 (Core Engine Logic)

系統使用 **啟發式優先度 + 回溯法 (Heuristic Backtracking Engine)** 進行排課：

### 4.1 硬性限制條件 (Hard Constraints)

排課過程必須 **100% 滿足** 以下條件，否則視為無效解：

1. **教師時間不重疊**：同一教師在相同 `(Day, Period)` 只能上 1 門課。
2. **班級時間不重疊**：同一班級在相同 `(Day, Period)` 只能上 1 門課。
3. **低年級半天限制**：1-2 年級除了週二（`Day 2`）有 5-7 節外，其餘四天第 5-7 節禁止排課。
4. **專科教室容納限制**：電腦教室、體育館同時段使用班級數 $\le$ 學校設備上限。

### 4.2 啟發式排課順序 (Scheduling Priority Rules)

為了降低回溯次數，排課引擎採用以下優先順序填入課課：

1. **最高優先度**：低年級週二下午的課程（因時段狹窄極易衝突）。
2. **高優先度**：需要專科教室的科目（如：電腦 `彈資`、音樂 `藝音`）。
3. **中優先度**：每週超過 3 節的主課（如：國語、數學），優先排在第 1~3 節（上午黃金時段）。
4. **一般優先度**：綜合、健康、彈性課程。

---

## 5. 前端核心程式碼範例 (JavaScript / Vue 實作參考)

以下提供管理員線上 CSV 解析與動態配課檢查的核心函數：

```javascript
/**
 * 1. CSV 名單解析與教師資料初始化
 */
function parseTeacherCSV(csvText) {
  const lines = csvText.split('\n');
  const teachers = [];
  
  // 欄位對映: 0:編號, 1:姓名, 2:身分, 3:基本節數, 4:導師班級, 5:專長
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map(item => item?.trim());
    if (!row[0] || !row[1]) continue;

    const roleMap = { '主任': 'director', '組長': 'leader', '導師': 'homeroom', '科任': 'subject', '鐘點': 'hourly' };
    const defaultHours = { 'director': 3, 'leader': 9, 'homeroom': 16, 'subject': 20, 'hourly': 0 };
    
    const role = roleMap[row[2]] || 'hourly';
    const baseHours = row[3] ? parseInt(row[3]) : defaultHours[role];

    teachers.push({
      id: row[0],
      name: row[1],
      role: role,
      baseHours: baseHours,
      assignedHours: 0,
      targetClassId: row[4] || null,
      specialties: row[5] ? row[5].split(';') : []
    });
  }
  return teachers;
}

/**
 * 2. 檢查全校教師配課負擔狀態
 */
function validateAssignments(teachers, assignments) {
  // 重置計數
  teachers.forEach(t => t.assignedHours = 0);

  // 累加已分配節數
  assignments.forEach(assign => {
    const teacher = teachers.find(t => t.id === assign.teacherId);
    if (teacher) {
      teacher.assignedHours += assign.weeklyHours;
    }
  });

  // 計算全校指標
  const totalAssigned = teachers.reduce((sum, t) => sum + t.assignedHours, 0);
  const unassignedHours = 429 - totalAssigned;

  return {
    isComplete: unassignedHours === 0,
    totalAssigned,
    unassignedHours,
    overloadedTeachers: teachers.filter(t => t.role !== 'hourly' && t.assignedHours > t.baseHours),
    underloadedTeachers: teachers.filter(t => t.role !== 'hourly' && t.assignedHours < t.baseHours)
  };
}

```

---

## 6. 系統維護與未來擴充建議

1. **Excel 課表匯出 (Export to Excel)**：
* 建議整合 `SheetJS (xlsx.full.min.js)` Library，可一鍵將全校總課表、各班課表、個人教師課表匯出為格式化 Excel 檔案。


2. **網頁拖拉微調衝突警示 (Interactive D&D)**：
* 手動調課時，當使用者將某一節課拖拽至新時段，系統需於 `dragover` 事件中實時比對該教師與該班級在該時段是否已佔用，並以紅色半透明遮罩警示衝突。


3. **資料本地端持久化 (LocalStorage Persist)**：
* 將管理員設定好的教師名單與配課狀態寫入 `localStorage`，避免網頁重新整理時資料遺失。