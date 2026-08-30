/* 墨案缉凶 · 主题网页版 bundle
 * 由 minigame-theme/src 静态封装（构建产物，勿手改；改源码后重跑 node minigame-theme/tools/build-web.mjs）。
 * 经典脚本：无 import/export、无 eval/new Function，靠 window 命名空间协作。 */
(function () {
'use strict';
var __mods = {};
var __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function __req(id) {
  if (__cache[id]) return __cache[id].exports;
  if (!__mods[id]) throw new Error('[moan] module not found: ' + id);
  var m = { exports: {} };
  __cache[id] = m;
  __mods[id](__req, m, m.exports);
  return m.exports;
}
window.__moanDef = __def;
window.__moanRequire = __req;
__def("src/logic/rng.js", function (require, module, exports) {
/* 种子随机数（mulberry32）+ 洗牌工具。浏览器与 Node 通用。 */
(function (global) {
  'use strict';

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seedStr) {
    const rand = mulberry32(hashSeed(seedStr));
    return {
      next: rand,
      int(n) { return Math.floor(rand() * n); },              // [0, n)
      range(a, b) { return a + Math.floor(rand() * (b - a + 1)); }, // [a, b]
      pick(arr) { return arr[Math.floor(rand() * arr.length)]; },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      chance(p) { return rand() < p; }
    };
  }

  global.MurdokuRNG = { makeRng, hashSeed };
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/puzzle.js", function (require, module, exports) {
/* 棋盘模型与空间谓词。格子索引 idx = row * size + col。 */
(function (global) {
  'use strict';

  const M = {};

  M.idx = (r, c, n) => r * n + c;
  M.row = (i, n) => Math.floor(i / n);
  M.col = (i, n) => i % n;

  M.inBounds = (r, c, n) => r >= 0 && r < n && c >= 0 && c < n;

  /** 四邻格子索引 */
  M.neighbors4 = function (i, n) {
    const r = M.row(i, n), c = M.col(i, n), out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  };

  /**
   * 方位谓词（与原版一致）：N/S/E/W 为半平面（任意列/行），
   * NE/NW/SE/SW 为对角半平面。d 相对 ref 是否处于 dir 方向。
   */
  M.dirOK = function (d, ref, dir, n) {
    const dr = M.row(d, n) - M.row(ref, n);
    const dc = M.col(d, n) - M.col(ref, n);
    switch (dir) {
      case 'N': return dr < 0;
      case 'S': return dr > 0;
      case 'W': return dc < 0;
      case 'E': return dc > 0;
      case 'NW': return dr < 0 && dc < 0;
      case 'NE': return dr < 0 && dc > 0;
      case 'SW': return dr > 0 && dc < 0;
      case 'SE': return dr > 0 && dc > 0;
    }
    return false;
  };

  M.DIRS = ['N', 'S', 'E', 'W', 'NW', 'NE', 'SW', 'SE'];

  /** 与 ref 格四相邻且同房间（原版 beside 语义要求同区域） */
  M.besideOK = function (d, ref, board) {
    if (M.neighbors4(ref, board.size).indexOf(d) < 0) return false;
    return board.roomAt[d] === board.roomAt[ref];
  };

  /** 转角格（墙隅）：房间轮廓的拐角——纵向（上/下）与横向（左/右）至少各有一面"异室墙"。
   *  棋盘外边界不算墙；仅对向两面墙的一字走廊格不算转角。 */
  M.computeCorners = function (board) {
    const n = board.size, corners = new Set();
    for (let i = 0; i < n * n; i++) {
      const r = M.row(i, n), c = M.col(i, n);
      const room = board.roomAt[i];
      let vWalls = 0, hWalls = 0;
      if (r > 0 && board.roomAt[i - n] !== room) vWalls++;
      if (r < n - 1 && board.roomAt[i + n] !== room) vWalls++;
      if (c > 0 && board.roomAt[i - 1] !== room) hWalls++;
      if (c < n - 1 && board.roomAt[i + 1] !== room) hWalls++;
      if (vWalls >= 1 && hWalls >= 1) corners.add(i);
    }
    return corners;
  };

  /** 每个房间的人数。pos: person -> cell */
  M.roomCounts = function (pos, board) {
    const counts = new Array(board.rooms.length).fill(0);
    for (let p = 0; p < pos.length; p++) {
      if (pos[p] >= 0) counts[board.roomAt[pos[p]]]++;
    }
    return counts;
  };

  /** 由完整解推出凶手：与受害者同房间且房间恰有 2 人的那个人 */
  M.findMurderer = function (pos, board) {
    const v = board.victimId;
    const room = board.roomAt[pos[v]];
    const counts = M.roomCounts(pos, board);
    if (counts[room] !== 2) return -1;
    for (let p = 0; p < pos.length; p++) {
      if (p !== v && board.roomAt[pos[p]] === room) return p;
    }
    return -1;
  };

  /** 国风坐标：行、列均用天干（甲乙丙…）。单格写作「己丙」（己行丙列），
   *  加间隔避免读作两个格子（如「己、丙」）。 */
  M.ROW_STEMS = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';
  M.COL_NUMS  = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';
  M.coordText = function (cell, n) {
    return M.ROW_STEMS[M.row(cell, n)] + '·' + M.COL_NUMS[M.col(cell, n)];
  };

  global.MurdokuModel = M;
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/clues.js", function (require, module, exports) {
/* 线索：数据定义、完整赋值校验、中文文案（关键词 <b> 加粗）。
 * 物件以「类型」指代、存在语义（"在香炉旁边" = 挨着至少一只香炉），参照 Murdoku 原版：
 * 不再用「某房间的某物件」逐一定指，文案更短、无需消歧。
 * 线索为纯数据（可序列化），solver 按 type 做传播，叶子用 checkClue 复核。 */
(function (global) {
  'use strict';

  const M = global.MurdokuModel;

  const DIR_ZH = {
    N: '北边', S: '南边', E: '东边', W: '西边',
    NW: '西北方向', NE: '东北方向', SW: '西南方向', SE: '东南方向'
  };
  const GENDER_ZH = { M: '男士', F: '女士' };

  /** 某类型的全部物件实例 */
  function objByKey(board, key) {
    return board.objects.filter(o => o.key === key);
  }
  /** 类型的显示名（同类型各实例同名） */
  function objName(board, key) {
    const o = board.objects.find(o2 => o2.key === key);
    return o ? o.name : key;
  }

  /** 性别匹配的非受害者候选人 */
  function genderCands(clue, board) {
    return board.people
      .filter(q => q.gender === clue.gender && q.id !== board.victimId)
      .map(q => q.id);
  }

  /** 完整赋值下的线索校验。pos: person -> cell（全部 >= 0）。 */
  function checkClue(clue, pos, board) {
    const n = board.size;
    const P = clue.p !== undefined ? pos[clue.p] : -1;
    switch (clue.type) {
      case 'row': return M.row(P, n) === clue.r;
      case 'col': return M.col(P, n) === clue.c;
      // 传奇新类型：行列区间（一元中强度锚点）
      case 'bandRow': return M.row(P, n) >= clue.r1 && M.row(P, n) <= clue.r2;
      case 'bandCol': return M.col(P, n) >= clue.c1 && M.col(P, n) <= clue.c2;
      // 传奇新类型：与某人曼哈顿距离恰为 k 步（二元）
      case 'dist': {
        const Q = pos[clue.q];
        return Math.abs(M.row(P, n) - M.row(Q, n)) + Math.abs(M.col(P, n) - M.col(Q, n)) === clue.k;
      }
      case 'room': return board.roomAt[P] === clue.room;
      case 'notRoom': return board.roomAt[P] !== clue.room;
      case 'corner': return board.corners.has(P);
      case 'notCorner': return !board.corners.has(P);
      case 'dir':
        if (clue.objKey) return objByKey(board, clue.objKey).some(o => M.dirOK(P, o.cell, clue.dir, n));
        return M.dirOK(P, pos[clue.ref.id], clue.dir, n);
      case 'notDir':
        if (clue.objKey) return !objByKey(board, clue.objKey).some(o => M.dirOK(P, o.cell, clue.dir, n));
        return !M.dirOK(P, pos[clue.ref.id], clue.dir, n);
      case 'beside':
        if (clue.objKey) return objByKey(board, clue.objKey).some(o => M.besideOK(P, o.cell, board));
        return M.besideOK(P, pos[clue.ref.id], board);
      case 'notBeside':
        if (clue.objKey) return !objByKey(board, clue.objKey).some(o => M.besideOK(P, o.cell, board));
        return !M.besideOK(P, pos[clue.ref.id], board);
      // 另有一人在同屋的 X 旁边：同屋某实例旁有他人（≠p；紧邻语义自带同区域约束）
      case 'otherBeside': {
        const R = board.roomAt[P];
        return objByKey(board, clue.objKey).some(o => board.roomAt[o.cell] === R &&
          board.people.some(q => q.id !== clue.p && M.besideOK(pos[q.id], o.cell, board)));
      }
      case 'with': return board.roomAt[P] === board.roomAt[pos[clue.q]];
      case 'notWith': return board.roomAt[P] !== board.roomAt[pos[clue.q]];
      case 'aloneWith': {
        if (board.roomAt[P] !== board.roomAt[pos[clue.q]]) return false;
        return M.roomCounts(pos, board)[board.roomAt[P]] === 2;
      }
      case 'alone': return M.roomCounts(pos, board)[board.roomAt[P]] === 1;
      case 'emptyRoom': return M.roomCounts(pos, board)[clue.room] === 0;
      case 'sameRowObj':
        return objByKey(board, clue.objKey).some(o => M.row(P, n) === M.row(o.cell, n));
      case 'sameColObj':
        return objByKey(board, clue.objKey).some(o => M.col(P, n) === M.col(o.cell, n));
      case 'sameDiag': {
        if (clue.objKey) {
          return objByKey(board, clue.objKey).some(o =>
            P !== o.cell &&
            Math.abs(M.row(P, n) - M.row(o.cell, n)) === Math.abs(M.col(P, n) - M.col(o.cell, n)));
        }
        const R = pos[clue.ref.id];
        return P !== R &&
          Math.abs(M.row(P, n) - M.row(R, n)) === Math.abs(M.col(P, n) - M.col(R, n));
      }
      case 'exactCol': return M.col(P, n) === M.col(pos[clue.ref.id], n) + clue.side;
      case 'exactRow': return M.row(P, n) === M.row(pos[clue.ref.id], n) + clue.side;
      case 'sitObj': return !!board.sittable[P] && !(board.mat && board.mat[P]);
      case 'onMat': return !!(board.mat && board.mat[P]);
      case 'notMat': return !(board.mat && board.mat[P]);
      case 'besideAnyOf':
        return clue.objKeys.some(k => objByKey(board, k).some(o => M.besideOK(P, o.cell, board)));
      case 'withGender':
        return genderCands(clue, board).some(q => q !== clue.p && board.roomAt[pos[q]] === board.roomAt[P]);
      case 'aloneWithGender': {
        const room = board.roomAt[P];
        if (M.roomCounts(pos, board)[room] !== 2) return false;
        return genderCands(clue, board).some(q => q !== clue.p && board.roomAt[pos[q]] === room);
      }
      case 'roomMixGender': {
        const room = clue.room;
        let hasM = false, hasF = false;
        board.people.forEach(q => {
          if (board.roomAt[pos[q.id]] === room) {
            if (q.gender === 'M') hasM = true; else hasF = true;
          }
        });
        return hasM && hasF;
      }
      case 'victimFree': return true;
    }
    return false;
  }

  function personName(board, id) { return board.people[id].name; }

  /** 中文线索文案（古风白话，HTML，人物/物件/性别关键词加粗；省略主语——卡片已标明是谁。
   *  句式向 Murdoku 原版看齐：一谓一句、能短则短。） */
  function clueText(clue, board) {
    // 行列用天干地支（与棋盘坐标一致）：行=甲乙丙…，列=甲乙丙…
    const rowNum = clue.r !== undefined ? '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'[clue.r] : '';
    const colNum = clue.c !== undefined ? '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'[clue.c] : '';
    switch (clue.type) {
      case 'row': return `在${rowNum}行。`;
      case 'col': return `在${colNum}列。`;
      case 'bandRow': return `在${'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'[clue.r1]}至${'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'[clue.r2]}行之间。`;
      case 'bandCol': return `在${'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'[clue.c1]}至${'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'[clue.c2]}列之间。`;
      case 'dist': return `与<b>${personName(board, clue.q)}</b>相距恰好 ${clue.k} 步。`;
      case 'room': return `身处${board.rooms[clue.room].name}。`;
      case 'notRoom': return `不在${board.rooms[clue.room].name}。`;
      case 'corner': return `身处墙角。`;
      case 'notCorner': return `不在墙角。`;
      case 'dir':
        return `在<b>${clue.objKey ? objName(board, clue.objKey) : personName(board, clue.ref.id)}</b>${DIR_ZH[clue.dir]}。`;
      case 'notDir':
        return `不在<b>${clue.objKey ? objName(board, clue.objKey) : personName(board, clue.ref.id)}</b>${DIR_ZH[clue.dir]}。`;
      case 'beside':
        if (clue.objKey) return `在<b>${objName(board, clue.objKey)}</b>旁边。`;
        return `与<b>${personName(board, clue.ref.id)}</b>紧邻。`;
      case 'notBeside':
        if (clue.objKey) return `不在<b>${objName(board, clue.objKey)}</b>旁边。`;
        return `不与<b>${personName(board, clue.ref.id)}</b>紧邻。`;
      case 'otherBeside': return `另有一人在同屋的<b>${objName(board, clue.objKey)}</b>旁边。`;
      case 'with': return `与<b>${personName(board, clue.q)}</b>同屋。`;
      case 'notWith': return `与<b>${personName(board, clue.q)}</b>不同屋。`;
      case 'aloneWith': return `仅与<b>${personName(board, clue.q)}</b>二人同屋。`;
      case 'alone': return `独处一室。`;
      case 'emptyRoom': return `${board.rooms[clue.room].name}空无一人。`;
      case 'sameRowObj': return `与<b>${objName(board, clue.objKey)}</b>在同一行。`;
      case 'sameColObj': return `与<b>${objName(board, clue.objKey)}</b>在同一列。`;
      case 'sameDiag':
        return `与<b>${clue.objKey ? objName(board, clue.objKey) : personName(board, clue.ref.id)}</b>同在一条斜线上。`;
      case 'exactCol': return `恰在<b>${personName(board, clue.ref.id)}</b>${clue.side > 0 ? '右' : '左'}边一列。`;
      case 'exactRow': return `恰在<b>${personName(board, clue.ref.id)}</b>${clue.side > 0 ? '下' : '上'}面一行。`;
      case 'sitObj': return `正坐在<b>${clue.objName}</b>上。`;
      case 'onMat': return `在<b>${objName(board, clue.objKey)}</b>上。`;
      case 'notMat': return `不在<b>${objName(board, clue.objKey)}</b>上。`;
      case 'besideAnyOf':
        return `在<b>${objName(board, clue.objKeys[0])}</b>或<b>${objName(board, clue.objKeys[1])}</b>旁边。`;
      case 'withGender': return `与一位<b>${GENDER_ZH[clue.gender]}</b>同屋。`;
      case 'aloneWithGender': return `仅与一位<b>${GENDER_ZH[clue.gender]}</b>同屋。`;
      case 'roomMixGender':
        return `${board.rooms[clue.room].name}内有一<b>男</b>一<b>女</b>。`;
      case 'victimFree': return `与真凶独处者，便是死者。`;
    }
    return '';
  }

  /**
   * 线索分类（用于"同人两条须不同类"与"每类最多 n 条"配额）：
   * dir=人物方位关系（方向/斜线/紧邻某人/恰在某人邻行邻列）
   * rowcol=人物所在行列
   * object=人物物品关系（坐/紧邻物件/与物件同行列斜线/物件组合）
   * room=人物区域关系（身处/未踏入/同屋/独处/墙隅/性别同屋/空房/男女同室）
   * other=其他
   */
  function categoryOf(clue) {
    const refsObject = !!clue.objKey || !!clue.objKeys;
    switch (clue.type) {
      case 'row': case 'col': case 'bandRow': case 'bandCol': return 'rowcol';
      case 'dist': return 'dir';
      case 'dir': case 'notDir': case 'sameDiag': case 'exactCol': case 'exactRow':
      case 'beside': case 'notBeside':
        return refsObject ? 'object' : 'dir';
      case 'sitObj': case 'besideAnyOf': case 'sameRowObj': case 'sameColObj':
      case 'otherBeside': case 'onMat': case 'notMat':
        return 'object';
      case 'room': case 'notRoom': case 'with': case 'notWith':
      case 'aloneWith': case 'alone': case 'corner': case 'notCorner':
      case 'withGender': case 'aloneWithGender':
      case 'emptyRoom': case 'roomMixGender':
        return 'room';
      default: return 'other';
    }
  }

  /** 线索涉及的人物 id 列表（用于 UI 高亮） */
  function cluePeople(clue) {
    const ids = [];
    if (clue.p !== undefined) ids.push(clue.p);
    if (clue.q !== undefined) ids.push(clue.q);
    if (clue.ref && clue.ref.kind === 'person') ids.push(clue.ref.id);
    return ids;
  }

  /** 一元线索（在求解器初始化时直接裁剪域）。bandRow/bandCol 为 legacy（旧库残留，新生成不再产出） */
  const UNARY_TYPES = new Set([
    'row', 'col', 'room', 'notRoom', 'corner', 'notCorner', 'emptyRoom',
    'sameRowObj', 'sameColObj', 'sitObj', 'onMat', 'notMat', 'besideAnyOf', 'bandRow', 'bandCol'
  ]);

  function isUnary(clue) {
    return UNARY_TYPES.has(clue.type) ||
      ((clue.type === 'dir' || clue.type === 'notDir' ||
        clue.type === 'beside' || clue.type === 'notBeside' || clue.type === 'sameDiag') &&
        !!clue.objKey);
  }

  global.MurdokuClues = { checkClue, clueText, cluePeople, isUnary, categoryOf, genderCands, objByKey, objName, DIR_ZH, GENDER_ZH };
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/solver.js", function (require, module, exports) {
/* 求解器：域传播（弧一致性简化版）+ MRV 回溯，统计解数量（上限 2）。
 * 用于生成器验证唯一解，也用于提示与校验。 */
(function (global) {
  'use strict';

  const M = global.MurdokuModel;
  const C = global.MurdokuClues;

  function cellsOfRoom(board, room) {
    if (!board._roomCells) {
      board._roomCells = board.rooms.map(() => []);
      for (let i = 0; i < board.size * board.size; i++) {
        board._roomCells[board.roomAt[i]].push(i);
      }
    }
    return board._roomCells[room];
  }

  /** 初始化每个人的候选域并应用一元线索 */
  function initDomains(board, clues) {
    const n = board.size;
    const occ = [];
    for (let i = 0; i < n * n; i++) if (board.occupiable[i]) occ.push(i);

    const domains = board.people.map(() => new Set(occ));

    const apply = (p, pred) => {
      const d = domains[p];
      for (const cell of Array.from(d)) if (!pred(cell)) d.delete(cell);
    };

    for (const clue of clues) {
      if (!C.isUnary(clue)) continue;
      const p = clue.p;
      switch (clue.type) {
        case 'row': apply(p, c => M.row(c, n) === clue.r); break;
        case 'col': apply(p, c => M.col(c, n) === clue.c); break;
        case 'bandRow': apply(p, c => M.row(c, n) >= clue.r1 && M.row(c, n) <= clue.r2); break;
        case 'bandCol': apply(p, c => M.col(c, n) >= clue.c1 && M.col(c, n) <= clue.c2); break;
        case 'room': apply(p, c => board.roomAt[c] === clue.room); break;
        case 'notRoom': apply(p, c => board.roomAt[c] !== clue.room); break;
        case 'corner': apply(p, c => board.corners.has(c)); break;
        case 'notCorner': apply(p, c => !board.corners.has(c)); break;
        case 'emptyRoom':
          for (let q = 0; q < domains.length; q++) {
            apply(q, c => board.roomAt[c] !== clue.room);
          }
          break;
        case 'sameRowObj': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => objs.some(o => M.row(c, n) === M.row(o.cell, n)));
          break;
        }
        case 'sameColObj': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => objs.some(o => M.col(c, n) === M.col(o.cell, n)));
          break;
        }
        case 'dir': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => objs.some(o => M.dirOK(c, o.cell, clue.dir, n)));
          break;
        }
        case 'notDir': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => !objs.some(o => M.dirOK(c, o.cell, clue.dir, n)));
          break;
        }
        case 'beside': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => objs.some(o => M.besideOK(c, o.cell, board)));
          break;
        }
        case 'notBeside': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => !objs.some(o => M.besideOK(c, o.cell, board)));
          break;
        }
        case 'sitObj': apply(p, c => !!board.sittable[c] && !(board.mat && board.mat[c])); break;
        case 'onMat': apply(p, c => !!(board.mat && board.mat[c])); break;
        case 'notMat': apply(p, c => !(board.mat && board.mat[c])); break;
        case 'besideAnyOf':
          apply(p, c => clue.objKeys.some(k =>
            C.objByKey(board, k).some(o => M.besideOK(c, o.cell, board))));
          break;
        case 'sameDiag': {
          const objs = C.objByKey(board, clue.objKey);
          apply(p, c => objs.some(o => c !== o.cell &&
            Math.abs(M.row(c, n) - M.row(o.cell, n)) === Math.abs(M.col(c, n) - M.col(o.cell, n))));
          break;
        }
      }
      if (domains[p] && domains[p].size === 0) return null;
    }
    return domains;
  }

  /** 依据已确定的人（域大小为 1）传播二元/多元线索。返回 false 表示域清空。 */
  function propagate(board, clues, domains) {
    const n = board.size;
    const people = board.people.length;
    const assigned = domains.map(d => (d.size === 1 ? d.values().next().value : -1));

    const filter = (p, pred) => {
      const d = domains[p];
      let changed = false;
      for (const cell of Array.from(d)) {
        if (!pred(cell)) { d.delete(cell); changed = true; }
      }
      if (d.size === 0) return 'fail';
      return changed ? 'changed' : 'ok';
    };

    let anyChanged = true;
    while (anyChanged) {
      anyChanged = false;
      for (let p = 0; p < people; p++) {
        assigned[p] = domains[p].size === 1 ? domains[p].values().next().value : -1;
      }
      for (const clue of clues) {
        if (C.isUnary(clue)) continue;
        let res = 'ok';
        const p = clue.p;
        const P = assigned[p];
        switch (clue.type) {
          case 'dir': case 'notDir': {
            if (clue.ref.kind !== 'person') break;
            const R = assigned[clue.ref.id];
            if (R >= 0) {
              res = filter(p, c => M.dirOK(c, R, clue.dir, n) === (clue.type === 'dir'));
            }
            break;
          }
          case 'beside': case 'notBeside': {
            if (clue.ref.kind === 'person') {
              const R = assigned[clue.ref.id];
              if (R >= 0) {
                res = filter(p, c => M.besideOK(c, R, board) === (clue.type === 'beside'));
              }
            } else if (P >= 0) {
              // notBeside 以物体为参照时已在一元阶段处理；此处仅 beside(object) 的反向无需处理
            }
            break;
          }
          case 'with': case 'notWith': {
            const want = clue.type === 'with';
            if (P >= 0) {
              res = filter(clue.q, c => (board.roomAt[c] === board.roomAt[P]) === want);
            }
            const Q = assigned[clue.q];
            if (res !== 'fail' && Q >= 0) {
              res = filter(p, c => (board.roomAt[c] === board.roomAt[Q]) === want);
            }
            break;
          }
          case 'dist': {
            // 曼哈顿距离恰为 k：双向弧一致（与 with/notWith 同构）
            const distOK = (a, b) =>
              Math.abs(M.row(a, n) - M.row(b, n)) + Math.abs(M.col(a, n) - M.col(b, n)) === clue.k;
            if (P >= 0) res = filter(clue.q, c => distOK(c, P));
            const Q = assigned[clue.q];
            if (res !== 'fail' && Q >= 0) res = filter(p, c => distOK(c, Q));
            break;
          }
          case 'aloneWith': {
            const q = clue.q, Q = assigned[q];
            if (P >= 0) {
              res = filter(q, c => board.roomAt[c] === board.roomAt[P]);
              for (let x = 0; x < people && res !== 'fail'; x++) {
                if (x !== p && x !== q) {
                  const r2 = filter(x, c => board.roomAt[c] !== board.roomAt[P]);
                  if (r2 === 'fail') res = 'fail'; else if (r2 === 'changed') res = 'changed';
                }
              }
            }
            if (res !== 'fail' && Q >= 0) {
              const r1 = filter(p, c => board.roomAt[c] === board.roomAt[Q]);
              if (r1 === 'fail') res = 'fail'; else if (r1 === 'changed') res = 'changed';
              for (let x = 0; x < people && res !== 'fail'; x++) {
                if (x !== p && x !== q) {
                  const r2 = filter(x, c => board.roomAt[c] !== board.roomAt[Q]);
                  if (r2 === 'fail') res = 'fail'; else if (r2 === 'changed') res = 'changed';
                }
              }
            }
            for (let x = 0; x < people && res !== 'fail'; x++) {
              if (x !== p && x !== q && assigned[x] >= 0) {
                const r1 = filter(p, c => board.roomAt[c] !== board.roomAt[assigned[x]]);
                if (r1 === 'fail') { res = 'fail'; break; }
                const r2 = filter(q, c => board.roomAt[c] !== board.roomAt[assigned[x]]);
                if (r2 === 'fail') { res = 'fail'; break; }
                if (r1 === 'changed' || r2 === 'changed') res = 'changed';
              }
            }
            break;
          }
          case 'alone': {
            if (P >= 0) {
              for (let x = 0; x < people && res !== 'fail'; x++) {
                if (x !== p) {
                  const r2 = filter(x, c => board.roomAt[c] !== board.roomAt[P]);
                  if (r2 === 'fail') res = 'fail'; else if (r2 === 'changed') res = 'changed';
                }
              }
            }
            for (let x = 0; x < people && res !== 'fail'; x++) {
              if (x !== p && assigned[x] >= 0) {
                const r1 = filter(p, c => board.roomAt[c] !== board.roomAt[assigned[x]]);
                if (r1 === 'fail') { res = 'fail'; break; }
                if (r1 === 'changed') res = 'changed';
              }
            }
            break;
          }
          case 'sameDiag': {
            if (clue.ref.kind === 'person') {
              const R = assigned[clue.ref.id];
              if (R >= 0) {
                const rr = M.row(R, n), rc = M.col(R, n);
                res = filter(p, c => c !== R &&
                  Math.abs(M.row(c, n) - rr) === Math.abs(M.col(c, n) - rc));
              }
            }
            break;
          }
          case 'exactCol': {
            const R = assigned[clue.ref.id];
            if (R >= 0) {
              res = filter(p, c => M.col(c, n) === M.col(R, n) + clue.side);
            }
            break;
          }
          case 'exactRow': {
            const R = assigned[clue.ref.id];
            if (R >= 0) {
              res = filter(p, c => M.row(c, n) === M.row(R, n) + clue.side);
            }
            break;
          }
          case 'withGender': {
            if (P >= 0) {
              const roomP = board.roomAt[P];
              const cands = C.genderCands(clue, board).filter(q => q !== p);
              const possible = cands.filter(q =>
                Array.from(domains[q]).some(c => board.roomAt[c] === roomP));
              if (possible.length === 0) { res = 'fail'; break; }
              // 已满足则无需再传播
              if (cands.some(q => assigned[q] >= 0 && board.roomAt[assigned[q]] === roomP)) break;
              if (possible.length === 1) {
                res = filter(possible[0], c => board.roomAt[c] === roomP);
              }
            }
            break;
          }
          case 'aloneWithGender': {
            if (P >= 0) {
              const roomP = board.roomAt[P];
              const cands = C.genderCands(clue, board).filter(q => q !== p);
              // 非候选者（含受害者）全部排除出该房间
              for (let x = 0; x < people && res !== 'fail'; x++) {
                if (x !== p && !cands.includes(x)) {
                  const r2 = filter(x, c => board.roomAt[c] !== roomP);
                  if (r2 === 'fail') res = 'fail'; else if (r2 === 'changed') res = 'changed';
                }
              }
              if (res === 'fail') break;
              const inR = cands.filter(q => assigned[q] >= 0 && board.roomAt[assigned[q]] === roomP);
              if (inR.length > 0) {
                // 已有一位候选人入内：其余候选人不得再入
                for (const q of cands) {
                  if (!inR.includes(q)) {
                    const r2 = filter(q, c => board.roomAt[c] !== roomP);
                    if (r2 === 'fail') { res = 'fail'; break; }
                    if (r2 === 'changed') res = 'changed';
                  }
                }
              } else {
                const possible = cands.filter(q =>
                  Array.from(domains[q]).some(c => board.roomAt[c] === roomP));
                if (possible.length === 0) { res = 'fail'; break; }
                if (possible.length === 1) {
                  res = filter(possible[0], c => board.roomAt[c] === roomP);
                }
              }
            }
            break;
          }
          case 'otherBeside': {
            // 另有一人在同屋物件旁：p 定位后做可行性检查与唯一候选锁定
            if (P >= 0) {
              const roomP = board.roomAt[P];
              const inst = C.objByKey(board, clue.objKey).filter(o => board.roomAt[o.cell] === roomP);
              const match = (c, o) => M.besideOK(c, o.cell, board);
              const cands = [];
              for (let q = 0; q < people; q++) {
                if (q === p) continue;
                if (Array.from(domains[q]).some(c => inst.some(o => match(c, o)))) cands.push(q);
              }
              if (cands.length === 0) { res = 'fail'; break; }
              const sat = cands.some(q => assigned[q] >= 0 && inst.some(o => match(assigned[q], o)));
              if (sat) break;
              if (cands.length === 1) {
                res = filter(cands[0], c => inst.some(o => match(c, o)));
              }
            }
            break;
          }
          case 'roomMixGender': {
            // 弱传播：仅做可行性检查
            const room = clue.room;
            for (const g of ['M', 'F']) {
              const anyPossible = board.people.some(q =>
                q.gender === g &&
                Array.from(domains[q.id]).some(c => board.roomAt[c] === room));
              if (!anyPossible) { res = 'fail'; break; }
            }
            break;
          }
          case 'victimFree': break;
        }
        if (res === 'fail') return false;
        if (res === 'changed') anyChanged = true;
      }
      // 行列唯一：已确定的格子，其他人的域中排除同行同列
      for (let p = 0; p < people; p++) {
        if (assigned[p] < 0) continue;
        const r = M.row(assigned[p], n), c = M.col(assigned[p], n);
        for (let q = 0; q < people; q++) {
          if (q === p) continue;
          const res = filter(q, cell => M.row(cell, n) !== r && M.col(cell, n) !== c);
          if (res === 'fail') return false;
          if (res === 'changed') anyChanged = true;
        }
      }
      // 行列容纳排除：若某人的域整包于某行/列，则该行/列必属此人，其余人排除。
      // （人类推理的自然一步；补全提示与求解的弧一致性）
      for (let p = 0; p < people; p++) {
        const d = domains[p];
        if (d.size <= 1) continue;
        let rowSame = -1, colSame = -1, first = true;
        for (const cell of d) {
          const r = M.row(cell, n), c = M.col(cell, n);
          if (first) { rowSame = r; colSame = c; first = false; continue; }
          if (r !== rowSame) rowSame = -2;
          if (c !== colSame) colSame = -2;
          if (rowSame === -2 && colSame === -2) break;
        }
        if (rowSame >= 0) {
          for (let q = 0; q < people; q++) {
            if (q === p) continue;
            const res = filter(q, cell => M.row(cell, n) !== rowSame);
            if (res === 'fail') return false;
            if (res === 'changed') anyChanged = true;
          }
        }
        if (colSame >= 0) {
          for (let q = 0; q < people; q++) {
            if (q === p) continue;
            const res = filter(q, cell => M.col(cell, n) !== colSame);
            if (res === 'fail') return false;
            if (res === 'changed') anyChanged = true;
          }
        }
      }
    }
    return true;
  }

  /**
   * 统计解数量（最多 cap 个）。nodeCap 防止爆炸。
   * 返回 { count, solution, aborted }；count===cap 表示“至少有 cap 个”。
   */
  function solve(board, clues, opts) {
    const cap = (opts && opts.cap) || 2;
    const nodeCap = (opts && opts.nodeCap) || 200000;
    const domains = initDomains(board, clues);
    if (!domains) return { count: 0, solution: null, aborted: false };
    if (!propagate(board, clues, domains)) return { count: 0, solution: null, aborted: false };

    const people = board.people.length;
    const solutions = [];
    let nodes = 0, aborted = false;

    function leafOK(pos) {
      for (const clue of clues) {
        if (!C.checkClue(clue, pos, board)) return false;
      }
      // 凶手规则：被害者须与恰好一人独处一室。
      // 这是玩家可见的公开规则（非被害者的位置提示），缺失它时被害者摆位
      // 往往无法唯一确定，故纳入求解约束。
      if (M.findMurderer(pos, board) < 0) return false;
      return true;
    }

    function search(domains) {
      if (solutions.length >= cap || aborted) return;
      if (++nodes > nodeCap) { aborted = true; return; }
      // MRV：选域最小且未确定的人
      let pickIdx = -1, pickSize = Infinity;
      for (let p = 0; p < people; p++) {
        const s = domains[p].size;
        if (s > 1 && s < pickSize) { pickSize = s; pickIdx = p; }
      }
      if (pickIdx === -1) {
        const pos = domains.map(d => d.values().next().value);
        // 行列唯一性复核 + 全部线索复核
        const rows = new Set(), cols = new Set();
        let ok = true;
        for (const cell of pos) {
          const r = M.row(cell, board.size), c = M.col(cell, board.size);
          if (rows.has(r) || cols.has(c)) { ok = false; break; }
          rows.add(r); cols.add(c);
        }
        if (ok && leafOK(pos)) solutions.push(pos);
        return;
      }
      for (const cell of Array.from(domains[pickIdx])) {
        const next = domains.map(d => new Set(d));
        next[pickIdx] = new Set([cell]);
        if (propagate(board, clues, next)) search(next);
        if (solutions.length >= cap || aborted) return;
      }
    }

    search(domains);
    return { count: solutions.length, solution: solutions[0] || null, aborted };
  }

  global.MurdokuSolver = { solve, initDomains, propagate };
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/sprites.js", function (require, module, exports) {
/* 自研卡通 SVG 素材（净室原创）：场景物件 sprite + 人物头像生成器。
 * 全部为字符串函数，浏览器与 Node 通用，不依赖 DOM。 */
