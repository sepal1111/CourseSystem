/**
 * scheduler.js - Heuristic Backtracking Course Scheduling Engine
 */

import { SPECIAL_ROOMS } from './data.js';

/**
 * Main function to start the scheduling process.
 * Runs Heuristic Backtracking CSP solver.
 */
export function runScheduler(teachers, classes, assignments, params = {}, logCallback = console.log) {
  const maxBacktracks = params.maxBacktracks || 500000;
  const preferMorningCore = params.preferMorningCore !== false;
  const preferConsecutiveSpecial = params.preferConsecutiveSpecial !== false;
  const roomsMap = params.rooms || SPECIAL_ROOMS;

  // Configurable requirements / special restrictions (see engine settings UI).
  // Defaults reproduce the engine's original hardcoded behavior.
  const maxSameSubjectPerDay = Number.isInteger(params.maxSameSubjectPerDay) && params.maxSameSubjectPerDay > 0
    ? params.maxSameSubjectPerDay : 2;
  const enforceEnglishSeparation = params.enforceEnglishSeparation !== false;
  const enforceForcedConnect = params.enforceForcedConnect !== false;
  const homeroomMinFreePeriods = Number.isInteger(params.homeroomMinFreePeriods) && params.homeroomMinFreePeriods >= 0
    ? params.homeroomMinFreePeriods : 2;
  const preferDirectorHalfDay = params.preferDirectorHalfDay !== false;
  const maxTeacherWeeklyHours = Number.isInteger(params.maxTeacherWeeklyHours) && params.maxTeacherWeeklyHours > 0
    ? params.maxTeacherWeeklyHours : 35;

  logCallback("===============================");
  logCallback(`[Engine] 啟動自動排課引擎...`);
  logCallback(`[Engine] 總班級數: ${classes.length}，總教師數: ${teachers.length}`);
  const validAssignments = assignments.filter(a => Boolean(a.teacherId));
  logCallback(`[Engine] 待排課節數: ${validAssignments.reduce((sum, a) => sum + a.weeklyHours, 0)} 節 (排除未指派教師之科目)`);
  logCallback(`[Engine] 最大回溯次數限制: ${maxBacktracks}`);
  
  // Pre-calculate teacher and class maps for fast lookup (moved ahead of
  // token generation below since the forced-double-split rule needs grade
  // lookups for high-grade English).
  const teacherMap = new Map();
  teachers.forEach(t => teacherMap.set(t.id, t));

  const classMap = new Map();
  classes.forEach(c => classMap.set(c.id, c));

  // Subjects requiring mandated consecutive scheduling ("連排"):
  // - 自然/社會 (any grade), exactly 3x/week: 2 periods back-to-back + the
  //   3rd on a different day (so no day ever has all 3).
  // - High-grade (5-6) English-family subjects (英文/英語/彈(英) - all
  //   fundamentally English instruction, per user clarification): exactly
  //   2x/week -> both periods back-to-back; exactly 3x/week -> same
  //   double+single pattern as 自然/社會.
  // Skipped for assignments the user has manually locked to a slot - an
  // explicit lock takes precedence over these patterns.
  const FORCED_DOUBLE_SUBJECTS = ["自然", "社會"];
  const FORCED_CONNECT_HIGH_GRADE_ENGLISH_SUBJECTS = ["英語", "英文", "彈(英)"];

  function getForcedConnectPattern(assign) {
    if (!enforceForcedConnect) return null;
    if (assign.lockedSlots && assign.lockedSlots.length > 0) return null;

    const isCoreSubject = FORCED_DOUBLE_SUBJECTS.includes(assign.subject);
    let isHighGradeEnglish = false;
    if (!isCoreSubject && FORCED_CONNECT_HIGH_GRADE_ENGLISH_SUBJECTS.includes(assign.subject)) {
      const cls = classMap.get(assign.classId);
      isHighGradeEnglish = Boolean(cls && cls.grade >= 5);
    }
    if (!isCoreSubject && !isHighGradeEnglish) return null;

    if (assign.weeklyHours === 3) return 'double-single';
    if (isHighGradeEnglish && assign.weeklyHours === 2) return 'full-double';
    return null;
  }

  // 1. Convert weekly CourseAssignments into a list of individual Lesson tokens
  // An assignment's `lockedSlots` (array of {day, period}, up to weeklyHours
  // entries) pins that many of its lesson tokens to fixed slots in order -
  // used e.g. for split-class local-language courses that must run at the
  // identical time across a whole grade, or for subjects with more than one
  // weekly period where each period needs its own fixed slot.
  const lessons = [];
  validAssignments.forEach(assign => {
    const connectPattern = getForcedConnectPattern(assign);

    if (connectPattern === 'double-single') {
      // One 2-period consecutive block + one standalone period. `groupRole`
      // marks them as a pair whose standalone member must land on a
      // different day than the block (enforced in isValid's Constraint 8).
      lessons.push({
        id: `${assign.classId}-${assign.subject}-${assign.teacherId}-double`,
        classId: assign.classId,
        subject: assign.subject,
        teacherId: assign.teacherId,
        requiresRoom: assign.requiresRoom || null,
        assignmentId: assign.id,
        lessonIndex: 0,
        weeklyHours: assign.weeklyHours,
        groupRole: 'double',
        locked: false, lockedDay: null, lockedPeriod: null
      });
      lessons.push({
        id: `${assign.classId}-${assign.subject}-${assign.teacherId}-single`,
        classId: assign.classId,
        subject: assign.subject,
        teacherId: assign.teacherId,
        requiresRoom: assign.requiresRoom || null,
        assignmentId: assign.id,
        lessonIndex: 1,
        weeklyHours: assign.weeklyHours,
        groupRole: 'single',
        locked: false, lockedDay: null, lockedPeriod: null
      });
      return;
    }

    if (connectPattern === 'full-double') {
      // Both periods must be consecutive - a single block, no leftover
      // single period. Reuses the same double-block placement machinery;
      // with no sibling token sharing this assignmentId, Constraint 8 in
      // isValid() is simply a no-op for it.
      lessons.push({
        id: `${assign.classId}-${assign.subject}-${assign.teacherId}-fulldouble`,
        classId: assign.classId,
        subject: assign.subject,
        teacherId: assign.teacherId,
        requiresRoom: assign.requiresRoom || null,
        assignmentId: assign.id,
        lessonIndex: 0,
        weeklyHours: assign.weeklyHours,
        groupRole: 'double',
        locked: false, lockedDay: null, lockedPeriod: null
      });
      return;
    }

    const lockedSlots = assign.lockedSlots || [];
    for (let i = 0; i < assign.weeklyHours; i++) {
      const slot = lockedSlots[i];
      const isLocked = Boolean(slot) && Number.isInteger(slot.day) && Number.isInteger(slot.period);

      lessons.push({
        id: `${assign.classId}-${assign.subject}-${assign.teacherId}-${i}`,
        classId: assign.classId,
        subject: assign.subject,
        teacherId: assign.teacherId,
        requiresRoom: assign.requiresRoom || null,
        assignmentId: assign.id,
        lessonIndex: i, // 0-indexed index of the lesson in this assignment
        weeklyHours: assign.weeklyHours,
        groupRole: null,
        locked: isLocked,
        lockedDay: isLocked ? slot.day : null,
        lockedPeriod: isLocked ? slot.period : null
      });
    }
  });

  // 3. Initialize scheduling matrices
  // Structure: classSchedule[classId][day][period] -> Lesson
  const classSchedule = {};
  classes.forEach(c => {
    classSchedule[c.id] = {};
    for (let day = 1; day <= 5; day++) {
      classSchedule[c.id][day] = {};
      for (let period = 1; period <= 7; period++) {
        classSchedule[c.id][day][period] = null;
      }
    }
  });

  // Structure: teacherSchedule[teacherId][day][period] -> classId
  const teacherSchedule = {};
  teachers.forEach(t => {
    teacherSchedule[t.id] = {};
    for (let day = 1; day <= 5; day++) {
      teacherSchedule[t.id][day] = {};
      for (let period = 1; period <= 7; period++) {
        teacherSchedule[t.id][day][period] = null;
      }
    }
  });

  // Structure: roomUsage[roomType][day][period] -> count
  const roomUsage = {};

  function initRoom(roomType) {
    if (!roomType) return;
    if (!roomUsage[roomType]) {
      roomUsage[roomType] = {};
      for (let day = 1; day <= 5; day++) {
        roomUsage[roomType][day] = {};
        for (let period = 1; period <= 7; period++) {
          roomUsage[roomType][day][period] = 0;
        }
      }
    }
  }

  // Pre-initialize roomUsage for roomsMap and all lesson requirements
  Object.keys(roomsMap || {}).forEach(roomType => initRoom(roomType));
  lessons.forEach(l => {
    if (l.requiresRoom) initRoom(l.requiresRoom);
  });

  // 3b. Pre-place user-locked lessons at their fixed slots before the solver
  // runs (e.g. split-class local-language courses that must run at the
  // identical day/period across an entire grade). `isValid` below is a
  // hoisted function declaration, so it's safe to call here.
  const lockedLessons = lessons.filter(l => l.locked);
  const freeLessons = lessons.filter(l => !l.locked);

  if (lockedLessons.length > 0) {
    logCallback(`[Engine] 發現 ${lockedLessons.length} 堂已鎖定固定時段的課程，優先鎖入課表...`);
  }

  let lockConflict = null;
  for (const l of lockedLessons) {
    if (isValid(l, l.lockedDay, l.lockedPeriod)) {
      classSchedule[l.classId][l.lockedDay][l.lockedPeriod] = l;
      teacherSchedule[l.teacherId][l.lockedDay][l.lockedPeriod] = l.classId;
      if (l.requiresRoom) {
        initRoom(l.requiresRoom);
        roomUsage[l.requiresRoom][l.lockedDay][l.lockedPeriod]++;
      }
    } else {
      lockConflict = l;
      break;
    }
  }

  if (lockConflict) {
    const lt = teacherMap.get(lockConflict.teacherId);
    logCallback(`[Engine] ❌ 鎖定課程衝突：班級 ${lockConflict.classId}、科目「${lockConflict.subject}」（教師：${lt ? lt.name : lockConflict.teacherId}）無法鎖定於週${lockConflict.lockedDay} 第${lockConflict.lockedPeriod} 節。`);
    logCallback(`[Engine] 可能原因：該年級此時段不可排課（半天/放學）、教師忙碌或已在其他班級授課、時段已被佔用、專科教室已達使用上限，或同科目當日已排滿 2 堂。`);
    logCallback(`[Engine] 💡 提示：請前往「配課」頁面調整此課程的鎖定時段設定後再重新排課。`);
    return null;
  }

  if (lockedLessons.length > 0) {
    logCallback(`[Engine] ✅ 已成功鎖定 ${lockedLessons.length} 堂課程於固定時段。`);
  }

  // 4. Sort variables (lessons) based on heuristics (MRV & constraint weight)
  // We want to schedule the hardest lessons first to avoid backtracking late.
  freeLessons.forEach(lesson => {
    const t = teacherMap.get(lesson.teacherId);
    const c = classMap.get(lesson.classId);
    let difficulty = 0;

    // A: Special room requirements (high risk of conflict)
    if (lesson.requiresRoom) {
      difficulty += 350;
      const limit = roomsMap[lesson.requiresRoom]?.limit || 1;
      difficulty += (5 - limit) * 40;
    }

    // B: Classes with fewer total available slots (Low grades have 23, Mid has 29, High has 32)
    if (c.grade <= 2) {
      difficulty += 250; // Low grade (only 23 slots available)
    } else if (c.grade <= 4) {
      difficulty += 100; // Mid grade (only 29 slots available)
    }

    // C: Teachers with busy slots or high assigned load
    if (t) {
      const busyCount = (t.busySlots || []).length;
      difficulty += busyCount * 80;
      
      // Prioritize teachers with higher workload
      difficulty += (t.assignedHours || 0) * 10;
      
      // Prioritize shared teachers (non-homeroom) because they cross-constrain multiple classes
      if (t.role !== 'homeroom') {
        difficulty += 150;
      }
    }

    // D: Special subjects (Computer, Science, Music, Art)
    if (["自然", "美勞", "電腦", "音樂", "藝(音)", "藝(美)", "彈(資)", "彈(英)", "英文", "科技"].includes(lesson.subject)) {
      difficulty += 30;
    }

    lesson.difficulty = difficulty;
  });

  // Sort descending by difficulty
  freeLessons.sort((a, b) => b.difficulty - a.difficulty);

  logCallback(`[Engine] 排序完成。最難排的前 5 門課：`);
  freeLessons.slice(0, 5).forEach((l, i) => {
    logCallback(`  ${i+1}. 班級 ${l.classId} - 科目 ${l.subject} - 教師 ${teacherMap.get(l.teacherId)?.name} (難度得分: ${l.difficulty.toFixed(0)})`);
  });

  // 0. Physical Impossibility Pre-Check: Teacher hours > 35
  const teacherTotalHours = {};
  validAssignments.forEach(assign => {
    teacherTotalHours[assign.teacherId] = (teacherTotalHours[assign.teacherId] || 0) + assign.weeklyHours;
  });

  const impossibleTeachers = [];
  Object.keys(teacherTotalHours).forEach(tId => {
    if (teacherTotalHours[tId] > maxTeacherWeeklyHours) {
      const tObj = teachers.find(t => t.id === tId);
      impossibleTeachers.push({
        id: tId,
        name: tObj ? tObj.name : tId,
        assigned: teacherTotalHours[tId]
      });
    }
  });

  if (impossibleTeachers.length > 0) {
    logCallback(`[Engine] ❌ 發現實體不可能排課條件！以下教師配課總節數超出單週最大可用時段設定 (${maxTeacherWeeklyHours} 節)：`);
    impossibleTeachers.forEach(t => {
      logCallback(`  - 教師: ${t.name} (已被指派 ${t.assigned} 節 / 每週上限 ${maxTeacherWeeklyHours} 節)`);
    });
    logCallback(`[Engine] 💡 提示：單一教師無法在同一時段同時於兩個班級上課。請前往「線上互動配課」，將部份班級科目分散指派給其他兼任/鐘點教師。`);
    return null;
  }

  // 5. Backtracking DFS solver with Symmetry Breaking
  let backtrackCount = 0;
  let startTime = performance.now();
  const lastSlotMap = {};

  /**
   * Helper to check if a class slot is active based on grade level (Hard constraint)
   */
  function isSlotAllowedForClass(classId, day, period) {
    const cls = classMap.get(classId);
    if (!cls) return false;

    // Low Grade (1-2): Mon, Wed, Thu, Fri are half days (periods 1-4). Only Tue has periods 5-7.
    if (cls.grade <= 2) {
      if (period >= 5 && day !== 2) return false;
    }
    // Mid Grade (3-4): Wed, Fri are half days (periods 1-4). Mon, Tue, Thu are full days.
    if (cls.grade >= 3 && cls.grade <= 4) {
      if (period >= 5 && (day === 3 || day === 5)) return false;
    }
    // High Grade (5-6): Wed is half day (periods 1-4). Mon, Tue, Thu, Fri are full days.
    if (cls.grade >= 5) {
      if (period >= 5 && day === 3) return false;
    }

    return true;
  }

  /**
   * How many periods a teacher could possibly teach on a given day, based on
   * their homeroom class's half-day/full-day pattern (falls back to a full
   * 7-period day for teachers with no homeroom class). Used to gauge how
   * many free periods a homeroom teacher would have left on a given day.
   */
  function getTeacherDailyCapacity(teacherId, day) {
    const t = teacherMap.get(teacherId);
    if (t && t.targetClassId) {
      const cls = classMap.get(t.targetClassId);
      if (cls) {
        let cap = 0;
        for (let p = 1; p <= 7; p++) {
          if (isSlotAllowedForClass(cls.id, day, p)) cap++;
        }
        return cap;
      }
    }
    return 7;
  }

  /**
   * Check if assigning a lesson to (day, period) satisfies all hard constraints.
   */
  function isValid(lesson, day, period) {
    const { classId, teacherId, requiresRoom } = lesson;

    // Constraint 1: Class slot active?
    if (!isSlotAllowedForClass(classId, day, period)) return false;

    // Constraint 2: Class already has a class in this slot?
    if (classSchedule[classId][day][period] !== null) return false;

    // Constraint 3: Teacher already busy in this slot? (School meeting / personal)
    const t = teacherMap.get(teacherId);
    if (t && t.busySlots.includes(`${day}-${period}`)) return false;

    // Constraint 4: Teacher already teaching another class in this slot?
    if (teacherSchedule[teacherId][day][period] !== null) return false;

    // Constraint 5: Special room limit exceeded, or room blocked at this slot?
    if (requiresRoom) {
      const room = roomsMap[requiresRoom];
      if (room?.busySlots?.includes(`${day}-${period}`)) return false;

      const currentUsage = roomUsage[requiresRoom] ? (roomUsage[requiresRoom][day][period] || 0) : 0;
      const maxLimit = room?.limit || 1;
      if (currentUsage >= maxLimit) return false;
    }

    // Constraint 6: Strict limit of max N periods of the same subject on the same day (configurable)
    let subjectCountToday = 0;
    for (let p = 1; p <= 7; p++) {
      const scheduled = classSchedule[classId][day][p];
      if (scheduled && scheduled.subject === lesson.subject) {
        subjectCountToday++;
      }
    }
    if (subjectCountToday >= maxSameSubjectPerDay) return false;

    // Constraint 7: High Grade (5, 6) 彈(英) and 英文 cannot be on the same day (configurable)
    const cls = classMap.get(classId);
    if (enforceEnglishSeparation && cls && cls.grade >= 5) {
      if (lesson.subject === "彈(英)" || lesson.subject === "英文") {
        const conflictSubject = lesson.subject === "彈(英)" ? "英文" : "彈(英)";
        for (let p = 1; p <= 7; p++) {
          const scheduled = classSchedule[classId][day][p];
          if (scheduled && scheduled.subject === conflictSubject) {
            return false;
          }
        }
      }
    }

    // Constraint 8: Forced-double subjects (e.g. 自然/社會 at 3 periods/week,
    // split into a double-block + a standalone period) - the standalone
    // period must not land on the same day as its double-block sibling, and
    // vice versa. Order-independent: whichever of the pair is placed second
    // sees the first already committed and gets rejected if they'd collide.
    if (lesson.groupRole) {
      for (let p = 1; p <= 7; p++) {
        const scheduled = classSchedule[classId][day][p];
        if (scheduled && scheduled.assignmentId === lesson.assignmentId && scheduled.id !== lesson.id) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check both periods of a 2-period consecutive block for a forced-double
   * subject (e.g. 自然/社會). `startPeriod` and `startPeriod+1` must both be
   * free/valid; the pair spanning the lunch break (period 4→5) is excluded
   * by the caller since those two periods aren't actually back-to-back.
   */
  function isValidDoubleBlock(lesson, day, startPeriod) {
    if (!isValid(lesson, day, startPeriod)) return false;
    if (!isValid(lesson, day, startPeriod + 1)) return false;
    return true;
  }

  /**
   * Sort candidate (day, startPeriod) slots for a forced-double-block lesson.
   */
  function getSortedDoubleBlockSlots(lesson) {
    const candidates = [];
    const validStartPeriods = [1, 2, 3, 5, 6]; // 4→5 excluded: lunch break in between

    for (let day = 1; day <= 5; day++) {
      for (const startPeriod of validStartPeriods) {
        if (isValidDoubleBlock(lesson, day, startPeriod)) {
          candidates.push({ day, period: startPeriod, score: 0 });
        }
      }
    }

    // Light heuristic: avoid piling onto a day where this teacher is already heavily loaded.
    candidates.forEach(cand => {
      let score = 0;
      let teacherLoadOnDay = 0;
      for (let p = 1; p <= 7; p++) {
        if (teacherSchedule[lesson.teacherId][cand.day][p] !== null) teacherLoadOnDay++;
      }
      if (teacherLoadOnDay >= 4) score -= 20;
      cand.score = score;
    });

    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Sort candidate slots for a lesson based on soft constraint heuristics
   */
  function getSortedSlotsForLesson(lesson) {
    const candidates = [];
    const t = teacherMap.get(lesson.teacherId);

    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        if (isSlotAllowedForClass(lesson.classId, day, period)) {
          // Check if teacher is busy
          if (t && t.busySlots.includes(`${day}-${period}`)) continue;

          // Check if the required special room is blocked at this slot
          if (lesson.requiresRoom && roomsMap[lesson.requiresRoom]?.busySlots?.includes(`${day}-${period}`)) continue;

          candidates.push({ day, period, score: 0 });
        }
      }
    }

    // Heuristics Scoring
    candidates.forEach(cand => {
      let score = 0;
      const { day, period } = cand;

      // H1: Prefer morning slots (periods 1-3) for core subjects (Math, Chinese, English)
      if (preferMorningCore && ["國語", "數學", "英語"].includes(lesson.subject)) {
        if (period <= 3) {
          score += 50; // Higher score for morning
        } else if (period === 4) {
          score += 10; // Neutral
        } else {
          score -= 30; // Penalize afternoon
        }
      }

      // H2: Prefer afternoon slots (periods 5-7) for physical education, art, health
      if (["體育", "美勞", "綜合", "健康"].includes(lesson.subject)) {
        if (period >= 5) {
          score += 40;
        } else if (period === 4) {
          score += 20;
        } else {
          score -= 10;
        }
      }

      // H3: Spreading: Avoid scheduling the same subject multiple times on the same day.
      // (Unless we want consecutive double periods)
      let subjectCountOnDay = 0;
      let consecutivePossible = false;
      let alreadyScheduledDaysCount = 0;

      for (let d = 1; d <= 5; d++) {
        let hasSubjectOnD = false;
        for (let p = 1; p <= 7; p++) {
          const scheduled = classSchedule[lesson.classId][d][p];
          if (scheduled && scheduled.subject === lesson.subject) {
            hasSubjectOnD = true;
            if (d === day) {
              subjectCountOnDay++;
              // Check if it's consecutive to candidate period
              if (Math.abs(p - period) === 1) {
                consecutivePossible = true;
              }
            }
          }
        }
        if (hasSubjectOnD) alreadyScheduledDaysCount++;
      }

      let isConsecutiveSubject = ["社會", "美勞", "自然", "電腦", "音樂", "藝(音)", "藝(美)", "彈(資)", "科技"].includes(lesson.subject);
      const cls = classMap.get(lesson.classId);
      if (cls && cls.grade >= 5 && FORCED_CONNECT_HIGH_GRADE_ENGLISH_SUBJECTS.includes(lesson.subject)) {
        isConsecutiveSubject = true;
      }

      if (isConsecutiveSubject) {
        if (subjectCountOnDay > 0) {
          if (preferConsecutiveSpecial && consecutivePossible) {
            score += 100; // Highly encourage consecutive special lessons (double periods)
          } else {
            score -= 100; // Strongly penalize splitting the same subject on the same day if not consecutive
          }
        } else {
          // If it's a new day, penalize splitting if they should be consecutive
          if (lesson.weeklyHours === 2 && alreadyScheduledDaysCount >= 1) {
             score -= 60; // Penalize splitting a 2-hour consecutive class across different days
          }
          if (lesson.weeklyHours === 3 && alreadyScheduledDaysCount >= 2) {
             score -= 60; // Try not to split 3-hour class into 3 separate days
          }
        }
      } else {
        if (subjectCountOnDay > 0) {
          score -= 80; // Strongly penalize same day for non-consecutive subjects
        }
      }

      // H4: Spreading teacher load: Prefer scheduling lessons spread across days
      let teacherLoadOnDay = 0;
      for (let p = 1; p <= 7; p++) {
        if (teacherSchedule[lesson.teacherId][day][p] !== null) {
          teacherLoadOnDay++;
        }
      }
      // If teacher already teaches 4 periods on this day, prefer other days
      if (teacherLoadOnDay >= 4) {
        score -= 20;
      }

      // H5: Homeroom teachers should keep at least N free periods each day (configurable; 0 disables)
      if (t && t.role === 'homeroom' && homeroomMinFreePeriods > 0) {
        const dailyCapacity = getTeacherDailyCapacity(lesson.teacherId, day);
        const freeAfterPlacing = dailyCapacity - (teacherLoadOnDay + 1);
        if (freeAfterPlacing < homeroomMinFreePeriods) {
          score -= (homeroomMinFreePeriods - freeAfterPlacing) * 45; // Increasingly penalize squeezing below the minimum
        } else if (freeAfterPlacing >= homeroomMinFreePeriods + 1) {
          score += 15; // Reward leaving a comfortable buffer beyond the minimum
        }
      }

      // H6: Directors / section leaders should teach in one continuous half-day block (configurable)
      if (preferDirectorHalfDay && t && (t.role === 'director' || t.role === 'leader')) {
        let morningCount = 0;
        let afternoonCount = 0;
        for (let p = 1; p <= 4; p++) {
          if (teacherSchedule[lesson.teacherId][day][p] !== null) morningCount++;
        }
        for (let p = 5; p <= 7; p++) {
          if (teacherSchedule[lesson.teacherId][day][p] !== null) afternoonCount++;
        }

        const isMorningSlot = period <= 4;
        if (morningCount > 0 && afternoonCount === 0) {
          score += isMorningSlot ? 60 : -60; // Already committed to morning: stay there
        } else if (afternoonCount > 0 && morningCount === 0) {
          score += isMorningSlot ? -60 : 60; // Already committed to afternoon: stay there
        }

        // Bonus for landing right next to an already-scheduled period (tight block)
        let adjacentToExisting = false;
        for (let p = 1; p <= 7; p++) {
          if (p !== period && teacherSchedule[lesson.teacherId][day][p] !== null && Math.abs(p - period) === 1) {
            adjacentToExisting = true;
          }
        }
        if (adjacentToExisting) score += 25;
      }

      cand.score = score;
    });

    // Sort by score descending (highest score first)
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Backtracking DFS solver
   */
  function solve(lessonIndex) {
    backtrackCount++;
    
    if (backtrackCount > maxBacktracks) {
      throw new Error(`ExceededMaxBacktracks`);
    }

    // Success condition: all lessons scheduled
    if (lessonIndex === freeLessons.length) {
      return true;
    }

    const lesson = freeLessons[lessonIndex];
    const isDouble = lesson.groupRole === 'double';
    const candidateSlots = isDouble ? getSortedDoubleBlockSlots(lesson) : getSortedSlotsForLesson(lesson);
    // Symmetry breaking only applies to truly-interchangeable tokens of a
    // plain multi-period assignment - grouped (double/single) tokens are
    // structurally different from each other, so it's skipped for them.
    const minSlotVal = (!lesson.groupRole && lesson.lessonIndex > 0 && lastSlotMap[lesson.assignmentId]) ? lastSlotMap[lesson.assignmentId] : 0;

    for (let i = 0; i < candidateSlots.length; i++) {
      const { day, period } = candidateSlots[i];
      const slotVal = day * 10 + period;
      if (slotVal <= minSlotVal) continue; // Symmetry Breaking for identical tokens of same assignment

      const valid = isDouble ? isValidDoubleBlock(lesson, day, period) : isValid(lesson, day, period);
      if (valid) {
        // Apply assignment
        classSchedule[lesson.classId][day][period] = lesson;
        teacherSchedule[lesson.teacherId][day][period] = lesson.classId;
        if (lesson.requiresRoom) {
          initRoom(lesson.requiresRoom);
          roomUsage[lesson.requiresRoom][day][period]++;
        }
        if (isDouble) {
          classSchedule[lesson.classId][day][period + 1] = lesson;
          teacherSchedule[lesson.teacherId][day][period + 1] = lesson.classId;
          if (lesson.requiresRoom) {
            roomUsage[lesson.requiresRoom][day][period + 1]++;
          }
        }

        const prevSlotVal = lastSlotMap[lesson.assignmentId];
        lastSlotMap[lesson.assignmentId] = slotVal;

        // Recurse to next lesson
        try {
          if (solve(lessonIndex + 1)) {
            return true;
          }
        } catch (err) {
          if (err.message === 'ExceededMaxBacktracks') throw err;
        }

        // Backtrack
        classSchedule[lesson.classId][day][period] = null;
        teacherSchedule[lesson.teacherId][day][period] = null;
        if (lesson.requiresRoom) {
          initRoom(lesson.requiresRoom);
          roomUsage[lesson.requiresRoom][day][period]--;
        }
        if (isDouble) {
          classSchedule[lesson.classId][day][period + 1] = null;
          teacherSchedule[lesson.teacherId][day][period + 1] = null;
          if (lesson.requiresRoom) {
            roomUsage[lesson.requiresRoom][day][period + 1]--;
          }
        }
        lastSlotMap[lesson.assignmentId] = prevSlotVal;
      }
    }

    return false; // Backtrack trigger
  }

  // 6. Run the solver
  try {
    const success = solve(0);
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(3);

    if (success) {
      logCallback(`[Engine] 🎉 恭喜！排課成功！`);
      logCallback(`[Engine] 耗時: ${duration} 秒`);
      logCallback(`[Engine] 遞迴回溯次數: ${backtrackCount}`);
      
      // Format output schedule
      // We convert classSchedule to output format: { classId: { "day-period": { subject, teacherId, requiresRoom } } }
      const finalSchedule = {};
      classes.forEach(c => {
        finalSchedule[c.id] = {};
        for (let day = 1; day <= 5; day++) {
          for (let period = 1; period <= 7; period++) {
            const lesson = classSchedule[c.id][day][period];
            if (lesson) {
              finalSchedule[c.id][`${day}-${period}`] = {
                subject: lesson.subject,
                teacherId: lesson.teacherId,
                requiresRoom: lesson.requiresRoom,
                locked: Boolean(lesson.locked)
              };
            }
          }
        }
      });

      return finalSchedule;
    } else {
      logCallback(`[Engine] ❌ 無解。在最大限制次數內找不到符合所有硬性約束的排課方案。`);
      logCallback(`[Engine] 遞迴回溯次數: ${backtrackCount}`);
      return null;
    }
  } catch (err) {
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(3);
    
    if (err.message === 'ExceededMaxBacktracks') {
      logCallback(`[Engine] ❌ 超時/超出回溯上限！回溯次數已達 ${backtrackCount} 次。`);
      logCallback(`[Engine] 耗時: ${duration} 秒。`);
      logCallback(`[Engine] 提示：可能存在以下衝突點：`);
      logCallback(`  1. 某些科任/導師的授課總節數超出其可用授課時段。`);
      logCallback(`  2. 專科教室 (例如電腦教室) 設定了太多配課，在時段限制內排不下。`);
      logCallback(`  3. 教師自訂不可排課時段 (忙碌) 太多，限制了排課空間。`);
      logCallback(`  4. 專科教室設定了過多「禁止排課時段」，導致該教室可用時段不足。`);
      logCallback(`[Engine] 建議：請點擊「線上互動配課」檢查教師負荷，或在排課參數中增加最大回溯上限，或調整不可排課時段／教室禁排時段。`);
    } else {
      logCallback(`[Engine] ❌ 發生非預期錯誤：${err.message}`);
      console.error(err);
    }
    return null;
  }
}

/**
 * Validates a single manual swap/move in the schedule.
 * Returns { valid: boolean, reason: string | null }
 */
export function validateManualMove(schedule, teachers, classId, fromDay, fromPeriod, toDay, toPeriod, lesson, logCallback = console.log, customRooms = null, engineSettings = null) {
  const roomsMap = customRooms || SPECIAL_ROOMS;
  const maxSameSubjectPerDay = Number.isInteger(engineSettings?.maxSameSubjectPerDay) && engineSettings.maxSameSubjectPerDay > 0
    ? engineSettings.maxSameSubjectPerDay : 2;
  const enforceEnglishSeparation = engineSettings ? engineSettings.enforceEnglishSeparation !== false : true;

  // 0. Locked lessons are pinned - can't be dragged away, and nothing can be
  // dropped on top of them.
  if (lesson.locked) {
    return { valid: false, reason: "此課程已鎖定固定時段，無法搬動" };
  }
  const targetCellForLock = schedule[classId]?.[`${toDay}-${toPeriod}`];
  if (targetCellForLock && targetCellForLock.locked) {
    return { valid: false, reason: "目標時段的課程已鎖定，無法覆蓋" };
  }

  // 1. Check class level constraints (afternoon limits)
  // Determine grade
  const gradeStr = classId.substring(0, 1);
  const grade = parseInt(gradeStr);
  
  if (isNaN(grade)) return { valid: false, reason: "無效的班級名稱" };

  // Lower Grade Afternoon Limit
  if (grade <= 2 && toPeriod >= 5 && toDay !== 2) {
    return { valid: false, reason: "低年級僅週二下午能排課" };
  }
  // Mid Grade Afternoon Limit
  if (grade >= 3 && grade <= 4 && toPeriod >= 5 && (toDay === 3 || toDay === 5)) {
    return { valid: false, reason: "中年級週三、五下午不能排課" };
  }
  // High Grade Afternoon Limit
  if (grade >= 5 && toPeriod >= 5 && toDay === 3) {
    return { valid: false, reason: "高年級週三下午不能排課" };
  }

  // 2. Check teacher busy slot constraint
  const teacher = teachers.find(t => t.id === lesson.teacherId);
  if (teacher && teacher.busySlots.includes(`${toDay}-${toPeriod}`)) {
    return { valid: false, reason: `教師 ${teacher.name} 在該時段設為忙碌/會議時間` };
  }

  // 3. Check teacher schedule duplicate constraint
  // Check if this teacher is teaching another class in the target (toDay, toPeriod)
  for (const cId in schedule) {
    if (cId === classId) continue; // Skip current class
    const targetCell = schedule[cId][`${toDay}-${toPeriod}`];
    if (targetCell && targetCell.teacherId === lesson.teacherId) {
      return { 
        valid: false, 
        reason: `教師 ${teacher ? teacher.name : lesson.teacherId} 在該時段已經在 ${cId} 班授課` 
      };
    }
  }

  // 4. Check Special Room constraints
  if (lesson.requiresRoom) {
    const roomInfo = roomsMap[lesson.requiresRoom];
    const limit = roomInfo?.limit || 1;
    const roomName = roomInfo?.name || lesson.requiresRoom;

    if (roomInfo?.busySlots?.includes(`${toDay}-${toPeriod}`)) {
      return { valid: false, reason: `專科教室「${roomName}」於該時段設為禁止排課` };
    }

    let roomUsageCount = 0;
    
    for (const cId in schedule) {
      if (cId === classId) continue;
      const targetCell = schedule[cId][`${toDay}-${toPeriod}`];
      if (targetCell && targetCell.requiresRoom === lesson.requiresRoom) {
        roomUsageCount++;
      }
    }
    
    if (roomUsageCount >= limit) {
      return { 
        valid: false, 
        reason: `專科教室「${roomName}」在該時段的使用班級已達上限 (${limit} 班)` 
      };
    }
  }

  // 5. Check same day constraints
  let subjectCountToday = 0;
  for (let p = 1; p <= 7; p++) {
    if (p === toPeriod) continue;
    const targetCell = schedule[classId][`${toDay}-${p}`];
    if (targetCell && targetCell.subject === lesson.subject) {
      subjectCountToday++;
    }
  }
  if (subjectCountToday >= maxSameSubjectPerDay) {
    return { valid: false, reason: `同一天不可排超過 ${maxSameSubjectPerDay} 堂「${lesson.subject}」` };
  }

  if (enforceEnglishSeparation && grade >= 5 && (lesson.subject === "彈(英)" || lesson.subject === "英文")) {
    const conflictSubject = lesson.subject === "彈(英)" ? "英文" : "彈(英)";
    for (let p = 1; p <= 7; p++) {
      if (p === toPeriod) continue;
      const targetCell = schedule[classId][`${toDay}-${p}`];
      if (targetCell && targetCell.subject === conflictSubject) {
        return { valid: false, reason: `高年級「彈(英)」與「英文」不得在同一天` };
      }
    }
  }

  return { valid: true, reason: null };
}
