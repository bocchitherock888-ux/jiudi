var JiudiPdfBudget = (function () {
  "use strict";

  function sizeOf(bytes) {
    return bytes && Number(bytes.byteLength) > 0 ? Number(bytes.byteLength) : 0;
  }

  function targetBytes(kb) {
    return Math.floor(Number(kb) * 1000);
  }

  function withinLimit(bytes, limit) {
    return sizeOf(bytes) > 0 && sizeOf(bytes) <= Number(limit);
  }

  function betterFit(best, candidate, limit) {
    if (!candidate || !withinLimit(candidate.bytes, limit)) return best;
    if (!best || Number(candidate.quality) > Number(best.quality)) return candidate;
    return best;
  }

  async function findHighestFit(encode, maxQuality, limit, iterations) {
    var probes = 0;
    var best = null;
    var smallest = null;
    var trackingSmallest = true;
    var total = iterations + 2;

    async function probe(quality) {
      probes++;
      var candidate = { bytes: await encode(quality, probes, total), quality: quality };
      best = betterFit(best, candidate, limit);
      if (trackingSmallest && (!smallest || sizeOf(candidate.bytes) < sizeOf(smallest.bytes))) smallest = candidate;
      return candidate;
    }

    var highest = await probe(maxQuality);
    if (withinLimit(highest.bytes, limit)) return { fit: highest, smallest: highest, probes: probes };

    var floorQuality = 0.01;
    var floor = await probe(floorQuality);
    highest = null;
    if (!withinLimit(floor.bytes, limit)) return { fit: null, smallest: floor, probes: probes };
    trackingSmallest = false;
    smallest = null;
    floor = null;

    var lo = floorQuality;
    var hi = maxQuality;
    for (var i = 0; i < iterations; i++) {
      var mid = (lo + hi) / 2;
      var candidate = await probe(mid);
      if (withinLimit(candidate.bytes, limit)) lo = mid;
      else hi = mid;
    }
    return { fit: best, smallest: null, probes: probes };
  }

  function currentBytes(items) {
    return items.reduce(function (sum, it) { return sum + sizeOf(it.bytes); }, 0);
  }

  function retainedBytes(items) {
    return items.reduce(function (sum, it) {
      return sum + sizeOf(it.bytes) + (it.history || []).reduce(function (n, bytes) { return n + sizeOf(bytes); }, 0);
    }, 0);
  }

  function oldestHistory(items) {
    var entries = [];
    items.forEach(function (it, itemIndex) {
      (it.history || []).forEach(function (bytes, historyIndex) {
        var seqs = it.historySeqs || [];
        entries.push({
          item: it,
          bytes: bytes,
          seq: Number(seqs[historyIndex]) || 0,
          order: itemIndex * 1000000 + historyIndex
        });
      });
    });
    entries.sort(function (a, b) { return a.seq - b.seq || a.order - b.order; });
    return entries;
  }

  function makePlan(items, addedRetained, minimumCurrent, limit) {
    if (minimumCurrent > limit) return null;
    var over = retainedBytes(items) + addedRetained - limit;
    var prune = [];
    var candidates = oldestHistory(items);
    for (var i = 0; over > 0 && i < candidates.length; i++) {
      prune.push(candidates[i]);
      over -= sizeOf(candidates[i].bytes);
    }
    return over > 0 ? null : prune;
  }

  function planAddition(items, addedBytes, limit) {
    return makePlan(items, addedBytes, currentBytes(items) + addedBytes, limit);
  }

  function planReplacement(items, item, newBytes, limit) {
    var oldSize = sizeOf(item.bytes);
    var newSize = sizeOf(newBytes);
    var currentAfter = currentBytes(items) - oldSize + newSize;
    // The current bytes become the newest undo entry and stay protected by this plan.
    return makePlan(items, newSize, currentAfter + oldSize, limit);
  }

  function applyPrune(plan) {
    (plan || []).forEach(function (entry) {
      var history = entry.item.history || [];
      var index = history.indexOf(entry.bytes);
      if (index < 0) return;
      history.splice(index, 1);
      if (entry.item.historySeqs) entry.item.historySeqs.splice(index, 1);
    });
  }

  return {
    currentBytes: currentBytes,
    retainedBytes: retainedBytes,
    planAddition: planAddition,
    planReplacement: planReplacement,
    applyPrune: applyPrune,
    targetBytes: targetBytes,
    withinLimit: withinLimit,
    betterFit: betterFit,
    findHighestFit: findHighestFit
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = JiudiPdfBudget;

(function () {
  "use strict";

  if (typeof window === "undefined" || !window.document) return;

  var $ = Jiudi.$;
  var clamp = Jiudi.clamp;
  var fmtBytes = Jiudi.fmtBytes;
  var fmtBytesExact = Jiudi.fmtBytesExact;
  var downloadBlob = Jiudi.downloadBlob;
  var stem = Jiudi.stem;
  var toBlobP = Jiudi.toBlobP;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
  }

  var items = [];
  var selected = 0;
  var sel = new Set();
  var lastClick = 0;
  var renderScale = 1.5;
  var extractFmt = "jpeg";
  var exportDpi = 200;
  var job = 0;
  var drag = null;
  var skipClick = false;
  var viewGen = 0;
  var thumbRunning = 0;
  var thumbWait = [];
  var scrollTick = 0;
  var busy = false;
  var historyClock = 0;
  var PG_MIN = 108;
  var PG_GAP = 18;
  var PG_NUM_H = 20;
  var MAX_CANVAS_PIXELS = 32 * 1000 * 1000;
  var MAX_CANVAS_HEIGHT = 16384;
  var MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
  var MAX_PDF_BYTES = 256 * 1000 * 1000;
  var MAX_RETAINED_BYTES = 512 * 1000 * 1000;

  function status(text, kind) {
    Jiudi.setStatus($("status"), text, kind);
  }

  function progress(p) {
    Jiudi.setProgress($("progressBar"), p);
  }

  function pdfLimit() {
    var enabled = $("pdfLimitEnabled");
    var field = $("pdfTargetKB");
    if (!enabled || !field || !enabled.checked) return null;
    var kb = clamp(field.value, 10, 256000);
    field.value = String(kb);
    return { kb: kb, bytes: JiudiPdfBudget.targetBytes(kb) };
  }

  function showExportResult(label, blob) {
    var actual = fmtBytes(blob.size);
    var result = $("exportResult");
    if (result) {
      result.textContent = label + " · " + actual;
      result.title = fmtBytesExact(blob.size);
    }
    return actual;
  }

  function preflightPdfDownload(blob) {
    var limit = pdfLimit();
    if (!blob || blob.type !== "application/pdf" || !limit) return;
    if (blob.size > limit.bytes) {
      showExportResult("PDF 超过上限，下载已停止", blob);
      throw new Error("PDF 为 " + fmtBytes(blob.size) + "，超过 " + limit.kb + " KB 体积上限。请提高上限或压缩后重试");
    }
  }

  function downloadPdfBlob(blob, name, label) {
    preflightPdfDownload(blob);
    downloadBlob(blob, name);
    return showExportResult(label || "PDF 已下载", blob);
  }

  function current() {
    if (!items.length) throw new Error("还没有文件");
    return items[selected];
  }

  async function loadPdfJs(bytes) {
    var data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
    return pdfjsLib.getDocument({
      data: data,
      // Mozilla's documented mitigation for GHSA-wgrm-67xf-hhpq in PDF.js 3.x.
      isEvalSupported: false,
      disableAutoFetch: true,
      verbosity: 0
    }).promise;
  }

  function checkedCanvasSize(width, height, label) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (!isFinite(width) || !isFinite(height) || width * height > MAX_CANVAS_PIXELS) {
      throw new Error((label || "页面") + "需要 " + width + " × " + height + " 像素，超过 3200 万像素上限。请降低清晰度");
    }
    if (width > MAX_CANVAS_HEIGHT) {
      throw new Error((label || "页面") + "宽度 " + width + " 像素，超过 " + MAX_CANVAS_HEIGHT + " 像素上限。请降低清晰度");
    }
    if (height > MAX_CANVAS_HEIGHT) {
      throw new Error((label || "页面") + "高度 " + height + " 像素，超过 " + MAX_CANVAS_HEIGHT + " 像素上限。请降低清晰度");
    }
    return { width: width, height: height };
  }

  async function renderPageObject(page, scale, label) {
    var viewport = page.getViewport({ scale: scale || 1 });
    var size = checkedCanvasSize(viewport.width, viewport.height, label);
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return canvas;
  }

  async function renderPage(pdf, pageNum, scale) {
    var page = await pdf.getPage(pageNum);
    return renderPageObject(page, scale, "第 " + pageNum + " 页");
  }

  function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
  }

  function disposePdfJs(it) {
    it.pdfVersion = (it.pdfVersion || 0) + 1;
    var loaded = it.pdfJs;
    it.pdfJs = null;
    it.pdfJsPromise = null;
    if (loaded) {
      try { loaded.destroy(); } catch (e) {}
    }
  }

  function pushHistory(it) {
    it.history = it.history || [];
    it.historySeqs = it.historySeqs || [];
    it.history.push(it.bytes);
    it.historySeqs.push(++historyClock);
    var cap = it.bytes && it.bytes.byteLength > 20 * 1024 * 1024 ? 3 : 8;
    if (it.history.length > cap) {
      it.history.shift();
      it.historySeqs.shift();
    }
  }

  function requireAdditionBudget(newItems) {
    var addedBytes = newItems.reduce(function (sum, it) { return sum + it.bytes.byteLength; }, 0);
    var plan = JiudiPdfBudget.planAddition(items, addedBytes, MAX_RETAINED_BYTES);
    if (!plan) throw new Error("保留这些文件会超过 512 MB 上限，请先移除文件");
    JiudiPdfBudget.applyPrune(plan);
    return plan.length;
  }

  async function commitReplacement(it, bytes, note, pageCount, rangeMode) {
    var plan = JiudiPdfBudget.planReplacement(items, it, bytes, MAX_RETAINED_BYTES);
    if (!plan) throw new Error("处理结果和可撤销原稿会超过 512 MB 上限，请先移除其他文件");
    JiudiPdfBudget.applyPrune(plan);
    pushHistory(it);
    if (plan.length) note += " · 已清理 " + plan.length + " 个较早撤销记录";
    await replaceBytes(it, bytes, note, pageCount, rangeMode);
  }

  async function replaceBytes(it, bytes, note, pageCount, rangeMode) {
    disposePdfJs(it);
    it.bytes = new Uint8Array(bytes);
    if (pageCount != null) it.pages = pageCount;
    else {
      try {
        var pdf = await ensurePdfJs(it);
        it.pages = pdf.numPages;
      } catch (e) {}
    }
    sel.clear();
    lastClick = 0;
    refreshRail();
    refreshHead();
    if (rangeMode === "preserve") reconcileRangeState(it);
    else resetRangeState(it);
    restoreRangeState(it);
    mountPages();
    if (note) status(note, "ok");
  }

  function selectedIdx() {
    var it = items[selected];
    if (!it) return [];
    return Array.from(sel).filter(function (i) { return i >= 0 && i < it.pages; }).sort(function (a, b) { return a - b; });
  }

  function targetIdx() {
    var idxs = selectedIdx();
    if (idxs.length) return idxs;
    return exportIdx();
  }

  function parseSkip(str, pageCount) {
    var raw = (str || "").trim();
    if (!raw) return [];
    return Jiudi.parseRanges(raw, pageCount);
  }

  function exportIdx() {
    var it = current();
    if (!it || !it.pages) throw new Error("还没有文件");
    var from = Number($("pgFrom").value);
    var to = Number($("pgTo").value);
    if (!Number.isInteger(from) || from < 1 || from > it.pages) throw new Error("起始页应在 1–" + it.pages + " 之间");
    if (!Number.isInteger(to) || to < 1 || to > it.pages) throw new Error("结束页应在 1–" + it.pages + " 之间");
    if (from > to) throw new Error("起始页不能大于结束页");
    var skip = {};
    parseSkip($("pgSkip").value, it.pages).forEach(function (i) { skip[i] = 1; });
    var out = [];
    for (var n = from; n <= to; n++) {
      if (!skip[n - 1]) out.push(n - 1);
    }
    if (!out.length) throw new Error("这个页码范围是空的");
    return out;
  }

  function exportScale() {
    return exportDpi / 72;
  }

  function imageMime() {
    return extractFmt === "png" ? "image/png" : "image/jpeg";
  }

  function imageExt() {
    return extractFmt === "png" ? "png" : "jpg";
  }

  function padPage(n, max) {
    var w = String(max).length;
    var s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  }

  function resetRangeState(it) {
    if (!it || !it.pages) return;
    it.exportRange = { from: "1", to: String(it.pages), skip: "", pages: it.pages };
  }

  function saveRangeState(it) {
    if (!it || !it.pages) return;
    it.exportRange = {
      from: $("pgFrom").value,
      to: $("pgTo").value,
      skip: $("pgSkip").value,
      pages: it.pages
    };
  }

  function reconcileRangeState(it) {
    if (!it || !it.pages) return;
    if (!it.exportRange || it.exportRange.pages !== it.pages) resetRangeState(it);
  }

  function restoreRangeState(it) {
    if (!it || !it.pages) return;
    if (!it.exportRange) resetRangeState(it);
    $("pgFrom").value = it.exportRange.from;
    $("pgTo").value = it.exportRange.to;
    $("pgSkip").value = it.exportRange.skip;
    refreshRangeHint();
  }

  function fillRangeDefaults() {
    var it = items[selected];
    resetRangeState(it);
    restoreRangeState(it);
  }

  function refreshRangeHint() {
    var hint = $("rangeHint");
    if (!hint) return;
    try {
      var n = exportIdx().length;
      hint.textContent = "将导出 " + n + " 页 · " + exportDpi + " dpi";
      hint.classList.remove("warn");
      ["pgFrom", "pgTo", "pgSkip"].forEach(function (id) { $(id).removeAttribute("aria-invalid"); });
    } catch (e) {
      hint.textContent = e.message || "页码有误，请检查后重试。";
      hint.classList.add("warn");
      ["pgFrom", "pgTo", "pgSkip"].forEach(function (id) { $(id).setAttribute("aria-invalid", "true"); });
    }
    paintSelection();
  }

  function refreshHead() {
    if (!items.length) return;
    var it = items[selected];
    $("fileName").textContent = it.name;
    $("fileMeta").textContent = (it.pages != null ? it.pages + " 页 · " : "打开中 · ") + fmtBytes(it.bytes.byteLength);
    var n = selectedIdx().length;
    $("selCount").textContent = n ? "已选 " + n + " 页" : "未选";
    $("undo").disabled = !(it.history && it.history.length);
  }

  function refreshRail() {
    var rail = $("fileRail");
    rail.innerHTML = "";
    items.forEach(function (it, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.disabled = busy;
      b.className = "file-chip" + (idx === selected ? " on" : "");
      b.setAttribute("aria-pressed", idx === selected ? "true" : "false");
      b.innerHTML = "<span class=\"n\"></span>";
      b.querySelector(".n").textContent = it.name;
      b.addEventListener("click", function (e) {
        if (busy) return;
        if (e.target.closest(".x")) return;
        saveRangeState(items[selected]);
        selected = idx;
        sel.clear();
        refreshRail();
        refreshHead();
        ensureSelectedOpen().then(function () {
          restoreRangeState(items[selected]);
          mountPages();
        });
      });
      var x = document.createElement("button");
      x.type = "button";
      x.disabled = busy;
      x.className = "x";
      x.setAttribute("aria-label", "移除");
      x.textContent = "×";
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        if (busy) return;
        removeItem(idx);
      });
      b.appendChild(x);
      rail.appendChild(b);
    });
    var add = document.createElement("button");
    add.type = "button";
    add.disabled = busy;
    add.className = "file-add";
    add.textContent = "添加";
    add.addEventListener("click", function () { $("file").click(); });
    rail.appendChild(add);
  }

  function removeItem(idx) {
    if (busy) return;
    var it = items[idx];
    if (it) disposePdfJs(it);
    items.splice(idx, 1);
    if (!items.length) {
      $("work").classList.add("hidden");
      $("empty").classList.remove("hidden");
      sel.clear();
      return;
    }
    if (idx < selected) selected--;
    if (selected >= items.length) selected = items.length - 1;
    sel.clear();
    refreshRail();
    refreshHead();
    restoreRangeState(items[selected]);
    mountPages();
  }

  function metrics() {
    var stage = $("pageStage");
    var box = $("pages");
    var w = box.clientWidth;
    if (!w) {
      var style = window.getComputedStyle ? window.getComputedStyle(stage) : null;
      var pad = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 36;
      w = stage.clientWidth - pad;
    }
    w = Math.max(160, Math.floor(w));
    var n = (items[selected] && items[selected].pages) || 0;
    var min = w < 420 ? Math.max(96, Math.floor((w - PG_GAP) / 2)) : PG_MIN;
    if (w >= 420 && n && n <= 8) min = Math.max(min, 168);
    else if (w >= 420 && n && n <= 20) min = Math.max(min, 128);
    var cols = Math.max(1, Math.floor((w + PG_GAP) / (min + PG_GAP)));
    var cellW = Math.floor((w - (cols - 1) * PG_GAP) / cols);
    var sheetH = Math.round(cellW * 1.414);
    var cellH = sheetH + PG_NUM_H;
    return { cols: cols, cellW: cellW, cellH: cellH, sheetH: sheetH, gap: PG_GAP };
  }

  function visibleRange(n, m) {
    var stage = $("pageStage");
    var top = stage.scrollTop;
    var h = stage.clientHeight;
    var rowH = m.cellH + m.gap;
    var firstRow = Math.max(0, Math.floor(top / rowH) - 1);
    var lastRow = Math.ceil((top + h) / rowH) + 1;
    return [
      Math.min(n, firstRow * m.cols),
      Math.min(n, (lastRow + 1) * m.cols)
    ];
  }

  function makePageEl(i) {
    var pg = document.createElement("button");
    pg.type = "button";
    pg.disabled = busy;
    pg.className = "pg" + (sel.has(i) ? " on" : "");
    pg.setAttribute("aria-pressed", sel.has(i) ? "true" : "false");
    pg.dataset.i = String(i);
    pg.innerHTML = "<span class=\"sheet\"><span class=\"ph\"></span></span><span class=\"num\">" + (i + 1) + "</span>";
    pg.addEventListener("click", onPageClick);
    pg.addEventListener("pointerdown", onPagePointerDown);
    return pg;
  }

  function syncWindow() {
    var box = $("pages");
    var stage = $("pageStage");
    if (!items.length) {
      box.innerHTML = "";
      box.style.height = "0";
      return;
    }
    var it = items[selected];
    var n = it.pages || 0;
    if (!n) {
      box.innerHTML = "";
      box.style.height = "0";
      return;
    }
    var m = metrics();
    var rows = Math.ceil(n / m.cols);
    box.style.height = Math.max(0, rows * (m.cellH + m.gap) - m.gap) + "px";
    var range = visibleRange(n, m);
    var keep = {};
    var nodes = box.querySelectorAll(".pg");
    for (var k = 0; k < nodes.length; k++) {
      var idx = Number(nodes[k].dataset.i);
      if (idx < range[0] || idx >= range[1]) nodes[k].remove();
      else keep[idx] = nodes[k];
    }
    var need = [];
    for (var i = range[0]; i < range[1]; i++) {
      var el = keep[i];
      if (!el) {
        el = makePageEl(i);
        box.appendChild(el);
      }
      var col = i % m.cols;
      var row = Math.floor(i / m.cols);
      el.style.left = (col * (m.cellW + m.gap)) + "px";
      el.style.top = (row * (m.cellH + m.gap)) + "px";
      el.style.width = m.cellW + "px";
      el.style.height = m.cellH + "px";
      el.classList.toggle("on", sel.has(i));
      el.setAttribute("aria-pressed", sel.has(i) ? "true" : "false");
      el.classList.toggle("in-range", rangeHighlight().has(i));
      if (!el.querySelector("canvas")) need.push({ i: i, el: el, w: m.cellW });
    }
    thumbWait = need;
    pumpThumbs();
  }

  function mountPages() {
    viewGen++;
    thumbWait = [];
    $("pages").innerHTML = "";
    var stage = $("pageStage");
    if (stage) stage.scrollTop = 0;
    syncWindow();
  }

  function pumpThumbs() {
    var g = viewGen;
    while (thumbRunning < 2 && thumbWait.length) {
      var task = thumbWait.shift();
      thumbRunning++;
      fillThumb(task, g).then(function () {
        thumbRunning--;
        pumpThumbs();
      }, function () {
        thumbRunning--;
        pumpThumbs();
      });
    }
  }

  function onPageClick(e) {
    if (busy) return;
    if (skipClick) {
      skipClick = false;
      return;
    }
    var i = Number(e.currentTarget.dataset.i);
    if (e.shiftKey) {
      var a = Math.min(lastClick, i);
      var b = Math.max(lastClick, i);
      if (!e.metaKey && !e.ctrlKey) sel.clear();
      for (var n = a; n <= b; n++) sel.add(n);
    } else if (e.metaKey || e.ctrlKey) {
      if (sel.has(i)) sel.delete(i);
      else sel.add(i);
      lastClick = i;
    } else {
      sel.clear();
      sel.add(i);
      lastClick = i;
    }
    paintSelection();
    refreshHead();
  }

  function rangeHighlight() {
    var range = new Set();
    try {
      var it = current();
      var idxs = exportIdx();
      if (!it || !it.pages || idxs.length >= it.pages) return range;
      idxs.forEach(function (i) { range.add(i); });
    } catch (e) {}
    return range;
  }

  function paintSelection() {
    var range = rangeHighlight();
    var pgs = $("pages").querySelectorAll(".pg");
    for (var i = 0; i < pgs.length; i++) {
      var idx = Number(pgs[i].dataset.i);
      pgs[i].classList.toggle("on", sel.has(idx));
      pgs[i].setAttribute("aria-pressed", sel.has(idx) ? "true" : "false");
      pgs[i].classList.toggle("in-range", range.has(idx));
    }
  }

  function onPagePointerDown(e) {
    if (busy || e.button !== 0) return;
    var i = Number(e.currentTarget.dataset.i);
    drag = { from: i, over: i, x: e.clientX, y: e.clientY, moved: false, el: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.addEventListener("pointermove", onPagePointerMove);
    e.currentTarget.addEventListener("pointerup", onPagePointerUp);
    e.currentTarget.addEventListener("pointercancel", onPagePointerUp);
  }

  function pageAtPoint(x, y) {
    var els = $("pages").querySelectorAll(".pg");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return Number(els[i].dataset.i);
      }
    }
    return -1;
  }

  function onPagePointerMove(e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
    if (!drag.moved) return;
    var over = pageAtPoint(e.clientX, e.clientY);
    var pgs = $("pages").querySelectorAll(".pg");
    for (var i = 0; i < pgs.length; i++) pgs[i].classList.remove("ghost");
    if (over >= 0 && over !== drag.from) {
      drag.over = over;
      var hit = $("pages").querySelector('.pg[data-i="' + over + '"]');
      if (hit) hit.classList.add("ghost");
    }
  }

  async function onPagePointerUp(e) {
    var el = e.currentTarget;
    el.removeEventListener("pointermove", onPagePointerMove);
    el.removeEventListener("pointerup", onPagePointerUp);
    el.removeEventListener("pointercancel", onPagePointerUp);
    var info = drag;
    drag = null;
    var pgs = $("pages").querySelectorAll(".pg");
    for (var i = 0; i < pgs.length; i++) pgs[i].classList.remove("ghost");
    if (!info || !info.moved || info.over === info.from || info.over < 0) return;
    skipClick = true;
    await reorderPages(info.from, info.over);
  }

  async function reorderPages(from, to) {
    await runLocked(async function () {
      var it = current();
      var src = await PDFLib.PDFDocument.load(it.bytes);
      var order = [];
      for (var i = 0; i < src.getPageCount(); i++) order.push(i);
      var moved = order.splice(from, 1)[0];
      order.splice(to, 0, moved);
      var out = await PDFLib.PDFDocument.create();
      var copied = await out.copyPages(src, order);
      copied.forEach(function (p) { out.addPage(p); });
      var saved = await out.save();
      var keep = new Set();
      sel.forEach(function (i) {
        var j = order.indexOf(i);
        if (j >= 0) keep.add(j);
      });
      await commitReplacement(it, saved, "已重排", out.getPageCount(), "reset");
      sel = keep;
      paintSelection();
      refreshHead();
    });
  }

  function ensurePdfJs(it) {
    if (it.pdfJs) return Promise.resolve(it.pdfJs);
    if (it.pdfJsPromise) return it.pdfJsPromise;
    var version = it.pdfVersion || 0;
    var promise = loadPdfJs(it.bytes).then(function (pdf) {
      if ((it.pdfVersion || 0) !== version) {
        try { pdf.destroy(); } catch (e) {}
        throw new Error("文件内容已更新，请重试");
      }
      it.pdfJs = pdf;
      it.pdfJsPromise = null;
      return pdf;
    }, function (err) {
      if ((it.pdfVersion || 0) === version) it.pdfJsPromise = null;
      throw err;
    });
    it.pdfJsPromise = promise;
    return promise;
  }

  async function fillThumb(task, g) {
    var i = task.i;
    var pg = task.el;
    try {
      if (g !== viewGen || !pg.isConnected) return;
      var it = items[selected];
      if (!it) return;
      var pdf = await ensurePdfJs(it);
      if (g !== viewGen || !pg.isConnected) return;
      var page = await pdf.getPage(i + 1);
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(0.42, task.w / Math.max(1, base.width));
      var canvas = await renderPageObject(page, scale, "第 " + (i + 1) + " 页缩略图");
      if (g !== viewGen || !pg.isConnected) {
        releaseCanvas(canvas);
        return;
      }
      var sheet = pg.querySelector(".sheet") || pg;
      var ph = sheet.querySelector(".ph");
      if (ph) ph.replaceWith(canvas);
      else if (!sheet.querySelector("canvas")) sheet.appendChild(canvas);
    } catch (e) {}
  }

  async function imageToJpegBytes(file) {
    var bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { bmp = await createImageBitmap(file); }
    var sourceWidth = bmp.width;
    var sourceHeight = bmp.height;
    if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > MAX_IMAGE_PIXELS) {
      if (bmp.close) try { bmp.close(); } catch (e2) {}
      throw new Error((file.name || "图片") + " 为 " + sourceWidth + " × " + sourceHeight + " 像素，超过 4000 万像素导入上限");
    }
    if (/jpe?g$/i.test(file.name) || file.type === "image/jpeg") {
      if (bmp.close) try { bmp.close(); } catch (e3) {}
      return new Uint8Array(await file.arrayBuffer());
    }
    try {
      checkedCanvasSize(bmp.width, bmp.height, file.name || "图片");
    } catch (err) {
      if (bmp.close) try { bmp.close(); } catch (e4) {}
      throw err;
    }
    var c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) try { bmp.close(); } catch (e5) {}
    try {
      var blob = await toBlobP(c, "image/jpeg", 0.92);
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      releaseCanvas(c);
    }
  }

  async function imagesToItem(files) {
    var out = await PDFLib.PDFDocument.create();
    for (var i = 0; i < files.length; i++) {
      status("收入图片 " + (i + 1) + " / " + files.length + " …");
      var bytes = await imageToJpegBytes(files[i]);
      var img = await out.embedJpg(bytes);
      var page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    var saved = await out.save();
    return {
      name: files.length === 1 ? stem(files[0].name, "图") + ".pdf" : "图片.pdf",
      bytes: saved,
      pages: out.getPageCount(),
      history: []
    };
  }

  function friendlyPdfError(file, err) {
    var name = (err && err.name) || "";
    var message = (err && err.message) || "";
    if (name === "PasswordException" || /password|encrypted/i.test(message)) {
      return (file.name || "PDF") + " 已加密，需要先解除密码保护";
    }
    if (name === "InvalidPDFException" || /invalid pdf|malformed|corrupt/i.test(message)) {
      return (file.name || "PDF") + " 已损坏或格式无效";
    }
    return (file.name || "PDF") + " 无法打开" + (message ? "：" + message : "");
  }

  async function pdfFileToItem(file) {
    status("验证 " + file.name + " …");
    if (file.size > MAX_PDF_BYTES) {
      throw new Error((file.name || "PDF") + " 为 " + fmtBytes(file.size) + "，超过单个 PDF 256 MB 上限");
    }
    var bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength) throw new Error((file.name || "PDF") + " 是空文件");
    var pdf;
    try {
      pdf = await loadPdfJs(bytes);
    } catch (err) {
      throw new Error(friendlyPdfError(file, err));
    }
    if (!pdf.numPages) {
      try { pdf.destroy(); } catch (e) {}
      throw new Error((file.name || "PDF") + " 没有可用页面");
    }
    try {
      var editable = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      if (editable.getPageCount() !== pdf.numPages) throw new Error("页面目录不一致");
    } catch (structureErr) {
      try { pdf.destroy(); } catch (e2) {}
      throw new Error((file.name || "PDF") + " 已损坏、加密或格式暂不支持");
    }
    return {
      name: file.name || "file.pdf",
      bytes: bytes,
      pages: pdf.numPages,
      history: [],
      pdfJs: pdf,
      pdfVersion: 0
    };
  }

  async function importFiles(files) {
    var accepted = files.filter(function (f) { return Jiudi.isPdf(f) || Jiudi.isImage(f); });
    if (!accepted.length) throw new Error("请选择 PDF 或图片");
    var added = [];
    var pendingBytes = 0;
    var failures = [];
    for (var i = 0; i < accepted.length;) {
      if (Jiudi.isImage(accepted[i])) {
        var images = [];
        while (i < accepted.length && Jiudi.isImage(accepted[i])) images.push(accepted[i++]);
        try {
          var imageItem = await imagesToItem(images);
          if (!JiudiPdfBudget.planAddition(items, pendingBytes + imageItem.bytes.byteLength, MAX_RETAINED_BYTES)) {
            throw new Error("导入后文件总量会超过 512 MB 上限");
          }
          added.push(imageItem);
          pendingBytes += imageItem.bytes.byteLength;
        } catch (imageErr) {
          failures.push(imageErr.message || "图片无法读入");
        }
      } else {
        var file = accepted[i++];
        try {
          if (!JiudiPdfBudget.planAddition(items, pendingBytes + file.size, MAX_RETAINED_BYTES)) {
            throw new Error((file.name || "PDF") + " 会让已载入文件超过 512 MB 上限");
          }
          var pdfItem = await pdfFileToItem(file);
          added.push(pdfItem);
          pendingBytes += pdfItem.bytes.byteLength;
        } catch (pdfErr) {
          failures.push(pdfErr.message || "PDF 无法读入");
        }
      }
    }
    if (!added.length) throw new Error(failures.join("；") || "没有可读入的文件");
    var pruned = requireAdditionBudget(added);
    saveRangeState(items[selected]);
    Array.prototype.push.apply(items, added);
    selected = items.length - 1;
    sel.clear();
    $("empty").classList.add("hidden");
    $("work").classList.remove("hidden");
    refreshRail();
    refreshHead();
    mountPages();
    fillRangeDefaults();
    var budgetSuffix = pruned ? " · 已清理 " + pruned + " 个较早撤销记录" : "";
    if (failures.length) status("已导入 " + added.length + " 个文件；跳过：" + failures.join("；") + budgetSuffix, "warn");
    else status("已导入 " + added.length + " 个文件" + budgetSuffix, "ok");
  }

  async function addFiles(files) {
    await runLocked(function () { return importFiles(files); });
  }

  async function ensureSelectedOpen() {
    var it = items[selected];
    if (!it) return;
    if (it.pages != null) {
      syncWindow();
      return;
    }
    status("打开 " + it.name + " …");
    try {
      var pdf = await ensurePdfJs(it);
      it.pages = pdf.numPages;
      refreshRail();
      refreshHead();
      mountPages();
    } catch (e) {
      status(e.message || "这个 PDF 打不开", "warn");
    }
  }

  function setBusy(value) {
    busy = value;
    var main = $("mainContent");
    if (main) main.setAttribute("aria-busy", value ? "true" : "false");
    var drop = $("drop");
    if (drop) drop.setAttribute("aria-disabled", value ? "true" : "false");
    var controls = document.querySelectorAll("button, input");
    for (var i = 0; i < controls.length; i++) controls[i].disabled = value;
    if (!value) refreshHead();
  }

  async function runLocked(fn) {
    if (busy) {
      status("正在处理，请稍候", "warn");
      return false;
    }
    var my = ++job;
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      if (my === job) status(err.message || String(err), "warn");
      return false;
    } finally {
      if (my === job) {
        setBusy(false);
        progress(null);
      }
    }
  }

  async function rotateSel(deg) {
    await runLocked(async function () {
      var it = current();
      var idxs = selectedIdx();
      if (!idxs.length) idxs = targetIdx();
      status("旋转中…");
      var src = await PDFLib.PDFDocument.load(it.bytes);
      var pages = src.getPages();
      idxs.forEach(function (i) {
        var p = pages[i];
        var curAng = 0;
        try { curAng = p.getRotation().angle || 0; } catch (e) { curAng = 0; }
        p.setRotation(PDFLib.degrees((curAng + deg + 360) % 360));
      });
      var saved = await src.save();
      var keep = new Set(idxs);
      await commitReplacement(it, saved, "已旋转 " + idxs.length + " 页", src.getPageCount(), "preserve");
      sel = keep;
      paintSelection();
      refreshHead();
    });
  }

  async function deleteSel() {
    await runLocked(async function () {
      var it = current();
      var idxs = selectedIdx();
      if (!idxs.length) throw new Error("先点选要删的页");
      if (idxs.length >= it.pages) throw new Error("不能删光所有页");
      status("删除中…");
      var src = await PDFLib.PDFDocument.load(it.bytes);
      idxs.slice().sort(function (a, b) { return b - a; }).forEach(function (i) { src.removePage(i); });
      var saved = await src.save();
      await commitReplacement(it, saved, "已删除 " + idxs.length + " 页", src.getPageCount(), "reset");
    });
  }

  async function saveRangePdf(idxs, nameSuffix) {
    var it = current();
    var src = await PDFLib.PDFDocument.load(it.bytes);
    var out = await PDFLib.PDFDocument.create();
    var copied = await out.copyPages(src, idxs);
    copied.forEach(function (p) { out.addPage(p); });
    var saved = await out.save();
    var name = stem(it.name, "pdf") + (nameSuffix || "-摘页") + ".pdf";
    var blob = new Blob([saved], { type: "application/pdf" });
    preflightPdfDownload(blob);
    var created = { name: name, bytes: saved, pages: out.getPageCount(), history: [] };
    var pruned = requireAdditionBudget([created]);
    saveRangeState(it);
    items.push(created);
    selected = items.length - 1;
    refreshRail();
    refreshHead();
    fillRangeDefaults();
    mountPages();
    var actual = downloadPdfBlob(blob, name, "PDF 已下载");
    return { count: idxs.length, pruned: pruned, size: actual };
  }

  async function extractSel() {
    await runLocked(async function () {
      var idxs = selectedIdx();
      if (!idxs.length) idxs = exportIdx();
      status("拆出中…");
      var result = await saveRangePdf(idxs, "-拆出");
      status("已拆出 " + result.count + " 页 PDF · " + result.size + (result.pruned ? " · 已清理 " + result.pruned + " 个较早撤销记录" : ""), "ok");
    });
  }

  async function exportRangePdf() {
    await runLocked(async function () {
      var idxs = exportIdx();
      status("导出小 PDF …");
      var result = await saveRangePdf(idxs, "-" + (idxs[0] + 1) + "-" + (idxs[idxs.length - 1] + 1));
      status("已导出 " + result.count + " 页 PDF · " + result.size + (result.pruned ? " · 已清理 " + result.pruned + " 个较早撤销记录" : ""), "ok");
    });
  }

  async function canvasToExportBlob(canvas) {
    var q = extractFmt === "png" ? undefined : 0.92;
    return toBlobP(canvas, imageMime(), q);
  }

  async function longImagePlan(pdf, idxs) {
    var pages = [];
    var desiredWidth = 1;
    for (var i = 0; i < idxs.length; i++) {
      var page = await pdf.getPage(idxs[i] + 1);
      var viewport = page.getViewport({ scale: 1 });
      if (!isFinite(viewport.width) || !isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
        throw new Error("第 " + (idxs[i] + 1) + " 页尺寸无效");
      }
      pages.push({ index: idxs[i], width: viewport.width, height: viewport.height });
      desiredWidth = Math.max(desiredWidth, viewport.width * exportScale());
    }
    var desiredHeight = 0;
    pages.forEach(function (p) { desiredHeight += p.height * desiredWidth / p.width; });
    var shrink = Math.min(
      1,
      MAX_CANVAS_HEIGHT / desiredWidth,
      MAX_CANVAS_HEIGHT / desiredHeight,
      Math.sqrt(MAX_CANVAS_PIXELS / (desiredWidth * desiredHeight))
    );
    if (!isFinite(shrink) || shrink <= 0) throw new Error("这些页面无法组成长图");
    var width = Math.max(1, Math.floor(desiredWidth * shrink));
    var heights = pages.map(function (p) { return Math.max(1, Math.floor(p.height * width / p.width)); });
    var height = heights.reduce(function (sum, h) { return sum + h; }, 0);
    checkedCanvasSize(width, height, "长图");
    return {
      pages: pages,
      width: width,
      heights: heights,
      height: height,
      adjusted: shrink < 0.999,
      effectiveDpi: Math.max(1, Math.floor(exportDpi * shrink))
    };
  }

  async function writeLongImage(pdf, idxs) {
    var plan = await longImagePlan(pdf, idxs);
    var out = document.createElement("canvas");
    out.width = plan.width;
    out.height = plan.height;
    var ctx = out.getContext("2d", { alpha: false });
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, out.width, out.height);
    var y = 0;
    try {
      for (var i = 0; i < plan.pages.length; i++) {
        status("拼长图 " + (i + 1) + " / " + plan.pages.length + " …");
        progress((i + 1) / plan.pages.length);
        var info = plan.pages[i];
        var page = await pdf.getPage(info.index + 1);
        var canvas = await renderPageObject(page, plan.width / info.width, "第 " + (info.index + 1) + " 页");
        try {
          ctx.drawImage(canvas, 0, y, plan.width, plan.heights[i]);
        } finally {
          releaseCanvas(canvas);
        }
        y += plan.heights[i];
      }
      return {
        blob: await canvasToExportBlob(out),
        adjusted: plan.adjusted,
        width: plan.width,
        height: plan.height,
        effectiveDpi: plan.effectiveDpi
      };
    } finally {
      releaseCanvas(out);
    }
  }

  async function writeImages(idxs, asLong) {
    var it = current();
    var pdf = await ensurePdfJs(it);
    var ext = imageExt();
    if (asLong) {
      var result = await writeLongImage(pdf, idxs);
      var dimensions = result.width + " × " + result.height + " 像素";
      var adjustment = result.adjusted ? " · 已调整为约 " + result.effectiveDpi + " dpi" : " · " + exportDpi + " dpi";
      status("准备下载长图：" + dimensions + adjustment, result.adjusted ? "warn" : "ok");
      await new Promise(function (resolve) { requestAnimationFrame(resolve); });
      downloadBlob(result.blob, stem(it.name, "pdf") + "-" + (idxs[0] + 1) + "-" + (idxs[idxs.length - 1] + 1) + "-长图." + ext);
      var longSize = showExportResult("长图已下载", result.blob);
      status("已导出长图 " + idxs.length + " 页 · " + longSize + " · " + dimensions + adjustment, result.adjusted ? "warn" : "ok");
      return;
    }
    if (idxs.length === 1) {
      var one = await renderPage(pdf, idxs[0] + 1, exportScale());
      try {
        var oneBlob = await canvasToExportBlob(one);
        downloadBlob(oneBlob, stem(it.name, "pdf") + "-p" + (idxs[0] + 1) + "." + ext);
      } finally {
        releaseCanvas(one);
      }
      var oneSize = showExportResult("图片已下载", oneBlob);
      status("已导出 1 张图 · " + oneSize + " · " + exportDpi + " dpi", "ok");
      return;
    }
    var zip = new JSZip();
    for (var i = 0; i < idxs.length; i++) {
      status("出图 " + (i + 1) + " / " + idxs.length + " · " + exportDpi + " dpi");
      progress((i + 1) / idxs.length);
      var canvas = await renderPage(pdf, idxs[i] + 1, exportScale());
      try {
        zip.file("page-" + padPage(idxs[i] + 1, it.pages) + "." + ext, await canvasToExportBlob(canvas));
      } finally {
        releaseCanvas(canvas);
      }
    }
    var zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, stem(it.name, "pdf") + "-页图.zip");
    var zipSize = showExportResult("ZIP 已下载", zipBlob);
    status("已导出 " + idxs.length + " 张图 · " + zipSize + " · " + exportDpi + " dpi", "ok");
  }

  async function exportImages() {
    await runLocked(async function () {
      var idxs = selectedIdx();
      if (!idxs.length) idxs = exportIdx();
      await writeImages(idxs, false);
    });
  }

  async function exportRangeImages() {
    await runLocked(async function () {
      await writeImages(exportIdx(), false);
    });
  }

  async function exportLongImage() {
    await runLocked(async function () {
      await writeImages(exportIdx(), true);
    });
  }

  async function rasterPdfAtQuality(pdf, quality, probe, totalProbes) {
    var out = await PDFLib.PDFDocument.create();
    for (var i = 1; i <= pdf.numPages; i++) {
      status("测试清晰度 " + probe + " / " + totalProbes + " · 第 " + i + " / " + pdf.numPages + " 页…");
      progress(((probe - 1) + i / pdf.numPages) / totalProbes);
      var pdfPage = await pdf.getPage(i);
      var base = pdfPage.getViewport({ scale: 1 });
      var canvas = await renderPageObject(pdfPage, renderScale, "第 " + i + " 页");
      try {
        var imageBlob = await toBlobP(canvas, "image/jpeg", quality);
        var img = await out.embedJpg(await imageBlob.arrayBuffer());
        var page = out.addPage([base.width, base.height]);
        page.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      } finally {
        releaseCanvas(canvas);
      }
    }
    return out.save({ useObjectStreams: true });
  }

  async function findRasterFit(pdf, maxQuality, targetBytes) {
    return JiudiPdfBudget.findHighestFit(function (quality, probe, total) {
      return rasterPdfAtQuality(pdf, quality, probe, total);
    }, maxQuality, targetBytes, 8);
  }

  async function compressDoc() {
    await runLocked(async function () {
      var it = current();
      var rasterControl = $("rasterizePdf");
      var rasterize = !!(rasterControl && rasterControl.checked);
      var limit = pdfLimit();
      var before = it.bytes.byteLength;
      var saved;
      var pageCount = it.pages;

      if (limit && before <= limit.bytes) {
        status("当前 PDF 已在 " + limit.kb + " KB 上限内 · " + fmtBytes(before), "ok");
        return;
      }

      if (!rasterize) {
        status("整理 PDF 结构…");
        var source = await PDFLib.PDFDocument.load(it.bytes, { updateMetadata: false });
        saved = await source.save({ useObjectStreams: true });
        pageCount = source.getPageCount();
        if (limit && !JiudiPdfBudget.withinLimit(saved, limit.bytes)) {
          throw new Error("保留文字后的 PDF 为 " + fmtBytes(saved.byteLength) + "，超过 " + limit.kb +
            " KB。请勾选“转为图片进一步压缩”后重试");
        }
      } else if (limit) {
        var maxQuality = clamp($("jpgQNum").value, 1, 100) / 100;
        var pdf = await ensurePdfJs(it);
        var searched = await findRasterFit(pdf, maxQuality, limit.bytes);
        if (!searched.fit) {
          throw new Error("当前分辨率的最小结果为 " + fmtBytes(searched.smallest.bytes.byteLength) +
            "，超过 " + limit.kb + " KB。请降低分辨率或提高体积上限");
        }
        saved = searched.fit.bytes;
        pageCount = pdf.numPages;
        var qualityLabel = Math.round(searched.fit.quality * 100) + "%";
        await commitReplacement(it, saved, "栅格压缩 " + fmtBytes(before) + " → " + fmtBytes(saved.byteLength) +
          " · 已测试可用质量 " + qualityLabel + " · " + searched.probes + " 次测试", pageCount, "preserve");
        return;
      } else {
        var quality = clamp($("jpgQNum").value, 1, 100) / 100;
        var loaded = await ensurePdfJs(it);
        saved = await rasterPdfAtQuality(loaded, quality, 1, 1);
        pageCount = loaded.numPages;
      }

      if (saved.byteLength >= before) {
        status("当前文件更小，已保留 " + fmtBytes(before), "ok");
        return;
      }
      await commitReplacement(it, saved, "压缩 " + fmtBytes(before) + " → " + fmtBytes(saved.byteLength), pageCount, "preserve");
    });
  }

  async function mergeAll() {
    await runLocked(async function () {
      if (items.length < 2) throw new Error("至少两个文件才能合并");
      var out = await PDFLib.PDFDocument.create();
      for (var i = 0; i < items.length; i++) {
        status("合并 " + (i + 1) + " / " + items.length + " …");
        progress((i + 1) / items.length);
        var src = await PDFLib.PDFDocument.load(items[i].bytes);
        var copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach(function (p) { out.addPage(p); });
      }
      var saved = await out.save();
      var name = "就地-合并.pdf";
      var blob = new Blob([saved], { type: "application/pdf" });
      preflightPdfDownload(blob);
      var merged = { name: name, bytes: saved, pages: out.getPageCount(), history: [] };
      var pruned = requireAdditionBudget([merged]);
      saveRangeState(items[selected]);
      items.push(merged);
      selected = items.length - 1;
      refreshRail();
      refreshHead();
      fillRangeDefaults();
      mountPages();
      var mergedSize = downloadPdfBlob(blob, name, "PDF 已下载");
      status("已合并 " + out.getPageCount() + " 页 · " + mergedSize + (pruned ? " · 已清理 " + pruned + " 个较早撤销记录" : ""), "ok");
    });
  }

  function downloadCurrent() {
    if (busy) return;
    var it = current();
    var blob = new Blob([it.bytes], { type: "application/pdf" });
    try {
      var actual = downloadPdfBlob(blob, it.name, "PDF 已下载");
      status("已下载当前 PDF · " + actual, "ok");
    } catch (err) {
      status(err.message || String(err), "warn");
    }
  }

  async function undo() {
    await runLocked(async function () {
      var it = current();
      if (!it.history || !it.history.length) return;
      var prev = it.history.pop();
      if (it.historySeqs) it.historySeqs.pop();
      await replaceBytes(it, prev, "已撤销", null, "reset");
    });
  }

  function syncQ(fromRange) {
    var v = clamp(fromRange ? $("jpgQ").value : $("jpgQNum").value, 1, 100);
    $("jpgQ").value = String(v);
    $("jpgQNum").value = String(v);
  }

  function onStageScroll() {
    if (scrollTick) return;
    scrollTick = 1;
    requestAnimationFrame(function () {
      scrollTick = 0;
      syncWindow();
    });
  }

  Jiudi.markNav("pdf.html");
  Jiudi.bindDrop($("drop"), addFiles, function (f) { return Jiudi.isPdf(f) || Jiudi.isImage(f); });
  $("selAll").addEventListener("click", function () {
    if (busy) return;
    var it = items[selected];
    if (!it) return;
    sel = new Set();
    for (var i = 0; i < it.pages; i++) sel.add(i);
    paintSelection();
    refreshHead();
  });
  $("selNone").addEventListener("click", function () {
    if (busy) return;
    sel.clear();
    paintSelection();
    refreshHead();
  });
  $("rotL").addEventListener("click", function () { rotateSel(270); });
  $("rotR").addEventListener("click", function () { rotateSel(90); });
  $("delPages").addEventListener("click", deleteSel);
  $("extractSel").addEventListener("click", extractSel);
  $("exportImg").addEventListener("click", exportImages);
  $("compress").addEventListener("click", compressDoc);
  $("download").addEventListener("click", function () {
    try { downloadCurrent(); } catch (e) { status(e.message, "warn"); }
  });
  $("merge").addEventListener("click", mergeAll);
  $("undo").addEventListener("click", undo);
  $("jpgQ").addEventListener("input", function () { syncQ(true); });
  $("jpgQNum").addEventListener("input", function () { syncQ(false); });
  Jiudi.bindSeg($("scaleSeg"), "scale", function (v) { renderScale = parseFloat(v); });
  Jiudi.bindSeg($("exFmt"), "ex", function (v) { extractFmt = v; });
  Jiudi.bindSeg($("exDpi"), "dpi", function (v) {
    exportDpi = parseInt(v, 10) || 200;
    refreshRangeHint();
  });
  ["pgFrom", "pgTo", "pgSkip"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      saveRangeState(items[selected]);
      refreshRangeHint();
    });
  });
  $("exPdf").addEventListener("click", exportRangePdf);
  $("exLong").addEventListener("click", exportLongImage);
  $("exImgs").addEventListener("click", exportRangeImages);
  $("pageStage").addEventListener("scroll", onStageScroll, { passive: true });
  window.addEventListener("resize", onStageScroll);
})();