(function (global) {
  'use strict';

  const S = (inner, vb) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb || '0 0 64 64'}" width="100%" height="100%">${inner}</svg>`;

  const stroke = 'stroke="#222" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

  /* ---------------- 国风物件 sprites（viewBox 0 0 64 64） ---------------- */
  const OBJECT_SPRITES = {
    // 太师椅 — 高背宽扶手，红木色
    chair: S(`
      <rect x="18" y="6" width="28" height="26" rx="3" fill="#8b4513" ${stroke}/>
      <rect x="14" y="8" width="6" height="20" rx="2" fill="#9a5a2b" ${stroke}/>
      <rect x="44" y="8" width="6" height="20" rx="2" fill="#9a5a2b" ${stroke}/>
      <rect x="14" y="32" width="36" height="8" rx="2" fill="#7a3b10" ${stroke}/>
      <line x1="18" y1="40" x2="18" y2="54" ${stroke}/>
      <line x1="46" y1="40" x2="46" y2="54" ${stroke}/>
      <line x1="26" y1="40" x2="26" y2="50" ${stroke}/>`),
    // 圆桌 — 圆面四腿
    table: S(`
      <ellipse cx="32" cy="22" rx="20" ry="6" fill="#9a5a2b" ${stroke}/>
      <line x1="18" y1="22" x2="16" y2="52" ${stroke}/>
      <line x1="32" y1="22" x2="32" y2="52" ${stroke}/>
      <line x1="46" y1="22" x2="48" y2="52" ${stroke}/>
      <line x1="16" y1="40" x2="48" y2="40" stroke="#222" stroke-width="2"/>
      <circle cx="32" cy="22" r="18" fill="#b07a4a" stroke="#222" stroke-width="2.5"/><circle cx="32" cy="22" r="4" fill="#c98f5f"/>`),
    // 屏风 — 四扇折叠，绘山水
    screen: S(`
      <rect x="10" y="8" width="44" height="40" rx="2" fill="#f5eeda" ${stroke}/>
      <line x1="21" y1="8" x2="21" y2="48" stroke="#222" stroke-width="2"/>
      <line x1="32" y1="8" x2="32" y2="48" stroke="#222" stroke-width="2"/>
      <line x1="43" y1="8" x2="43" y2="48" stroke="#222" stroke-width="2"/>
      <path d="M14,32 l4,-10 l4,8 l3,-5 l4,7 z" fill="#7a9e6b" stroke="#222" stroke-width="1.5"/>
      <path d="M25,32 l4,-10 l4,8 l3,-5 l4,7 z" fill="#7a9e6b" stroke="#222" stroke-width="1.5"/>
      <path d="M36,32 l4,-10 l4,8 l3,-5 l4,7 z" fill="#7a9e6b" stroke="#222" stroke-width="1.5"/>`),
    // 书案 — 长方案几，上置笔墨
    desk: S(`
      <rect x="6" y="26" width="52" height="8" rx="2" fill="#9a5a2b" ${stroke}/>
      <line x1="10" y1="34" x2="10" y2="52" ${stroke}/>
      <line x1="32" y1="34" x2="32" y2="52" ${stroke}/>
      <line x1="54" y1="34" x2="54" y2="52" ${stroke}/>
      <rect x="14" y="18" width="14" height="8" rx="1" fill="#f5eeda" ${stroke}/>
      <rect x="44" y="20" width="4" height="10" rx="1" fill="#3a3a3a" ${stroke}/>`),
    // 香炉 — 三足鼎式，青烟袅袅
    incense: S(`
      <path d="M24,44 l4,-12 q4,-6 4,-10 q0,4 4,6 l4,16 q-4,4 -8,4 q-4,0 -8,-4 z" fill="#b8860b" ${stroke}/>
      <line x1="22" y1="44" x2="18" y2="54" ${stroke}/>
      <line x1="32" y1="44" x2="32" y2="56" ${stroke}/>
      <line x1="42" y1="44" x2="46" y2="54" ${stroke}/>
      <path d="M32,22 q-2,-8 0,-14 q2,8 0,14 z" fill="none" stroke="#999" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M30,16 q-3,-6 0,-10" fill="none" stroke="#bbb" stroke-width="1.2" stroke-linecap="round"/>`),
    // 盆景 — 青瓷盆，内栽松柏
    bonsai: S(`
      <ellipse cx="32" cy="48" rx="14" ry="5" fill="#6ba587" ${stroke}/>
      <path d="M32,48 v-16 q-6,-8 -8,-14 q-2,6 -3,10 q-1,-6 -5,-8 q1,8 4,12 q-4,-2 -5,2 q5,6 5,14 z" fill="#4a7a4a" ${stroke}/>
      <path d="M32,48 v-14 q6,-8 8,-14 q2,6 3,10 q1,-6 5,-8 q-1,8 -4,12 q4,-2 5,2 q-5,6 -5,14 z" fill="#5a9a5a" ${stroke}/>`),
    // 兵器架 — 木架横放刀枪
    weapons: S(`
      <rect x="12" y="12" width="40" height="6" rx="2" fill="#8a5a3b" ${stroke}/>
      <rect x="12" y="46" width="40" height="6" rx="2" fill="#8a5a3b" ${stroke}/>
      <line x1="24" y1="18" x2="40" y2="46" stroke="#8f9aa5" stroke-width="4" stroke-linecap="round"/>
      <line x1="40" y1="18" x2="24" y2="46" stroke="#8f9aa5" stroke-width="4" stroke-linecap="round"/>
      <line x1="20" y1="44" x2="26" y2="50" ${stroke}/>
      <line x1="38" y1="44" x2="44" y2="50" ${stroke}/>`),
    // 青花瓷瓶 — 梅瓶造型，蓝白花纹
    vase: S(`
      <path d="M26,10 h12 q4,6 2,12 q5,6 3,18 q-2,10 -10,10 q-8,0 -10,-10 q-2,-12 3,-18 q-2,-6 2,-12 z" fill="#e8ecf2" ${stroke}/>
      <path d="M27,34 q6,6 10,0" fill="none" stroke="#3a5a8c" stroke-width="2" stroke-linecap="round"/>
      <path d="M28,28 q5,4 8,0" fill="none" stroke="#3a5a8c" stroke-width="1.5" stroke-linecap="round"/>`),
    // 灯笼 — 红绢圆灯笼，穗子下垂
    lantern: S(`
      <rect x="30" y="6" width="4" height="5" fill="#b8860b" ${stroke}/>
      <ellipse cx="32" cy="26" rx="12" ry="16" fill="#c44b4b" ${stroke}/>
      <line x1="32" y1="42" x2="32" y2="52" stroke="#b8860b" stroke-width="2"/>
      <line x1="28" y1="52" x2="36" y2="52" stroke="#b8860b" stroke-width="2"/>
      <line x1="30" y1="52" x2="30" y2="56" stroke="#d4a017" stroke-width="1.5"/>
      <line x1="34" y1="52" x2="34" y2="56" stroke="#d4a017" stroke-width="1.5"/>`),
    // 卧床 — 架子床，帷帐半垂
    bed: S(`
      <rect x="6" y="30" width="52" height="16" rx="3" fill="#9a5a2b" ${stroke}/>
      <rect x="10" y="22" width="14" height="12" rx="2" fill="#f5eeda" ${stroke}/>
      <rect x="28" y="22" width="24" height="12" rx="2" fill="#d4c8a8" ${stroke}/>
      <line x1="10" y1="46" x2="10" y2="56" ${stroke}/>
      <line x1="54" y1="46" x2="54" y2="56" ${stroke}/>
      <rect x="6" y="8" width="4" height="38" fill="#8a5a3b" ${stroke}/>
      <rect x="54" y="8" width="4" height="38" fill="#8a5a3b" ${stroke}/>
      <line x1="8" y1="8" x2="56" y2="8" ${stroke}/>`),
    // 博古架 — 多格架，摆书册古玩
    shelf: S(`
      <rect x="10" y="6" width="44" height="50" rx="3" fill="#8a5a3b" ${stroke}/>
      <line x1="10" y1="22" x2="54" y2="22" ${stroke}/>
      <line x1="10" y1="38" x2="54" y2="38" ${stroke}/>
      <rect x="14" y="10" width="14" height="10" fill="#c95050"/>
      <rect x="32" y="10" width="18" height="10" fill="#5078c9"/>
      <rect x="14" y="26" width="10" height="10" fill="#c9a050"/>
      <rect x="28" y="26" width="14" height="10" fill="#50a56a"/>
      <rect x="14" y="42" width="20" height="10" fill="#8c50c9"/>
      <rect x="38" y="42" width="12" height="10" fill="#c9a050"/>`),
    // 水缸 — 陶制大水缸，水面浮瓢
    vat: S(`
      <ellipse cx="32" cy="46" rx="16" ry="5" fill="#7a6a5a" ${stroke}/>
      <path d="M18,18 l2,28 q5,6 12,6 q7,0 12,-6 l2,-28 q-5,4 -14,4 q-9,0 -14,-4 z" fill="#8a7a6a" ${stroke}/>
      <ellipse cx="32" cy="18" rx="14" ry="4" fill="#6ba5a5" ${stroke}/>
      <ellipse cx="28" cy="18" rx="3" ry="1.5" fill="#8a5a3b" ${stroke}/>`),
    // 古琴 — 七弦琴横置琴桌上
    qin: S(`
      <rect x="8" y="28" width="48" height="6" rx="2" fill="#8a5a3b" ${stroke}/>
      <rect x="10" y="20" width="44" height="8" rx="2" fill="#4a3a2a" ${stroke}/>
      <line x1="14" y1="22" x2="14" y2="28" stroke="#c9a050" stroke-width="1.5"/>
      <line x1="18" y1="22" x2="18" y2="28" stroke="#c9a050" stroke-width="1.5"/>
      <line x1="22" y1="22" x2="22" y2="28" stroke="#c9a050" stroke-width="1.5"/>
      <line x1="26" y1="22" x2="26" y2="28" stroke="#c9a050" stroke-width="1.5"/>
      <line x1="30" y1="22" x2="30" y2="28" stroke="#c9a050" stroke-width="1.5"/>
      <line x1="34" y1="22" x2="34" y2="28" stroke="#c9a050" stroke-width="1.5"/>
      <line x1="38" y1="22" x2="38" y2="28" stroke="#c9a050" stroke-width="1.5"/>`),
    // 绣架 — 木框绷绣布
    embroidery: S(`
      <rect x="14" y="22" width="36" height="20" rx="2" fill="#f5eeda" ${stroke}/>
      <rect x="10" y="46" width="8" height="6" fill="#8a5a3b" ${stroke}/>
      <rect x="46" y="46" width="8" height="6" fill="#8a5a3b" ${stroke}/>
      <line x1="16" y1="16" x2="48" y2="16" ${stroke}/>
      <line x1="14" y1="42" x2="10" y2="52" ${stroke}/>
      <line x1="50" y1="42" x2="54" y2="52" ${stroke}/>
      <circle cx="26" cy="30" r="2" fill="#c44b4b"/>
      <circle cx="36" cy="30" r="2" fill="#c44b4b"/>
      <circle cx="31" cy="36" r="2" fill="#4a6d8c"/>`),
    // 石凳 — 青石鼓凳
    stoneSeat: S(`
      <ellipse cx="32" cy="46" rx="14" ry="5" fill="#9a9a9a" ${stroke}/>
      <path d="M20,17 q2,9 6,14 q8,9 4,12 q-5,3 0,-4 q-4,-10 3,-14 q2,-16 -13,-8 z" fill="#b8b8b8" ${stroke}/>
      <ellipse cx="32" cy="18" rx="12" ry="4" fill="#c9c9c9" ${stroke}/>
      <path d="M22,34 q10,8 20,0" fill="none" stroke="#999" stroke-width="1.5"/>`),
    // 井 — 石砌井口，辘轳悬桶
    well: S(`
      <ellipse cx="32" cy="46" rx="18" ry="6" fill="#8a8a8a" ${stroke}/>
      <path d="M16,16 l4,32 q5,5 12,5 q7,0 12,-5 l4,-32 q-5,3 -16,3 q-11,0 -16,-3 z" fill="#aaa" ${stroke}/>
      <ellipse cx="32" cy="16" rx="16" ry="5" fill="#3a5a7a" ${stroke}/>
      <rect x="12" y="8" width="8" height="4" fill="#8a5a3b" ${stroke}/>
      <rect x="44" y="8" width="8" height="4" fill="#8a5a3b" ${stroke}/>
      <line x1="24" y1="10" x2="20" y2="26" ${stroke}/>
      <rect x="18" y="26" width="8" height="6" rx="1" fill="#8a5a3b" ${stroke}/>`)
  };

  /* ---------------- 国风头像生成器（viewBox 0 0 100 100） ---------------- */
  const SKINS = ['#f2c89b', '#e8b08a', '#d99a6c', '#c07f4f', '#f6d3b0'];
  const HAIR_COLORS = ['#1a1a1a', '#2b2b2b', '#3a2a1a', '#4a3a2a'];
  const GREY = '#b8b8b8';

  // 古风发式：0=幞头(男) 1=发髻(男) 2=儒巾 3=云鬓(女) 4=双丫髻(女) 5=光头(僧) 6=卷髻 7=花白短发(老) 8=员外巾
  function hairPath(style, color) {
    const c = `fill="${color}" ${stroke}`;
    switch (style) {
      case 0: // 幞头（管家/护院戴的软帽）
        return `<path d="M28,44 Q26,22 50,20 Q74,22 72,44 Q67,30 50,30 Q33,30 28,44 Z" ${c}/>
          <rect x="29" y="16" width="42" height="7" rx="3" ${c}/>`;
      case 1: // 男士发髻 + 方巾
        return `<circle cx="50" cy="12" r="7" ${c}/>
          <path d="M30,44 Q28,18 50,18 Q72,18 70,44 Q67,28 50,28 Q33,28 30,44 Z" ${c}/>
          <rect x="36" y="4" width="28" height="6" rx="2" ${c}/>`;
      case 2: // 儒巾（书生方巾）
        return `<path d="M30,44 Q28,20 50,20 Q72,20 70,44 Q67,30 50,30 Q33,30 30,44 Z" ${c}/>
          <rect x="27" y="14" width="46" height="8" rx="2" ${c}/>
          <line x1="27" y1="22" x2="73" y2="22" stroke="#222" stroke-width="2"/>`;
      case 3: // 云鬓珠钗（小姐高髻）
        return `<ellipse cx="50" cy="13" rx="10" ry="9" ${c}/>
          <path d="M28,44 Q26,18 50,18 Q74,18 72,44 Q69,30 58,28 Q68,26 66,22 Q60,18 50,18 Q33,19 30,44 Z" ${c}/>
          <circle cx="38" cy="8" r="2.5" fill="#d4a017"/>
          <circle cx="46" cy="6" r="2" fill="#d4a017"/>`;
      case 4: // 双丫髻（丫鬟双髻）
        return `<circle cx="38" cy="16" r="7" ${c}/>
          <circle cx="62" cy="16" r="7" ${c}/>
          <path d="M30,44 Q28,30 50,30 Q72,30 70,44 Q67,38 50,38 Q33,38 30,44 Z" ${c}/>
          <line x1="38" y1="23" x2="38" y2="28" stroke="#222" stroke-width="1.5"/>
          <line x1="62" y1="23" x2="62" y2="28" stroke="#222" stroke-width="1.5"/>`;
      case 5: // 光头（僧人）
        return '';
      case 6: // 卷髻（账房小髻）
        return `<circle cx="50" cy="14" r="5" ${c}/>
          <path d="M29,44 Q27,22 50,22 Q73,22 71,44 Q67,32 50,32 Q33,32 29,44 Z" ${c}/>`;
      case 7: // 花白短发（花匠老翁，两侧灰发）
        return `<ellipse cx="28" cy="40" rx="6" ry="10" ${c}/>
          <ellipse cx="72" cy="40" rx="6" ry="10" ${c}/>
          <path d="M34,28 Q50,18 66,28 Q60,22 50,22 Q40,22 34,28 Z" ${c}/>`;
      case 8: // 员外巾（账房/富绅方帽）
        return `<path d="M29,44 Q27,24 50,24 Q73,24 71,44 Q67,34 50,34 Q33,34 29,44 Z" ${c}/>
          <rect x="31" y="18" width="38" height="8" rx="3" ${c}/>
          <rect x="34" y="14" width="6" height="6" fill="#d4a017" ${stroke}/>`;
    }
    return '';
  }

  function avatarSVG(av) {
    const skin = av.skin, hc = av.hairColor, cl = av.clothes;
    const beard = av.beard
      ? `<path d="M32,52 Q34,72 50,72 Q66,72 68,52 Q64,60 57,57 Q61,66 50,66 Q39,66 43,57 Q36,60 32,52 Z" fill="${hc}" ${stroke}/>`
      : '';
    const mouth = av.beard ? '' :
      `<path d="M44,57 Q50,60 56,57" fill="none" stroke="#222" stroke-width="2.5" stroke-linecap="round"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect x="2" y="2" width="96" height="96" rx="14" fill="${av.bg}" stroke="#222" stroke-width="3"/>
      <path d="M18,100 Q20,74 50,74 Q80,74 82,100 Z" fill="${cl}" ${stroke}/>
      <rect x="43" y="58" width="14" height="18" fill="${skin}" stroke="#222" stroke-width="2.5"/>
      <ellipse cx="50" cy="43" rx="21" ry="24" fill="${skin}" ${stroke}/>
      ${hairPath(av.hairStyle, hc)}
      <ellipse cx="42" cy="44" rx="2.8" ry="3.4" fill="#222"/>
      <ellipse cx="58" cy="44" rx="2.8" ry="3.4" fill="#222"/>
      ${mouth}${beard}
    </svg>`;
  }

  /**
   * 角色造型预设（按性别与身份定制）：style=发式 grey=花白 beard=胡须
   * 发式：0=幞头 1=男士发髻 2=儒巾 3=云鬓(女) 4=双丫髻(女) 5=光头(僧/尼) 6=卷髻(女) 7=花白短发(老) 8=员外巾
   */
  const AVATAR_PRESETS = {
    // —— 主剧本九人 ——
    '刘忠':   { style: 0, grey: true,  beard: true  }, // 老管家：幞头，霜鬓，山羊须
    '王嫂':   { style: 6, grey: false, beard: false }, // 厨娘：中年卷髻
    '沈文渊': { style: 2, grey: false, beard: false }, // 西席举子：儒巾
    '柳如烟': { style: 3, grey: false, beard: false }, // 大小姐：云鬓珠钗
    '春兰':   { style: 4, grey: false, beard: false }, // 丫鬟：双丫髻
    '赵铁柱': { style: 0, grey: false, beard: true  }, // 护院武师：幞头，短须
    '钱万金': { style: 8, grey: false, beard: false }, // 账房先生：员外巾
    '老陈':   { style: 7, grey: true,  beard: true  }, // 老花匠：花白短发，胡须
    '慧明':   { style: 5, grey: false, beard: false }, // 游方僧人：光头
    // —— 扩展角色（供后续剧本/更大棋盘） ——
    '邢铁面': { style: 0, grey: false, beard: true  }, // 捕快
    '宋验':   { style: 7, grey: true,  beard: false }, // 仵作
    '苏济':   { style: 1, grey: false, beard: true  }, // 郎中
    '玄朴':   { style: 1, grey: false, beard: true  }, // 道士：发髻长须
    '巧针':   { style: 6, grey: false, beard: false }, // 绣娘
    '老黄':   { style: 7, grey: true,  beard: true  }, // 门房
    '金满仓': { style: 8, grey: false, beard: true  }, // 行商
    '柳音':   { style: 3, grey: false, beard: false }, // 伶人：云鬓
    '静安':   { style: 5, grey: false, beard: false }  // 尼姑：光头
  };
  // 未收录名字的兜底：按性别随机
  const FALLBACK = {
    F: [{ style: 3 }, { style: 4 }, { style: 6 }],
    M: [{ style: 0 }, { style: 1 }, { style: 2 }, { style: 8 }]
  };

  function makeAvatarSpec(rng, personId, clothesColor, name, gender) {
    const skin = rng.pick(SKINS);
    const bg = ['#f7e2e2', '#e2eef7', '#e7f5e3', '#f6efdb', '#efe4f4', '#e0f2f0'][personId % 6];
    const preset = (name && AVATAR_PRESETS[name]) ||
      (gender && rng.pick(FALLBACK[gender])) || { style: rng.pick([0, 1, 2, 3, 4, 6, 8]) };
    const grey = !!preset.grey;
    return {
      skin,
      hairStyle: preset.style,
      hairColor: grey ? GREY : rng.pick(HAIR_COLORS),
      clothes: clothesColor,
      bg,
      beard: !!preset.beard
    };
  }

  /* ---------------- AI 工笔头像（WebP） ----------------
   * 同一身份固定一张头像（p.imgKey），跨关仅换姓；无 imgKey 回退 SVG。
   * key 即身份图文件名（assets/avatars/<key>.webp，512px）。 */
  // 已生成裁底版（cut-*.png，透明背景）的 key
  const CUT_OK = {
    liuzhong: 1, wangsao: 1, shenwenyuan: 1, liuruyan: 1,
    chunlan: 1, zhaotiezhu: 1, laochen: 1, huiming: 1, qianwanjin: 1,
    xingtiemian: 1, songyan: 1, langzhong: 1, daoshi: 1, qiaozhen: 1,
    laohuang: 1, jinmancang: 1, liuyijn: 1, nigu: 1, zhum: 1, xiaoshitou: 1
  };

  /* ---------------- AI 工笔头像（WebP） ----------------
   * 同一身份固定一张头像（p.imgKey），跨关仅换姓；无 imgKey 回退 SVG。 */
  /* ---------------- AI 工笔头像（内联 base64 优先，跨关仅换姓） ----------------
   * 核心包（assets-bundle-core.js）随 index.html 同步加载，头像即时可用。
   * 同一身份固定一张头像（p.imgKey）；无 imgKey 回退 SVG。 */
  const INLINE = (typeof global.MOAN_ASSETS !== 'undefined') ? global.MOAN_ASSETS : null;
  const avatarSrc = key => (INLINE && INLINE.avatars[key]) || `assets/avatars/${key}.webp`;
  const cutSrc = key => (INLINE && INLINE.cut[key]) || `assets/avatars/cut-${key}.webp`;

  /* 主题分包按需加载：确定棋盘主题后动态注入 <script>，命中内联后重绘。
   * 返回 Promise（加载完成/已加载/无该主题即 resolve）。 */
  const themeLoaded = {};
  function ensureTheme(themeId, onReady) {
    const tid = themeId || 'zhaiyuan';
    if (!INLINE) return Promise.resolve();
    if (INLINE.objects[tid]) { themeLoaded[tid] = true; return Promise.resolve(); }
    if (themeLoaded[tid] === 'loading') return Promise.resolve();
    themeLoaded[tid] = 'loading';
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = `assets/assets-bundle-${tid}.js`;
      s.onload = () => { themeLoaded[tid] = true; if (onReady) onReady(); resolve(); };
      s.onerror = () => { themeLoaded[tid] = false; resolve(); };
      document.head.appendChild(s);
    });
  }

  function portraitHTML(p) {
    if (p.imgKey) {
      return `<img src="${avatarSrc(p.imgKey)}" alt="${p.name}" draggable="false" ` +
        `style="width:100%;height:100%;display:block;border-radius:inherit;object-fit:cover">`;
    }
    return avatarSVG(p.avatar);
  }

  /* 棋盘 token：裁底人像（透明底、缩小、露出地板），回退普通头像 */
  function tokenHTML(p) {
    if (p.imgKey && CUT_OK[p.imgKey]) {
      return `<img src="${cutSrc(p.imgKey)}" alt="${p.name}" draggable="false" ` +
        `style="position:absolute;left:5%;top:2%;width:90%;height:96%;object-fit:contain;pointer-events:none">`;
    }
    return portraitHTML(p);
  }

  /* ---------------- 物件图片（按主题目录 WebP，优先于 SVG sprite） ---------------- */
  const FLOOR_IMG = {
    grass: 'grass', white: 'white', pink: 'pink', blue: 'blue', beige: 'beige', grey: 'grey',
    wood: 'wood', stone: 'stone', bluestone: 'bluestone', tatami: 'tatami', dirt: 'dirt', cobble: 'cobble'
  };

  function objectHTML(key, themeId) {
    const tid = themeId || 'zhaiyuan';
    const src = (INLINE && INLINE.objects[tid] && INLINE.objects[tid][key]) || `assets/objects/${tid}/${key}.webp`;
    return `<img src="${src}" alt="" draggable="false" onerror="this.style.display='none'" ` +
      `style="width:100%;height:100%;display:block;object-fit:contain;pointer-events:none">`;
  }

  // 地板：主题专属贴图在主题目录（文件名含 tile）；通用纹理在 objects 根目录
  function floorURL(key, themeId) {
    const isThemeTile = key.indexOf('tile') >= 0 || key.indexOf('Meshy_AI_') === 0;
    if (isThemeTile) {
      const tid = themeId || 'zhaiyuan';
      const k = 'Meshy_AI_' + key;
      return (INLINE && INLINE.objects[tid] && INLINE.objects[tid][k]) || `assets/objects/${tid}/${k}.webp`;
    }
    return FLOOR_IMG[key]
      ? ((INLINE && INLINE.floors[FLOOR_IMG[key]]) || `assets/objects/floor-${FLOOR_IMG[key]}.webp`)
      : '';
  }

  global.MurdokuArt = { OBJECT_SPRITES, avatarSVG, makeAvatarSpec, portraitHTML, tokenHTML, objectHTML, floorURL, ensureTheme };
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/generator.js", function (require, module, exports) {
/* 谜题生成器（净室自研）：
 * 1) 随机生长划分房间；2) 随机置换生成解答；3) 选受害者（房间恰 2 人）；
 * 4) 枚举真线索池，按难度加权逐个加入，直到求解器证明唯一解；5) 反向消冗。 */
