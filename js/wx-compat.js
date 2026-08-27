/* 墨案缉凶 · 主题网页版 wx 兼容层
 * 把微信小游戏 API 映射到标准 Web，仅实现游戏实际用到的最小集合
 * （移植自 xhs-minitool/app/js/wx-compat.js）。
 * 未提供的 API（getMenuButtonBoundingClientRect / setDeviceOrientation /
 * getStorageSync / loadSubpackage 等）调用方均有 typeof 守卫或本地替代，
 * 会自然走降级分支，无须在此补齐。 */
(function () {
  'use strict';

  var cbs = { start: [], move: [], end: [], cancel: [] };

  function fire(kind, e) {
    for (var i = 0; i < cbs[kind].length; i++) cbs[kind][i](e);
  }

  /* DOM TouchEvent → 微信事件形状 {touches, changedTouches}；
   * clientX/Y 换算到 canvas 坐标系（画布因安全区有 CSS 偏移）。 */
  function toWxTouch(e, canvas) {
    var rect = canvas.getBoundingClientRect();
    function map(t) { return { clientX: t.clientX - rect.left, clientY: t.clientY - rect.top }; }
    return {
      touches: Array.prototype.map.call(e.touches || [], map),
      changedTouches: Array.prototype.map.call(e.changedTouches || [], map)
    };
  }

  function bind() {
    var canvas = document.getElementById('game');
    if (!canvas) return;
    var opts = { passive: false };
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); fire('start', toWxTouch(e, canvas)); }, opts);
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); fire('move', toWxTouch(e, canvas)); }, opts);
    canvas.addEventListener('touchend', function (e) { e.preventDefault(); fire('end', toWxTouch(e, canvas)); }, opts);
    canvas.addEventListener('touchcancel', function (e) { fire('cancel', toWxTouch(e, canvas)); }, opts);

    /* 鼠标回退：PC 浏览器游玩（PC 模拟器本身会把鼠标映射为 touch，不会双触发） */
    var down = false;
    function mouseEv(e, isEnd) {
      var rect = canvas.getBoundingClientRect();
      var t = { clientX: e.clientX - rect.left, clientY: e.clientY - rect.top };
      return { touches: isEnd ? [] : [t], changedTouches: [t] };
    }
    canvas.addEventListener('mousedown', function (e) { down = true; fire('start', mouseEv(e, false)); });
    canvas.addEventListener('mousemove', function (e) { if (down) fire('move', mouseEv(e, false)); });
    window.addEventListener('mouseup', function (e) { if (down) { down = false; fire('end', mouseEv(e, true)); } });
  }

  window.wx = {
    /* 图片加载：微信 wx.createImage() → 浏览器 Image */
    createImage: function () { return new Image(); },
    /* 离屏画布：微信 wx.createOffscreenCanvas({type,width,height}) → DOM canvas */
    createOffscreenCanvas: function (opt) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil((opt && opt.width) || 1));
      c.height = Math.max(1, Math.ceil((opt && opt.height) || 1));
      return c;
    },
    onTouchStart: function (fn) { cbs.start.push(fn); },
    onTouchMove: function (fn) { cbs.move.push(fn); },
    onTouchEnd: function (fn) { cbs.end.push(fn); },
    onTouchCancel: function (fn) { cbs.cancel.push(fn); },
    /* 窗口尺寸变化（旋转/拖窗口）：回报画布 CSS 尺寸（已扣除安全区） */
    onWindowResize: function (fn) {
      window.addEventListener('resize', function () {
        var canvas = document.getElementById('game');
        if (!canvas) return;
        fn({ windowWidth: canvas.clientWidth || window.innerWidth, windowHeight: canvas.clientHeight || window.innerHeight });
      });
    },
    /* 轻振动：不支持则静默 */
    vibrateShort: function () {
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* 无振动能力 */ }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
