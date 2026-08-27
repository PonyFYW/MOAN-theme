/* 墨案缉凶 · 主题网页版入口（由微信小游戏 game.js 适配，同 xhs main.js 模式）：
 * 画布为 DOM <canvas>，尺寸由 JS 直算（window.innerWidth/innerHeight − 安全区探针实测值），
 * 不依赖 CSS 的 top/bottom 约束求值。场景管理与业务代码经 window.__moanRequire 取自 bundle。 */
(function () {
  'use strict';
  var req = window.__moanRequire;
  var L = req('src/logic/index.js');
  var sceneMod = req('src/ui/scene.js');
  var homeMod = req('src/ui/home.js');
  var themeMod = req('src/ui/theme.js');
  var data = req('src/ui/data.js');

  // 主题先于首帧确定（canvas 无 CSS，启动即需配色）
  var settings = L.Storage.getSettings();
  themeMod.setTheme(settings.theme || 'dark');

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  /* 安全区探针：读 --safe-area-inset-* / env()；不支持时得 0 */
  function safeArea() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px));'
      + 'padding-bottom:var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px));';
    document.body.appendChild(probe);
    var cs = getComputedStyle(probe);
    var top = parseFloat(cs.paddingTop) || 0;
    var bottom = parseFloat(cs.paddingBottom) || 0;
    document.body.removeChild(probe);
    return { top: top, bottom: bottom };
  }

  /* 直算画布 CSS 盒与缓冲尺寸（DPR 缩放），返回逻辑尺寸（CSS px）。
   * 网页无容器原生按钮，顶部只留安全区 + 基础呼吸位 12px。 */
  var TOP_PAD_MIN = 12;
  function layout() {
    var dpr = window.devicePixelRatio || 1;
    var sa = safeArea();
    var top = Math.max(sa.top, TOP_PAD_MIN);
    var W = window.innerWidth || 375;
    var H = Math.max(200, (window.innerHeight || 667) - top - sa.bottom);
    canvas.style.left = '0px';
    canvas.style.top = top + 'px';
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后全部按 CSS px 坐标绘制
    return { W: W, H: H };
  }

  /* 顶条（画布上方留白区，显示 body 背景）颜色跟随游戏主题（值同 theme.js 的 bg） */
  var lastTheme = null;
  setInterval(function () {
    var name = themeMod.themeName();
    if (name !== lastTheme) {
      lastTheme = name;
      document.body.style.background = name === 'light' ? '#f2eee2' : '#121510';
    }
  }, 300);

  var size = layout();
  var manager = sceneMod.createSceneManager(canvas, ctx, { width: size.W, height: size.H, L: L });
  manager.replace(homeMod.createHomeScene(manager));

  /* 尺寸变化（旋转 / 窗口调整）：重算画布并重建场景 */
  if (window.wx && window.wx.onWindowResize) {
    window.wx.onWindowResize(function () {
      var s = layout();
      manager.resize(s.W, s.H);
    });
  }

  /* 图片资产直拷在站点内：直接加载，到位后重绘（未就绪前渲染层回退 SVG/底色） */
  data.loadPortraits(function () { manager.invalidate(); });

  window.__moan = manager; // 调试钩子（冒烟测试/控制台访问场景管理器）
})();