(function (global) {
  'use strict';

  const M = global.MurdokuModel;
  const C = global.MurdokuClues;
  const Solver = global.MurdokuSolver;

  // 南宋公案 · 人物身份库
  // 同一身份（职业/头像固定）跨关仅换「姓」：捕快这关姓赵、下关姓陈。
  // 单字简称即「姓」（同关互异，供格内批注）；fixedName 无姓氏型角色取名字首字。
  // namefmt: (姓)→显示名；fixedName: 无姓氏型角色直接用固定名。
  const SURNAMES = ['赵', '陈', '王', '沈', '钱', '周', '吴', '郑', '冯', '卫', '蒋', '韩', '杨', '朱', '秦', '许', '何', '吕', '张', '孔'];
  const IDENTITY_POOL = [
    { title: '管家', gender: 'M', avatar: 'liuzhong', namefmt: s => s + '管家' },
    { title: '厨娘', gender: 'F', avatar: 'wangsao', namefmt: s => s + '嫂' },
    { title: '西席', gender: 'M', avatar: 'shenwenyuan', namefmt: s => s + '先生' },
    { title: '大小姐', gender: 'F', avatar: 'liuruyan', namefmt: s => s + '姑娘' },
    { title: '丫鬟', gender: 'F', avatar: 'chunlan', fixedName: '春兰' },
    { title: '护院', gender: 'M', avatar: 'zhaotiezhu', namefmt: s => s + '护院' },
    { title: '账房', gender: 'M', avatar: 'qianwanjin', namefmt: s => s + '账房' },
    { title: '花匠', gender: 'M', avatar: 'laochen', namefmt: s => '老' + s },
    { title: '僧客', gender: 'M', avatar: 'huiming', fixedName: '慧明师傅' },
    { title: '捕快', gender: 'M', avatar: 'xingtiemian', namefmt: s => s + '捕头' },
    { title: '仵作', gender: 'M', avatar: 'songyan', namefmt: s => s + '仵作' },
    { title: '郎中', gender: 'M', avatar: 'langzhong', namefmt: s => s + '郎中' },
    { title: '道士', gender: 'M', avatar: 'daoshi', namefmt: s => s + '道长' },
    { title: '绣娘', gender: 'F', avatar: 'qiaozhen', fixedName: '巧针' },
    { title: '门房', gender: 'M', avatar: 'laohuang', namefmt: s => '老' + s },
    { title: '行商', gender: 'M', avatar: 'jinmancang', namefmt: s => s + '掌柜' },
    { title: '伶人', gender: 'F', avatar: 'liuyijn', namefmt: s => s + '娘子' },
    { title: '尼姑', gender: 'F', avatar: 'nigu', fixedName: '静安师太' },
    { title: '主母', gender: 'F', avatar: 'zhum', namefmt: s => s + '夫人' },
    { title: '小厮', gender: 'M', avatar: 'xiaoshitou', fixedName: '小石头' }
  ];
  // 降饱和传统色：朱砂、黛蓝、藤黄、青绿、紫棠、青瓷、赭石、檀木、墨灰
  const PEOPLE_COLORS = ['#c44b4b', '#4a6d8c', '#c4a23a', '#6b9e6d', '#8c5a7a', '#5a8a8a', '#c47a4a', '#8c7a6a', '#6a6a7a'];

  /* ---------------- 八案主题体系 ----------------
   * 每关从 8 个主题取一个：房间名、特色物件、地面、案件名随主题换。
   * 通用 8 件 + 主题 8 件 = 16 件候选；调色板照旧抽取。 */
  const COMMON_OBJECTS = [
    { key: 'chair', name: '太师椅', sittable: true },
    { key: 'table', name: '圆桌' },
    { key: 'lantern', name: '灯笼' },
    { key: 'screen', name: '屏风' },
    { key: 'vase', name: '花瓶' },
    { key: 'censer', name: '香炉' },
    { key: 'stoneSeat', name: '石凳', sittable: true },
    { key: 'well', name: '井' }
  ];
  const THEMES = [
    { id: 'zhaiyuan', name: '士绅宅院', caseName: '沈府夜宴案',
      indoor: ['正堂','东厢房','西厢房','书房','厨房','柴房','祠堂','账房','闺房','厅堂','库房','暖阁','茶室','净房'],
      outdoor: ['花园','回廊','马厩','角门','天井'],
      inFloors: ['tile-goldBrick', 'tile-oldPine', 'white', 'wood'], outFloors: ['tile-mossStone', 'grass', 'bluestone'],
      objects: [
        { key: 'desk', name: '书案', sittable: true }, { key: 'bed', name: '卧床' },
        { key: 'shelf', name: '博古架' }, { key: 'qin', name: '古琴' },
        { key: 'embroidery', name: '绣架' }, { key: 'bonsai', name: '盆景' },
        { key: 'weaponRack', name: '兵器架' }, { key: 'vat', name: '水缸' },
        // 新版正俯视物件（assets/objects/zhaiyuan/，区域定向摆放用；span:2 = 横向跨两格）
        { key: 'tiaoan', name: '条案', span: 2 }, { key: 'zaotai', name: '灶台', span: 2 },
        { key: 'chaidui', name: '柴堆', span: 2 }, { key: 'gongzhuo', name: '供桌', span: 2 },
        { key: 'zhangan', name: '账案', sittable: true, span: 2 }, { key: 'qiangui', name: '钱柜' },
        { key: 'zhuangtai', name: '妆台' }, { key: 'huojia', name: '货架', span: 2 },
        { key: 'xianglong', name: '箱笼' }, { key: 'huopen', name: '火盆' },
        { key: 'chalu', name: '茶炉' }, { key: 'jingtong', name: '净桶' },
        { key: 'guanxijia', name: '盥洗架' }, { key: 'macao', name: '马槽', span: 2 },
        { key: 'zawukuang', name: '杂物筐' },
        { key: 'couch', name: '锦榻', sittable: true }, { key: 'teaTable', name: '茶案', sittable: true },
        { key: 'stoneLion', name: '石狮' },
        { key: 'matBamboo', name: '竹席', sittable: true, mat: true, matZone: 'in' }],
      // 区域定向摆放（docs/士绅宅院-区域物件表.md）：每区 1-2 件，硬件放本屋空格、可坐件放本屋有人格
      roomObjects: {
        正堂: ['tiaoan', 'chair'], 东厢房: ['bed'], 西厢房: ['bed'],
        书房: ['desk', 'shelf'], 厨房: ['zaotai', 'vat'], 柴房: ['chaidui', 'zawukuang'],
        祠堂: ['gongzhuo', 'censer'], 账房: ['zhangan', 'qiangui'], 闺房: ['qin', 'zhuangtai'],
        厅堂: ['table', 'chair'], 库房: ['huojia', 'xianglong'], 暖阁: ['couch', 'huopen'],
        茶室: ['teaTable', 'chalu'], 净房: ['jingtong', 'guanxijia'],
        花园: ['bonsai', 'stoneSeat'], 回廊: ['lantern', 'stoneSeat'],
        马厩: ['macao'], 角门: ['stoneLion', 'weaponRack'], 天井: ['well', 'vat']
      } },
    { id: 'gucha', name: '深山古刹', caseName: '灵隐寺钟声案',
      indoor: ['大雄宝殿','藏经阁','禅房','钟楼','斋堂','方丈院','罗汉堂','香积厨','戒台'],
      outdoor: ['塔林','山门','碑廊'],
      inFloors: ['tile-ancientStone', 'tile-zenMat', 'bluestone', 'grey'], outFloors: ['tile-mossCobble', 'cobble', 'stone'],
      objects: [
        { key: 'futon', name: '蒲团', sittable: true, mat: true, matZone: 'in' }, { key: 'buddha', name: '佛像' },
        { key: 'bronzeBell', name: '铜钟' }, { key: 'sutraShelf', name: '经架' },
        { key: 'muyu', name: '木鱼' }, { key: 'stoneLamp', name: '石灯' },
        { key: 'prayerFlag', name: '经幡' }, { key: 'bronzeCenser', name: '铜炉' }] },
    { id: 'jiulou', name: '临江酒楼', caseName: '望江楼血案',
      indoor: ['大堂','雅间','后厨','酒窖','账台','储货间','掌柜房','茶厅'],
      outdoor: ['露台','码头','柴火院','天井'],
      inFloors: ['tile-redWood', 'tile-kitchenStone', 'wood', 'stone'], outFloors: ['tile-dockPlank', 'stone', 'wood'],
      objects: [
        { key: 'wineJar', name: '酒坛' }, { key: 'stove', name: '灶台' },
        { key: 'counter', name: '柜台' }, { key: 'fishBasket', name: '鱼篓' },
        { key: 'teaTable', name: '茶案', sittable: true }, { key: 'wineFlag', name: '酒旗' },
        { key: 'steamer', name: '蒸笼' }, { key: 'plaque', name: '匾额' },
        { key: 'matReed', name: '苇席', sittable: true, mat: true, matZone: 'in' }] },
    { id: 'xianya', name: '县衙公堂', caseName: '钱塘县衙冤案',
      indoor: ['公堂','签押房','牢房','仵作房','兵器库','班房','档案室','刑房','后衙'],
      outdoor: ['马号','门房','天牢'],
      inFloors: ['courtStone_tile', 'prisonStone_tile', 'grey', 'bluestone'], outFloors: ['gateDirt_tile_v3', 'dirt', 'stone'],
      objects: [
        { key: 'gongan', name: '公案', sittable: true }, { key: 'tortureRack', name: '刑架' },
        { key: 'caseShelf', name: '卷宗架' }, { key: 'jailBars', name: '牢栏' },
        { key: 'gavel', name: '惊堂木' }, { key: 'shuihuoStick', name: '水火棍' },
        { key: 'cangue', name: '枷锁' }, { key: 'stoneLion', name: '石狮' },
        { key: 'matFelt', name: '毡毯', sittable: true, mat: true, matZone: 'in' }] },
    { id: 'huafang', name: '运河画舫', caseName: '漕船灯影案',
      indoor: ['前舱','后舱','底舱','舵楼','货舱','伙舱','船长室','宴客厅','储水舱'],
      outdoor: ['甲板','望台','桨室'],
      inFloors: ['cabinWood_tile', 'bilgePlank_tile_v2', 'wood', 'tatami'], outFloors: ['deckWood_tile_v2', 'wood'],
      objects: [
        { key: 'rudder', name: '舵轮' }, { key: 'anchor', name: '铁锚' },
        { key: 'ropeCoil', name: '绳盘' }, { key: 'couch', name: '锦榻', sittable: true },
        { key: 'crate', name: '货箱' }, { key: 'pipa', name: '琵琶' },
        { key: 'compass', name: '罗盘' }, { key: 'lanternString', name: '灯笼串' },
        { key: 'matBrocade', name: '锦席', sittable: true, mat: true, matZone: 'in' }] },
    { id: 'yuanlin', name: '私家园林', caseName: '沈园曲径案',
      indoor: ['水榭','凉亭','茶室','长廊','书斋','琴室'],
      outdoor: ['荷池','假山区','月洞门','竹林','花圃','曲桥'],
      inFloors: ['bambooFloor_tile', 'watersideStone_tile', 'wood', 'white'], outFloors: ['pebblePath_tile_v2', 'grass', 'cobble', 'stone'],
      objects: [
        { key: 'rockery', name: '假山' }, { key: 'lotusVat', name: '莲缸' },
        { key: 'birdcage', name: '鸟笼' }, { key: 'fishingRod', name: '钓竿架' },
        { key: 'goTable', name: '棋桌', sittable: true }, { key: 'swing', name: '秋千', sittable: true },
        { key: 'stoneLamp', name: '石灯' }, { key: 'flowerRack', name: '花架' },
        { key: 'matMoss', name: '苔茵', sittable: true, mat: true, matZone: 'out' }] },
    { id: 'nongzhuang', name: '山村农庄', caseName: '龙井茶村命案',
      indoor: ['堂屋','灶房','粮仓','磨坊','蚕室','井台'],
      outdoor: ['牛棚','猪圈','柴院','菜窖','打谷场','药圃'],
      inFloors: ['strawFloor_tile', 'rammedEarth_tile', 'dirt', 'wood'], outFloors: ['threshGround_tile', 'grass', 'dirt', 'stone'],
      objects: [
        { key: 'stoneMill', name: '石磨' }, { key: 'haystack', name: '草垛', sittable: true },
        { key: 'plow', name: '犁' }, { key: 'chickenCoop', name: '鸡笼' },
        { key: 'loom', name: '织机' }, { key: 'grainBin', name: '粮桶' },
        { key: 'herbHoe', name: '药锄' }, { key: 'fieldWell', name: '田间井' },
        { key: 'matStraw', name: '草垫', sittable: true, mat: true, matZone: 'in' }] },
    { id: 'yizhan', name: '边关驿站', caseName: '潼关驿迷踪',
      indoor: ['驿丞房','客房','伙房','兵械库','信使房','储粮窖','文书房','大门'],
      outdoor: ['马厩','烽燧台','哨楼','车马院'],
      inFloors: ['rammedFloor_tile', 'roughStone_tile', 'dirt', 'grey'], outFloors: ['sandyStone_tile', 'dirt', 'cobble'],
      objects: [
        { key: 'beaconBasin', name: '烽火盆' }, { key: 'armorRack', name: '盔甲架' },
        { key: 'mapTable', name: '舆图桌', sittable: true }, { key: 'flagPole', name: '旗杆' },
        { key: 'saddleRack', name: '马鞍架' }, { key: 'trunk', name: '行囊箱' },
        { key: 'bowRack', name: '弓架' }, { key: 'postBell', name: '驿铃' },
        { key: 'matWool', name: '毛毡', sittable: true, mat: true, matZone: 'in' }] }
  ];

  const DIFFICULTY = {
    veryEasy: { size: 5, objectDensity: 0.10, negWeight: 0.2, label: '非常简单', rcW: 2.5,
      poolW: { with: 0.5, notWith: 0.5, aloneWith: 0.5, withGender: 0.5, exactRow: 0.25, exactCol: 0.25, sameDiag: 0.05, dir: 0.3 } },
    easy: { size: 6, objectDensity: 0.12, negWeight: 0.4, label: '简单', rcW: 2.0,
      poolW: { with: 0.6, exactRow: 0.3, exactCol: 0.3, sameDiag: 0.08, dir: 0.4 } },
    medium: { size: 7, objectDensity: 0.14, negWeight: 0.7, label: '中等', rcW: 1.5,
      poolW: { exactRow: 0.4, exactCol: 0.4, sameDiag: 0.1, dir: 0.5 } },
    hard: { size: 8, objectDensity: 0.16, negWeight: 1.0, label: '困难', rcW: 1.2,
      poolW: { sameDiag: 0.12, dir: 0.6 } },
    expert: { size: 9, objectDensity: 0.18, negWeight: 1.4, label: '专家', noHint: true, rowColCap: 1 },
    master: { size: 12, objectDensity: 0.18, negWeight: 1.6, label: '大师', noHint: true, rowColCap: 1 },
    // 大师-pro：同 12×12，但线索池剔除直给行列（row/col），深度验收 ≤4（构建器可递增放宽）
    masterPro: { size: 12, objectDensity: 0.18, negWeight: 1.6, label: '大师-pro', banRowCol: true },
    // 传奇 16×16：仅离线题库供应（实时生成不可行）；深度验收 d4~d8
    legend: { size: 16, objectDensity: 0.18, negWeight: 1.8, label: '传奇', noHint: true, rowColCap: 1 },
    // 主题矩阵补充尺寸档（仅用于主题×尺寸矩阵库生成；label 即尺寸，导航直接显示）
    s10: { size: 10, objectDensity: 0.18, negWeight: 1.5, label: '10×10', noHint: true, rowColCap: 1 },
    s11: { size: 11, objectDensity: 0.18, negWeight: 1.55, label: '11×11', noHint: true, rowColCap: 1 },
    s13: { size: 13, objectDensity: 0.18, negWeight: 1.65, label: '13×13', noHint: true, rowColCap: 1 },
    s14: { size: 14, objectDensity: 0.18, negWeight: 1.7, label: '14×14', noHint: true, rowColCap: 1 },
    s15: { size: 15, objectDensity: 0.18, negWeight: 1.75, label: '15×15', noHint: true, rowColCap: 1 }
  };

  /** 随机生长划分房间：平均约 5-6 格/房间，限制最大尺寸避免巨型房间 */
  function genRooms(size, rng) {
    const total = size * size;
    const target = Math.max(3, Math.min(12, Math.round(total / 6)));
    const maxSize = Math.ceil((total / target) * 1.8);
    const roomAt = new Int16Array(total).fill(-1);

    const seeds = rng.shuffle(Array.from({ length: total }, (_, i) => i)).slice(0, target);
    const fronts = seeds.map(s => [s]);
    seeds.forEach((s, r) => { roomAt[s] = r; });
    const sizes = seeds.map(() => 1);

    let unassigned = total - target;
    let guard = total * 20;
    while (unassigned > 0 && guard-- > 0) {
      const order = rng.shuffle(Array.from({ length: target }, (_, i) => i));
      for (const r of order) {
        if (unassigned <= 0) break;
        if (sizes[r] >= maxSize || fronts[r].length === 0) continue;
        const f = rng.pick(fronts[r]);
        const cand = M.neighbors4(f, size).filter(c => roomAt[c] === -1);
        if (cand.length === 0) {
          fronts[r].splice(fronts[r].indexOf(f), 1);
          continue;
        }
        const cell = rng.pick(cand);
        roomAt[cell] = r;
        fronts[r].push(cell);
        sizes[r]++;
        unassigned--;
      }
    }
    // 兜底：仍有未分配则并入相邻房间
    for (let i = 0; i < total; i++) {
      if (roomAt[i] === -1) {
        const nb = M.neighbors4(i, size).find(c => roomAt[c] !== -1);
        roomAt[i] = nb !== undefined ? roomAt[nb] : 0;
      }
    }
    // 去掉空房间（理论上不会发生）
    const used = Array.from(new Set(roomAt));
    const remap = new Map(used.map((r, i) => [r, i]));
    const rooms = used.map((old, i) => ({ id: i }));
    for (let i = 0; i < total; i++) roomAt[i] = remap.get(roomAt[i]);
    return { rooms, roomAt };
  }

  /** 为房间分配地板风格与名字（随主题）：约 1/3 为户外，其余为室内。
   *  房名按轮次取；名库用尽时第二轮起加方位前缀（东/西/南/北…）去重，不再原样重复。 */
  const ROOM_QUAL = ['', '东', '西', '南', '北', '前', '后', '内', '外'];
  function styleRooms(rooms, rng, theme) {
    const R = rooms.length;
    const outdoorCount = Math.min(theme.outdoor.length, R >= 4 ? Math.max(1, Math.round(R / 3)) : 0);
    const flags = rng.shuffle([
      ...Array(outdoorCount).fill(true),
      ...Array(R - outdoorCount).fill(false)
    ]);
    const inNames = rng.shuffle(theme.indoor.slice());
    const outNames = rng.shuffle(theme.outdoor.slice());
    const inFloors = rng.shuffle(theme.inFloors.slice());
    const outFloors = rng.shuffle(theme.outFloors.slice());
    let ii = 0, oi = 0;
    rooms.forEach((room, i) => {
      if (flags[i]) {
        room.floor = outFloors[oi % outFloors.length];
        room.name = ROOM_QUAL[Math.floor(oi / outNames.length) % ROOM_QUAL.length] + outNames[oi++ % outNames.length];
      } else {
        room.floor = inFloors[ii % inFloors.length];
        room.name = ROOM_QUAL[Math.floor(ii / inNames.length) % ROOM_QUAL.length] + inNames[ii++ % inNames.length];
      }
    });
  }

  /** 随机置换：第 p 个人在 (p, perm[p]) → 天然满足每行每列一人 */
  function genSolution(size, rng) {
    return rng.shuffle(Array.from({ length: size }, (_, i) => i))
      .map((col, row) => M.idx(row, col, size));
  }

  /** 选受害者：其房间恰有 2 人（受害者 + 凶手）。找不到则重试解答。 */
  function pickVictim(solution, roomAt, roomCount) {
    const counts = new Array(roomCount).fill(0);
    solution.forEach(cell => counts[roomAt[cell]]++);
    const candidates = [];
    solution.forEach((cell, p) => { if (counts[roomAt[cell]] === 2) candidates.push(p); });
    return candidates;
  }

  /** 枚举当前解答下所有为真的候选线索（含对角线/坐/性别/组合等新类型） */
  function genCluePool(board, solution, rng, negWeight, banRowCol, rcW, poolW) {
    const n = board.size;
    const pool = [];
    const people = board.people.length;
    const counts = M.roomCounts(solution, board);
    // 类型 -> 实例列表：物件线索按「类型」指代（存在语义，无需逐一定指消歧）
    const byKey = {};
    board.objects.forEach(o => { (byKey[o.key] = byKey[o.key] || []).push(o); });

    // poolW：难度级类型阻尼（低难度压关系型、留强锚点，保纯逻辑直落）
    const push = (clue, weight) => pool.push({ clue, weight: weight * ((poolW && poolW[clue.type]) || 1) });

    for (let p = 0; p < people; p++) {
      const cell = solution[p];
      if (!banRowCol) {   // 大师-pro 禁直给行列（玩家反馈太"送"）
        // rcW：低难度行列加权（v3 关系型线索权重上调后，小盘需要直给锚点才能纯逻辑直落）
        const w = rcW || 1;
        push({ type: 'row', p, r: M.row(cell, n) }, w);
        push({ type: 'col', p, c: M.col(cell, n) }, w);
      }
      // 「身处某区域」：Murdoku 主口味（区域=中强度锚点；v3 起从禁用改为重用）
      push({ type: 'room', p, room: board.roomAt[cell] }, 1.4);
      if (board.corners.has(cell)) push({ type: 'corner', p }, 1.0);
      else if (rng.chance(0.3 * negWeight)) push({ type: 'notCorner', p }, 0.3 * negWeight);
      // 「正坐在……上」：仅当该类坐具在全图 ≥2 个时生成（单一会变成直接报答案）；席垫不走坐具文案
      if (board.sittable[cell]) {
        const obj = board.objects.find(o => o.cell === cell);
        if (obj && !obj.mat && board.objects.filter(o2 => o2.key === obj.key).length >= 2) {
          push({ type: 'sitObj', p, objName: obj.name, objKey: obj.key }, 1.4);
        }
      }
      // 「在/不在 X（席垫）上」：席垫=平铺地板的可站物件，站上即锚点（Murdoku 地毯同款）
      const matObjs = board.objects.filter(o => o.mat);
      if (matObjs.length) {
        const on = matObjs.find(o => o.cell === cell);
        if (on) push({ type: 'onMat', p, objKey: on.key }, 1.6);
        else if (rng.chance(0.35 * negWeight)) push({ type: 'notMat', p, objKey: matObjs[0].key }, 0.35 * negWeight);
      }

      // 与物件的一元关系（类型指代、存在语义："挨着至少一只 X"）
      const besideKeys = [];
      Object.keys(byKey).forEach(k => {
        const inst = byKey[k];
        const beside = inst.some(o => o.cell !== cell && M.besideOK(cell, o.cell, board));
        if (beside) {
          besideKeys.push(k);
          push({ type: 'beside', p, objKey: k }, 1.3);
        } else if (inst.some(o => board.roomAt[o.cell] === board.roomAt[cell]) && rng.chance(0.3 * negWeight)) {
          // 「不在 X 旁边」：同屋有 X 但未挨着（参照 Murdoku 原版否定物件线索）
          push({ type: 'notBeside', p, objKey: k }, 0.3 * negWeight);
        }
        if (inst.some(o => M.row(o.cell, n) === M.row(cell, n))) push({ type: 'sameRowObj', p, objKey: k }, 0.3);
        if (inst.some(o => M.col(o.cell, n) === M.col(cell, n))) push({ type: 'sameColObj', p, objKey: k }, 0.3);
        // 对角线（物件）：|Δ行|==|Δ列|（v3 起压低权重，斜线线索只作点缀）
        if (inst.some(o => o.cell !== cell &&
          Math.abs(M.row(cell, n) - M.row(o.cell, n)) === Math.abs(M.col(cell, n) - M.col(o.cell, n)))) {
          push({ type: 'sameDiag', p, objKey: k }, 0.15);
        }
        // 不生成物件方位线索：多实例时"在某只 X 的东边"参照点不明，对玩家有歧义
        // （Murdoku 原版同样没有物件方位线索；方位仅以唯一的人名为参照）
      });
      // 组合：在 A 或 B 旁边（两个不同类型）
      if (besideKeys.length >= 2) {
        const two = rng.shuffle(besideKeys.slice()).slice(0, 2);
        push({ type: 'besideAnyOf', p, objKeys: two }, 0.85);
      }

      // 不在某房间（否定线索，低权重）
      const otherRooms = board.rooms.filter(r => r.id !== board.roomAt[cell]);
      if (otherRooms.length && rng.chance(0.5 * negWeight)) {
        push({ type: 'notRoom', p, room: rng.pick(otherRooms).id }, 0.3 * negWeight);
      }

      // 性别关系（同房）
      const roomP = board.roomAt[cell];
      const mateGenders = new Set();
      board.people.forEach(q => {
        if (q.id !== p && q.id !== board.victimId && board.roomAt[solution[q.id]] === roomP) {
          mateGenders.add(q.gender);
        }
      });
      mateGenders.forEach(g => {
        push({ type: 'withGender', p, gender: g }, 0.6);
        if (counts[roomP] === 2) push({ type: 'aloneWithGender', p, gender: g }, 0.85);
      });

      // 「另有一人在同屋的 X 旁边」（Murdoku 同款）：参照物限定同屋
      Object.keys(byKey).forEach(k => {
        const inRoom = byKey[k].filter(o => board.roomAt[o.cell] === roomP);
        if (!inRoom.length) return;
        if (board.people.some(q => q.id !== p &&
          inRoom.some(o => M.besideOK(solution[q.id], o.cell, board)))) {
          push({ type: 'otherBeside', p, objKey: k }, 0.75);
        }
      });
    }

    // 人与人的关系
    for (let p = 0; p < people; p++) {
      for (let q = 0; q < people; q++) {
        if (p === q) continue;
        const pc = solution[p], qc = solution[q];
        const sameRoom = board.roomAt[pc] === board.roomAt[qc];
        const dc = M.col(pc, n) - M.col(qc, n);
        const dr = M.row(pc, n) - M.row(qc, n);

        // 对角线（v3 起压低权重，只作点缀）
        if (Math.abs(dr) === Math.abs(dc) && dr !== 0) {
          push({ type: 'sameDiag', p, ref: { kind: 'person', id: q } }, 0.15);
        }
        // 正好左/右边一列
        if (dc === 1) push({ type: 'exactCol', p, ref: { kind: 'person', id: q }, side: 1 }, 0.7);
        if (dc === -1) push({ type: 'exactCol', p, ref: { kind: 'person', id: q }, side: -1 }, 0.7);
        // 正好上/下面一行
        if (dr === 1) push({ type: 'exactRow', p, ref: { kind: 'person', id: q }, side: 1 }, 0.7);
        if (dr === -1) push({ type: 'exactRow', p, ref: { kind: 'person', id: q }, side: -1 }, 0.7);

        // 8 方位（压低权重，避免方位线索泛滥；另有全关硬上限 1 条，见 HARD_ONCE）
        for (const dir of ['NW', 'NE', 'SW', 'SE']) {
          if (M.dirOK(pc, qc, dir, n)) { push({ type: 'dir', p, ref: { kind: 'person', id: q }, dir }, 0.22); break; }
        }
        for (const dir of ['N', 'S', 'E', 'W']) {
          if (M.dirOK(pc, qc, dir, n)) { push({ type: 'dir', p, ref: { kind: 'person', id: q }, dir }, 0.16); }
        }

        if (M.besideOK(pc, qc, board)) {
          push({ type: 'beside', p, ref: { kind: 'person', id: q } }, 1.25);
        } else if (rng.chance(0.3 * negWeight)) {
          push({ type: 'notBeside', p, ref: { kind: 'person', id: q } }, 0.25 * negWeight);
        }

        if (p < q) {
          // 同屋/不同屋/二人同屋一律不以被害者为参照：会直接暴露真凶（剧透）
          const involvesVictim = p === board.victimId || q === board.victimId;
          if (sameRoom) {
            if (!involvesVictim) push({ type: 'with', p, q }, 1.35);
            if (counts[board.roomAt[pc]] === 2 && !involvesVictim) {
              push({ type: 'aloneWith', p, q }, 0.9);
            }
          } else if (rng.chance(0.4 * negWeight) && !involvesVictim) {
            push({ type: 'notWith', p, q }, 0.45 * negWeight);
          }
        }
      }
    }

    // 独处 / 空房 / 男女同室
    for (let p = 0; p < people; p++) {
      if (counts[board.roomAt[solution[p]]] === 1) push({ type: 'alone', p }, 0.9);
    }
    board.rooms.forEach(r => {
      if (counts[r.id] === 0) {
        push({ type: 'emptyRoom', room: r.id }, 0.8);
      } else {
        let hasM = false, hasF = false;
        board.people.forEach(q => {
          if (board.roomAt[solution[q.id]] === r.id) {
            if (q.gender === 'M') hasM = true; else hasF = true;
          }
        });
        if (hasM && hasF) push({ type: 'roomMixGender', room: r.id }, 0.5);
      }
    });

    return pool;
  }

  /**
   * 生成谜题。返回 board 对象（含 clues/solution/victimId/murdererId）。
   * 失败（极少数）返回 null，调用方换种子重试。
   */
  function generate(seedStr, difficultyKey, themeId) {
    const diff = DIFFICULTY[difficultyKey] || DIFFICULTY.medium;
    const rng = global.MurdokuRNG.makeRng(seedStr);
    const size = diff.size;
    // 主题：显式指定（主题矩阵库）优先，否则按种子随机（天然平均分布）
    const theme = themeId
      ? THEMES.find(t => t.id === themeId) || THEMES[rng.int(THEMES.length)]
      : THEMES[rng.int(THEMES.length)];
    const OBJECT_TYPES = COMMON_OBJECTS.concat(theme.objects);

    for (let attempt = 0; attempt < 40; attempt++) {
      const attemptStart = Date.now();
      const { rooms, roomAt } = genRooms(size, rng);
      styleRooms(rooms, rng, theme);

      let solution = null, victimId = -1;
      for (let t = 0; t < 200; t++) {
        const cand = genSolution(size, rng);
        const victims = pickVictim(cand, roomAt, rooms.length);
        if (victims.length > 0) {
          solution = cand;
          victimId = rng.pick(victims);
          break;
        }
      }
      if (!solution) continue;

      // 人物：身份按种子抽取，同身份仅换姓（性别/头衔/头像随身份固定）
      const idents = rng.shuffle(IDENTITY_POOL.slice()).slice(0, size);
      // 简称取「姓」，同关姓氏须互异：抽取消耗照旧（逐人一次 rng.pick，保题库结构不变），
      // 撞姓时不追加抽取，按 SURNAMES 顺序确定性顺延到首个未用姓。
      const usedSurnames = new Set();
      const people = idents.map((idn, p) => {
        let surname = rng.pick(SURNAMES);
        if (usedSurnames.has(surname)) surname = SURNAMES.find(s => !usedSurnames.has(s));
        usedSurnames.add(surname);
        return {
          id: p,
          name: idn.fixedName || idn.namefmt(surname),
          short: idn.fixedName ? idn.fixedName[0] : surname,
          title: idn.title,
          gender: idn.gender,
          color: PEOPLE_COLORS[p % PEOPLE_COLORS.length],
          isVictim: p === victimId,
          avatar: global.MurdokuArt.makeAvatarSpec(rng, p, PEOPLE_COLORS[p % PEOPLE_COLORS.length], null, idn.gender),
          imgKey: idn.avatar
        };
      });

      // 物件：硬物件放非解答格；可坐物件放有人格子上
      const occupied = new Set(solution);
      const freeCells = [];
      for (let i = 0; i < size * size; i++) if (!occupied.has(i)) freeCells.push(i);
      const occupiable = new Array(size * size).fill(true);
      const sittable = new Array(size * size).fill(false);
      const mat = new Array(size * size).fill(false);
      const objects = [];

      if (theme.roomObjects) {
        // 区域定向摆放（主题带 roomObjects 表时）：每区 1-2 件，硬件放本屋空格、可坐件放本屋有人格
        const cellsOfRoom = rooms.map(() => []);
        for (let i = 0; i < size * size; i++) cellsOfRoom[roomAt[i]].push(i);
        rooms.forEach(room => {
          const keys = theme.roomObjects[room.name];
          if (!keys || !keys.length) return;
          const freeInRoom = cellsOfRoom[room.id].filter(c => !occupied.has(c));
          const occInRoom = cellsOfRoom[room.id].filter(c => occupied.has(c));
          keys.slice(0, 2).forEach(key => {
            const t = OBJECT_TYPES.find(x => x.key === key);
            if (!t) return;
            // 相邻同列对（跨格物件要求同屋同行）
            const pairOf = pool => {
              const set = new Set(pool);
              for (const c of pool) if (M.col(c, size) < size - 1 && set.has(c + 1)) return [c, c + 1];
              return null;
            };
            if (t.sittable) {
              if (!occInRoom.length) return;
              if (t.span === 2) {
                const pair = pairOf(occInRoom);
                if (!pair) return;
                objects.push({ id: objects.length, cell: pair[0], key: t.key, name: t.name, sittable: true, span: 2 });
                sittable[pair[0]] = true; sittable[pair[1]] = true;
              } else {
                const cell = rng.pick(occInRoom);
                objects.push({ id: objects.length, cell, key: t.key, name: t.name, sittable: true });
                sittable[cell] = true;
              }
            } else {
              if (t.span === 2) {
                const pair = pairOf(freeInRoom);
                if (!pair) return;
                freeInRoom.splice(freeInRoom.indexOf(pair[0]), 1);
                freeInRoom.splice(freeInRoom.indexOf(pair[1]), 1);
                objects.push({ id: objects.length, cell: pair[0], key: t.key, name: t.name, sittable: false, span: 2 });
                occupiable[pair[0]] = false; occupiable[pair[1]] = false;
              } else {
                if (!freeInRoom.length) return;
                const cell = rng.pick(freeInRoom);
                freeInRoom.splice(freeInRoom.indexOf(cell), 1);
                objects.push({ id: objects.length, cell, key: t.key, name: t.name, sittable: false });
                occupiable[cell] = false;
              }
            }
          });
        });
      } else {
      // 物件调色板：本关只出现少数几种类型；其他类型各 2 个，其余全归主导类型
      const hardTypes = OBJECT_TYPES.filter(t => !t.sittable);
      const paletteSize = size >= 9 ? 4 : size >= 7 ? 3 : 2;
      const palette = rng.shuffle(hardTypes.slice()).slice(0, paletteSize);
      const hardCount = Math.min(
        freeCells.length,
        Math.max(Math.round(size * size * diff.objectDensity), palette.length * 2)
      );
      const hardCells = rng.shuffle(freeCells.slice()).slice(0, hardCount);
      const typeSeq = [];
      palette.slice(1).forEach(t => { typeSeq.push(t, t); });
      while (typeSeq.length < hardCells.length) typeSeq.push(palette[0]);
      rng.shuffle(typeSeq);
      hardCells.forEach((cell, i) => {
        const t = typeSeq[i % typeSeq.length];
        objects.push({ id: objects.length, cell, key: t.key, name: t.name, sittable: false });
        occupiable[cell] = false;
      });

      // 2-3 个可坐物件落在有人格子上（“坐在椅子上”线索的锚点）
      const sitTypes = OBJECT_TYPES.filter(t => t.sittable && !t.mat);
      const sitCellCount = Math.min(size >= 8 ? 3 : size >= 6 ? 2 : 1, size);
      rng.shuffle(Array.from(occupied)).slice(0, sitCellCount).forEach(cell => {
        const t = rng.pick(sitTypes);
        objects.push({ id: objects.length, cell, key: t.key, name: t.name, sittable: true });
        sittable[cell] = true;
      });
      }   // theme.roomObjects 分支结束

      // 席垫：成块铺设的地板物件（「在/不在 X 上」线索锚点，对标 Murdoku 地毯）。
      // 规则：每块 ≥2 格连续（同一房间内、横或竖一条），杜绝单格孤垫；
      //       按主题 matZone 限定铺在室内/室外房间；一块压有人格（出"在席上"锚点），一块落空格。
      const matTypes = OBJECT_TYPES.filter(t => t.mat);
      if (matTypes.length) {
        const mt = matTypes[0];
        const zone = mt.matZone || 'in';
        // 占位集含跨格物件的右半格（span:2 的 objects 条目只记左格）
        const taken = new Set();
        objects.forEach(o => { taken.add(o.cell); if (o.span === 2) taken.add(o.cell + 1); });
        const inZone = room =>
          zone === 'in' ? theme.indoor.includes(room.name) : theme.outdoor.includes(room.name);
        // 同房间内的连续候选串（len 格，横/竖一条；cellOk 由各池决定）
        const runsOf = (pool, len, rooms) => {
          const set = new Set(pool), out = [];
          for (const c of pool) {
            // 横向：同行且同房连续
            let ok = len === 1;
            if (len > 1 && M.col(c, size) + len <= size) {
              ok = true;
              for (let k = 1; k < len; k++) ok = ok && set.has(c + k) && roomAt[c + k] === roomAt[c];
            } else ok = false;
            if (ok) out.push({ cells: Array.from({ length: len }, (_, k) => c + k), room: roomAt[c] });
            // 竖向：同列且同房连续
            ok = len === 1;
            if (len > 1 && M.row(c, size) + len <= size) {
              ok = true;
              for (let k = 1; k < len; k++) ok = ok && set.has(c + k * size) && roomAt[c + k * size] === roomAt[c];
            } else ok = false;
            if (ok) out.push({ cells: Array.from({ length: len }, (_, k) => c + k * size), room: roomAt[c] });
          }
          return out.filter(r => rooms.includes(r.room));
        };
        const zoneRooms = rooms.filter(inZone).map(r => r.id);
        // 有人格参与判定占位（席垫只压“可站”格：有人格或 occupiable 空格）
        const standPool = c => occupied.has(c) || (occupiable[c] && !taken.has(c));
        const allCells = Array.from({ length: size * size }, (_, i) => i).filter(standPool);
        const placedMat = [];
        // 选一条串：先看限定室内外，放宽到任意房间；且不与已铺席垫相邻（防两块跨墙连成一片）
        const touchOK = run => !run.cells.some(c => M.neighbors4(c, size).some(k => placedMat.includes(k)));
        const pickRun = (pool, len) => {
          let cands = runsOf(pool, len, zoneRooms).filter(touchOK);
          if (!cands.length) cands = runsOf(pool, len, rooms.map(r => r.id)).filter(touchOK);
          return cands.length ? rng.pick(cands) : null;
        };
        // 锚点块：len 格中至少 1 格有人（出"在席上"锚点）；装饰块：全空格（出"不在席上"空间）
        const blocks = size >= 8
          ? [['anchor', 2], ['free', 2]]
          : [['anchor', 2]];
        blocks.forEach(([kind, len]) => {
          let run = null;
          if (kind === 'anchor') {
            let cands = runsOf(allCells, len, zoneRooms).filter(r => r.cells.some(c => occupied.has(c))).filter(touchOK);
            if (!cands.length) cands = runsOf(allCells, len, rooms.map(r => r.id)).filter(r => r.cells.some(c => occupied.has(c))).filter(touchOK);
            if (cands.length) run = rng.pick(cands);
            else run = pickRun(allCells.filter(c => !occupied.has(c)), len);   // 凑不出有人串 → 全空格兜底
          } else {
            run = pickRun(allCells.filter(c => !occupied.has(c)), len);
          }
          if (!run) return;
          run.cells.forEach(cell => {
            objects.push({ id: objects.length, cell, key: mt.key, name: mt.name, sittable: true, mat: true });
            sittable[cell] = true;   // 机械与坐具一致：人可立其上
            mat[cell] = true;
            placedMat.push(cell);
          });
        });
      }

      const board = {
        size, rooms, roomAt, objects, occupiable, sittable, mat, people,
        solution, victimId, murdererId: -1, seed: seedStr, difficulty: difficultyKey,
        theme: { id: theme.id, name: theme.name, caseName: theme.caseName }
      };
      board.corners = M.computeCorners(board);
      board.murdererId = M.findMurderer(solution, board);
      if (board.murdererId < 0) continue;

      // ===== 线索筛选 =====
      // 规则：每人至多 2 条；同一人 2 条须不同类；每类线索全关最多 n 条（n = max(2, ⌈人数/4⌉)）
      const pool = genCluePool(board, solution, rng, diff.negWeight, diff.banRowCol, diff.rcW, diff.poolW);
      const weighted = pool.map(e => ({ e, k: -Math.log(Math.max(rng.next(), 1e-9)) / e.weight }));
      weighted.sort((a, b) => a.k - b.k);
      const ordered = weighted.map(w => w.e.clue);

      const GENERAL_TYPES = new Set(['emptyRoom', 'roomMixGender']);
      const generalPool = [];
      const byPerson = people.map(() => []);
      for (const clue of ordered) {
        if (GENERAL_TYPES.has(clue.type)) { generalPool.push(clue); continue; }
        if (clue.p === undefined) continue;
        byPerson[clue.p].push(clue);
      }

      const N_QUOTA = Math.ceil(people.length / 4) + 1; // 每类线索上限（公式见 docs/线索分类体系.md）
      const clues = [];
      const catCount = {};
      const typeCount = {};
      const queues = byPerson.map(list => list.slice()); // 每人一个候选队列（权重序）
      // 被害者不给任何位置提示：清空其候选队列，仅保留身份线索 victimFree（补线索阶段加入）
      queues[victimId] = [];
      const countOf = p => clues.filter(c => c.p === p).length;
      const personOrder = rng.shuffle(people.map(p => p.id));
      const personCatOK = (p, cand) =>
        countOf(p) === 0 || C.categoryOf(clues.find(c => c.p === p)) !== C.categoryOf(cand);
      const catOK = cand => (catCount[C.categoryOf(cand)] || 0) < N_QUOTA;
      // 类型多样性：同一 type 全关至多 1 条；四个类别尽量各至少 1 条（均为软约束，逐级放宽）
      const typeOK = cand => !typeCount[cand.type];
      // 文案全同、重复即"两条同样线索"的类型（转角/独处）：全关硬上限各 1 条，任何放宽阶段不突破
      // 文案全同、重复即"两条同样线索"的类型：全关硬上限各 1 条，任何放宽阶段不突破。
      // dir（方位）同此：玩家要求每关至多一条方位线索。
      const HARD_ONCE = new Set(['corner', 'notCorner', 'alone', 'dir']);
      const hardOnceOK = cand => !(HARD_ONCE.has(cand.type) && typeCount[cand.type]);
      // 高档直给行列限量（rowColCap：row+col 合计条数上限）
      const rowColOK = cand => diff.rowColCap == null || (cand.type !== 'row' && cand.type !== 'col') ||
        ((typeCount.row || 0) + (typeCount.col || 0)) < diff.rowColCap;
      // 行列锁定判定（锁行/锁列 = 该类线索把位置限定到唯一行/列）：
      // sameRowObj/sameColObj 是存在语义，仅当全部实例同行/列时才锁定
      const rowsOf = k => board.objects.filter(o => o.key === k).map(o => M.row(o.cell, size));
      const colsOf = k => board.objects.filter(o => o.key === k).map(o => M.col(o.cell, size));
      const lockRow = cl => {
        if (cl.type === 'row') return cl.r;
        if (cl.type === 'sameRowObj') {
          const rs = rowsOf(cl.objKey);
          return rs.length && rs.every(r => r === rs[0]) ? rs[0] : null;
        }
        return null;
      };
      const lockCol = cl => {
        if (cl.type === 'col') return cl.c;
        if (cl.type === 'sameColObj') {
          const cs = colsOf(cl.objKey);
          return cs.length && cs.every(cc => cc === cs[0]) ? cs[0] : null;
        }
        return null;
      };
      // 同一人不得同时持有锁行与锁列线索（行∩列=唯一格，等于直接报答案；各档通用）
      const pinRowColOK = (p, cand) => {
        const locksR = lockRow(cand) !== null, locksC = lockCol(cand) !== null;
        if (!locksR && !locksC) return true;
        return !clues.some(x => x.p === p &&
          ((locksR && lockCol(x) !== null) || (locksC && lockRow(x) !== null)));
      };
      const candidateOK = (p, cand) => hardOnceOK(cand) && rowColOK(cand) && pinRowColOK(p, cand);
      const catMissing = () => ['dir', 'rowcol', 'object', 'room'].filter(k => !catCount[k]);
      const addClue = cand => {
        clues.push(cand);
        const k = C.categoryOf(cand);
        catCount[k] = (catCount[k] || 0) + 1;
        typeCount[cand.type] = (typeCount[cand.type] || 0) + 1;
      };
      // 「与当事人位置无关」的等价：仅看参照物。命中则该候选对 p 而言与既有线索等价（废线索）。
      // sameRowObj/sameColObj 是存在语义（任一实例同参照行/列即成立），故：
      //   row=r ↔ sameRowObj 等价 ⟺ 该类型全部实例都在第 r 行（此时二者都锁定第 r 行）。
      //   两条相同 row/col 亦等价。
      const freeEquiv = (c, x) => {
        const cr = lockRow(c), xr = lockRow(x);
        if (cr !== null && cr === xr) return true;
        const cc = lockCol(c), xc = lockCol(x);
        if (cc !== null && cc === xc) return true;
        return false;
      };
      const isRedundant = (p, cand) =>
        clues.some(x => x.p === p && freeEquiv(cand, x));
      // 扫描队列（不消耗），返回可用候选下标或 -1
      const findCand = (p, opts) => {
        opts = opts || {};
        const q = queues[p];
        for (let i = 0; i < q.length; i++) {
          const c = q[i];
          if (!candidateOK(p, c)) continue;
          if (!personCatOK(p, c)) continue;
          if (!opts.ignoreType && !typeOK(c)) continue;
          if (!opts.ignoreQuota && !catOK(c)) continue;
          if (opts.preferCat && C.categoryOf(c) !== opts.preferCat) continue;
          if (isRedundant(p, c)) continue; // 与既有线索等价（如 row ↔ sameRowObj 同行）
          return i;
        }
        return -1;
      };
      const byFewest = () => personOrder.slice().sort((a, b) => countOf(a) - countOf(b));

      // 主循环：优先给线索少的人加，直到解唯一
      let ok = false;
      for (let step = 0; step < 400; step++) {
        const solved = Solver.solve(board, clues, { cap: 2, nodeCap: 15000 });
        if (!solved.aborted && solved.count === 1) { ok = true; break; }
        let target = -1, idx = -1;
        // ① 严格：同 type 不重复 + 类别配额内
        for (const p of byFewest()) {
          if (countOf(p) >= 2) continue;
          const i = findCand(p);
          if (i >= 0) { target = p; idx = i; break; }
        }
        // ② 补齐缺失类别（仍守同 type 不重复）
        if (target < 0) {
          for (const cat of catMissing()) {
            for (const p of byFewest()) {
              if (countOf(p) >= 2) continue;
              const i = findCand(p, { preferCat: cat, ignoreQuota: true });
              if (i >= 0) { target = p; idx = i; break; }
            }
            if (target >= 0) break;
          }
        }
        // ③ 放宽类别配额（仍守同 type 不重复与同人不同类）
        if (target < 0) {
          for (const p of byFewest()) {
            if (countOf(p) >= 2) continue;
            const i = findCand(p, { ignoreQuota: true });
            if (i >= 0) { target = p; idx = i; break; }
          }
        }
        // ④ 放宽"同 type 不重复"（仍守类别配额与同人不同类）
        if (target < 0) {
          for (const p of byFewest()) {
            if (countOf(p) >= 2) continue;
            const i = findCand(p, { ignoreType: true });
            if (i >= 0) { target = p; idx = i; break; }
          }
        }
        // ⑤ 放宽"同人不同类"（仍守 ≤2 与硬规则）：优先未使用 type 的候选
        if (target < 0) {
          for (const p of byFewest()) {
            if (countOf(p) >= 2) continue;
            const i = queues[p].findIndex(c => !typeCount[c.type] && candidateOK(p, c));
            if (i >= 0) { target = p; idx = i; break; }
          }
        }
        if (target < 0) {
          for (const p of byFewest()) {
            if (countOf(p) >= 2) continue;
            const i = queues[p].findIndex(c => candidateOK(p, c));
            if (i >= 0) { target = p; idx = i; break; }
          }
        }
        if (target < 0) {
          // 最后手段：允许第三人…（尽量与既有线索不同类，且不与既有线索等价）
          for (const p of byFewest()) {
            if (countOf(p) >= 3) continue;
            const i = queues[p].findIndex(c => {
              const k = C.categoryOf(c);
              return candidateOK(p, c) && !isRedundant(p, c) &&
                clues.filter(x => x.p === p).every(x => C.categoryOf(x) !== k);
            });
            if (i >= 0) { target = p; idx = i; break; }
          }
        }
        if (target < 0) break;
        addClue(queues[target].splice(idx, 1)[0]);
        if (Date.now() - attemptStart > 3000) break;
      }
      if (global.__genDebug) console.log(`  attempt: clues=${clues.length} ok=${ok} cats=${JSON.stringify(catCount)}`);
      if (!ok) { global.__failNoUnique = (global.__failNoUnique || 0) + 1; continue; }

      // 解已唯一：给仍无线索的人补一条最弱的真线索（真线索不影响唯一性）
      for (const p of personOrder) {
        if (countOf(p) === 0) {
          const cand = [...queues[p]].reverse().find(c => candidateOK(p, c)) || null;
          if (cand) addClue(cand);
          else if (p === victimId) addClue({ type: 'victimFree', p });
        }
      }

      // 反向消冗：每人至少保留一条（求解超时保守保留）。
      // 循环至整轮无可删：单趟顺序会漏掉级联冗余（后删的线索使先检查的线索变冗）。
      // 评估框架与最终交付一致（含前 2 条通用线索）：通用线索参与约束，缺它会把可删误判为保留。
      // 删除顺序：优先删「重复 type」的线索；删不掉时尝试「删重复 + 补不同类型」的替换，
      // 以保住全关类型多样性（同一 type 至多 1 条为软目标）。
      const generalTop = generalPool.slice(0, 2);
      // 深度感知消冗（移植自 moon 侧）：配置了深度目标的难度，删除/替换线索前须经深度
      // 预言机复核（拟人深度 ≤ 目标）。预言机由离线构建器注入（MurdokuGenerator.depthOracle，
      // (board, fullClues, target) => bool）；未注入即完全不启用，行为与旧版一致。
      const depthTarget = ((global.MurdokuGenerator || {}).depthTargets || {})[difficultyKey];
      const depthOK = (fullClues, b) => {
        const oracle = (global.MurdokuGenerator || {}).depthOracle;
        if (depthTarget == null || !oracle) return true;
        return oracle(b || board, fullClues, depthTarget);
      };
      const removalOrder = () => {
        const idx = clues.map((_, i) => i);
        return idx.sort((a, b) => (typeCount[clues[b].type] || 0) - (typeCount[clues[a].type] || 0));
      };
      const trySwap = i => {
        const base = clues.slice(0, i).concat(clues.slice(i + 1));
        // 遍历全池中未使用的新类型线索（不限本人），逐条试到能保住唯一解为止
        for (const cand of ordered) {
          if (cand.p === undefined || cand.p === victimId) continue;
          if (typeCount[cand.type] || clues.includes(cand)) continue;
          if (!candidateOK(cand.p, cand)) continue;
          if (countOf(cand.p) >= 2 || !personCatOK(cand.p, cand)) continue;
          const res = Solver.solve(board, generalTop.concat(base).concat([cand]), { cap: 2, nodeCap: 15000 });
          if (res.aborted || res.count !== 1 || res.solution.join() !== solution.join()) continue;
          if (!depthOK(generalTop.concat(base).concat([cand]))) continue;
          catCount[C.categoryOf(clues[i])]--;
          typeCount[clues[i].type]--;
          clues.splice(i, 1);
          addClue(cand);
          const qi = queues[cand.p].indexOf(cand);
          if (qi >= 0) queues[cand.p].splice(qi, 1);
          return true;
        }
        return false;
      };
      let removedAny = true;
      while (removedAny) {
        removedAny = false;
        for (const i of removalOrder()) {
          if (i >= clues.length) continue;
          if (Date.now() - attemptStart > 3000) break;
          if (countOf(clues[i].p) <= 1) continue;
          const trial = clues.slice(0, i).concat(clues.slice(i + 1));
          const res = Solver.solve(board, generalTop.concat(trial), { cap: 2, nodeCap: 15000 });
          if (!res.aborted && res.count === 1 && res.solution.join() === solution.join() &&
            depthOK(generalTop.concat(trial))) {
            const k = C.categoryOf(clues[i]);
            catCount[k]--;
            typeCount[clues[i].type]--;
            clues.splice(i, 1);
            removedAny = true;
          } else if ((typeCount[clues[i].type] || 0) > 1 && trySwap(i)) {
            removedAny = true;
          }
        }
        if (Date.now() - attemptStart > 3000) break;
      }

      // ===== 等价线索清理：同一人的两条线索若锁定完全相同的格子集，则其一为废线索。
      // 用 cellsOf（其他人按解答摆放时该线索对 p 的成立格集）做精确等价判断——
      // 覆盖位置相关等价（如 col=2 与 sameColObj(花瓶在列2,3) 对"在列2的人"等价）。
      // 优先直接删（仍唯一则删）；删不掉（小棋盘线索紧张）则替换为全池中不等价的新线索。
      {
        const cellsOfClue = (c, p) => {
          const cells = [];
          for (let x = 0; x < size * size; x++) {
            const sol = solution.slice();
            sol[p] = x;
            try { if (C.checkClue(c, sol, board)) cells.push(x); } catch (e) { /* 非法假设跳过 */ }
          }
          return cells;
        };
        const sameCells = (a, b) => a.length === b.length && a.every(v => b.includes(v));
        const uniqueWith = arr => {
          const res = Solver.solve(board, generalTop.concat(arr), { cap: 2, nodeCap: 15000 });
          return !res.aborted && res.count === 1 && res.solution.join() === solution.join() &&
            depthOK(generalTop.concat(arr));
        };
        let cleaned = true;
        while (cleaned) {
          cleaned = false;
          for (const p of people) {
            const mineIdx = clues.map((c, i) => (c.p === p.id ? i : -1)).filter(i => i >= 0);
            let hit = -1;
            for (let a = 0; a < mineIdx.length && hit < 0; a++) {
              for (let b = a + 1; b < mineIdx.length && hit < 0; b++) {
                const ca = cellsOfClue(clues[mineIdx[a]], p.id);
                const cb = cellsOfClue(clues[mineIdx[b]], p.id);
                if (sameCells(ca, cb)) hit = mineIdx[b]; // 后加的那条优先处理
              }
            }
            if (hit < 0) continue;
            const base = clues.slice(0, hit).concat(clues.slice(hit + 1));
            // ① 直接删：仍唯一则删
            if (countOf(p.id) > 1 && uniqueWith(base)) {
              catCount[C.categoryOf(clues[hit])]--;
              typeCount[clues[hit].type]--;
              clues.splice(hit, 1);
              cleaned = true;
              continue;
            }
            // ② 替换：从全池找一条与 p 既有线索不等价的新线索补上
            let swapped = false;
            for (const cand of ordered) {
              if (cand.p === undefined || cand.p === victimId) continue;
              if (clues.includes(cand)) continue;
              if (!candidateOK(cand.p, cand)) continue;
              if (countOf(cand.p) >= 2 || !personCatOK(cand.p, cand)) continue;
              // 与 cand.p 既有线索不等价
              const cc = cellsOfClue(cand, cand.p);
              const equiv = clues.some(x => x.p === cand.p && sameCells(cc, cellsOfClue(x, cand.p)));
              if (equiv) continue;
              if (uniqueWith(base.concat([cand]))) {
                catCount[C.categoryOf(clues[hit])]--;
                typeCount[clues[hit].type]--;
                clues.splice(hit, 1);
                addClue(cand);
                const qi = queues[cand.p].indexOf(cand);
                if (qi >= 0) queues[cand.p].splice(qi, 1);
                swapped = true;
                break;
              }
            }
            if (swapped) cleaned = true;
          }
        }
      }

      // ===== 物件类型覆盖：出现的类型都必须被线索提及 =====
      const collectObjRefs = c => {
        const keys = [];
        if (c.objKey) keys.push(c.objKey);
        if (c.objKeys) keys.push(...c.objKeys);
        return keys;
      };
      const mentioned = new Set();
      clues.forEach(c => {
        collectObjRefs(c).forEach(k => mentioned.add(k));
        // sitObj 不携带类型字段，但同样构成对该类型的提及
        if (c.type === 'sitObj') {
          const o = board.objects.find(o2 => o2.cell === solution[c.p]);
          if (o) mentioned.add(o.key);
        }
      });
      // 席垫是地板装饰件（类似 Murdoku 地毯）：不参与「未提及即移除」清理——
      // 板上常驻（每次生成必铺），被 onMat/notMat/旁边等线索自然提及时成为推理锚点
      const presentTypes = [...new Set(board.objects.filter(o => !o.mat).map(o => o.key))];
      const toRemove = new Set();
      // 评估线索 c 对 p 的成立格集合（其他人按解答摆放）：用于识别「等价冗余」
      const cellsOf = (c, p) => {
        const cells = [];
        for (let x = 0; x < size * size; x++) {
          const sol = solution.slice();
          sol[p] = x;
          try { if (C.checkClue(c, sol, board)) cells.push(x); } catch (e) { /* 非法假设跳过 */ }
        }
        return cells;
      };
      const isSubset = (a, b) => { const s = new Set(b); return a.every(x => s.has(x)); };
      // 候选与 p 的既有线索互为成立格子集（一方蕴含另一方）→ 对玩家呈现为等价条件，不补。
      // 一元线索（含全部物件线索）不参与等价判断：其成立格集与 p 实际位置无关，会误判。
      const redundantWith = (p, c) => {
        if (C.isUnary(c)) return false;
        const cc = cellsOf(c, p);
        return clues.filter(x => x.p === p && !C.isUnary(x)).some(x => {
          const xc = cellsOf(x, p);
          return isSubset(cc, xc) || isSubset(xc, cc);
        });
      };
      for (const t of presentTypes) {
        const ids = board.objects.filter(o => o.key === t).map(o => o.id);
        if (mentioned.has(t)) continue;
        // 为某人补一条提及该类型的真线索（≤2 且不同类、不与既有线索等价；加真线索不破坏唯一性）
        // 优先选「未使用 type」的候选，保住全关类型多样性
        let fixed = false;
        for (const p of byFewest()) {
          if (countOf(p) >= 2) continue;
          if (p === victimId) continue; // 被害者不给位置提示
          const fits = c =>
            !clues.includes(c) &&
            collectObjRefs(c).includes(t) &&
            candidateOK(p, c) &&   // sameRowObj/sameColObj 全实例同行列时也算锁行/列，纳入同人组合禁令
            personCatOK(p, c) &&
            // 等价过滤对已用 type 放宽：宁要一条不等价的新类型，也不要等价的重复类型
            (typeCount[c.type] || !redundantWith(p, c));
          let cand = byPerson[p].find(c => fits(c) && !typeCount[c.type]) || byPerson[p].find(fits);
          // 若此人正坐在该类型物件上，可直接补“正坐在…”
          if (!cand) {
            const satObj = board.objects.find(o => o.key === t && o.sittable && o.cell === solution[p] &&
              board.objects.filter(o2 => o2.key === t).length >= 2);
            if (satObj) {
              const s = { type: 'sitObj', p, objName: satObj.name, objKey: satObj.key };
              if (personCatOK(p, s)) cand = s;
            }
          }
          if (cand) {
            addClue(cand);
            // 立即并入 mentioned：后续类型的去重/删除判断要看到这条新线索（否则会误删刚提及类型的实例）
            collectObjRefs(cand).forEach(k => mentioned.add(k));
            if (cand.type === 'sitObj') {
              const o = board.objects.find(o2 => o2.cell === solution[cand.p]);
              if (o) mentioned.add(o.key);
            }
            fixed = true; break;
          }
        }
        if (!fixed) ids.forEach(id => toRemove.add(id));
      }
      if (toRemove.size) {
        // 移除未被提及的类型实例（线索按类型指代，无需重映射索引）
        board.objects.filter(o => toRemove.has(o.id)).forEach(o => {
          board.occupiable[o.cell] = true;
          board.sittable[o.cell] = false;
          board.mat[o.cell] = false;
          if (o.span === 2) { board.occupiable[o.cell + 1] = true; board.sittable[o.cell + 1] = false; board.mat[o.cell + 1] = false; }
        });
        board.objects = board.objects.filter(o => !toRemove.has(o.id));
      }

      // 覆盖补线索后再消一轮冗余：补线索可能使既有线索变冗。
      // 守卫：每人至少留一条；且不得删掉某物件类型的唯一提及（保持「出现的类型都被提及」）。
      {
        const typesOf = c => {
          const keys = collectObjRefs(c);
          if (c.type === 'sitObj') {
            const o = board.objects.find(o2 => o2.cell === solution[c.p]);
            if (o) keys.push(o.key);
          }
          return keys;
        };
        let removed2 = true;
        while (removed2) {
          removed2 = false;
          for (const i of removalOrder()) {
            if (i >= clues.length) continue;
            if (Date.now() - attemptStart > 3000) break;
            if (countOf(clues[i].p) <= 1) continue;
            const trial = clues.slice(0, i).concat(clues.slice(i + 1));
            const myTypes = typesOf(clues[i]);
            if (myTypes.length) {
              const rest = new Set();
              clues.forEach((c, j) => { if (j !== i) typesOf(c).forEach(t => rest.add(t)); });
              const exclusive = myTypes.filter(t => !rest.has(t));
              if (exclusive.length) {
                // 独占提及：先试「删线索 + 删独占类型实例」的组合删除（解决等价冗余被覆盖守卫挡住的情况）
                const boardTrial = { ...board, objects: board.objects.filter(o => !exclusive.includes(o.key)) };
                const res2 = Solver.solve(boardTrial, generalTop.concat(trial), { cap: 2, nodeCap: 15000 });
                if (!res2.aborted && res2.count === 1 && res2.solution.join() === solution.join() &&
                  depthOK(generalTop.concat(trial), boardTrial)) {
                  board.objects.forEach(o => {
                    if (exclusive.includes(o.key)) {
                      board.occupiable[o.cell] = true; board.sittable[o.cell] = false;
                      if (o.span === 2) { board.occupiable[o.cell + 1] = true; board.sittable[o.cell + 1] = false; }
                    }
                  });
                  board.objects = boardTrial.objects;
                  const k = C.categoryOf(clues[i]);
                  catCount[k]--;
                  typeCount[clues[i].type]--;
                  clues.splice(i, 1);
                  removed2 = true;
                }
                continue;
              }
            }
            const res = Solver.solve(board, generalTop.concat(trial), { cap: 2, nodeCap: 15000 });
            if (!res.aborted && res.count === 1 && res.solution.join() === solution.join() &&
              depthOK(generalTop.concat(trial))) {
              const k = C.categoryOf(clues[i]);
              catCount[k]--;
              typeCount[clues[i].type]--;
              clues.splice(i, 1);
              removed2 = true;
            }
          }
          if (Date.now() - attemptStart > 3000) break;
        }
      }

      // 通用线索取前 2 条
      const finalClues = [...generalPool.slice(0, 2), ...clues];

      // 最终校验：唯一解且等于生成解（给足节点预算；超时则换题板）
      const final = Solver.solve(board, finalClues, { cap: 2, nodeCap: 500000 });
      if (final.aborted || final.count !== 1 || final.solution.join() !== solution.join()) {
        global.__failFinal = (global.__failFinal || 0) + 1;
        continue;
      }
      // 深度断言：配置了深度目标时，消冗后仍超深的题板整体弃用（换种子重试）
      if (!depthOK(finalClues)) {
        global.__failDepth = (global.__failDepth || 0) + 1;
        continue;
      }

      board.clues = finalClues.map(clue => ({ ...clue, text: C.clueText(clue, board) }));
      delete board._roomCells;
      return board;
    }
    return null;
  }

  global.MurdokuGenerator = { generate, DIFFICULTY, THEMES, COMMON_OBJECTS, IDENTITY_POOL, SURNAMES, depthTargets: {}, depthOracle: null };
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/storage.js", function (require, module, exports) {
/* 本地持久化：进度与设置。三端自适应：
 * 微信小程序 → wx.getStorageSync / wx.setStorageSync
 * 浏览器     → localStorage
 * Node 测试  → 读写异常被捕获，静默退化为默认值 */
(function (global) {
  'use strict';

  const KEY = 'moan:v1';

  const store = (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function')
    ? {
        getItem(k) {
          const v = wx.getStorageSync(k);
          return v === '' || v == null ? null : v; // wx 未命中返回空串，对齐 localStorage 的 null
        },
        setItem(k, v) { wx.setStorageSync(k, v); }
      }
    : {
        getItem(k) { return localStorage.getItem(k); },
        setItem(k, v) { localStorage.setItem(k, v); }
      };

  function load() {
    try {
      return JSON.parse(store.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function save(data) {
    try { store.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式等 */ }
  }

  function get() {
    const d = load();
    d.settings = d.settings || { sound: true, autoX: true };
    d.progress = d.progress || {};
    return d;
  }

  function saveProgress(puzzleKey, progress) {
    const d = get();
    d.progress[puzzleKey] = progress;
    save(d);
  }

  function getProgress(puzzleKey) {
    return get().progress[puzzleKey] || null;
  }

  function saveSettings(settings) {
    const d = get();
    d.settings = settings;
    save(d);
  }

  function getSettings() {
    return get().settings;
  }

  global.MurdokuStorage = { getProgress, saveProgress, getSettings, saveSettings };
})(typeof window !== 'undefined' ? window : globalThis);

});
__def("src/logic/index.js", function (require, module, exports) {
/* 逻辑层加载器：按 moan/index.html 的 <script> 顺序 require，文件零修改。
 * 这些文件是 UMD 式写法，运行时无 window，会挂到 globalThis 上。 */
require('src/logic/rng.js');
require('src/logic/puzzle.js');
require('src/logic/clues.js');
require('src/logic/solver.js');
require('src/logic/sprites.js');
require('src/logic/generator.js');
require('src/logic/storage.js');

module.exports = {
  RNG: globalThis.MurdokuRNG,
  Model: globalThis.MurdokuModel,
  Clues: globalThis.MurdokuClues,
  Solver: globalThis.MurdokuSolver,
  Art: globalThis.MurdokuArt,
  Generator: globalThis.MurdokuGenerator,
  Storage: globalThis.MurdokuStorage
};

});
__def("src/ui/scroll.js", function (require, module, exports) {
/* 拖动滚动（跟随手指 + 边界钳制；惯性滚动留待 P4' 打磨）。 */
function createScroll() {
  let offset = 0, max = 0, startY = 0, startOffset = 0, active = false;
  return {
    get offset() { return offset; },
    /* 每次渲染时调用：内容/视口高度变化后钳制 offset */
    setRange(contentH, viewH) {
      max = Math.max(0, contentH - viewH);
      if (offset > max) offset = max;
    },
    onStart(y) {
      startY = y;
      startOffset = offset;
      active = true;
    },
    onMove(y) {
      if (!active) return;
      offset = Math.min(max, Math.max(0, startOffset + (startY - y)));
    },
    onEnd() { active = false; },
    reset() { offset = 0; active = false; }
  };
}

module.exports = { createScroll };

});
__def("src/ui/svgmini.js", function (require, module, exports) {
/* SVG 子集解释器：把 sprites.js 的 SVG 字符串绘制到 canvas（小游戏无 <image>/DOM）。
 * 覆盖 sprites.js 实际用到的全部特性：
 *   元素：rect(rx) / circle / ellipse / line / path
 *   path 命令：M L H V Q C Z + 小写相对 m l h v q c z
 *   属性：fill（含 "none"）/ stroke / stroke-width / stroke-linecap
 * 坐标系：按 viewBox 缩放到目标矩形。 */

function parseAttrs(s) {
  const attrs = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = m[2];
  return attrs;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function ellipsePath(ctx, cx, cy, rx, ry) {
  if (ctx.ellipse) {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  } else {
    // 老运行时兜底：贝塞尔近似
    const k = 0.5522847498307936;
    ctx.moveTo(cx + rx, cy);
    ctx.bezierCurveTo(cx + rx, cy - ry * k, cx + rx * k, cy - ry, cx, cy - ry);
    ctx.bezierCurveTo(cx - rx * k, cy - ry, cx - rx, cy - ry * k, cx - rx, cy);
    ctx.bezierCurveTo(cx - rx, cy + ry * k, cx - rx * k, cy + ry, cx, cy + ry);
    ctx.bezierCurveTo(cx + rx * k, cy + ry, cx + rx, cy + ry * k, cx + rx, cy);
    ctx.closePath();
  }
}

function drawPathData(ctx, d) {
  const tokens = d.match(/[MLHVQCZmlhvqcz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const num = () => Number(tokens[i++]);
  ctx.beginPath();
  while (i < tokens.length) {
    const tk = tokens[i];
    if (/[A-Za-z]/.test(tk)) { cmd = tk; i++; }
    const rel = cmd >= 'a' && cmd <= 'z';
    const C = cmd.toUpperCase();
    if (C === 'M') {
      const nx = num(), ny = num();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny;
      ctx.moveTo(x, y); sx = x; sy = y;
      cmd = rel ? 'l' : 'L'; // 后续隐式为 LineTo
    } else if (C === 'L') {
      const nx = num(), ny = num();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny;
      ctx.lineTo(x, y);
    } else if (C === 'H') {
      const nx = num();
      x = rel ? x + nx : nx;
      ctx.lineTo(x, y);
    } else if (C === 'V') {
      const ny = num();
      y = rel ? y + ny : ny;
      ctx.lineTo(x, y);
    } else if (C === 'Q') {
      let x1 = num(), y1 = num(), x2 = num(), y2 = num();
      if (rel) { x1 += x; y1 += y; x2 += x; y2 += y; }
      ctx.quadraticCurveTo(x1, y1, x2, y2);
      x = x2; y = y2;
    } else if (C === 'C') {
      let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
      if (rel) { x1 += x; y1 += y; x2 += x; y2 += y; x3 += x; y3 += y; }
      ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
      x = x3; y = y3;
    } else if (C === 'Z') {
      ctx.closePath();
      x = sx; y = sy;
      cmd = ''; // 防止参数残留被重复处理
    } else {
      break; // 未知命令，中止该 path（防御）
    }
  }
}

function drawElement(ctx, tag, attrs) {
  const fill = attrs.fill === undefined ? '#000' : attrs.fill;
  const doFill = fill !== 'none';
  const doStroke = !!attrs.stroke && attrs.stroke !== 'none';
  ctx.save();
  if (attrs['stroke-linecap']) ctx.lineCap = attrs['stroke-linecap'];
  if (doStroke) {
    ctx.strokeStyle = attrs.stroke;
    ctx.lineWidth = Number(attrs['stroke-width'] || 1);
  }

  if (tag === 'rect') {
    const x = Number(attrs.x) || 0, y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 0, h = Number(attrs.height) || 0;
    const rx = Number(attrs.rx) || 0;
    ctx.beginPath();
    if (rx) roundRectPath(ctx, x, y, w, h, rx); else ctx.rect(x, y, w, h);
  } else if (tag === 'circle') {
    ctx.beginPath();
    ctx.arc(Number(attrs.cx) || 0, Number(attrs.cy) || 0, Number(attrs.r) || 0, 0, Math.PI * 2);
  } else if (tag === 'ellipse') {
    ctx.beginPath();
    ellipsePath(ctx, Number(attrs.cx) || 0, Number(attrs.cy) || 0,
      Number(attrs.rx) || 0, Number(attrs.ry) || 0);
  } else if (tag === 'line') {
    ctx.beginPath();
    ctx.moveTo(Number(attrs.x1) || 0, Number(attrs.y1) || 0);
    ctx.lineTo(Number(attrs.x2) || 0, Number(attrs.y2) || 0);
    if (doStroke) ctx.stroke();
    ctx.restore();
    return; // line 不填充
  } else if (tag === 'path') {
    drawPathData(ctx, attrs.d || '');
  } else {
    ctx.restore();
    return;
  }

  if (doFill) { ctx.fillStyle = fill; ctx.fill(); }
  if (doStroke) ctx.stroke();
  ctx.restore();
}

/* 把 svg 字符串按 viewBox 缩放绘制到 (x, y, w, h)。 */
function drawSVG(ctx, svg, x, y, w, h) {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  const p = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 64, 64];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / p[2], h / p[3]);
  ctx.translate(-p[0], -p[1]);
  const re = /<(rect|circle|ellipse|line|path)\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(svg))) drawElement(ctx, m[1], parseAttrs(m[2]));
  ctx.restore();
}

module.exports = { drawSVG };

});
__def("src/ui/theme.js", function (require, module, exports) {
/* 主题配色（canvas 无 CSS 变量， palettes 手工维护，对应 Web 版 dataset.theme）。
 * v4.0「水墨公堂」设计系统：松烟墨/宣纸/朱砂/黛青/金箔 五色纪律（docs/design/公堂卷轴-桌面视觉稿-v5.png）。 */
const INK = '#1b1710';      // 松烟墨（文字/墙线）
const XUAN = '#f2ecdd';     // 宣纸（卡面）
const XUAN_D = '#e7dcc2';   // 宣纸暗一档（通用线索/分区底）
const CINNABAR = '#b13a30'; // 朱砂（强调/印章/选中）
const INDIGO = '#33465a';   // 黛青（次要信息/性别♂）
const GOLD = '#c2a24a';     // 金箔（描边/坐标/点缀）

const PALETTES = {
  dark: {
    bg: '#16130e', card: '#221c12', cardEdge: '#4a3f28',
    fg: XUAN, muted: '#9a8f74', faint: '#6b6250',
    accent: CINNABAR, gold: GOLD, ok: '#7ec97e', dim: 'rgba(0,0,0,0.62)',
    ink: INK, xuan: XUAN, xuanD: XUAN_D, indigo: INDIGO
  },
  light: {
    bg: '#f2eee2', card: '#faf5e8', cardEdge: '#ddd5c0',
    fg: '#2a2620', muted: '#8a8064', faint: '#a39b7e',
    accent: CINNABAR, gold: '#9a7526', ok: '#3e8e4e', dim: 'rgba(60,55,40,0.45)',
    ink: INK, xuan: XUAN, xuanD: XUAN_D, indigo: INDIGO
  }
};

/* 字体栈（P1 先走系统字体：Windows KaiTi / macOS STKaiti / 宋体兜底；
 * webfont 子集内联（马善政/落霞文楷 + Noto Serif SC）留作后续增强项——Android 无楷体时会回落默认黑体 */
const FONTS = {
  kai: '"KaiTi","STKaiti","Kaiti SC","楷体",serif',
  song: '"Noto Serif SC","Source Han Serif SC","SimSun","宋体",serif'
};

let current = 'dark';

function setTheme(name) { if (PALETTES[name]) current = name; }
function theme() { return PALETTES[current]; }
function themeName() { return current; }
function toggleTheme() { current = current === 'light' ? 'dark' : 'light'; return current; }

module.exports = { setTheme, theme, themeName, toggleTheme, FONTS, INK, XUAN, XUAN_D, CINNABAR, INDIGO, GOLD };

});
__def("src/ui/widgets.js", function (require, module, exports) {
/* 通用绘制小部件与工具函数。 */
const { FONTS } = require('src/ui/theme.js');

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function hit(rect, x, y) {
  return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* 印章 logo（与 Web 版 main.js 的 SVG 同款）：红底圆角 + 内框 + 墨案二字（楷体） */
function drawSeal(ctx, cx, y, S) {
  ctx.fillStyle = '#b13a30';
  roundRect(ctx, cx - S / 2, y, S, S, S * 0.18);
  ctx.fill();
  ctx.strokeStyle = '#f2ecdd';
  ctx.lineWidth = Math.max(2, S * 0.025);
  roundRect(ctx, cx - S / 2 + S * 0.067, y + S * 0.067, S * 0.866, S * 0.866, S * 0.13);
  ctx.stroke();
  ctx.fillStyle = '#f2ecdd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(S * 0.36)}px ${FONTS.kai}`;
  ctx.fillText('墨', cx, y + S * 0.30);
  ctx.fillText('案', cx, y + S * 0.72);
}

/* 朱砂印（通用）：任意文字白文印（1 字居中 / 2 字上下 / ≥3 字竖排），糙边印泥质感 */
function drawCinnabarSeal(ctx, cx, cy, S, text, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot || 0);
  ctx.fillStyle = '#b13a30';
  roundRect(ctx, -S / 2, -S / 2, S, S, S * 0.14);
  ctx.fill();
  ctx.fillStyle = '#f2ecdd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = String(text).split('');
  if (chars.length === 1) {
    ctx.font = `${Math.round(S * 0.52)}px ${FONTS.kai}`;
    ctx.fillText(chars[0], 0, S * 0.02);
  } else if (chars.length === 2) {
    ctx.font = `${Math.round(S * 0.38)}px ${FONTS.kai}`;
    ctx.fillText(chars[0], 0, -S * 0.20);
    ctx.fillText(chars[1], 0, S * 0.22);
  } else {
    ctx.font = `${Math.round(S * 0.26)}px ${FONTS.kai}`;
    const step = S * 0.27;
    const y0 = -step * (chars.length - 1) / 2;
    chars.forEach((ch, i) => ctx.fillText(ch, 0, y0 + i * step));
  }
  ctx.restore();
}

/* 朱砂印锁定标识（drawSeal 同款红底白文）：1 字居中，3 字竖排 */
function drawLockSeal(ctx, cx, cy, S, text) {
  ctx.fillStyle = '#b13a30';
  roundRect(ctx, cx - S / 2, cy - S / 2, S, S, S * 0.16);
  ctx.fill();
  ctx.strokeStyle = '#f2ecdd';
  ctx.lineWidth = Math.max(1.5, S * 0.03);
  roundRect(ctx, cx - S / 2 + S * 0.08, cy - S / 2 + S * 0.08, S * 0.84, S * 0.84, S * 0.12);
  ctx.stroke();
  ctx.fillStyle = '#f2ecdd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = String(text).split('');
  if (chars.length === 1) {
    ctx.font = `${Math.round(S * 0.52)}px ${FONTS.kai}`;
    ctx.fillText(chars[0], cx, cy + S * 0.02);
  } else {
    ctx.font = `${Math.round(S * 0.26)}px ${FONTS.kai}`;
    const step = S * 0.27;
    const y0 = cy - step * (chars.length - 1) / 2;
    chars.forEach((ch, i) => ctx.fillText(ch, cx, y0 + i * step));
  }
}

/* 按宽度断行（中文逐字测量）。返回行数组。 */
function wrapText(ctx, text, maxW) {
  const lines = [];
  String(text).split('\n').forEach(para => {
    let line = '';
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  });
  return lines;
}

/* ---------- 宣纸纹理（程序生成一次成离屏 tile，平铺用，零逐帧开销） ---------- */
let _paperTile = null;
function paperTile() {
  if (_paperTile) return _paperTile;
  const S = 96;
  const cv = (typeof wx !== 'undefined' && wx.createOffscreenCanvas)
    ? wx.createOffscreenCanvas({ type: '2d', width: S, height: S })
    : null;
  if (!cv) return null;
  const c = cv.getContext('2d');
  for (let i = 0; i < 110; i++) {
    c.fillStyle = `rgba(120,100,60,${0.03 + Math.random() * 0.06})`;
    c.fillRect(Math.random() * S, Math.random() * S, 1.2, 1.2);
  }
  for (let i = 0; i < 4; i++) {
    const px = Math.random() * S, py = Math.random() * S, r = 18 + Math.random() * 30;
    const g = c.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(180,160,110,0.06)');
    g.addColorStop(1, 'rgba(180,160,110,0)');
    c.fillStyle = g;
    c.fillRect(px - r, py - r, r * 2, r * 2);
  }
  _paperTile = cv;
  return _paperTile;
}
/* 宣纸面填充：底色 + 纤维纹平铺（r 圆角） */
function fillPaper(ctx, x, y, w, h, r, base) {
  ctx.fillStyle = base || '#f2ecdd';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  const tile = paperTile();
  if (!tile) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  for (let ty = y; ty < y + h; ty += 96) {
    for (let tx = x; tx < x + w; tx += 96) ctx.drawImage(tile, tx, ty);
  }
  ctx.restore();
}

/* ---------- 文房工具图标（去 emoji：毛笔/朱叉/砚台/卷轴/回锋） ---------- */
function drawToolIcon(ctx, key, cx, cy, s, color) {
  const ink = color || '#1b1710';
  ctx.save();
  ctx.translate(cx, cy);
  switch (key) {
    case 'note': {   // 毛笔（批注）
      ctx.rotate(-0.7);
      ctx.fillStyle = '#8a6a3e';
      roundRect(ctx, -s * 0.09, -s * 0.5, s * 0.18, s * 0.6, s * 0.08);
      ctx.fill();
      ctx.fillStyle = '#d8cba8';
      roundRect(ctx, -s * 0.09, s * 0.1, s * 0.18, s * 0.14, s * 0.05);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-s * 0.09, s * 0.24);
      ctx.quadraticCurveTo(0, s * 0.58, s * 0.09, s * 0.24);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'x': {      // 朱笔排除
      ctx.strokeStyle = '#b13a30';
      ctx.lineWidth = s * 0.16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.3); ctx.lineTo(s * 0.3, s * 0.3);
      ctx.moveTo(s * 0.3, -s * 0.3); ctx.lineTo(-s * 0.3, s * 0.3);
      ctx.stroke();
      break;
    }
    case 'erase': {  // 砚台（擦除）
      ctx.fillStyle = '#4a4234';
      ctx.beginPath(); ctx.ellipse(0, s * 0.1, s * 0.42, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.ellipse(0, s * 0.04, s * 0.3, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(90,110,140,0.55)';
      ctx.beginPath(); ctx.ellipse(-s * 0.08, s * 0.02, s * 0.14, s * 0.08, -0.25, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'hint': {   // 卷轴（提点）
      ctx.fillStyle = '#e7dcc2';
      roundRect(ctx, -s * 0.32, -s * 0.4, s * 0.64, s * 0.8, s * 0.08);
      ctx.fill();
      ctx.strokeStyle = 'rgba(42,36,26,0.5)';
      ctx.lineWidth = Math.max(1, s * 0.03);
      roundRect(ctx, -s * 0.32, -s * 0.4, s * 0.64, s * 0.8, s * 0.08);
      ctx.stroke();
      ctx.strokeStyle = '#b13a30';
      ctx.lineWidth = s * 0.05;
      [-0.18, 0, 0.18].forEach(dy => {
        ctx.beginPath(); ctx.moveTo(-s * 0.2, s * dy); ctx.lineTo(s * 0.2, s * dy); ctx.stroke();
      });
      break;
    }
    case 'undo': {   // 回锋（撤回）
      ctx.strokeStyle = ink;
      ctx.lineWidth = s * 0.13;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, s * 0.05, s * 0.3, -0.2, Math.PI * 1.25);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, -s * 0.28);
      ctx.lineTo(-s * 0.06, -s * 0.34);
      ctx.lineTo(-s * 0.16, -s * 0.06);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'autoX': {  // 自（自动排除开关：小印 + 朱叉）
      ctx.strokeStyle = ink;
      ctx.lineWidth = s * 0.07;
      roundRect(ctx, -s * 0.36, -s * 0.36, s * 0.72, s * 0.72, s * 0.14);
      ctx.stroke();
      ctx.strokeStyle = '#b13a30';
      ctx.lineWidth = s * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, -s * 0.18); ctx.lineTo(s * 0.18, s * 0.18);
      ctx.moveTo(s * 0.18, -s * 0.18); ctx.lineTo(-s * 0.18, s * 0.18);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/* 按钮绘制（实心/幽灵；默认楷体） */
function drawButton(ctx, t, rect, label, opts) {
  opts = opts || {};
  ctx.fillStyle = opts.ghost ? 'rgba(0,0,0,0)' : (opts.bg || t.accent);
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, opts.r !== undefined ? opts.r : 10);
  ctx.fill();
  if (opts.ghost) {
    ctx.strokeStyle = t.cardEdge;
    ctx.lineWidth = 1;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, opts.r !== undefined ? opts.r : 10);
    ctx.stroke();
  }
  ctx.fillStyle = opts.ghost ? t.muted : (opts.fg || '#f2ecdd');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = opts.font || `16px ${FONTS.kai}`;
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

/* 主题切换图标（矢量绘制；emoji 在部分真机上渲染为单色/豆腐块） */
function drawThemeIcon(ctx, x, y, r, isLight, fg, bg) {
  ctx.fillStyle = fg;
  if (isLight) {
    // 太阳：实心圆 + 八芒
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68);
      ctx.lineTo(x + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98);
      ctx.stroke();
    }
  } else {
    // 弯月：整圆减偏移圆
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x + r * 0.34, y - r * 0.18, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
}

module.exports = { roundRect, hit, fmtTime, drawSeal, drawCinnabarSeal, drawLockSeal, wrapText, fillPaper, drawToolIcon, drawButton, drawThemeIcon, canRotate, toggleOrientation };

/* 横竖屏切换能力（基础库 2.26+；旧版/桌面端没有则隐藏切换键） */
function canRotate() {
  return typeof wx !== 'undefined' && typeof wx.setDeviceOrientation === 'function';
}
function toggleOrientation(w, h) {
  if (!canRotate()) return;
  wx.setDeviceOrientation({ value: w > h ? 'portrait' : 'landscape' });
}

});
__def("src/ui/data.js", function (require, module, exports) {
/* 案件数据：案名库、每日挑战配置、缩略图地板色、棋盘缓存。
 * 移植自 Web 版 main.js（CASE_NAMES / DAILY_DIFFS / FLOOR_COLORS / caseSeed 等）。
 * 棋盘生成耗时，缓存跨场景复用（卷宗列表预生成 = 开局即达）。 */
const L = require('src/logic/index.js');

// 案件名与 Web 版一致：以棋盘主题案件名为准（八案主题体系）
const CASE_NAMES = L.Generator.THEMES.map(t => t.caseName);
// 试玩版不含每日挑战：置空即全端隐藏（题库/生成脚本保留，恢复 = 改回 ['easy', 'medium', 'hard']）
const DAILY_DIFFS = [];
const CASES_PER_DIFF = 12;
const FLOOR_COLORS = {
  grass: '#93c96b', white: '#f4f0e6', pink: '#f3dde3',
  blue: '#dde7f3', beige: '#efe4cd', grey: '#e7e7e7',
  wood: '#b28c60', stone: '#bcb6aa', bluestone: '#76848e',
  tatami: '#cebe8a', dirt: '#ac9268', cobble: '#96928a'
};

const cache = new Map();

function dailyKey() {
  return new Date().toISOString().slice(0, 10); // UTC 日期，与 Web 版一致
}
function caseSeed(diff, i) { return `case3:${diff}:${i}`; }   // v3：线索体系换代（去区间/距离、加席垫），旧进度不继承
function caseName(seed) { return CASE_NAMES[L.RNG.hashSeed(seed) % CASE_NAMES.length]; }
const NUM_ZH = ['', '其二', '其三', '其四', '其五', '其六', '其七', '其八'];
/* 案名按档内去重：主题案名只有 8 个而每档 12 案，重名时追加「其二/其三…」 */
function caseNameAt(diff, i) {
  const base = CASE_NAMES[(L.RNG.hashSeed(diff) + i) % CASE_NAMES.length];
  const occ = Math.floor(i / CASE_NAMES.length);   // 第几轮重名
  return occ === 0 ? base : base + NUM_ZH[occ];
}

/* 主题划分版主页：主题 → 案件阶梯（按难度从低到高、同档按案号）。
 * 优先读主题×尺寸矩阵库（themes.js）；无则回退难度题库归组。
 * 直接读题库（避免 revive 深拷贝开销），结果缓存（结构不随进度变化）。 */
const DIFF_ORDER = ['veryEasy', 'easy', 'medium', 'hard', 'expert', 'master', 'masterPro', 'legend'];
const SIZE_DIFF = { 5: 'veryEasy', 6: 'easy', 7: 'medium', 8: 'hard', 9: 'expert', 10: 's10', 11: 's11', 12: 'master', 13: 's13', 14: 's14', 15: 's15', 16: 'legend' };
let laddersCache = null;
function themeSpec(id) { return L.Generator.THEMES.find(t => t.id === id) || null; }
function themeLadders() {
  if (laddersCache) return laddersCache;
  if (LIB.themes) {
    // 矩阵库：theme2:<id>:<size> → 每主题按尺寸升序各一案（theme2 = 线索体系 v3 前缀）
    const out = L.Generator.THEMES.map(t => ({ id: t.id, name: t.name, caseName: t.caseName, cases: [] }));
    Object.keys(LIB.themes).forEach(seed => {
      const m = seed.match(/^theme2:(\w+):(\d+)$/);
      if (!m) return;
      const b = LIB.themes[seed];
      const th = out.find(x => x.id === m[1]);
      if (th && b) th.cases.push({ seed, diff: SIZE_DIFF[b.size] || 'medium', i: b.size, size: b.size });
    });
    out.forEach(th => th.cases.sort((a, b) => a.size - b.size));
    laddersCache = out.filter(th => th.cases.length);
    return laddersCache;
  }
  const out = L.Generator.THEMES.map(t => ({ id: t.id, name: t.name, caseName: t.caseName, cases: [] }));
  DIFF_ORDER.forEach(diff => {
    const lib = LIB[diff];
    if (!lib || !hasDiff(diff)) return;
    for (let i = 0; i < caseCount(diff); i++) {
      const b = lib[caseSeed(diff, i)];
      if (!b) continue;
      const th = out.find(x => x.id === b.theme.id);
      if (th) th.cases.push({ seed: caseSeed(diff, i), diff, i, size: b.size });
    }
  });
  out.forEach(th => th.cases.sort((a, b) => DIFF_ORDER.indexOf(a.diff) - DIFF_ORDER.indexOf(b.diff) || a.i - b.i));
  laddersCache = out.filter(th => th.cases.length);
  return laddersCache;
}

/* 与 gen-worker/main.js 相同的重试策略 */
function genBoard(seed, diff) {
  let board = null;
  for (let i = 0; i < 20 && !board; i++) {
    board = L.Generator.generate(i === 0 ? seed : `${seed}#${i}`, diff);
  }
  return board;
}

/* 离线谜题库：全部六档 + 每日挑战（build-library-v2 产出，含验收与推理链）。
 * 存在则优先命中；库缺案时回退运行时生成（master 档除外：实时生成不可行，宁可缺题）。
 * 注意：必须字面量静态 require（微信打包器不做动态路径分析）。 */
const LIB = {};
try { LIB.veryEasy = require('assets/library/veryEasy.js'); } catch (e) { /* 库未构建时静默回退 */ }
try { LIB.easy = require('assets/library/easy.js'); } catch (e) { }
try { LIB.medium = require('assets/library/medium.js'); } catch (e) { }
try { LIB.hard = require('assets/library/hard.js'); } catch (e) { }
try { LIB.expert = require('assets/library/expert.js'); } catch (e) { }
try { LIB.master = require('assets/library/master.js'); } catch (e) { }
try { LIB.masterPro = require('assets/library/masterPro.js'); } catch (e) { }
try { LIB.legend = require('assets/library/legend.js'); } catch (e) { }
try { LIB.themes = require('assets/library/themes.js'); } catch (e) { }   // 主题×尺寸矩阵库
try { LIB.daily = require('assets/library/daily.js'); } catch (e) { }

/* 这些难度只允许走题库（实时生成不可行，宁可缺题不可卡死） */
const LIBRARY_ONLY = new Set(['master', 'masterPro', 'legend']);

/* 该难度是否有可玩内容（LIBRARY_ONLY 档题库未出库/空占位时不应在主页露出行） */
function hasDiff(diff) {
  if (!LIBRARY_ONLY.has(diff)) return true;
  const lib = LIB[diff];
  return !!lib && Object.keys(lib).length > 0;
}

/* 每档案数：默认 CASES_PER_DIFF，大师-pro 仅 3 案、传奇仅 1 案（生成代价高） */
const CASE_COUNT = { masterPro: 3, legend: 1 };
function caseCount(diff) { return CASE_COUNT[diff] || CASES_PER_DIFF; }

/* 题库板出炉前的兼容修复：corners 由数组复活为 Set；线索文案按当前版本重算。
 * 返回深拷贝，调用方改动不污染库缓存。 */
function reviveBoard(board) {
  if (!board) return board;
  const b = JSON.parse(JSON.stringify(board));
  if (Array.isArray(b.corners)) b.corners = new Set(b.corners);
  if (L.Clues && b.clues) {
    b.clues.forEach(c => { c.text = L.Clues.clueText(c, b); });
  }
  return b;
}

function getBoard(seed, diff) {
  let raw = null;
  if (seed.indexOf('theme2:') === 0) {
    // 主题矩阵案：只走矩阵库（缺失时绝不运行时生成——大尺寸实时生成不可行）
    raw = (LIB.themes && LIB.themes[seed]) || null;
    return raw ? reviveBoard(raw) : null;
  }
  if (seed.indexOf('daily:') === 0 && LIB.daily) raw = LIB.daily[seed] || null;
  else if (LIB[diff]) raw = LIB[diff][seed] || null;
  if (raw) return reviveBoard(raw);
  if (LIBRARY_ONLY.has(diff)) return null; // 题库未收录：快速失败，不尝试实时生成
  const key = `${diff}|${seed}`;
  if (!cache.has(key)) cache.set(key, genBoard(seed, diff));
  return cache.get(key);
}

/* 工笔头像（webp）：按身份 imgKey 加载（与 Web 版身份制一致），未加载完成回退 SVG */
const AVATAR_KEYS = L.Generator.IDENTITY_POOL.map(i => i.avatar);
const portraits = {};
const cuts = {};

/* 物件/地板图片注册表（按主题目录 webp；通用地板在根目录） */
const THEME_DIRS = L.Generator.THEMES.map(t => t.id);
const FLOOR_IMG_KEYS = {
  grass: 'grass', white: 'white', pink: 'pink', blue: 'blue', beige: 'beige', grey: 'grey',
  wood: 'wood', stone: 'stone', bluestone: 'bluestone', tatami: 'tatami', dirt: 'dirt', cobble: 'cobble'
};
const objectImgs = {}; // { themeId: { key: img } }
const floorImgs = {};  // { key: img }（含主题地板 themeId/key）
const uiImgs = {};     // UI 贴图（未解锁朱砂印等）
let imgVersion = 0; // 图片到位计数（用于离屏缓存失效）

function _loadOne(map, name, path, onAny) {
  const INLINE = (typeof window !== 'undefined' && window.MOAN_INLINE) || null;
  const img = wx.createImage();
  img.onload = () => {
    map[name] = img;
    imgVersion++;
    if (onAny) onAny();
  };
  img.onerror = (e) => {
    if (typeof console !== 'undefined') console.warn('[moan] 图片加载失败:', path, (e && e.errMsg) || '');
  };
  img.src = (INLINE && INLINE[path]) || path;   // 内联优先（build-web.mjs 注入）
}

function loadPortraits(onAny) {
  if (typeof wx === 'undefined' || !wx.createImage) return;
  AVATAR_KEYS.forEach(key => {
    _loadOne(portraits, key, `assets/avatars/${key}.png`, onAny);
    _loadOne(cuts, key, `assets/avatars/cut-${key}.png`, onAny);
  });
  // 主题专属头像（有则覆盖同身份全局图）：assets/avatars/<dir>/<stem>.png + cut-<stem>.png
  Object.entries(THEME_AVATARS).forEach(([themeId, cfg]) => {
    Object.entries(cfg.map).forEach(([imgKey, stem]) => {
      _loadOne(portraits, themeId + ':' + imgKey, `assets/avatars/${cfg.dir}/${stem}.png`, onAny);
      _loadOne(cuts, themeId + ':' + imgKey, `assets/avatars/${cfg.dir}/cut-${stem}.png`, onAny);
    });
  });
  // 各主题物件 + 主题地板（tile*）
  THEME_DIRS.forEach(tid => {
    objectImgs[tid] = {};
    const theme = L.Generator.THEMES.find(t => t.id === tid);
    const keys = new Set(theme.objects.map(o => o.key).concat(L.Generator.COMMON_OBJECTS.map(o => o.key)));
    keys.forEach(key => {
      _loadOne(objectImgs[tid], key, `assets/objects/${tid}/${key}.png`, onAny);
    });
    // 跨格物件整图（2:1，渲染时左右各取半）
    theme.objects.filter(o => o.span === 2).forEach(o => {
      _loadOne(objectImgs[tid], o.key + '-2', `assets/objects/${tid}/${o.key}-2.png`, onAny);
    });
    theme.inFloors.concat(theme.outFloors).forEach(fkey => {
      if (fkey.indexOf('tile') >= 0) {
        const k = tid + '/' + fkey;
        _loadOne(floorImgs, k, `assets/objects/${tid}/Meshy_AI_${fkey}.png`, onAny);
      }
    });
  });
  // 通用地板
  Object.values(FLOOR_IMG_KEYS).forEach(key => {
    _loadOne(floorImgs, key, `assets/objects/floor-${key}.png`, onAny);
  });
  // UI 贴图
  _loadOne(uiImgs, 'sealUnlock', 'assets/ui/seal-unlock.png', onAny);
}

/* 主题专属头像映射：themeId → { dir: 资产目录, map: { 全局 imgKey → 主题文件名 } } */
const THEME_AVATARS = {
  zhaiyuan: {
    dir: 'shishenzhaiyuan',
    map: {
      liuzhong: 'guanjia', zhum: 'zhumu', liuruyan: 'daxiaojie', qianwanjin: 'zhangfang',
      shenwenyuan: 'xixi', wangsao: 'chuniang', chunlan: 'chunlan',
      zhaotiezhu: 'huyuan-v2', xiaoshitou: 'xiaoshitou'
    }
  }
};

function portrait(p, themeId) {
  const cfg = themeId && THEME_AVATARS[themeId];
  if (cfg && cfg.map[p.imgKey]) {
    const themed = portraits[themeId + ':' + p.imgKey];
    if (themed) return themed;
  }
  return portraits[p.imgKey] || null;
}

/* 裁底人像（透明底，棋盘 token 用），无则回退普通头像 */
function cut(p, themeId) {
  const cfg = themeId && THEME_AVATARS[themeId];
  if (cfg && cfg.map[p.imgKey]) {
    const themed = cuts[themeId + ':' + p.imgKey] || portraits[themeId + ':' + p.imgKey];
    if (themed) return themed;
  }
  return cuts[p.imgKey] || portraits[p.imgKey] || null;
}

function objectImg(key, themeId) {
  const tid = themeId || 'zhaiyuan';
  return (objectImgs[tid] && objectImgs[tid][key]) || null;
}

function floorImg(key, themeId) {
  if (key.indexOf('tile') >= 0) return floorImgs[(themeId || 'zhaiyuan') + '/' + key] || null;
  return floorImgs[key] || null;
}

function lockSeal() {
  return uiImgs.sealUnlock || null;
}

/* 图片加载版本号（每次到位 +1）：渲染层据此重建离屏缓存 */
function imageVersion() {
  return imgVersion;
}

const HOWTO = `真凶必曾与死者独处一室（同处一屋，且屋内再无第三人）。提刑官需根据各人证词，还原案发时每人所在的位置。
【铁律】
· 同行、同列，各仅一人。
· 诸位只能立于空地（不可立于桌椅器物之上，但可坐在椅凳上）。
· 💀 死者亦在案发现场某处。
【仵作手法】
· 点按嫌疑人：选中此人的案卷
· 点按格子：朱笔批注（显示单字简称）
· 长按格子：将选中之人置于此处
· 按住拖动：连续批注
· ✕ 排除：墨笔打叉，标记此处断无可能（PC 端可直接右键格子打/撤叉）
· ⌫ 擦除：点按清单一格，长按清空全盘
· ↩ 撤回　💡 提点（推理链逐步揭示）
· 专家/大师/传奇档不设提点，全凭推理
【术语】
· 屋/房/处所：粗墙围合之区域
· 墙角：房间轮廓的拐角格——纵、横两个方向各至少贴一面异室的墙；仅棋盘靠边或一字走廊不算
· 毗邻：上下左右紧挨，且在同一屋内
· 独处一室：屋内仅此二人，再无旁人
· 斜线：同在一条 45° 对角连线上
· 坐在某物上：椅、凳等可坐人之器物
· 在席垫上：人立于席垫（竹席/苇席/蒲团/毡毯等，随主题而异）之上；「不在席上」即脚下无席
· 东/南/西/北边：该方向任意格子，不限屋舍
【呈堂】
将所有人安置妥当后，点击「呈堂」断案。若有误，会提示几处与现场不符。`;

module.exports = {
  L, CASE_NAMES, DAILY_DIFFS, CASES_PER_DIFF, FLOOR_COLORS, HOWTO,
  dailyKey, caseSeed, caseName, caseNameAt, getBoard, caseCount, hasDiff, themeLadders, themeSpec,
  loadPortraits, portrait, cut, objectImg, floorImg, imageVersion, lockSeal
};

});
__def("src/ui/play.js", function (require, module, exports) {
/* 游戏场景：棋盘 + 国风坐标 + 嫌疑人栏 + 线索卡 + 工具栏。
 * 交互移植自 Web 版 ui.js createGameScreen：
 *   点按格子=批注（选中之人），长按 400ms=放置，拖动=连续批注；
 *   ✕ 排除模式；⌫ 擦除（长按清空全部）；↩ 撤回；💡 提点（推理链逐步揭示）；
 *   放置后 ⚡自动在行/列打 X；全部安置后「呈堂」断案。
 * 状态结构与存档格式（placed/marks/hintsUsed/seconds/done）与 Web 版一致。 */
const data = require('src/ui/data.js');
const { theme, themeName, toggleTheme, FONTS } = require('src/ui/theme.js');
const { roundRect, hit, fmtTime, wrapText, fillPaper, drawToolIcon, drawCinnabarSeal, drawSeal, drawThemeIcon, canRotate, toggleOrientation } = require('src/ui/widgets.js');
const { createScroll } = require('src/ui/scroll.js');
const { drawSVG } = require('src/ui/svgmini.js');

const HOLD_MS = 400;
const ERASE_ALL_HOLD_MS = 650;
/* 拖动容差：按下点位移 ≤12px 视为静止（与 scene.js 点按阈值一致）。
 * 真机"静止"触摸会发亚像素~数 px 的抖动 move，若据此取消长按计时，
 * 400ms 几乎必然撑不满 → 长按放置失败，抬起又被判为点按 → 误放简称批注。 */
const DRAG_SLOP = 12;
/* 提点次数不设上限（推理链逐步揭示） */
const GENERAL_TYPES = new Set(['emptyRoom', 'roomMixGender']);
const HEADER_H = 44;
const COORD = 16;

function createPlayScene(manager, opts) {
  const L = manager.L;
  const M = L.Model;
  const W = manager.view.width;
  const H = manager.view.height;

  /* ---------- 布局：横屏 = 左线索列 / 右棋盘列；竖屏 = 通用卡+棋盘 / 角色线索带 / 功能区贴底 ---------- */
  const capsule = (typeof wx !== 'undefined' && wx.getMenuButtonBoundingClientRect)
    ? wx.getMenuButtonBoundingClientRect() : null;
  const TOP_SAFE = Math.max(HEADER_H, (capsule && capsule.bottom ? capsule.bottom : 0) + 6);
  /* 头部带顶：竖屏须压过胶囊底；横屏胶囊在右上角，左右分栏后头部可靠顶 */
  const HDR_TOP = W > H ? 10 : TOP_SAFE;
  const HEADER_BAND = 34;                          // 头部带（返回/案名/计时）
  const LAND = W > H;
  const TOOL_H = 46;
  let boardX = 0, boardY = 0, boardSide = 0;
  let toolY = 0, toolX = 0, toolW = W;
  let clueX = 0, clueW = W, clueBandY = 0, clueBandBottom = 0;
  let generalH = 96;                               // 通用线索卡高（就绪后按内容重算；横屏不占独立高度）
  // 通用线索行（只列本案通用线索；两条固定规则已按产品要求省略）
  function generalLines() {
    if (!board) return [];
    const out = [];
    const cpl = Math.max(12, Math.floor((LAND ? clueW - 36 : boardSide + COORD - 24) / 12));
    board.clues.forEach(clue => {
      if (!GENERAL_TYPES.has(clue.type)) return;
      const s = stripTags(clue.text);
      for (let i = 0; i < s.length; i += cpl) out.push({ text: s.slice(i, i + cpl) });
    });
    return out;
  }
  function relayout() {
    if (LAND) {
      // 横屏：左线索列（含通用卡）/ 中棋盘 / 最右侧竖排功能轨
      const RAIL_W = 64;
      boardSide = Math.min(H - HDR_TOP - HEADER_BAND - COORD - 12, W * 0.6);
      clueX = 8;
      clueW = Math.min(300, Math.max(220, W * 0.32));
      clueBandY = HDR_TOP + HEADER_BAND + 4;
      clueBandBottom = H - 8;
      toolX = W - RAIL_W - 8;
      toolW = RAIL_W;
      const rightX = clueX + clueW + 12 + COORD;
      boardX = rightX + Math.max(0, (toolX - 12 - rightX - boardSide) / 2);
      boardY = HDR_TOP + HEADER_BAND + COORD + 4;
      toolY = boardY;
    } else {
      boardX = 4 + COORD;
      boardSide = W - 8 - COORD;
      toolY = H - TOOL_H - 6;
      toolX = 0;
      toolW = W;
      if (board) {
        const gl = generalLines().length;
        generalH = gl ? gl * 18 + 30 : 0;   // 无通用线索的案不收通用卡高度
      }
      boardY = TOP_SAFE + HEADER_BAND + generalH + 8 + COORD;  // 横轴在棋盘上方（留 COORD）
      clueX = boardX - COORD - 8;             // 卡片内缩 8 → 线索卡左右缘含纵轴刻度与棋盘对齐
      clueW = boardSide + COORD + 16;
      clueBandY = boardY + boardSide + COORD + 2;  // 与上方通用线索的间距一致（约一个轴高）
      clueBandBottom = toolY - 6;
    }
  }

  /* ---------- 状态（onShow 异步初始化） ---------- */
  let board = null;
  let n = 0;
  let cell = 0;
  let placed = {};
  let marks = {};
  let placedStash = {};   // 放置时被同步清除的标记（取消放置时还原）
  let hintCells = new Set();
  let hintsUsed = 0;
  let seconds = 0;
  let done = false;
  let selected = 0;
  let tool = 'note';
  const undoStack = [];
  let objAt = {};
  let ready = false;
  let loadFailed = false;

  /* ---------- 设置 ---------- */
  const settings = Object.assign({ sound: true, autoX: true }, L.Storage.getSettings());

  /* ---------- 手势/界面状态 ---------- */
  /* 专家/大师/传奇不设提点（高难度全凭推理；传奇推理链超深未生成） */
  const HINT_OFF = !!(L.Generator.DIFFICULTY[opts.diff] || {}).noHint;
  const clueScroll = createScroll();
  const hintScroll = createScroll();
  const howtoScroll = createScroll();
  let downCell = -1;
  let downX = 0, downY = 0;   // 按下点坐标（拖动容差判定用）
  let holdTimer = null;
  let holdFired = false;
  let holdCell = -1;
  let holdStart = 0;
  let painting = false;
  let lastPaint = -1;
  let hlRoom = -1;
  let toastMsg = '';
  let toastUntil = 0;
  let hintModal = null; // { steps, idx }
  let showHowto = false;   // 玩法说明弹层（关卡内）
  let showWin = false;
  let showReplay = false;   // 已破案后再进：「再玩一次」选择层
  let timerInt = null;
  const zones = {};

  function vibrate() {
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 无振动 */ }
  }

  function toast(msg, ms) {
    toastMsg = msg;
    toastUntil = Date.now() + (ms || 2200);
    manager.invalidate();
  }

  /* ---------- 持久化（与 Web 版同格式） ---------- */
  let saveTimer = null;
  function saveNow() {
    if (!opts.seed || !ready) return;
    clearTimeout(saveTimer);
    L.Storage.saveProgress(opts.seed, {
      placed, marks, hintCells: [...hintCells],
      hintsUsed, seconds, done
    });
  }
  function saveSoon() {
    if (!opts.seed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  /* ---------- 撤销 ---------- */
  function snapshot() {
    return JSON.stringify({ placed, marks, selected });
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
  }
  function undo() {
    const prev = undoStack.pop();
    if (!prev || done) return;
    const s = JSON.parse(prev);
    placed = Object.fromEntries(Object.entries(s.placed).map(([k, v]) => [Number(k), v]));
    marks = s.marks;
    if (s.selected !== undefined) selected = s.selected;
    hintCells = new Set([...hintCells].filter(c => placed[c] !== undefined));
    afterChange();
  }

  /* ---------- 动作（移植 ui.js） ---------- */
  function ensureTimer() {
    if (!done) timerOn = true;
  }
  let timerOn = false;

  function hasAnyX(i) {
    const m = marks[i];
    // 'x'=手动排除叉，'ax'=放置时行列联动打上的自动叉；显示/拦截语义相同
    return m && Object.values(m).some(v => v === 'x' || v === 'ax');
  }

  function toggleMark(i, kind) {
    if (placed[i] !== undefined || !board.occupiable[i] || done) return;
    // 已打叉的格子：除擦除外的操作一律不改写（防误触覆盖排除结论；要去掉叉请用 ⌫ 擦除）
    if (hasAnyX(i)) return;
    pushUndo();
    marks[i] = marks[i] || {};
    if (marks[i][selected] === kind) delete marks[i][selected];
    else marks[i][selected] = kind;
    if (!Object.keys(marks[i]).length) delete marks[i];
    ensureTimer();
    afterChange();
  }

  function eraseCell(i) {
    if (done || (placed[i] === undefined && !marks[i])) return;
    pushUndo();
    delete placed[i];
    delete marks[i];
    hintCells.delete(i);
    ensureTimer();
    afterChange();
  }

  function clearAll() {
    if (done) return;
    pushUndo();
    placed = {};
    marks = {};
    placedStash = {};
    hintCells.clear();
    afterChange();
    toast('已清空全盘');
  }

  function advanceSelection() {
    const placedPersons = new Set(Object.values(placed));
    const next = board.people.find(p => !placedPersons.has(p.id));
    if (next) selected = next.id;
  }

  /* 移除某格的放置并清理该行/列的自动 X（只清 'ax'，手动打上的 'x' 保留；不压撤销栈，由调用方统一压） */
  function removePlacement(i) {
    const person = placed[i];
    delete placed[i];
    hintCells.delete(i);
    const r = M.row(i, n), c = M.col(i, n);
    for (let k = 0; k < n * n; k++) {
      if ((M.row(k, n) === r || M.col(k, n) === c) && marks[k] && marks[k][person] === 'ax') {
        delete marks[k][person];
        if (!Object.keys(marks[k]).length) delete marks[k];
      }
    }
  }

  function placePerson(person, i) {
    if (done || !ready) return;
    if (!board.occupiable[i]) { toast('此处不可站立'); vibrate(); return; }
    if (placed[i] !== undefined) { vibrate(); return; }
    if (hasAnyX(i)) { toast('此处已打叉排除，先 ⌫ 擦除'); vibrate(); return; }
    pushUndo();
    // 一人一格：已在别处的，先拿起（移动语义，同属一步撤销）
    const prevCell = Object.keys(placed).find(k => placed[k] === person);
    if (prevCell !== undefined) removePlacement(Number(prevCell));
    placed[i] = person;
    delete marks[i];
    // 位置已定：此人的批注（猜测位置）同步清除并暂存，取消放置时还原；
    // 排除叉保留——那是本局仍在使用的排除结论（曾全清导致放置即丢排除记录）
    const stash = {};
    for (const k of Object.keys(marks)) {
      if (marks[k][person] === 'note') {
        stash[k] = 'note';
        delete marks[k][person];
        if (!Object.keys(marks[k]).length) delete marks[k];
      }
    }
    placedStash[person] = stash;
    if (settings.autoX) {
      const r = M.row(i, n), c = M.col(i, n);
      for (let k = 0; k < n * n; k++) {
        if (k === i || placed[k] !== undefined || !board.occupiable[k]) continue;
        if (M.row(k, n) === r || M.col(k, n) === c) {
          marks[k] = marks[k] || {};
          // 自动叉记为 'ax'，与手动 'x' 区分开，拿起时只清自动叉；
          // 已有手动叉的槽位不覆盖——那是玩家自己的排除结论
          if (marks[k][person] === undefined) marks[k][person] = 'ax';
        }
      }
    }
    ensureTimer();
    afterChange();
    advanceSelection();
    vibrate();
  }

  function unplace(i) {
    if (done) return;
    const person = placed[i];
    if (person === undefined) return;
    pushUndo();
    removePlacement(i);
    // 还原放置时被同步清除的此人标记（刚放完就拿起的情形）
    const stash = placedStash[person];
    if (stash) {
      for (const k of Object.keys(stash)) {
        if (placed[k] !== undefined) continue;
        marks[k] = marks[k] || {};
        if (marks[k][person] === undefined) marks[k][person] = stash[k];
      }
      delete placedStash[person];
    }
    selected = person;
    afterChange();
  }

  function submit() {
    if (done || !ready) return;
    if (Object.keys(placed).length !== n) {
      toast('请先安置所有人');
      return;
    }
    const wrong = Object.entries(placed)
      .filter(([cellStr, p]) => board.solution[p] !== Number(cellStr)).length;
    if (wrong > 0) {
      vibrate();
      toast(`尚有 ${wrong} 处与现场不符，请提刑官再推敲推敲`);
      return;
    }
    done = true;
    timerOn = false;
    saveNow();
    vibrate();
    showWin = true;
    manager.invalidate();
  }

  /* ---------- 提点（离线推理链逐步揭示；运行时生成的兜底板回退域快照） ---------- */
  let hintSteps = null;
  function computeHintSteps() {
    if (hintSteps) return hintSteps;
    hintSteps = [];
    // 题库板自带纯推理链（build-library-v2 产出，含 <b> 加粗标记）
    if (Array.isArray(board.walk) && board.walk.length) {
      hintSteps = board.walk;
      return hintSteps;
    }
    const domains = L.Solver.initDomains(board, board.clues);
    if (domains && L.Solver.propagate(board, board.clues, domains)) {
      const arr = board.people.map(p => ({ p, cells: [...domains[p.id]] }));
      arr.sort((a, b) => a.cells.length - b.cells.length);
      hintSteps = arr.slice(0, 6).map(({ p, cells }) => {
        if (cells.length === 1) {
          return `由证词推断，${p.title}${p.name} 只能在 ${M.coordText(cells[0], n)}——别无他处。`;
        }
        return `先从${p.title}${p.name}入手：结合所有证词，${p.name} 可能的位置只剩 ${cells.length} 格。`;
      });
    }
    return hintSteps;
  }

  function useHint() {
    if (done || HINT_OFF) return;
    const steps = computeHintSteps();
    if (hintsUsed >= steps.length) return;  // 已展开完毕
    hintsUsed++;
    ensureTimer();
    saveSoon();
    hintModal = {
      steps,
      idx: Math.max(0, Math.min(hintsUsed, steps.length) - 1)
    };
    hintScroll.reset();
    manager.invalidate();
  }

  function afterChange() {
    saveSoon();
    manager.invalidate();
  }

  /* ---------- 棋盘坐标换算 ---------- */
  function cellAt(x, y) {
    if (x < boardX || y < boardY) return -1;
    const c = Math.floor((x - boardX) / cell);
    const r = Math.floor((y - boardY) / cell);
    if (c < 0 || c >= n || r < 0 || r >= n) return -1;
    return r * n + c;
  }

  /* ---------- 初始化（异步生成，复用缓存） ---------- */
  function init() {
    const b = data.getBoard(opts.seed, opts.diff);
    if (!b) {
      loadFailed = true;
      manager.invalidate();
      return;
    }
    board = b;
    n = b.size;
    relayout();
    cell = boardSide / n;
    objAt = {};
    b.objects.forEach(o => {
      objAt[o.cell] = o;
      if (o.span === 2) objAt[o.cell + 1] = o;   // 跨格物件右半格同样命中（点按报名/禁批注等）
    });

    const saved = L.Storage.getProgress(opts.seed) || null;
    placed = saved ? Object.fromEntries(Object.entries(saved.placed || {}).map(([k, v]) => [Number(k), v])) : {};
    marks = saved ? JSON.parse(JSON.stringify(saved.marks || {})) : {};
    hintCells = saved ? new Set(saved.hintCells || []) : new Set();
    hintsUsed = saved ? saved.hintsUsed || 0 : 0;
    seconds = saved ? saved.seconds || 0 : 0;
    done = saved ? !!saved.done : false;
    if (done) showReplay = true;   // 已破案：进入给「再玩一次」选择
    selected = b.people.find(p => !p.isVictim).id;
    ready = true;
    // 首次进棋盘的情境提示（一次性，settings 落盘；对齐"情境提示优于说明书墙"）
    if (!settings.hintSeen && !done) {
      toast('点按=批注 · 长按=放置 · ✕=排除 · ⌫=擦除', 4500);
      settings.hintSeen = true;
      L.Storage.saveSettings(settings);
    }
    if (!done) timerOn = true;
    timerInt = setInterval(() => {
      if (timerOn && !done) {
        seconds++;
        if (seconds % 5 === 0) saveSoon();
        manager.invalidate();
      }
    }, 1000);
    manager.invalidate();
  }

  /* ================================================================
     渲染（静态层离屏缓存：地板/网格/墙/房间名/物件 只随图片到位重建）
     ================================================================ */
  let boardCache = null;
  let cacheVer = -1;

  /* 静态层（局部坐标 0..boardSide） */
  function drawBoardStatic(c) {
    for (let i = 0; i < n * n; i++) {
      const r = M.row(i, n), cc = M.col(i, n);
      const fkey = board.rooms[board.roomAt[i]].floor;
      const fimg = data.floorImg(fkey, board.theme && board.theme.id);
      const fx = cc * cell, fy = r * cell;
      if (fimg) {
        c.drawImage(fimg, fx, fy, cell, cell);
      } else {
        c.fillStyle = data.FLOOR_COLORS[fkey] || '#f4f0e6';
        c.fillRect(fx, fy, cell + 0.5, cell + 0.5);
      }
    }
    // 细网格
    c.strokeStyle = 'rgba(30,30,30,0.18)';
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 0; k <= n; k++) {
      c.moveTo(k * cell, 0);
      c.lineTo(k * cell, boardSide);
      c.moveTo(0, k * cell);
      c.lineTo(boardSide, k * cell);
    }
    c.stroke();
    // 墙线
    c.strokeStyle = '#161616';
    c.lineWidth = 2.5;
    c.beginPath();
    for (let r = 0; r < n; r++) {
      for (let cc = 0; cc < n; cc++) {
        const i = r * n + cc;
        const room = board.roomAt[i];
        const x = cc * cell, y = r * cell;
        if (r === 0 || board.roomAt[i - n] !== room) { c.moveTo(x, y); c.lineTo(x + cell, y); }
        if (r === n - 1 || board.roomAt[i + n] !== room) { c.moveTo(x, y + cell); c.lineTo(x + cell, y + cell); }
        if (cc === 0 || board.roomAt[i - 1] !== room) { c.moveTo(x, y); c.lineTo(x, y + cell); }
        if (cc === n - 1 || board.roomAt[i + 1] !== room) { c.moveTo(x + cell, y); c.lineTo(x + cell, y + cell); }
      }
    }
    c.stroke();
    // 物件（优先 PNG，缺失回退 SVG；span:2 跨格物件锚点格画左半、右格画右半）
    Object.keys(objAt).forEach(k => {
      const i = Number(k);
      const o = objAt[i];
      if (o.span === 2 && i !== o.cell) return;   // 右半格由锚点格统一处理
      const x = M.col(i, n) * cell, y = M.row(i, n) * cell;
      const tid = board.theme && board.theme.id;
      if (o.span === 2) {
        const img2 = data.objectImg(o.key + '-2', tid);
        if (img2 && img2.width) {
          const hw = img2.width / 2;
          c.drawImage(img2, 0, 0, hw, img2.height, x + cell * 0.02, y + cell * 0.07, cell * 0.98, cell * 0.86);
          c.drawImage(img2, hw, 0, img2.width - hw, img2.height, x + cell + cell * 0.02, y + cell * 0.07, cell * 0.98, cell * 0.86);
          return;
        }
      }
      const oimg = data.objectImg(o.key, tid);
      if (oimg) {
        c.drawImage(oimg, x + cell * 0.07, y + cell * 0.07, cell * 0.86, cell * 0.86);
      } else {
        const svg = L.Art.OBJECT_SPRITES[objAt[i].key];
        if (svg) drawSVG(c, svg, x + cell * 0.12, y + cell * 0.12, cell * 0.76, cell * 0.76);
      }
    });
  }

  /* 区域名标签（动态顶层绘制：压在 token/批注/进度环之上，参照月球主题 room-overlay 高层）。
   * 局部坐标 0..boardSide；每个房间最底行居中、贴底边收进区域内；
   * 断开区域取最底行的最长连续段居中，防止标签落进别的房间。 */
  function drawRoomLabels(c) {
    c.fillStyle = 'rgba(20,20,20,0.78)';
    c.font = `bold ${Math.max(10, cell * 0.28)}px ${FONTS.kai}`;   // 区域名楷体（公堂视觉）
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    board.rooms.forEach(room => {
      let rMax = -1;
      for (let i = 0; i < n * n; i++) {
        if (board.roomAt[i] === room.id) rMax = Math.max(rMax, M.row(i, n));
      }
      if (rMax < 0) return;
      const bottomCols = [];
      for (let i = 0; i < n * n; i++) {
        if (board.roomAt[i] === room.id && M.row(i, n) === rMax) bottomCols.push(M.col(i, n));
      }
      bottomCols.sort((a, b) => a - b);
      // 最长连续段
      let bestS = bottomCols[0], bestLen = 1, curS = bottomCols[0], curLen = 1;
      for (let k = 1; k <= bottomCols.length; k++) {
        if (k < bottomCols.length && bottomCols[k] === bottomCols[k - 1] + 1) {
          curLen++;
        } else {
          if (curLen > bestLen) { bestS = curS; bestLen = curLen; }
          curS = bottomCols[k]; curLen = 1;
        }
      }
      // 白色描边：深色房间名在任何地板上都醒目
      const lx = (bestS + bestLen / 2) * cell, ly = (rMax + 1) * cell - 1;
      c.lineWidth = Math.max(2, cell * 0.05);
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(250,248,240,0.92)';
      c.strokeText(room.name, lx, ly);
      c.fillText(room.name, lx, ly);
    });
  }

  function rebuildBoardCache() {
    cacheVer = data.imageVersion();
    if (!wx.createOffscreenCanvas) { boardCache = null; return; }
    const scale = 2;
    const cv = wx.createOffscreenCanvas({
      type: '2d',
      width: Math.ceil(boardSide * scale),
      height: Math.ceil(boardSide * scale)
    });
    const c = cv.getContext('2d');
    c.scale(scale, scale);
    drawBoardStatic(c);
    boardCache = cv;
  }

  function drawBoard(ctx, t) {
    if (cacheVer !== data.imageVersion()) rebuildBoardCache();
    // 静态层（离屏缓存一次绘入，避免每帧逐格重绘）
    if (boardCache) {
      ctx.drawImage(boardCache, boardX, boardY, boardSide, boardSide);
    } else {
      ctx.save();
      ctx.translate(boardX, boardY);
      drawBoardStatic(ctx);
      ctx.restore();
    }
    // 触碰区域高亮
    if (hlRoom >= 0) {
      ctx.fillStyle = 'rgba(120,120,120,0.20)';
      for (let i = 0; i < n * n; i++) {
        if (board.roomAt[i] === hlRoom) {
          ctx.fillRect(boardX + M.col(i, n) * cell, boardY + M.row(i, n) * cell, cell, cell);
        }
      }
    }
    // 冲突高亮（同行/列多人）
    const rows = {}, cols = {};
    Object.keys(placed).forEach(cs => {
      const i = Number(cs);
      (rows[M.row(i, n)] = rows[M.row(i, n)] || []).push(i);
      (cols[M.col(i, n)] = cols[M.col(i, n)] || []).push(i);
    });
    ctx.fillStyle = 'rgba(184,64,56,0.30)';
    [rows, cols].forEach(map => Object.values(map).forEach(cells => {
      if (cells.length > 1) {
        cells.forEach(i => ctx.fillRect(boardX + M.col(i, n) * cell, boardY + M.row(i, n) * cell, cell, cell));
      }
    }));
    // 放置的人物 / X / 笔记
    for (let i = 0; i < n * n; i++) {
      const r = M.row(i, n), c = M.col(i, n);
      const x = boardX + c * cell, y = boardY + r * cell;
      if (placed[i] !== undefined) {
        const p = board.people[placed[i]];
        drawToken(ctx, p, x, y);
      } else if (hasAnyX(i)) {
        ctx.strokeStyle = '#181818';
        ctx.lineWidth = Math.max(3, cell * 0.14);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + cell * 0.18, y + cell * 0.18);
        ctx.lineTo(x + cell * 0.82, y + cell * 0.82);
        ctx.moveTo(x + cell * 0.82, y + cell * 0.18);
        ctx.lineTo(x + cell * 0.18, y + cell * 0.82);
        ctx.stroke();
      } else if (marks[i] && Object.keys(marks[i]).length) {
        const noted = board.people.filter(p => marks[i][p.id] === 'note');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        noted.slice(0, 6).forEach((p, k) => {
          // 粗体 + 黑色描边（参考 murdoku 的格子字母样式）；v3.1 字号放大（简称标注易读）
          const fs = Math.max(13, cell * 0.34);
          const tx = x + 2 + (k % 3) * cell * 0.32;
          const ty = y + 2 + Math.floor(k / 3) * cell * 0.3;
          ctx.font = `bold ${fs}px sans-serif`;
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, fs * 0.22);
          ctx.strokeStyle = '#161616';
          ctx.strokeText(p.short, tx, ty);
          ctx.fillStyle = p.color || '#333';
          ctx.fillText(p.short, tx, ty);
        });
      }
    }
    // 长按进度环
    if (holdCell >= 0 && !holdFired) {
      const progress = Math.min(1, (Date.now() - holdStart) / HOLD_MS);
      const r = M.row(holdCell, n), c = M.col(holdCell, n);
      const cx = boardX + (c + 0.5) * cell, cy = boardY + (r + 0.5) * cell;
      ctx.strokeStyle = board.people[selected].color || '#b84038';
      ctx.lineWidth = 6;   // 长按进度环：v3.1 加粗（闭合圆环更醒目）
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.42, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      manager.invalidate(); // 动画期间持续重绘
    }
    // 区域名最上层：压在 token/批注/进度环之上（参照月球主题 room-overlay 高层）
    ctx.save();
    ctx.translate(boardX, boardY);
    drawRoomLabels(ctx);
    ctx.restore();
    // 国风坐标：横轴在棋盘上方，纵轴在左（楷体描金，公堂视觉系统）
    ctx.fillStyle = 'rgba(214,182,92,0.95)';
    ctx.font = `15px ${FONTS.kai}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < n; c++) {
      ctx.fillText(M.COL_NUMS[c], boardX + (c + 0.5) * cell, boardY - COORD / 2);
    }
    for (let r = 0; r < n; r++) {
      ctx.fillText(M.ROW_STEMS[r], boardX - COORD / 2, boardY + (r + 0.5) * cell);
    }
  }

  function drawToolbar(ctx, t) {
    const tools = [
      { key: 'x', label: '排除', zone: 'xBtn' },
      { key: 'erase', label: '擦除', zone: 'eraseBtn' },
      { key: 'undo', label: '撤回', zone: 'undoBtn' }
    ];
    if (!HINT_OFF) tools.push({ key: 'hint', label: `提点·${hintsUsed}`, zone: 'hintBtn' });
    if (LAND) {
      // 横屏：最右侧竖排功能轨（文房圆牌 + 自绘图标）
      let y = toolY;
      tools.forEach(tb => {
        const rect = { x: toolX, y, w: toolW, h: 44 };
        const active = (tb.key === 'x' && tool === 'x') || (tb.key === 'erase' && tool === 'erase');
        ctx.fillStyle = active ? 'rgba(177,58,48,0.18)' : 'rgba(242,236,221,0.10)';
        ctx.beginPath(); ctx.arc(rect.x + toolW / 2, rect.y + 17, 17, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = active ? '#b13a30' : 'rgba(214,182,92,0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        drawToolIcon(ctx, tb.key, rect.x + toolW / 2, rect.y + 17, 18, active ? '#b13a30' : t.fg);
        ctx.font = `10px ${FONTS.kai}`;
        ctx.fillStyle = active ? '#b13a30' : t.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tb.label, rect.x + toolW / 2, rect.y + 37);
        zones[tb.zone] = rect;
        y += 48;
      });
      // 自动排除开关（小印 + 朱叉）
      const ax = { x: toolX, y, w: toolW, h: 44 };
      ctx.fillStyle = settings.autoX ? 'rgba(194,162,74,0.22)' : 'rgba(242,236,221,0.10)';
      ctx.beginPath(); ctx.arc(ax.x + toolW / 2, ax.y + 22, 17, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = settings.autoX ? '#c2a24a' : 'rgba(214,182,92,0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      drawToolIcon(ctx, 'autoX', ax.x + toolW / 2, ax.y + 22, 18, settings.autoX ? '#c2a24a' : t.muted);
      zones.autoXBtn = ax;
      y += 52;
      // 呈堂（朱砂大印；未集齐时淡印）
      const allPlaced = ready && Object.keys(placed).length === n;
      const sub = { x: toolX, y, w: toolW, h: 64 };
      if (!allPlaced && !done) ctx.globalAlpha = 0.45;
      drawCinnabarSeal(ctx, sub.x + toolW / 2, sub.y + 30, 56, done ? '已破' : '呈堂', -0.05);
      ctx.globalAlpha = 1;
      zones.submitBtn = sub;
      return;
    }
    let x = toolX + 8;
    tools.forEach(tb => {
      const rect = { x, y: toolY, w: 46, h: TOOL_H };
      const active = (tb.key === 'x' && tool === 'x') || (tb.key === 'erase' && tool === 'erase');
      ctx.fillStyle = active ? 'rgba(177,58,48,0.18)' : 'rgba(242,236,221,0.10)';
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
      ctx.fill();
      ctx.strokeStyle = active ? '#b13a30' : 'rgba(214,182,92,0.45)';
      ctx.lineWidth = 1.1;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
      ctx.stroke();
      drawToolIcon(ctx, tb.key, rect.x + 23, rect.y + 17, 20, active ? '#b13a30' : t.fg);
      ctx.font = `10px ${FONTS.kai}`;
      ctx.fillStyle = active ? '#b13a30' : t.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tb.label, rect.x + 23, rect.y + 36);
      zones[tb.zone] = rect;
      x += 52;
    });
    // 自动排除开关
    const ax = { x, y: toolY, w: 34, h: TOOL_H };
    ctx.fillStyle = settings.autoX ? 'rgba(194,162,74,0.22)' : 'rgba(242,236,221,0.10)';
    roundRect(ctx, ax.x, ax.y, ax.w, ax.h, 8);
    ctx.fill();
    ctx.strokeStyle = settings.autoX ? '#c2a24a' : 'rgba(214,182,92,0.4)';
    ctx.lineWidth = 1.1;
    roundRect(ctx, ax.x, ax.y, ax.w, ax.h, 8);
    ctx.stroke();
    drawToolIcon(ctx, 'autoX', ax.x + 17, ax.y + TOOL_H / 2, 18, settings.autoX ? '#c2a24a' : t.muted);
    zones.autoXBtn = ax;
    // 呈堂（朱砂印；未集齐时淡印）
    const allPlaced = ready && Object.keys(placed).length === n;
    const sub = { x: toolX + toolW - 8 - 70, y: toolY - 5, w: 70, h: TOOL_H + 10 };
    if (!allPlaced && !done) ctx.globalAlpha = 0.45;
    drawCinnabarSeal(ctx, sub.x + sub.w / 2, sub.y + sub.h / 2, 50, done ? '已破' : '呈堂', -0.05);
    ctx.globalAlpha = 1;
    zones.submitBtn = sub;
  }

  function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, '');
  }

  /* 棋盘 token：裁底人像（透明底、缩小露出地板）+ 左上角简称徽章 */
  function drawToken(ctx, p, x, y) {
    const img = data.cut(p, board && board.theme && board.theme.id);
    if (img) {
      ctx.drawImage(img, x + cell * 0.06, y + cell * 0.02, cell * 0.88, cell * 0.96);
    } else {
      drawSVG(ctx, L.Art.avatarSVG(p.avatar), x + cell * 0.04, y + cell * 0.04, cell * 0.92, cell * 0.92);
    }
    ctx.fillStyle = 'rgba(245,238,218,0.92)';
    roundRect(ctx, x + 2, y + 2, 17, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.short, x + 10.5, y + 9);
  }

  /* 工笔头像（webp）优先，未加载完成回退参数化 SVG */
  function drawPortrait(ctx, p, x, y, w, h) {
    const img = data.portrait(p, board && board.theme && board.theme.id);
    if (img) ctx.drawImage(img, x, y, w, h);
    else drawSVG(ctx, L.Art.avatarSVG(p.avatar), x, y, w, h);
  }

  /* 通用线索卡（竖屏：固定在头部下方、棋盘上方；横屏并入左侧线索列首位） */
  function drawGeneral(ctx, t) {
    if (LAND) return;
    const lines = generalLines();
    if (!lines.length) return;
    const cw = boardSide + COORD;              // 与棋盘底边等宽（含纵轴）
    const gx = boardX - COORD;
    const y = TOP_SAFE + HEADER_BAND + 2;
    fillPaper(ctx, gx, y, cw, generalH - 4, 10, '#e7dcc2');   // 通用线索用深一档的宣纸，与角色卡区分
    ctx.strokeStyle = '#2a2620';
    ctx.lineWidth = 1.5;
    roundRect(ctx, gx, y, cw, generalH - 4, 10);
    ctx.stroke();
    ctx.fillStyle = '#9a7526';
    ctx.font = `bold 12px ${FONTS.kai}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('通用线索', gx + 10, y + 8);
    let ly = y + 26;
    lines.forEach(wl => {
      ctx.fillStyle = '#2a2620';
      ctx.font = `bold 13px ${FONTS.song}`;   // 证词宋体加粗（公堂视觉）
      ctx.fillText(wl.text, gx + 10, ly);
      ly += 18;
    });
  }

  /* 角色线索卡列表（竖屏：棋盘下方滚动带；横屏：左侧整列，通用卡在首位） */
  function drawClues(ctx, t) {
    const off = clueScroll.offset;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clueX, clueBandY, clueW, clueBandBottom - clueBandY);
    ctx.clip();
    ctx.translate(clueX, clueBandY - off);

    zones.clueCards = [];
    let y = 2;
    const cw = clueW - 16;

    // 横屏：通用线索卡并入列表首位
    if (LAND) {
      const lines = generalLines();
      const ch = lines.length * 18 + 30;
      fillPaper(ctx, 8, y, cw, ch, 10, '#e7dcc2');   // 通用线索用深一档的宣纸，与角色卡区分
      ctx.strokeStyle = '#2a2620';
      ctx.lineWidth = 1.5;
      roundRect(ctx, 8, y, cw, ch, 10);
      ctx.stroke();
      ctx.fillStyle = '#9a7526';
      ctx.font = `bold 12px ${FONTS.kai}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('通用线索', 18, y + 8);
      let gy = y + 26;
      lines.forEach(wl => {
        ctx.fillStyle = '#2a2620';
        ctx.font = `bold 13px ${FONTS.song}`;   // 证词宋体加粗（公堂视觉）
        ctx.fillText(wl.text, 18, gy);
        gy += 18;
      });
      y += ch + 6;
    }
    // 逐人卡（参照月球主题排布：头像放大居上，姓名/性别同行，证词在头像下方通栏）；整卡点按选人
    board.people.forEach(p => {
      const pairs = [];
      board.clues.forEach((clue, i) => {
        if (!GENERAL_TYPES.has(clue.type) && clue.p === p.id) pairs.push([clue, i]);
      });
      if (!pairs.length) return;
      const AV = 44;                            // 头像边长（原 28，月球主题同款放大）
      ctx.font = `bold 13px ${FONTS.song}`;
      const isPlaced = Object.values(placed).includes(p.id);
      const text = pairs.map(([c]) => stripTags(c.text)).join('');
      const lines = [];
      wrapText(ctx, text, cw - 28).forEach(s => lines.push(s));
      const ch = Math.max(66, 10 + AV + 8 + lines.length * 18 + 8);
      // 已放置者卡片底罩灰作区分（深浅主题均可见；透明度调和法在浅色主题下会隐形）；
      // 头像/姓名/性别/证词保持全亮
      fillPaper(ctx, 8, y, cw, ch, 10, '#f2ecdd');
      if (isPlaced) {
        ctx.fillStyle = 'rgba(80,80,80,0.30)';
        roundRect(ctx, 8, y, cw, ch, 10);
        ctx.fill();
      }
      ctx.strokeStyle = p.id === selected ? '#b13a30' : '#2a2620';
      ctx.lineWidth = p.id === selected ? 2 : 1.5;
      roundRect(ctx, 8, y, cw, ch, 10);
      ctx.stroke();
      // 头像（大）+ 右下角简称徽章
      drawPortrait(ctx, p, 14, y + 10, AV, AV);
      ctx.fillStyle = 'rgba(242,236,221,0.95)';
      roundRect(ctx, 14 + AV - 16, y + 10 + AV - 15, 16, 13, 3);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.font = `bold 10px ${FONTS.kai}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.short, 14 + AV - 8, y + 10 + AV - 8.5);
      // 姓名 + 简称 + 性别：与头像同行、垂直居中（被害者标明身份；简称对应棋盘批注字母）
      const nameX = 14 + AV + 10, nameY = y + 10 + AV / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.id === selected ? '#b13a30' : '#6b5f3a';
      ctx.font = `bold 13px ${FONTS.kai}`;
      const namePart = `${p.name}（${p.short}）${p.isVictim ? '（被害者）' : ''}`;
      ctx.fillText(namePart, nameX, nameY);
      // 性别符号单独 middle 基线绘制（部分机型符号字体与中文基线不齐，真机曾见下沉错位）
      ctx.fillText(p.gender === 'F' ? '♀' : '♂', nameX + ctx.measureText(namePart).width + 5, nameY);
      // 证词：头像下方通栏（宋体加粗）
      let ly = y + 10 + AV + 8;
      ctx.textBaseline = 'top';
      lines.forEach(s => {
        ctx.fillStyle = '#2a2620';
        ctx.font = `bold 13px ${FONTS.song}`;
        ctx.fillText(s, 14, ly);
        ly += 18;
      });
      zones.clueCards.push({ x: 8, y, w: cw, h: ch, p: p.id });
      y += ch + 6;
    });

    clueScroll.setRange(y, clueBandBottom - clueBandY);
    ctx.restore();

    // 滚动条：让玩家感知线索区可下滑
    const bandH = clueBandBottom - clueBandY;
    const cardR = clueX + clueW - 8;
    const frameR = Math.min(W - 2, cardR + 6);
    if (y > bandH) {                       // 内容超高才显示滚动条
      const maxOff = y - bandH;
      const ratio = Math.max(0, Math.min(1, clueScroll.offset / maxOff));
      const trackX = frameR - 6;
      const thumbH = Math.max(24, bandH * bandH / y);
      const thumbY = clueBandY + 3 + (bandH - 6 - thumbH) * ratio;
      ctx.fillStyle = 'rgba(42,38,32,0.10)';
      roundRect(ctx, trackX, clueBandY + 3, 3, bandH - 6, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(42,38,32,0.45)';
      roundRect(ctx, trackX, thumbY, 3, thumbH, 1.5);
      ctx.fill();
    }
  }

  /* <b> 加粗段折行渲染：返回 lines: [[{t, b}...], ...] */
  function wrapRich(ctx, text, maxW, fontN, fontB) {
    const parts = [];
    let bold = false;
    for (const tok of String(text).split(/(<b>|<\/b>)/)) {
      if (tok === '<b>') { bold = true; continue; }
      if (tok === '</b>') { bold = false; continue; }
      if (tok) parts.push({ t: tok, b: bold });
    }
    const lines = [];
    let cur = [], curW = 0;
    for (const part of parts) {
      for (const ch of part.t) {
        ctx.font = part.b ? fontB : fontN;
        const w = ctx.measureText(ch).width;
        if (curW + w > maxW && cur.length) { lines.push(cur); cur = []; curW = 0; }
        if (cur.length && cur[cur.length - 1].b === part.b) cur[cur.length - 1].t += ch;
        else cur.push({ t: ch, b: part.b });
        curW += w;
      }
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  function drawHintModal(ctx, t) {
    const { steps, idx } = hintModal;
    const text = steps.length ? steps[idx] : '本局暂无更多可推断的提示。';
    // 提点卡嵌入角色线索区：同位置同尺寸，文本可滚动，横竖屏一致
    const card = { x: clueX + 8, y: clueBandY, w: clueW - 16, h: clueBandBottom - clueBandY };
    zones.hintCard = card;
    fillPaper(ctx, card.x, card.y, card.w, card.h, 12, '#f2ecdd');
    ctx.fillStyle = t.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `16px ${FONTS.kai}`;
    ctx.fillText(steps.length ? `提点 ${idx + 1}/${steps.length}` : '提点', card.x + card.w / 2, card.y + 22);
    // 文本区（超高可滚动）
    const tx = card.x + 16, ty = card.y + 40;
    const tw = card.w - 40, th = card.h - 40 - 46;
    const bodyF = `13px ${FONTS.song}`, bodyB = `bold 13px ${FONTS.song}`;
    ctx.font = bodyF;
    const lines = wrapRich(ctx, text, tw, bodyF, bodyB);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx - 2, ty, tw + 10, th);
    ctx.clip();
    ctx.translate(0, -hintScroll.offset);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((segs, i) => {
      let x = tx;
      const y = ty + i * 20;
      for (const seg of segs) {
        ctx.font = seg.b ? bodyB : bodyF;
        ctx.fillStyle = seg.b ? t.gold : t.fg;
        ctx.fillText(seg.t, x, y);
        x += ctx.measureText(seg.t).width;
      }
    });
    ctx.restore();
    const contentH = lines.length * 20;
    hintScroll.setRange(contentH, th);
    if (contentH > th) {   // 滚动条
      const ratio = Math.max(0, Math.min(1, hintScroll.offset / (contentH - th)));
      const thumbH = Math.max(20, th * th / contentH);
      const thumbY = ty + (th - thumbH) * ratio;
      ctx.fillStyle = 'rgba(128,118,96,0.45)';
      roundRect(ctx, card.x + card.w - 8, thumbY, 3, thumbH, 1.5);
      ctx.fill();
    }
    ctx.textBaseline = 'middle';
    zones.hintClose = { x: card.x + card.w - 36, y: card.y + 8, w: 28, h: 28 };
    ctx.fillStyle = t.muted;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', zones.hintClose.x + 14, zones.hintClose.y + 14);
    zones.hintPrev = idx > 0 ? { x: card.x + 16, y: card.y + card.h - 38, w: 60, h: 30 } : null;
    zones.hintNext = idx < steps.length - 1 ? { x: card.x + card.w - 76, y: card.y + card.h - 38, w: 60, h: 30 } : null;
    if (zones.hintPrev) {
      ctx.fillStyle = t.cardEdge;
      roundRect(ctx, zones.hintPrev.x, zones.hintPrev.y, 60, 30, 8);
      ctx.fill();
      ctx.fillStyle = t.fg;
      ctx.fillText('‹', zones.hintPrev.x + 30, zones.hintPrev.y + 15);
    }
    if (zones.hintNext) {
      ctx.fillStyle = t.cardEdge;
      roundRect(ctx, zones.hintNext.x, zones.hintNext.y, 60, 30, 8);
      ctx.fill();
      ctx.fillStyle = t.fg;
      ctx.fillText('›', zones.hintNext.x + 30, zones.hintNext.y + 15);
    }
  }

  /* 玩法说明弹层（关卡内）：居中卡片 + 遮罩，文本可滚动 */
  function drawHowtoModal(ctx, t) {
    ctx.fillStyle = t.dim;
    ctx.fillRect(0, 0, W, H);
    const cw2 = LAND ? Math.min(520, W - 48) : W - 48;
    const card = LAND
      ? { x: (W - cw2) / 2, y: 24, w: cw2, h: H - 48 }
      : { x: 24, y: 56, w: cw2, h: H - 128 };
    zones.howtoCard = card;
    fillPaper(ctx, card.x, card.y, card.w, card.h, 12, '#f2ecdd');
    ctx.fillStyle = t.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `17px ${FONTS.kai}`;
    ctx.fillText('玩法说明', card.x + card.w / 2, card.y + 22);
    const tx = card.x + 16, ty = card.y + 40;
    const tw = card.w - 32, th = card.h - 40 - 12;
    ctx.font = `12px ${FONTS.song}`;
    let howtoText = data.HOWTO;
    if (board) {
      // 本关器物说明：哪些可坐哪些不可坐（按类型去重）
      const seen = {};
      board.objects.forEach(o => { seen[o.key] = o; });
      const types = Object.values(seen);
      const can = types.filter(o => o.sittable).map(o => o.name);
      const cant = types.filter(o => !o.sittable).map(o => o.name);
      howtoText += `\n【本关器物】\n· 可坐：${can.join('、') || '无'}\n· 不可坐：${cant.join('、') || '无'}`;
    }
    const lines = [];
    howtoText.split('\n').forEach(raw => wrapText(ctx, raw, tw).forEach(s => lines.push(s)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx - 2, ty, tw + 10, th);
    ctx.clip();
    ctx.translate(0, -howtoScroll.offset);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = t.fg;
    lines.forEach((s, i) => ctx.fillText(s, tx, ty + i * 19));
    ctx.restore();
    const contentH = lines.length * 19;
    howtoScroll.setRange(contentH, th);
    if (contentH > th) {
      const ratio = Math.max(0, Math.min(1, howtoScroll.offset / (contentH - th)));
      const thumbH = Math.max(20, th * th / contentH);
      const thumbY = ty + (th - thumbH) * ratio;
      ctx.fillStyle = 'rgba(128,118,96,0.45)';
      roundRect(ctx, card.x + card.w - 8, thumbY, 3, thumbH, 1.5);
      ctx.fill();
    }
    ctx.textBaseline = 'middle';
    zones.howtoClose = { x: card.x + card.w - 36, y: card.y + 8, w: 28, h: 28 };
    ctx.fillStyle = t.muted;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', zones.howtoClose.x + 14, zones.howtoClose.y + 14);
  }

  /* 已破案重进：再给一次的选择层 */
  function drawReplay(ctx, t) {
    ctx.fillStyle = t.dim;
    ctx.fillRect(0, 0, W, H);
    const card = { x: 28, y: H * 0.32, w: W - 56, h: 210 };
    ctx.fillStyle = t.card;
    roundRect(ctx, card.x, card.y, card.w, card.h, 14);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.gold;
    ctx.font = `18px ${FONTS.kai}`;
    ctx.fillText('本案已破', W / 2, card.y + 44);
    ctx.fillStyle = t.muted;
    ctx.font = '12px sans-serif';
    ctx.fillText('卷宗已录。可重开现场，再推一遍。', W / 2, card.y + 76);
    zones.replayBtn = { x: card.x + 24, y: card.y + card.h - 106, w: card.w - 48, h: 42 };
    ctx.fillStyle = t.accent;
    roundRect(ctx, zones.replayBtn.x, zones.replayBtn.y, zones.replayBtn.w, 42, 10);
    ctx.fill();
    ctx.fillStyle = '#f5eeda';
    ctx.font = '15px sans-serif';
    ctx.fillText('再玩一次', W / 2, zones.replayBtn.y + 21);
    zones.replayHome = { x: card.x + 24, y: card.y + card.h - 56, w: card.w - 48, h: 38 };
    ctx.strokeStyle = t.cardEdge;
    ctx.lineWidth = 1;
    roundRect(ctx, zones.replayHome.x, zones.replayHome.y, zones.replayHome.w, 38, 10);
    ctx.stroke();
    ctx.fillStyle = t.muted;
    ctx.font = '14px sans-serif';
    ctx.fillText('返回', W / 2, zones.replayHome.y + 19);
  }

  function drawWin(ctx, t) {
    ctx.fillStyle = t.dim;
    ctx.fillRect(0, 0, W, H);
    const card = { x: 28, y: H * 0.20, w: W - 56, h: 330 };
    ctx.fillStyle = t.card;
    roundRect(ctx, card.x, card.y, card.w, card.h, 14);
    ctx.fill();
    const murderer = board.people[board.murdererId];
    const victim = board.people[board.victimId];
    drawSeal(ctx, W / 2, card.y + 14, 40);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.gold;
    ctx.font = `20px ${FONTS.kai}`;
    ctx.fillText('真相大白！', W / 2, card.y + 68);
    ctx.fillStyle = t.fg;
    ctx.font = '13px sans-serif';
    ctx.fillText('提刑官明察秋毫！真凶已然伏法：', W / 2, card.y + 96);
    drawPortrait(ctx, murderer, W / 2 - 74, card.y + 114, 44, 44);
    drawPortrait(ctx, victim, W / 2 + 30, card.y + 114, 44, 44);
    ctx.fillStyle = t.fg;
    ctx.font = '13px sans-serif';
    ctx.fillText(`${murderer.name}  杀害了  ${victim.name}`, W / 2, card.y + 176);
    ctx.fillStyle = t.muted;
    ctx.font = '12px sans-serif';
    ctx.fillText(`用时 ${fmtTime(seconds)} · 提点 ${hintsUsed} 次 · ${board.size}×${board.size}`, W / 2, card.y + 200);
    zones.winNext = null;
    zones.winHome = null;
    if (opts.next) {
      zones.winNext = { x: card.x + 24, y: card.y + card.h - 116, w: card.w - 48, h: 42 };
      ctx.fillStyle = t.accent;
      roundRect(ctx, zones.winNext.x, zones.winNext.y, zones.winNext.w, 42, 10);
      ctx.fill();
      ctx.fillStyle = '#f5eeda';
      ctx.font = '15px sans-serif';
      ctx.fillText('下一案 →', W / 2, zones.winNext.y + 21);
    }
    zones.winHome = { x: card.x + 24, y: card.y + card.h - 64, w: card.w - 48, h: 40 };
    ctx.strokeStyle = t.cardEdge;
    ctx.lineWidth = 1;
    roundRect(ctx, zones.winHome.x, zones.winHome.y, zones.winHome.w, 40, 10);
    ctx.stroke();
    ctx.fillStyle = t.muted;
    ctx.font = '14px sans-serif';
    ctx.fillText('返回', W / 2, zones.winHome.y + 20);
  }

  /* ================================================================
     场景接口
     ================================================================ */
  // PC 端：右键 = 对格打/撤排除叉（不切当前工具；单槽注册，换场景自动覆盖）
  if (typeof wx !== 'undefined' && wx.onContextMenu) {
    wx.onContextMenu(e => {
      const t0 = e.touches && e.touches[0];
      if (!t0 || !ready) return;
      const i = cellAt(t0.clientX, t0.clientY);
      if (i >= 0) { toggleMark(i, 'x'); vibrate(); }
    });
  }
  const scene = {
    zones,

    onShow() {
      setTimeout(init, 30);
    },

    onHide() {
      clearInterval(timerInt);
      clearTimeout(holdTimer);
      saveNow();
    },

    /* 横竖屏切换：尺寸变化后按原参数重建（进度经 saveNow 落盘恢复） */
    recreate() {
      if (ready) saveNow();
      return createPlayScene(manager, opts);
    },

    render(ctx) {
      const t = theme();
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, H);

      // 头部：返回+案名靠最顶（竖屏对齐胶囊高度，利用胶囊左侧空区）；右侧控件群竖屏低于胶囊、横屏靠顶
      const hdrY = (W > H) ? HDR_TOP
        : (capsule && capsule.height ? capsule.top + Math.max(0, (capsule.height - HEADER_BAND) / 2) : 10);
      const hdrYCtl = (W > H) ? HDR_TOP : TOP_SAFE;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.fg;
      ctx.font = '20px sans-serif';
      ctx.fillText('←', 14, hdrY + HEADER_BAND / 2);
      zones.back = { x: 0, y: hdrY, w: 48, h: HEADER_BAND };
      ctx.font = `15px ${FONTS.kai}`;
      // 标题：优先卷宗卡上的去重案名（主题案名仅 8 个会重名）
      const title = opts.title || (board && board.theme && board.theme.caseName);
      ctx.fillText(title, 44, hdrY + 11);
      // 操作提示小字（常有玩家误把单击标记当放置，常驻提醒）
      ctx.font = `9px ${FONTS.song}`;
      ctx.fillStyle = t.muted;
      ctx.fillText('单击标记 · 长按放置 · 长按擦除清空全部', 44, hdrY + 25);
      ctx.fillStyle = t.fg;
      // 右侧控件群（2 区）：主题 ← 切换 ← 计时，间距明确；横屏时收在胶囊左缘以内
      const hdrRight = (LAND && capsule && capsule.left) ? capsule.left - 8 : W - 8;
      ctx.textAlign = 'center';
      ctx.font = '15px sans-serif';
      drawThemeIcon(ctx, hdrRight - 18, hdrYCtl + HEADER_BAND / 2, 11, themeName() === 'light', t.fg, t.bg);
      zones.themeBtn = { x: hdrRight - 34, y: hdrYCtl + 2, w: 32, h: 32 };
      // 玩法说明入口（关卡内随时查术语/手法）
      zones.howtoBtn = { x: hdrRight - 76, y: hdrYCtl + 2, w: 32, h: 32 };
      ctx.fillStyle = t.muted;
      ctx.font = '16px sans-serif';
      ctx.fillText('？', hdrRight - 60, hdrYCtl + HEADER_BAND / 2);
      const rotX = hdrRight - 76 - 10 - 40;
      if (canRotate()) {
        zones.rotateBtn = { x: rotX, y: hdrYCtl + 4, w: 40, h: 28 };
        ctx.strokeStyle = t.muted;
        ctx.lineWidth = 1;
        roundRect(ctx, rotX, hdrYCtl + 4, 40, 28, 6);
        ctx.stroke();
        ctx.fillStyle = t.muted;
        ctx.font = '11px sans-serif';
        ctx.fillText(LAND ? '竖屏' : '横屏', rotX + 20, hdrYCtl + HEADER_BAND / 2);
      }
      ctx.textAlign = 'right';
      ctx.font = '13px monospace';
      ctx.fillStyle = t.muted;
      ctx.fillText(fmtTime(seconds), rotX - 10, hdrYCtl + HEADER_BAND / 2);

      if (!ready) {
        ctx.textAlign = 'center';
        ctx.fillStyle = t.muted;
        ctx.font = '14px sans-serif';
        ctx.fillText(loadFailed ? '生成失败，请返回重试' : '🔎 勘验现场、搜集蛛丝马迹…', W / 2, H / 2);
        return;
      }

      drawGeneral(ctx, t);
      drawBoard(ctx, t);
      drawToolbar(ctx, t);
      drawClues(ctx, t);

      // toast
      if (Date.now() < toastUntil) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        const tw = ctx.measureText(toastMsg).width + 32;
        roundRect(ctx, (W - tw) / 2, toolY - 40, tw, 30, 15);
        ctx.fill();
        ctx.fillStyle = '#f5eeda';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(toastMsg, W / 2, toolY - 25);
        manager.invalidate(); // 到期自动消失
      }

      if (hintModal) drawHintModal(ctx, t);
      if (showHowto) drawHowtoModal(ctx, t);
      if (showReplay) drawReplay(ctx, t);
      if (showWin) drawWin(ctx, t);
    },

    onTap(x, y) {
      if (!ready) {
        if (hit(zones.back, x, y)) manager.back();
        return;
      }
      if (hintModal) {
        if (hit(zones.hintClose, x, y) || !hit(zones.hintCard, x, y)) {
          hintModal = null;
        } else if (zones.hintPrev && hit(zones.hintPrev, x, y)) {
          hintModal.idx--;
          hintScroll.reset();
        } else if (zones.hintNext && hit(zones.hintNext, x, y)) {
          hintModal.idx++;
          hintScroll.reset();
        }
        manager.invalidate();
        return;
      }
      if (showHowto) {
        if (hit(zones.howtoClose, x, y) || !hit(zones.howtoCard, x, y)) showHowto = false;
        manager.invalidate();
        return;
      }
      if (showReplay) {
        if (zones.replayBtn && hit(zones.replayBtn, x, y)) {
          // 重开一局：清进行档（破案记录在卷宗列表以最新完成为准）
          placed = {};
          marks = {};
          placedStash = {};
          hintCells = new Set();
          undoStack.length = 0;
          hintsUsed = 0;
          seconds = 0;
          done = false;
          showReplay = false;
          timerOn = true;
          saveNow();
          manager.invalidate();
        } else if (zones.replayHome && hit(zones.replayHome, x, y)) {
          manager.back();
        }
        return;
      }
      if (showWin) {
        if (zones.winNext && hit(zones.winNext, x, y)) {
          manager.swap(createPlayScene(manager, opts.next));
        } else if (zones.winHome && hit(zones.winHome, x, y)) {
          manager.back();
        }
        return;
      }
      if (hit(zones.back, x, y)) { manager.back(); return; }
      if (hit(zones.themeBtn, x, y)) {
        settings.theme = toggleTheme();
        L.Storage.saveSettings(settings);
        manager.invalidate();
        return;
      }
      if (zones.rotateBtn && hit(zones.rotateBtn, x, y)) {
        toggleOrientation(W, H);
        return;
      }
      if (zones.howtoBtn && hit(zones.howtoBtn, x, y)) {
        showHowto = true;
        howtoScroll.reset();
        manager.invalidate();
        return;
      }

      // 工具栏
      if (hit(zones.xBtn, x, y)) { tool = tool === 'x' ? 'note' : 'x'; manager.invalidate(); return; }
      if (hit(zones.eraseBtn, x, y)) { tool = tool === 'erase' ? 'note' : 'erase'; manager.invalidate(); return; }
      if (hit(zones.undoBtn, x, y)) { undo(); return; }
      if (hit(zones.hintBtn, x, y)) { useHint(); return; }
      if (hit(zones.autoXBtn, x, y)) {
        settings.autoX = !settings.autoX;
        L.Storage.saveSettings(settings);
        manager.invalidate();
        return;
      }
      if (hit(zones.submitBtn, x, y)) { submit(); return; }

      // 棋盘
      const i = cellAt(x, y);
      if (i >= 0) {
        if (holdFired) return; // 长按放置后的抬起，不再触发点按
        // 不可坐物件格：仅展示物件名（本就不可站/坐，无法标记）。
        // 可坐物件格与普通格同等待遇（对齐 Web 版）：批注/排除/擦除照常，已放置则点按拿起。
        if (objAt[i] && !board.occupiable[i]) {
          toast(objAt[i].name);
          manager.invalidate();
          return;
        }
        // 可坐物件格：单击也报器物名（不拦截批注/拿起等操作）
        if (objAt[i]) toast(objAt[i].name);
        if (tool === 'note') {
          if (placed[i] !== undefined) unplace(i);
          else toggleMark(i, 'note');
        } else if (tool === 'x') {
          toggleMark(i, 'x');
        } else if (tool === 'erase') {
          eraseCell(i);
        }
        return;
      }

      // 点按证人卡（整卡）选人
      if (zones.clueCards) {
        const cx = x - clueX;
        const cy = y + clueScroll.offset - clueBandY;
        for (const z of zones.clueCards) {
          if (hit(z, cx, cy)) {
            selected = z.p;
            tool = 'note';
            manager.invalidate();
            return;
          }
        }
      }
    },

    onTouchStart(x, y) {
      if (hintModal) {   // 提点卡内滑动翻文本
        if (zones.hintCard && hit(zones.hintCard, x, y)) hintScroll.onStart(y);
        return;
      }
      if (showHowto) {   // 玩法说明卡内滑动
        if (zones.howtoCard && hit(zones.howtoCard, x, y)) howtoScroll.onStart(y);
        return;
      }
      if (!ready || done || showWin) return;
      // 棋盘手势
      const i = cellAt(x, y);
      if (i >= 0) {
        downCell = i;
        downX = x; downY = y;
        painting = true;
        lastPaint = i;
        hlRoom = board.roomAt[i];
        if (tool === 'note' && placed[i] === undefined && board.occupiable[i] && !hasAnyX(i)) {
          holdCell = i;
          holdStart = Date.now();
          holdFired = false;
          holdTimer = setTimeout(() => {
            holdFired = true;
            holdCell = -1;
            placePerson(selected, i);
          }, HOLD_MS);
          manager.invalidate();
        }
        return;
      }
      // 橡皮长按清空
      if (hit(zones.eraseBtn, x, y)) {
        this._eraseTimer = setTimeout(() => { clearAll(); this._eraseTimer = null; }, ERASE_ALL_HOLD_MS);
        return;
      }
      // 线索区滚动（仅线索带内；下方是棋盘/功能区）
      if (y >= clueBandY && y < clueBandBottom && x >= clueX && x <= clueX + clueW) clueScroll.onStart(y);
    },

    onTouchMove(x, y) {
      if (hintModal) { hintScroll.onMove(y); return; }
      if (showHowto) { howtoScroll.onMove(y); return; }
      if (!ready) return;
      if (painting) {
        // 位移未出容差视为静止：防真机抖动误取消长按/误批注邻格（格子上方抖动越界同理）
        if (Math.hypot(x - downX, y - downY) <= DRAG_SLOP) return;
        clearTimeout(holdTimer);
        holdCell = -1;
        // 拖动成立：先补标起点格（此前在等待长按判定，未标记）
        if (!holdFired && downCell >= 0 && (tool === 'note' || tool === 'x') &&
            placed[downCell] === undefined && board.occupiable[downCell] && !hasAnyX(downCell)) {
          marks[downCell] = marks[downCell] || {};
          const kind0 = tool === 'x' ? 'x' : 'note';
          if (marks[downCell][selected] !== kind0) {
            marks[downCell][selected] = kind0;
            ensureTimer();
            saveSoon();
            manager.invalidate();
          }
        }
        const i = cellAt(x, y);
        if (i === lastPaint) return;
        lastPaint = i;
        if (i < 0 || holdFired) return;
        if (placed[i] === undefined && board.occupiable[i] && !hasAnyX(i)) {
          if (tool === 'note' || tool === 'x') {   // 滑动连续批注/打叉（已打叉格跳过，仅擦除可改）
            marks[i] = marks[i] || {};
            const kind = tool === 'x' ? 'x' : 'note';
            if (marks[i][selected] !== kind) {
              marks[i][selected] = kind;
              ensureTimer();
              saveSoon();
              manager.invalidate();
            }
          }
        }
        return;
      }
      if (y >= clueBandY && y < clueBandBottom && x >= clueX && x <= clueX + clueW) clueScroll.onMove(y);
    },

    onTouchEnd() {
      clearTimeout(holdTimer);
      if (this._eraseTimer) {
        clearTimeout(this._eraseTimer);
        this._eraseTimer = null;
      }
      holdCell = -1;
      painting = false;
      hlRoom = -1;
      clueScroll.onEnd();
      hintScroll.onEnd();
      howtoScroll.onEnd();
      // holdFired 在下一帧渲染前由 onTap 检查，这里延迟复位
      setTimeout(() => { holdFired = false; }, 0);
      manager.invalidate();
    },

    /* 冒烟测试钩子 */
    debug: {
      state: () => ({ placed, marks, hintsUsed, seconds, done, selected, ready, showReplay }),
      board: () => board,
      layout: () => ({ boardX, boardY, boardSide, clueBandY, clueBandBottom }),
      place: placePerson,
      submit,
      toggleMark,
      eraseCell,
      undo,
      clearAll,
      useHint
    }
  };
  return scene;
}

module.exports = { createPlayScene };

});
__def("src/ui/cases.js", function (require, module, exports) {
/* 卷宗列表场景：12 案缩略图卡片 + 进度印章（对应 Web 版 main.js showCaseList）。
 * 棋盘缩略图逐张异步生成（getBoard 有缓存，重进秒开）。 */
const data = require('src/ui/data.js');
const { createPlayScene } = require('src/ui/play.js');
const { theme, FONTS } = require('src/ui/theme.js');
const { roundRect, hit, fmtTime, drawLockSeal, fillPaper } = require('src/ui/widgets.js');
const { createScroll } = require('src/ui/scroll.js');
const { drawSVG } = require('src/ui/svgmini.js');

const MARGIN = 12;
const GAP = 10;
const HEADER_H = 56;

/* 卷宗第 i 案的场景参数（含「下一案」链） */
function caseOpts(L, diff, i) {
  return {
    seed: data.caseSeed(diff, i),
    diff,
    title: `「${data.caseNameAt(diff, i)}」· ${L.Generator.DIFFICULTY[diff].label}`,
    next: i + 1 < data.caseCount(diff) ? caseOpts(L, diff, i + 1) : null
  };
}

function createCasesScene(manager, diff) {
  const L = manager.L;
  const d = L.Generator.DIFFICULTY[diff];
  const W = manager.view.width;
  const H = manager.view.height;
  const scroll = createScroll();
  const boards = new Array(data.caseCount(diff)).fill(null);
  const zones = { back: { x: 0, y: 0, w: 56, h: HEADER_H }, cards: [] };
  let generated = 0;

  function genNext() {
    if (generated >= data.caseCount(diff)) return;
    const i = generated++;
    boards[i] = data.getBoard(data.caseSeed(diff, i), diff);
    if (!boards[i]) boards[i] = 'MISS'; // 题库未收录：不阻塞，标占位
    manager.invalidate();
    setTimeout(genNext, 10);
  }

  /* 棋盘缩略图：地板色 + 房间墙线 + 物件（优先 PNG），对应 Web 版 renderPreview */
  function drawThumb(ctx, board, x, y, w) {
    const n = board.size;
    const cell = w / n;
    const objAt = {};
    board.objects.forEach(o => { objAt[o.cell] = o; });
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n), c = i % n;
      const fkey = board.rooms[board.roomAt[i]].floor;
      const fimg = data.floorImg(fkey, board.theme && board.theme.id);
      if (fimg) {
        ctx.drawImage(fimg, c * cell, r * cell, cell, cell);
      } else {
        ctx.fillStyle = data.FLOOR_COLORS[fkey] || '#f4f0e6';
        ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
      }
    }
    ctx.strokeStyle = '#161616';
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.beginPath();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const room = board.roomAt[i];
        if (r === 0 || board.roomAt[i - n] !== room) {
          ctx.moveTo(c * cell, r * cell);
          ctx.lineTo((c + 1) * cell, r * cell);
        }
        if (r === n - 1 || board.roomAt[i + n] !== room) {
          ctx.moveTo(c * cell, (r + 1) * cell);
          ctx.lineTo((c + 1) * cell, (r + 1) * cell);
        }
        if (c === 0 || board.roomAt[i - 1] !== room) {
          ctx.moveTo(c * cell, r * cell);
          ctx.lineTo(c * cell, (r + 1) * cell);
        }
        if (c === n - 1 || board.roomAt[i + 1] !== room) {
          ctx.moveTo((c + 1) * cell, r * cell);
          ctx.lineTo((c + 1) * cell, (r + 1) * cell);
        }
      }
    }
    ctx.stroke();
    Object.keys(objAt).forEach(k => {
      const i = Number(k);
      const r = Math.floor(i / n), c = i % n;
      const oimg = data.objectImg(objAt[i].key, board.theme && board.theme.id);
      if (oimg) {
        ctx.drawImage(oimg, c * cell + cell * 0.07, r * cell + cell * 0.07, cell * 0.86, cell * 0.86);
      } else {
        const svg = L.Art.OBJECT_SPRITES[objAt[i].key];
        if (svg) drawSVG(ctx, svg, c * cell + cell * 0.12, r * cell + cell * 0.12, cell * 0.76, cell * 0.76);
      }
    });
    ctx.restore();
  }

  const scene = {
    zones,

    onShow() { setTimeout(genNext, 30); },

    /* 横竖屏切换后按新尺寸重建卷宗页 */
    recreate() { return createCasesScene(manager, diff); },

    render(ctx) {
      const t = theme();
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, H);

      const off = scroll.offset;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, HEADER_H, W, H - HEADER_H);   // 内容裁剪在页眉之下
      ctx.clip();
      ctx.translate(0, HEADER_H - off);

      const cols = W > H ? 4 : 2;   // 横屏四列
      const cardW = (W - MARGIN * 2 - GAP * (cols - 1)) / cols;
      const cardH = cardW + 62;
      zones.cards = [];
      let prevDone = true;   // 第 1 案始终解锁；之后破案逐一解锁下一案
      for (let i = 0; i < data.caseCount(diff); i++) {
        const prog = L.Storage.getProgress(data.caseSeed(diff, i));
        const unlocked = prevDone;
        prevDone = !!(prog && prog.done);
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = MARGIN + col * (cardW + GAP);
        const y = row * (cardH + GAP) + 6;
        zones.cards.push({ x, y, w: cardW, h: cardH, locked: !unlocked });

        fillPaper(ctx, x, y, cardW, cardH, 12, '#f2ecdd');

        const board = boards[i];
        if (board && board !== 'MISS') {
          // 直接绘制（离屏缓存曾在部分真机上把物件画成细条；图片到位会触发 invalidate 重绘补全）
          drawThumb(ctx, board, x + 6, y + 6, cardW - 12);
        } else {
          ctx.fillStyle = t.muted;
          ctx.textAlign = 'center';
          ctx.font = `12px ${FONTS.song}`;
          ctx.fillText(board === 'MISS' ? '题库待补' : '整理卷宗中…', x + cardW / 2, y + 6 + (cardW - 12) / 2);
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = '#2a2620';
        ctx.font = `bold 13px ${FONTS.kai}`;
        // 案件名：档内去重后的名字为准（主题案名只 8 个，直接用会重名）
        const displayName = data.caseNameAt(diff, i);
        ctx.fillText(`「${displayName}」`, x + cardW / 2, y + cardW + 22);

        let meta = `${d.label} · ${d.size}×${d.size}`;
        let metaColor = t.muted;
        if (!unlocked) {
          meta = '破前一案解锁';
        } else if (prog && prog.done) {
          meta = `已破 · ${fmtTime(prog.seconds || 0)}`;
          metaColor = t.ok;
        } else if (prog && prog.placed && Object.keys(prog.placed).length > 0) {
          meta = '进行中';
          metaColor = t.gold;
        }
        ctx.fillStyle = metaColor;
        ctx.font = `11px ${FONTS.song}`;
        ctx.fillText(meta, x + cardW / 2, y + cardW + 42);

        if (!unlocked) {
          // 锁态：整卡压暗 + 缩略图中央盖镂空朱砂印「未解锁」（图片未就位回退绘制版）
          ctx.fillStyle = 'rgba(20,18,14,0.45)';
          roundRect(ctx, x, y, cardW, cardH, 12);
          ctx.fill();
          const seal = data.lockSeal();
          if (seal) {
            const sw = Math.min(cardW * 0.62, 132);
            const sh = sw * 205 / 360;
            ctx.drawImage(seal, x + cardW / 2 - sw / 2, y + 6 + (cardW - 12) / 2 - sh / 2, sw, sh);
          } else {
            drawLockSeal(ctx, x + cardW / 2, y + 6 + (cardW - 12) / 2, 56, '未解锁');
          }
        }
      }

      const rows = Math.ceil(data.caseCount(diff) / cols);
      scroll.setRange(rows * (cardH + GAP) + 12, H - HEADER_H);
      ctx.restore();

      // 页眉最后画：不透明底 + 文字，始终压在最顶层
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, HEADER_H);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.fg;
      ctx.font = '20px sans-serif';
      ctx.fillText('←', 16, HEADER_H / 2);
      ctx.font = `17px ${FONTS.kai}`;
      ctx.fillText(`卷宗 · ${d.label}`, 48, HEADER_H / 2 - 9);
      ctx.font = `11px ${FONTS.song}`;
      ctx.fillStyle = t.muted;
      ctx.fillText(`${d.size}×${d.size} · ${d.size - 1} 名嫌疑人 · 1 名被害者`, 48, HEADER_H / 2 + 11);
    },

    onTap(x, y) {
      if (hit(zones.back, x, y)) {
        manager.back();
        return;
      }
      const cy = y + scroll.offset - HEADER_H;
      for (let i = 0; i < zones.cards.length; i++) {
        if (hit(zones.cards[i], x, cy) && !zones.cards[i].locked && boards[i] && boards[i] !== 'MISS') {
          manager.push(createPlayScene(manager, caseOpts(L, diff, i)));
          return;
        }
      }
    },

    onTouchStart(x, y) { scroll.onStart(y); },
    onTouchMove(x, y) { scroll.onMove(y); },
    onTouchEnd() { scroll.onEnd(); }
  };
  return scene;
}

module.exports = { createCasesScene };

});
__def("src/ui/home.js", function (require, module, exports) {
/* 主页场景（主题划分版）：主页（开始游戏/玩法说明）→ 主题选择 → 主题内难度 → 对局。
 * 弹层（玩法说明）在场景内以模态绘制；zones 暴露给冒烟测试。 */
const data = require('src/ui/data.js');
const { createPlayScene } = require('src/ui/play.js');
const { theme, themeName, toggleTheme, FONTS } = require('src/ui/theme.js');
const { roundRect, hit, drawSeal, drawLockSeal, wrapText, fillPaper, drawButton, drawThemeIcon, canRotate, toggleOrientation, fmtTime } = require('src/ui/widgets.js');
const { createScroll } = require('src/ui/scroll.js');

const HOWTO = data.HOWTO;

/* 难度分档（标题显示用）：5~6 非常简单 / 7~8 简单 / 9~10 中等 / 11~12 困难 / 13~14 专家 / 15~16 大师 */
const BANDS = [[5, '非常简单'], [7, '简单'], [9, '中等'], [11, '困难'], [13, '专家'], [15, '大师']];
function bandOf(size) {
  for (let i = BANDS.length - 1; i >= 0; i--) if (size >= BANDS[i][0]) return BANDS[i][1];
  return BANDS[0][1];
}

/* 顶部控件锚点：与对局页标题同高（竖屏对齐微信胶囊，无胶囊容器取 10） */
function headerTop(W, H) {
  if (W > H) return 10;
  const capsule = (typeof wx !== 'undefined' && wx.getMenuButtonBoundingClientRect)
    ? wx.getMenuButtonBoundingClientRect() : null;
  return capsule && capsule.height ? capsule.top + Math.max(0, (capsule.height - 34) / 2) : 10;
}

/* 主题+难度+第 ci 案的场景参数：「下一案」先在同难度内递进，尽头接下一难度首案 */
function makeCaseOpts(L, th, diffKey, ci) {
  const sameDiff = th.cases.filter(c => c.diff === diffKey);
  const diffsPresent = [...new Set(th.cases.map(c => c.diff))];   // cases 已按难度升序
  const c = sameDiff[ci];
  let next = null;
  if (ci + 1 < sameDiff.length) {
    next = makeCaseOpts(L, th, diffKey, ci + 1);
  } else {
    const di = diffsPresent.indexOf(diffKey);
    if (di >= 0 && di + 1 < diffsPresent.length) next = makeCaseOpts(L, th, diffsPresent[di + 1], 0);
  }
  return {
    seed: c.seed,
    diff: diffKey,
    title: `「${th.caseName}」· ${bandOf(c.size)} · ${c.size}×${c.size}`,
    next
  };
}

/* ---------- 玩法说明弹层（主页/主题页共用） ---------- */
function renderHowtoModal(ctx, t, W, H, zones, modalScroll) {
  ctx.fillStyle = t.dim;
  ctx.fillRect(0, 0, W, H);
  const card = { x: 24, y: 56, w: W - 48, h: H - 128 };
  zones.modalCard = card;
  fillPaper(ctx, card.x, card.y, card.w, card.h, 14, '#f2ecdd');
  ctx.fillStyle = t.gold;
  ctx.textAlign = 'center';
  ctx.font = `19px ${FONTS.kai}`;
  ctx.fillText('玩法说明', W / 2, card.y + 30);

  const bodyX = card.x + 20, bodyY = card.y + 52;
  const bodyW = card.w - 40, bodyH = card.h - 52 - 66;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bodyX, bodyY, bodyW, bodyH);
  ctx.clip();
  ctx.translate(0, -modalScroll.offset);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `13px ${FONTS.song}`;
  ctx.fillStyle = '#2a2620';
  const lines = wrapText(ctx, HOWTO, bodyW);
  let ly = bodyY;
  lines.forEach(line => {
    ctx.fillText(line, bodyX, ly);
    ly += 21;
  });
  modalScroll.setRange(lines.length * 21, bodyH);
  ctx.restore();
  ctx.textBaseline = 'middle';

  zones.modalClose = { x: card.x + 20, y: card.y + card.h - 54, w: card.w - 40, h: 42 };
  drawButton(ctx, t, zones.modalClose, '开始破案');
}

/* 主题器物/区域摘要（主题选择卡用） */
function themeInfo(th) {
  const spec = data.themeSpec(th.id);
  const objs = spec.objects.map(o => o.sittable ? `${o.name}(可坐)` : o.name).join('、');
  const rooms = spec.indoor.concat(spec.outdoor).join('、');
  return { objs, rooms };
}

/* ---------- 主页：只保留 玩法说明 + 开始游戏 ---------- */
function createHomeScene(manager) {
  const L = manager.L;
  const W = manager.view.width;
  const H = manager.view.height;
  const scroll = createScroll();
  const modalScroll = createScroll();
  let modal = null; // 'howto'
  const zones = {};

  const scene = {
    zones,
    onShow() {},
    recreate() { return createHomeScene(manager); },

    render(ctx) {
      const t = theme();
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, H);

      const CW = W > H ? Math.min(W, 640) : W;
      const OX = (W - CW) / 2;
      ctx.save();
      ctx.translate(OX, 0);

      // 内容块（印章+标题+副标题+双按钮）整体垂直居中，避免底部大片留空
      const blockH = 326;
      const sealY = Math.max(28, Math.round((H - blockH) / 2));
      drawSeal(ctx, CW / 2, sealY, 110);
      ctx.fillStyle = t.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `30px ${FONTS.kai}`;
      ctx.fillText('墨 案 缉 凶', CW / 2, sealY + 150);
      ctx.font = `12px ${FONTS.song}`;
      ctx.fillStyle = t.muted;
      ctx.fillText('南宋公案推理 —— 提刑官勘验现场，依证词断案缉凶', CW / 2, sealY + 180);

      zones.startBtn = { x: 32, y: sealY + 214, w: CW - 64, h: 48 };
      drawButton(ctx, t, zones.startBtn, '开始游戏');
      zones.howtoBtn = { x: 32, y: sealY + 278, w: CW - 64, h: 44 };
      drawButton(ctx, t, zones.howtoBtn, '玩法说明', { ghost: true });
      ctx.restore();

      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.fg;
      const hdrTop = headerTop(W, H);   // 左上角容器与对局页标题同高
      drawThemeIcon(ctx, 29, hdrTop + 17, 12, themeName() === 'light', t.fg, t.bg);
      zones.themeBtn = { x: 12, y: hdrTop, w: 34, h: 34 };
      if (canRotate()) {
        zones.rotateBtn = { x: 52, y: hdrTop + 3, w: 40, h: 28 };
        ctx.strokeStyle = t.muted;
        ctx.lineWidth = 1;
        roundRect(ctx, 52, hdrTop + 3, 40, 28, 6);
        ctx.stroke();
        ctx.fillStyle = t.muted;
        ctx.font = '11px sans-serif';
        ctx.fillText(W > H ? '竖屏' : '横屏', 72, hdrTop + 17);
      }

      if (modal === 'howto') renderHowtoModal(ctx, t, W, H, zones, modalScroll);
    },

    onTap(x, y) {
      if (modal === 'howto') {
        if (hit(zones.modalClose, x, y) || !hit(zones.modalCard, x, y)) modal = null;
        return;
      }
      if (hit(zones.themeBtn, x, y)) {
        const name = toggleTheme();
        const s = L.Storage.getSettings();
        s.theme = name;
        L.Storage.saveSettings(s);
        return;
      }
      if (zones.rotateBtn && hit(zones.rotateBtn, x, y)) {
        toggleOrientation(W, H);
        return;
      }
      const cx = x - (W > H ? (W - Math.min(W, 640)) / 2 : 0);
      if (hit(zones.startBtn, cx, y)) { manager.push(createThemeScene(manager)); return; }
      if (hit(zones.howtoBtn, cx, y)) modal = 'howto';
    },

    onTouchStart(x, y) { (modal ? modalScroll : scroll).onStart(y); },
    onTouchMove(x, y) { (modal ? modalScroll : scroll).onMove(y); },
    onTouchEnd() { scroll.onEnd(); modalScroll.onEnd(); }
  };
  return scene;
}

/* ---------- 主题选择页：主题卡（器物含可坐标注 + 区域清单 + 进度） ---------- */
function createThemeScene(manager) {
  const L = manager.L;
  const W = manager.view.width;
  const H = manager.view.height;
  const scroll = createScroll();
  const modalScroll = createScroll();
  let modal = null;
  const zones = { back: { x: 0, y: headerTop(W, H), w: 56, h: 44 }, themeCards: [] };

  const scene = {
    zones,
    recreate() { return createThemeScene(manager); },

    render(ctx) {
      const t = theme();
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, H);

      const CW = W > H ? Math.min(W, 640) : W;
      const OX = (W - CW) / 2;
      ctx.save();
      ctx.translate(OX, -scroll.offset);

      let y = headerTop(W, H) + 64;
      zones.themeCards = [];
      data.themeLadders().forEach(th => {
        const info = themeInfo(th);
        ctx.font = `11px ${FONTS.song}`;
        const objLines = wrapText(ctx, `器物：${info.objs}`, CW - 96);
        const roomLines = wrapText(ctx, `区域：${info.rooms}`, CW - 96);
        const cardH = 30 + objLines.length * 16 + roomLines.length * 16 + 14;
        const rect = { x: 24, y, w: CW - 48, h: cardH, th };
        const doneCount = th.cases.filter(c => {
          const p = L.Storage.getProgress(c.seed);
          return p && p.done;
        }).length;
        fillPaper(ctx, rect.x, rect.y, rect.w, rect.h, 12, '#f2ecdd');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#9a7526';
        ctx.font = `bold 15px ${FONTS.kai}`;
        ctx.fillText(`【${th.name}】${th.caseName}`, rect.x + 14, rect.y + 16);
        ctx.textAlign = 'right';
        ctx.fillStyle = doneCount ? t.ok : t.muted;
        ctx.font = `11px ${FONTS.song}`;
        ctx.fillText(`已破 ${doneCount}/${th.cases.length}`, rect.x + rect.w - 14, rect.y + 16);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#2a2620';
        let ly = rect.y + 30 + 8;
        objLines.forEach(s => { ctx.fillText(s, rect.x + 14, ly); ly += 16; });
        ctx.fillStyle = '#6b5f3a';
        roomLines.forEach(s => { ctx.fillText(s, rect.x + 14, ly); ly += 16; });
        zones.themeCards.push(rect);
        y += cardH + 12;
      });
      scroll.setRange(y + 16, H);
      ctx.restore();

      // 页眉：返回 + 标题（与对局页标题同高）
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, headerTop(W, H) + 52);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.fg;
      ctx.font = '20px sans-serif';
      ctx.fillText('←', 14, headerTop(W, H) + 26);
      ctx.font = `17px ${FONTS.kai}`;
      ctx.fillText('选择案发地', 44, headerTop(W, H) + 26);

      if (modal === 'howto') renderHowtoModal(ctx, t, W, H, zones, modalScroll);
    },

    onTap(x, y) {
      if (modal === 'howto') {
        if (hit(zones.modalClose, x, y) || !hit(zones.modalCard, x, y)) modal = null;
        return;
      }
      if (hit(zones.back, x, y)) { manager.back(); return; }
      const cx = x - (W > H ? (W - Math.min(W, 640)) / 2 : 0);
      const cy = y + scroll.offset;
      for (const rect of zones.themeCards) {
        if (hit(rect, cx, cy)) {
          manager.push(createDiffScene(manager, rect.th));
          return;
        }
      }
    },

    onTouchStart(x, y) { (modal ? modalScroll : scroll).onStart(y); },
    onTouchMove(x, y) { (modal ? modalScroll : scroll).onMove(y); },
    onTouchEnd() { scroll.onEnd(); modalScroll.onEnd(); }
  };
  return scene;
}

/* ---------- 主题内选案页：按难度分组、组内列案件；最低难度初始解锁，
 *   破上一难度任一案解锁下一难度，难度内破前一案解锁下一案 ---------- */
function createDiffScene(manager, th) {
  const L = manager.L;
  const W = manager.view.width;
  const H = manager.view.height;
  const scroll = createScroll();
  const zones = { back: { x: 0, y: headerTop(W, H), w: 56, h: 44 }, diffRows: [] };
  // 按难度分档分组（5~6 非常简单 … 15~16 大师），组内按尺寸升序
  const rows = [];
  th.cases.forEach(c => {
    const band = bandOf(c.size);
    let row = rows.find(r => r.band === band);
    if (!row) { row = { band, cases: [] }; rows.push(row); }
    row.cases.push(c);
  });

  const scene = {
    zones,
    recreate() { return createDiffScene(manager, th); },

    render(ctx) {
      const t = theme();
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, H);

      const CW = W > H ? Math.min(W, 640) : W;
      const OX = (W - CW) / 2;
      ctx.save();
      ctx.translate(OX, -scroll.offset);

      let y = headerTop(W, H) + 64;
      zones.diffRows = [];
      let prevDiffPassed = true;   // 上一难度已有案破获 → 本难度解锁；首难度恒解锁
      rows.forEach(row => {
        const doneFlags = row.cases.map(c => {
          const p = L.Storage.getProgress(c.seed);
          return !!(p && p.done);
        });
        const doneCount = doneFlags.filter(Boolean).length;
        const diffUnlocked = prevDiffPassed;
        prevDiffPassed = doneCount > 0;

        // 难度组头（不可点）：分档名 + 尺寸区间 + 进度
        const labelText = row.cases.length > 1
          ? `${row.band} · ${row.cases[0].size}×${row.cases[0].size} ~ ${row.cases[row.cases.length - 1].size}×${row.cases[row.cases.length - 1].size}`
          : `${row.band} · ${row.cases[0].size}×${row.cases[0].size}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = diffUnlocked ? t.gold : t.muted;
        ctx.font = '14px sans-serif';
        ctx.fillText(labelText, 32, y + 9);
        ctx.textAlign = 'right';
        ctx.fillStyle = t.muted;
        ctx.font = '11px sans-serif';
        ctx.fillText(`已破 ${doneCount}/${row.cases.length}`, CW - 32, y + 9);
        y += 26;

        // 案件行：难度内链式解锁（破前一案开下一案）
        let casePrev = diffUnlocked;
        row.cases.forEach((c, ci) => {
          const unlocked = casePrev;
          casePrev = doneFlags[ci];
          const rect = { x: 24, y, w: CW - 48, h: 40, row, ci, seed: c.seed, size: c.size, diff: c.diff, locked: !unlocked };
          ctx.fillStyle = t.card;
          roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
          ctx.fill();
          ctx.textAlign = 'left';
          ctx.fillStyle = unlocked ? t.fg : t.muted;
          ctx.font = '14px sans-serif';
          if (unlocked) {
            ctx.fillText(`${c.size}×${c.size}`, rect.x + 16, rect.y + 20);
          } else {
            const seal = data.lockSeal();
            if (seal) {
              const sh = 22, sw = sh * 360 / 205;
              ctx.drawImage(seal, rect.x + 14, rect.y + 20 - sh / 2, sw, sh);
              ctx.fillText(`${c.size}×${c.size}`, rect.x + 14 + sw + 8, rect.y + 20);
            } else {
              drawLockSeal(ctx, rect.x + 26, rect.y + 20, 20, '锁');
              ctx.fillText(`${c.size}×${c.size}`, rect.x + 42, rect.y + 20);
            }
          }
          ctx.textAlign = 'right';
          const prog = L.Storage.getProgress(c.seed);
          ctx.fillStyle = prog && prog.done ? t.ok : t.muted;
          ctx.font = '12px sans-serif';
          ctx.fillText(!unlocked ? '破前一案解锁'
            : (prog && prog.done ? `已破 · ${fmtTime(prog.seconds || 0)}`
              : (prog && prog.placed && Object.keys(prog.placed).length ? '进行中' : '未开始')),
            rect.x + rect.w - 14, rect.y + 20);
          ctx.textAlign = 'center';
          zones.diffRows.push(rect);
          y += 46;
        });
        y += 12;
      });
      scroll.setRange(y + 16, H);
      ctx.restore();

      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, W, headerTop(W, H) + 52);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.fg;
      ctx.font = '20px sans-serif';
      ctx.fillText('←', 14, headerTop(W, H) + 26);
      ctx.font = '15px sans-serif';
      ctx.fillText(`【${th.name}】${th.caseName}`, 44, headerTop(W, H) + 26);
    },

    onTap(x, y) {
      if (hit(zones.back, x, y)) { manager.back(); return; }
      const cx = x - (W > H ? (W - Math.min(W, 640)) / 2 : 0);
      const cy = y + scroll.offset;
      for (const rect of zones.diffRows) {
        if (hit(rect, cx, cy) && !rect.locked) {
          // 案件行直进（所见即所选；ci 换算为该难度键内的序号）
          const c = rect.row.cases[rect.ci];
          const sameDiff = th.cases.filter(x => x.diff === rect.diff);
          manager.push(createPlayScene(manager, makeCaseOpts(L, th, rect.diff, sameDiff.indexOf(c))));
          return;
        }
      }
    },

    onTouchStart(x, y) { scroll.onStart(y); },
    onTouchMove(x, y) { scroll.onMove(y); },
    onTouchEnd() { scroll.onEnd(); }
  };
  return scene;
}

module.exports = { createHomeScene };

});
__def("src/ui/scene.js", function (require, module, exports) {
/* 极简场景管理器：单 canvas，按需重绘（脏标记 + RAF 循环），触摸事件分发。
 * tap 判定：按下→抬起位移 ≤12px 视为点按，转发给当前场景的 onTap。
 * 场景接口：{ render(ctx, view), onShow?, onTap?(x,y), onTouchStart?, onTouchMove?, onTouchEnd? } */
function createSceneManager(canvas, ctx, view) {
  let current = null;
  let dirty = true;
  let downX = 0, downY = 0, moved = false;
  const stack = [];

  function frame() {
    if (dirty && current) {
      dirty = false;
      current.render(ctx, view);
    }
    requestAnimationFrame(frame);
  }

  function enter(scene) {
    if (current && current.onHide) current.onHide();
    current = scene;
    if (scene && scene.onShow) scene.onShow();
    dirty = true;
  }

  const manager = {
    L: view.L,
    view: view,
    invalidate() { dirty = true; },
    /* 替换整个导航栈（回到根场景） */
    replace(scene) {
      stack.length = 0;
      enter(scene);
    },
    /* 压栈前进 */
    push(scene) {
      if (current) stack.push(current);
      enter(scene);
    },
    /* 替换当前场景，保留返回栈（用于「下一案」衔接） */
    swap(scene) {
      enter(scene);
    },
    /* 出栈返回；返回 true 表示发生了跳转 */
    back() {
      if (!stack.length) return false;
      enter(stack.pop());
      return true;
    },
    /* 横竖屏切换：视图尺寸已更新后调用，按 recreate 钩子重建场景栈 */
    resize(w, h) {
      view.width = w;
      view.height = h;
      for (let i = 0; i < stack.length; i++) {
        if (stack[i] && typeof stack[i].recreate === 'function') stack[i] = stack[i].recreate();
      }
      if (current && typeof current.recreate === 'function') {
        enter(current.recreate());
      } else {
        dirty = true;
      }
    },
    current() { return current; }
  };

  wx.onTouchStart(e => {
    const t = e.touches[0];
    downX = t.clientX;
    downY = t.clientY;
    moved = false;
    if (current && current.onTouchStart) {
      current.onTouchStart(t.clientX, t.clientY, e);
      dirty = true;
    }
  });

  wx.onTouchMove(e => {
    const t = e.touches[0];
    if (Math.hypot(t.clientX - downX, t.clientY - downY) > 12) moved = true;
    if (current && current.onTouchMove) {
      current.onTouchMove(t.clientX, t.clientY, e);
      dirty = true;
    }
  });

  wx.onTouchEnd(e => {
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    const x = t ? t.clientX : downX;
    const y = t ? t.clientY : downY;
    if (current) {
      if (!moved && current.onTap) current.onTap(x, y, e);
      if (current.onTouchEnd) current.onTouchEnd(e);
      dirty = true;
    }
  });

  if (wx.onTouchCancel) {
    wx.onTouchCancel(e => {
      if (current && current.onTouchEnd) current.onTouchEnd(e);
    });
  }

  requestAnimationFrame(frame);
  return manager;
}

module.exports = { createSceneManager };

});
})();
