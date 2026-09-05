var JiudiImageSize = (function () {
  "use strict";

  function targetBytes(kb) {
    return Math.floor(Number(kb) * 1000);
  }

  function fits(blob, limit) {
    return !!blob && Number(blob.size) > 0 && Number(blob.size) <= Number(limit);
  }

  return { targetBytes: targetBytes, fits: fits };
})();

if (typeof module !== "undefined" && module.exports) module.exports = JiudiImageSize;

(function () {
  "use strict";

  if (typeof window === "undefined" || !window.document) return;

  var $ = Jiudi.$;
  var clamp = Jiudi.clamp;
  var fmtBytes = Jiudi.fmtBytes;
  var fmtBytesExact = Jiudi.fmtBytesExact;
  var toBlobP = Jiudi.toBlobP;
  var stem = Jiudi.stem;

  var MIME = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" };
  var EXT = { jpeg: "jpg", webp: "webp", png: "png" };

  var ASPECTS = [
    { id: "free", label: "自由", ratio: null },
    { id: "1-1", label: "1∶1", ratio: 1 },
    { id: "3-4", label: "3∶4", ratio: 3 / 4 },
    { id: "4-3", label: "4∶3", ratio: 4 / 3 },
    { id: "16-9", label: "16∶9", ratio: 16 / 9 }
  ];

  var PRESETS = [
    { id: "one", label: "一寸", w: 295, h: 413 },
    { id: "two", label: "二寸", w: 413, h: 579 },
    { id: "pass", label: "护照", w: 390, h: 567 },
    { id: "visa", label: "签证", w: 330, h: 480 },
    { id: "wx", label: "头像", w: 640, h: 640 },
    { id: "mail", label: "邮件 200KB", kb: 200 }
  ];

  var items = [];
  var current = 0;
  var format = "jpeg";
  var webpOk = true;
  var keepAsp = true;
  var lockOut = false;
  var view = "crop";
  var debounceT = 0;
  var cmpX = 0.5;
  var disp = { scale: 1, w: 0, h: 0 };
  var drag = null;
  var settingsVersion = 0;
  var requestVersion = 0;
  var compareVersion = 0;
  var batchVersion = 0;
  var displayedCompareItem = null;
  var foregroundRunning = false;
  var foregroundQueued = false;
  var encoderTail = Promise.resolve();
  var importTail = Promise.resolve();
  var importCount = 0;
  var retainedPixels = 0;

  var MAX_SOURCE_PIXELS = 40000000;
  var MAX_SOURCE_EDGE = 16384;
  var MAX_EXPORT_PIXELS = 32000000;
  var MAX_EXPORT_EDGE = 8000;
  var MAX_RETAINED_PIXELS = 120000000;

  function StaleJobError() {
    this.name = "StaleJobError";
    this.message = "任务已过期";
  }
  StaleJobError.prototype = Object.create(Error.prototype);

  function isStaleError(err) {
    return err && err.name === "StaleJobError";
  }

  function throwIfCancelled(cancelled) {
    if (cancelled && cancelled()) throw new StaleJobError();
  }

  function cur() {
    return items[current] || null;
  }

  function status(text, kind) {
    Jiudi.setStatus($("status"), text, kind);
  }

  function targetKB() {
    return clamp($("kbNum").value, 10, 4000);
  }

  function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  function releaseImage(img) {
    if (img && typeof img.close === "function") img.close();
  }

  function clearCompare() {
    compareVersion++;
    if (displayedCompareItem && displayedCompareItem.cmpOrigUrl) {
      URL.revokeObjectURL(displayedCompareItem.cmpOrigUrl);
      displayedCompareItem.cmpOrigUrl = null;
    }
    displayedCompareItem = null;
    $("cmpOrig").removeAttribute("src");
    $("cmpOut").removeAttribute("src");
  }

  function releaseOutput(item) {
    if (!item) return;
    item.outToken = (item.outToken || 0) + 1;
    if (item.outUrl) URL.revokeObjectURL(item.outUrl);
    if (item.cmpOrigUrl) URL.revokeObjectURL(item.cmpOrigUrl);
    item.outBlob = null;
    item.outUrl = null;
    item.cmpOrigUrl = null;
    item.origAtOut = null;
    item.outSettingsVersion = -1;
    item.outEditVersion = -1;
  }

  function clearCurrentResult() {
    var dl = $("dl");
    dl.setAttribute("aria-disabled", "true");
    dl.setAttribute("href", "#");
    dl.removeAttribute("download");
    dl.removeAttribute("title");
    dl.textContent = "下载这张";
    $("resultBox").textContent = "";
    clearCompare();
  }

  function isResultValid(item) {
    return !!(item && item.outBlob && item.outUrl &&
      item.outSettingsVersion === settingsVersion &&
      item.outEditVersion === item.editVersion);
  }

  function invalidateItem(item, queue) {
    if (!item) return;
    item.editVersion = (item.editVersion || 0) + 1;
    item.dirty = true;
    releaseOutput(item);
    requestVersion++;
    if (item === cur()) clearCurrentResult();
    if (queue !== false) queueCompression();
    else {
      clearTimeout(debounceT);
      foregroundQueued = false;
    }
  }

  function invalidateSettings(queue) {
    settingsVersion++;
    requestVersion++;
    items.forEach(function (item) {
      item.dirty = true;
      releaseOutput(item);
    });
    clearCurrentResult();
    if (queue !== false) queueCompression();
  }

  function syncKB(fromRange) {
    var v = clamp(fromRange ? $("kbRange").value : $("kbNum").value, 10, 4000);
    $("kbRange").value = String(v);
    $("kbNum").value = String(v);
    $("pngWarn").classList.toggle("show", format === "png" && v < 200);
  }

  async function decodeFile(file) {
    try {
      var bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { img: bmp, w: bmp.width, h: bmp.height };
    } catch (e1) {
      try {
        var bmp2 = await createImageBitmap(file);
        return { img: bmp2, w: bmp2.width, h: bmp2.height };
      } catch (e2) {
        return await new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(file);
          var im = new Image();
          im.onload = function () {
            var w = im.naturalWidth;
            var h = im.naturalHeight;
            URL.revokeObjectURL(url);
            resolve({ img: im, w: w, h: h });
          };
          im.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error("无法读取这张图"));
          };
          im.src = url;
        });
      }
    }
  }

  function makeWorking(item) {
    var w = item.srcW;
    var h = item.srcH;
    var rot = item.rot;
    var dw = rot % 180 === 0 ? w : h;
    var dh = rot % 180 === 0 ? h : w;
    var c = item.work || document.createElement("canvas");
    c.width = dw;
    c.height = dh;
    if (c.width !== dw || c.height !== dh) {
      releaseCanvas(c);
      throw new Error("图片单边尺寸超过浏览器画布限制");
    }
    var ctx = c.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建图片画布");
    ctx.translate(dw / 2, dh / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    ctx.drawImage(item.src, -w / 2, -h / 2);
    item.work = c;
    item.workW = dw;
    item.workH = dh;
  }

  function fitAspectCrop(item, ratio) {
    var W = item.workW;
    var H = item.workH;
    if (!ratio) return { x: 0, y: 0, w: W, h: H };
    var w = W;
    var h = w / ratio;
    if (h > H) {
      h = H;
      w = h * ratio;
    }
    return {
      x: Math.round((W - w) / 2),
      y: Math.round((H - h) / 2),
      w: Math.max(8, Math.round(w)),
      h: Math.max(8, Math.round(h))
    };
  }

  function constrainCrop(item, crop) {
    var W = item.workW;
    var H = item.workH;
    var c = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
    if (item.aspect) {
      if (c.w / c.h !== item.aspect) c.h = c.w / item.aspect;
      if (c.h > H) {
        c.h = H;
        c.w = c.h * item.aspect;
      }
      if (c.w > W) {
        c.w = W;
        c.h = c.w / item.aspect;
      }
    }
    c.w = clamp(c.w, 8, W);
    c.h = clamp(c.h, 8, H);
    c.x = clamp(c.x, 0, W - c.w);
    c.y = clamp(c.y, 0, H - c.h);
    return {
      x: Math.round(c.x),
      y: Math.round(c.y),
      w: Math.round(c.w),
      h: Math.round(c.h)
    };
  }

  function layoutStage() {
    var item = cur();
    if (!item || !item.work) return;
    var stage = $("stage");
    var inner = $("stageInner");
    var canvas = $("view");
    var rect = stage.getBoundingClientRect();
    var pad = 28;
    var availW = Math.max(48, rect.width - pad);
    var availH = Math.max(48, rect.height - pad);
    var scale = Math.min(availW / item.workW, availH / item.workH);
    disp.scale = scale;
    disp.w = Math.max(1, Math.round(item.workW * scale));
    disp.h = Math.max(1, Math.round(item.workH * scale));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(disp.w * dpr);
    canvas.height = Math.round(disp.h * dpr);
    canvas.style.width = disp.w + "px";
    canvas.style.height = disp.h + "px";
    inner.style.width = disp.w + "px";
    inner.style.height = disp.h + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, disp.w, disp.h);
    ctx.drawImage(item.work, 0, 0, disp.w, disp.h);
    placeCrop();
    layoutCompare();
  }

  function placeCrop() {
    var item = cur();
    var el = $("cropEl");
    if (!item || view !== "crop") {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var s = disp.scale;
    el.style.left = item.crop.x * s + "px";
    el.style.top = item.crop.y * s + "px";
    el.style.width = item.crop.w * s + "px";
    el.style.height = item.crop.h * s + "px";
  }

  function syncOutFields() {
    var item = cur();
    if (!item || lockOut) return;
    $("wVal").value = String(item.crop.w);
    $("hVal").value = String(item.crop.h);
  }

  function readDimension(value, label) {
    var n = Number(value);
    if (!isFinite(n) || n < 1 || n > MAX_EXPORT_EDGE) {
      throw new Error(label + "须在 1–" + MAX_EXPORT_EDGE + " 像素之间");
    }
    return Math.round(n);
  }

  function captureSettings() {
    var kb = targetKB();
    var captured = {
      version: settingsVersion,
      format: format,
      mime: MIME[format],
      ext: EXT[format],
      targetKB: kb,
      targetBytes: JiudiImageSize.targetBytes(kb),
      lockOut: lockOut,
      width: null,
      height: null
    };
    if (captured.lockOut) {
      captured.width = readDimension($("wVal").value, "输出宽度");
      captured.height = readDimension($("hVal").value, "输出高度");
    }
    return captured;
  }

  function captureItem(item, capturedSettings) {
    var crop = { x: item.crop.x, y: item.crop.y, w: item.crop.w, h: item.crop.h };
    var w = capturedSettings.lockOut ? capturedSettings.width : Math.round(crop.w);
    var h = capturedSettings.lockOut ? capturedSettings.height : Math.round(crop.h);
    if (w < 1 || h < 1 || w > MAX_EXPORT_EDGE || h > MAX_EXPORT_EDGE) {
      throw new Error("输出尺寸 " + w + "×" + h + " 超出单边 " + MAX_EXPORT_EDGE + " 像素限制，请调整裁切或输出像素");
    }
    if (w * h > MAX_EXPORT_PIXELS) {
      throw new Error("输出尺寸 " + w + "×" + h + " 超过 3200 万像素，请降低宽高");
    }
    return {
      item: item,
      work: item.work,
      crop: crop,
      editVersion: item.editVersion,
      settingsVersion: capturedSettings.version,
      format: capturedSettings.format,
      mime: capturedSettings.mime,
      ext: capturedSettings.ext,
      targetKB: capturedSettings.targetKB,
      targetBytes: capturedSettings.targetBytes,
      allowScale: !capturedSettings.lockOut,
      width: w,
      height: h
    };
  }

  function snapshotIsStale(snapshot) {
    return snapshot.settingsVersion !== settingsVersion ||
      snapshot.editVersion !== snapshot.item.editVersion ||
      snapshot.work !== snapshot.item.work;
  }

  function normalizedArchiveKey(name) {
    var normalized = typeof name.normalize === "function" ? name.normalize("NFKC") : name;
    return normalized.toLowerCase();
  }

  function uniqueArchiveName(file, ext, usedNames) {
    var base = stem(file && file.name, "image") + "-就地";
    var candidate = base + "." + ext;
    var suffix = 2;
    while (usedNames[normalizedArchiveKey(candidate)]) {
      candidate = base + "-" + suffix + "." + ext;
      suffix++;
    }
    usedNames[normalizedArchiveKey(candidate)] = true;
    return candidate;
  }

  function markChips(root, key, id) {
    var btns = root.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", btns[i].dataset[key] === id);
    }
  }

  function resetCropForItem(item) {
    item.crop = constrainCrop(item, fitAspectCrop(item, item.aspect));
  }

  function setAspect(id, ratio, resetCrop, settingsChanged) {
    var item = cur();
    if (!item) return;
    item.aspectId = id;
    item.aspect = ratio;
    markChips($("aspects"), "id", id);
    if (resetCrop) {
      resetCropForItem(item);
      if (!lockOut) syncOutFields();
      layoutStage();
      if (settingsChanged) invalidateSettings();
      else invalidateItem(item);
    }
  }

  function applyPreset(p) {
    var item = cur();
    if (!item) return;
    item.presetId = p.id;
    markChips($("presets"), "id", p.id);
    if (p.kb) {
      $("kbRange").value = String(p.kb);
      $("kbNum").value = String(p.kb);
      syncKB(true);
    }
    if (p.w && p.h) {
      lockOut = true;
      $("wVal").value = String(p.w);
      $("hVal").value = String(p.h);
      setAspect("custom", p.w / p.h, true, true);
    } else {
      lockOut = false;
      syncOutFields();
      invalidateSettings();
    }
  }

  function onCropDown(e) {
    var item = cur();
    if (!item || view !== "crop") return;
    var handle = e.target.dataset.handle || "move";
    drag = {
      handle: handle,
      x0: e.clientX,
      y0: e.clientY,
      crop: { x: item.crop.x, y: item.crop.y, w: item.crop.w, h: item.crop.h }
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onCropMove(e) {
    if (!drag) return;
    var item = cur();
    var dx = (e.clientX - drag.x0) / disp.scale;
    var dy = (e.clientY - drag.y0) / disp.scale;
    var c = { x: drag.crop.x, y: drag.crop.y, w: drag.crop.w, h: drag.crop.h };
    var h = drag.handle;
    if (h === "move") {
      c.x += dx;
      c.y += dy;
    } else {
      if (h.indexOf("w") !== -1) {
        c.x += dx;
        c.w -= dx;
      }
      if (h.indexOf("e") !== -1) c.w += dx;
      if (h.indexOf("n") !== -1) {
        c.y += dy;
        c.h -= dy;
      }
      if (h.indexOf("s") !== -1) c.h += dy;
      if (c.w < 8) {
        if (h.indexOf("w") !== -1) c.x = drag.crop.x + drag.crop.w - 8;
        c.w = 8;
      }
      if (c.h < 8) {
        if (h.indexOf("n") !== -1) c.y = drag.crop.y + drag.crop.h - 8;
        c.h = 8;
      }
      if (item.aspect) {
        if (h === "e" || h === "w") c.h = c.w / item.aspect;
        else if (h === "n" || h === "s") c.w = c.h * item.aspect;
        else {
          c.h = c.w / item.aspect;
          if (h.indexOf("n") !== -1) c.y = drag.crop.y + drag.crop.h - c.h;
        }
      }
    }
    item.crop = constrainCrop(item, c);
    invalidateItem(item, false);
    placeCrop();
    syncOutFields();
  }

  function onCropUp() {
    if (!drag) return;
    drag = null;
    queueCompression();
  }

  async function encodeCanvas(canvas, mime, q, cancelled) {
    throwIfCancelled(cancelled);
    var blob = await toBlobP(canvas, mime, q);
    throwIfCancelled(cancelled);
    if (blob.type !== mime) {
      throw new Error("浏览器无法输出 " + (mime === "image/webp" ? "WebP" : mime.replace("image/", "").toUpperCase()));
    }
    return blob;
  }

  async function searchQuality(canvas, mime, targetBytes, cancelled) {
    var lo = 0.08;
    var hi = 1;
    var bestFit = null;
    var smallest = null;
    var smallestQ = lo;

    async function probe(q) {
      var blob = await encodeCanvas(canvas, mime, q, cancelled);
      if (!smallest || blob.size < smallest.size) {
        smallest = blob;
        smallestQ = q;
      }
      if (blob.size <= targetBytes && (!bestFit || q >= bestFit.q)) {
        bestFit = { blob: blob, q: q };
      }
      return blob;
    }

    var hiBlob = await probe(hi);
    if (hiBlob.size <= targetBytes) return { blob: hiBlob, q: hi, fit: true };

    var loBlob = await probe(lo);
    if (loBlob.size > targetBytes) {
      var floor = await probe(0.01);
      if (floor.size > targetBytes) return { blob: smallest, q: smallestQ, fit: false };
      lo = 0.01;
      hi = 0.08;
    }

    for (var i = 0; i < 9; i++) {
      throwIfCancelled(cancelled);
      var mid = (lo + hi) / 2;
      var blob = await probe(mid);
      if (blob.size <= targetBytes) lo = mid;
      else hi = mid;
    }
    if (bestFit) return { blob: bestFit.blob, q: bestFit.q, fit: true };
    return { blob: smallest, q: smallestQ, fit: false };
  }

  function drawOut(snapshot, w, h) {
    if (w * h > MAX_EXPORT_PIXELS) {
      throw new Error("输出尺寸 " + w + "×" + h + " 超过 3200 万像素，请降低宽高");
    }
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      releaseCanvas(canvas);
      throw new Error("浏览器无法创建输出画布");
    }
    if (snapshot.format !== "png") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(snapshot.work, snapshot.crop.x, snapshot.crop.y, snapshot.crop.w, snapshot.crop.h, 0, 0, w, h);
    return canvas;
  }

  async function encodeSnapshot(snapshot, cancelled) {
    var scale = 1;
    var result = null;
    var lastFailedScale = null;

    async function encodeAtScale(candidateScale) {
      throwIfCancelled(cancelled);
      var cw = Math.max(1, Math.round(snapshot.width * candidateScale));
      var ch = Math.max(1, Math.round(snapshot.height * candidateScale));
      var canvas = drawOut(snapshot, cw, ch);
      try {
        if (snapshot.format === "png") {
          var pngBlob = await encodeCanvas(canvas, snapshot.mime, undefined, cancelled);
          return { blob: pngBlob, w: cw, h: ch, q: null, fit: pngBlob.size <= snapshot.targetBytes };
        }
        var qualityResult = await searchQuality(canvas, snapshot.mime, snapshot.targetBytes, cancelled);
        return { blob: qualityResult.blob, w: cw, h: ch, q: qualityResult.q, fit: qualityResult.fit };
      } finally {
        releaseCanvas(canvas);
      }
    }

    for (var attempt = 0; attempt < 40; attempt++) {
      result = await encodeAtScale(scale);
      if (result.fit) break;
      if (!snapshot.allowScale) break;
      if (result.w <= 24 || result.h <= 24) break;
      lastFailedScale = scale;
      scale *= 0.85;
    }

    if (result && result.fit && snapshot.allowScale && lastFailedScale != null) {
      var fitScale = scale;
      var failedScale = lastFailedScale;
      for (var refine = 0; refine < 5; refine++) {
        var midScale = (fitScale + failedScale) / 2;
        var refined = await encodeAtScale(midScale);
        if (refined.fit) {
          result = refined;
          fitScale = midScale;
        } else {
          failedScale = midScale;
        }
      }
    }

    throwIfCancelled(cancelled);
    if (!result) throw new Error("压缩失败");
    return result;
  }

  function publishResult(snapshot, best) {
    if (snapshotIsStale(snapshot)) throw new StaleJobError();
    var item = snapshot.item;
    releaseOutput(item);
    item.outBlob = best.blob;
    item.outUrl = URL.createObjectURL(best.blob);
    item.outW = best.w;
    item.outH = best.h;
    item.outQ = best.q;
    item.fit = JiudiImageSize.fits(best.blob, snapshot.targetBytes);
    item.outFormat = snapshot.format;
    item.outExt = snapshot.ext;
    item.outTargetKB = snapshot.targetKB;
    item.outTargetBytes = snapshot.targetBytes;
    item.outCrop = snapshot.crop;
    item.outSettingsVersion = snapshot.settingsVersion;
    item.outEditVersion = snapshot.editVersion;
    item.dirty = false;
    item.origAtOut = null;
    return item;
  }

  function runExclusive(task) {
    var run = encoderTail.then(task, task);
    encoderTail = run.catch(function () {});
    return run;
  }

  function applyCurrentResult() {
    var item = cur();
    if (!isResultValid(item)) {
      clearCurrentResult();
      return;
    }
    var actualSize = fmtBytes(item.outBlob.size);
    $("dl").title = fmtBytesExact(item.outBlob.size);
    var name = stem(item.file.name, "image") + "-就地." + item.outExt;
    if (JiudiImageSize.fits(item.outBlob, item.outTargetBytes)) {
      $("dl").href = item.outUrl;
      $("dl").download = name;
      $("dl").removeAttribute("aria-disabled");
      $("dl").textContent = "下载 · " + actualSize;
    } else {
      $("dl").setAttribute("aria-disabled", "true");
      $("dl").setAttribute("href", "#");
      $("dl").removeAttribute("download");
      $("dl").textContent = "超过目标 · " + actualSize;
    }

    var qtxt = item.outQ != null && item.outFormat !== "png" ? " · " + Math.round(item.outQ * 100) + "%" : "";
    $("resultBox").innerHTML =
      "<b title=\"" + fmtBytesExact(item.outBlob.size) + "\">" + actualSize + "</b> · " + item.outW + "×" + item.outH + qtxt;

    if (item.fit) status("");
    else status("结果超过 " + item.outTargetKB + " KB，下载已停用。请提高目标大小、解锁输出尺寸或更换格式", "warn");

    if (view === "compare") fillCompare(item);
  }

  function queueCompression() {
    if (!cur()) return;
    clearTimeout(debounceT);
    debounceT = setTimeout(runForeground, 160);
  }

  async function runForeground() {
    if (foregroundRunning) {
      foregroundQueued = true;
      return;
    }
    foregroundRunning = true;
    try {
      do {
        foregroundQueued = false;
        var item = cur();
        if (!item) continue;
        var myRequest = requestVersion;
        var capturedSettings;
        var snapshot;
        try {
          capturedSettings = captureSettings();
          snapshot = captureItem(item, capturedSettings);
          status("正在压到 " + capturedSettings.targetKB + " KB…");
          clearCurrentResult();
          var best = await runExclusive(function () {
            return encodeSnapshot(snapshot, function () {
              return myRequest !== requestVersion || snapshotIsStale(snapshot);
            });
          });
          if (myRequest !== requestVersion || snapshotIsStale(snapshot)) throw new StaleJobError();
          publishResult(snapshot, best);
          if (item === cur()) applyCurrentResult();
        } catch (err) {
          if (!isStaleError(err) && myRequest === requestVersion) {
            clearCurrentResult();
            status(err.message || String(err), "warn");
          }
        }
      } while (foregroundQueued);
    } finally {
      foregroundRunning = false;
      if (foregroundQueued) runForeground();
    }
  }

  async function makeOrigAtOut(item) {
    if (item.origAtOut) return item.origAtOut;
    if (!isResultValid(item)) throw new StaleJobError();
    var token = item.outToken;
    var previewSnapshot = {
      format: "jpeg",
      work: item.work,
      crop: item.outCrop
    };
    var canvas = drawOut(previewSnapshot, item.outW, item.outH);
    var blob;
    try {
      blob = await encodeCanvas(canvas, "image/jpeg", 0.95, function () {
        return token !== item.outToken || !isResultValid(item);
      });
    } finally {
      releaseCanvas(canvas);
    }
    if (token !== item.outToken || !isResultValid(item)) throw new StaleJobError();
    item.origAtOut = blob;
    return item.origAtOut;
  }

  async function fillCompare(item) {
    if (!item || !isResultValid(item)) return;
    var myCompare = ++compareVersion;
    var resultUrl = item.outUrl;
    try {
      var orig = await makeOrigAtOut(item);
      if (myCompare !== compareVersion || item !== cur() || view !== "compare" ||
          resultUrl !== item.outUrl || !isResultValid(item)) return;
      if (item.cmpOrigUrl) URL.revokeObjectURL(item.cmpOrigUrl);
      item.cmpOrigUrl = URL.createObjectURL(orig);
      displayedCompareItem = item;
      $("cmpOrig").src = item.cmpOrigUrl;
      $("cmpOut").src = item.outUrl;
      layoutCompare();
    } catch (err) {
      if (!isStaleError(err) && item === cur()) status(err.message || String(err), "warn");
    }
  }

  function layoutCompare() {
    var box = $("compareView");
    box.style.setProperty("--stage-w", box.clientWidth + "px");
    $("cmpTop").style.width = cmpX * 100 + "%";
    $("cmpBar").style.left = cmpX * 100 + "%";
    $("cmpOut").style.width = box.clientWidth + "px";
    $("cmpOut").style.height = box.clientHeight + "px";
  }

  function setView(next) {
    view = next;
    compareVersion++;
    var btns = $("stageTabs").querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", btns[i].dataset.view === next);
    }
    $("cropView").classList.toggle("hidden", next !== "crop");
    $("compareView").classList.toggle("hidden", next !== "compare");
    placeCrop();
    if (next === "compare" && cur()) fillCompare(cur());
    else clearCompare();
    layoutCompare();
  }

  function refreshHead() {
    var item = cur();
    if (!item) return;
    $("fileName").textContent = item.file.name;
    $("fileMeta").textContent = fmtBytes(item.file.size) + " · " + item.srcW + "×" + item.srcH;
    $("dlAll").classList.toggle("hidden", items.length < 2);
  }

  function refreshStrip() {
    var box = $("batchStrip");
    box.classList.toggle("hidden", items.length < 2);
    box.innerHTML = "";
    items.forEach(function (it, idx) {
      var b = document.createElement("button");
      b.type = "button";
      if (idx === current) b.className = "on";
      var im = document.createElement("img");
      if (!it.thumbUrl) it.thumbUrl = URL.createObjectURL(it.file);
      im.src = it.thumbUrl;
      im.alt = it.file.name;
      b.appendChild(im);
      b.addEventListener("click", function () { selectItem(idx); });
      box.appendChild(b);
    });
  }

  function selectItem(idx) {
    requestVersion++;
    clearTimeout(debounceT);
    foregroundQueued = false;
    clearCurrentResult();
    current = idx;
    var item = cur();
    markChips($("aspects"), "id", item.aspectId || "free");
    markChips($("presets"), "id", item.presetId || "");
    if (!lockOut) {
      $("wVal").value = String(item.crop.w);
      $("hVal").value = String(item.crop.h);
    }
    refreshHead();
    refreshStrip();
    layoutStage();
    if (!isResultValid(item)) queueCompression();
    else applyCurrentResult();
  }

  function transform(kind) {
    var item = cur();
    if (!item) return;
    if (kind === "l") item.rot = (item.rot + 270) % 360;
    if (kind === "r") item.rot = (item.rot + 90) % 360;
    if (kind === "h") item.flipH = !item.flipH;
    if (kind === "v") item.flipV = !item.flipV;
    makeWorking(item);
    resetCropForItem(item);
    if (!lockOut) syncOutFields();
    layoutStage();
    invalidateItem(item);
  }

  async function addFiles(files) {
    var added = 0;
    var lastError = "";
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!Jiudi.isImage(file)) continue;
      var dec = null;
      try {
        dec = await decodeFile(file);
        var pixels = dec.w * dec.h;
        if (!dec.w || !dec.h || !isFinite(pixels)) {
          throw new Error(file.name + "：图片尺寸无效");
        }
        if (pixels > MAX_SOURCE_PIXELS) {
          throw new Error(file.name + "：" + dec.w + "×" + dec.h + " 超过 4000 万像素读取限制");
        }
        if (dec.w > MAX_SOURCE_EDGE || dec.h > MAX_SOURCE_EDGE) {
          throw new Error(file.name + "：单边尺寸超过 " + MAX_SOURCE_EDGE + " 像素读取限制");
        }
        var retainedForItem = pixels * 2;
        if (retainedPixels + retainedForItem > MAX_RETAINED_PIXELS) {
          throw new Error(file.name + "：已载入图片达到内存上限，请刷新页面后分批处理");
        }
        var item = {
          file: file,
          src: dec.img,
          srcW: dec.w,
          srcH: dec.h,
          rot: 0,
          flipH: false,
          flipV: false,
          dirty: true,
          editVersion: 0,
          retainedPixels: retainedForItem,
          outToken: 0,
          aspect: null,
          aspectId: "free",
          presetId: ""
        };
        makeWorking(item);
        resetCropForItem(item);
        items.push(item);
        retainedPixels += retainedForItem;
        dec = null;
        added++;
      } catch (err) {
        if (dec) releaseImage(dec.img);
        lastError = err.message || "有一张读不进来";
        status(lastError, "warn");
      }
    }
    if (!items.length) {
      status(lastError || "请选择图片", "warn");
      return;
    }
    if (!added) return;
    $("empty").classList.add("hidden");
    $("work").classList.remove("hidden");
    selectItem(items.length - (added || 1));
    refreshStrip();
    requestAnimationFrame(layoutStage);
  }

  function setImportLocked(locked) {
    $("file").disabled = locked;
    $("swap").disabled = locked;
  }

  function enqueueFiles(files) {
    importCount++;
    setImportLocked(true);
    var task = importTail.then(function () { return addFiles(files); });
    importTail = task.catch(function (err) {
      status(err.message || String(err), "warn");
    }).then(function () {
      importCount--;
      if (!importCount) setImportLocked(false);
    });
    return task;
  }

  function resetCurrentImage() {
    var item = cur();
    if (!item) return;
    item.rot = 0;
    item.flipH = false;
    item.flipV = false;
    item.aspectId = "free";
    item.aspect = null;
    item.presetId = "";
    var settingsChanged = lockOut;
    lockOut = false;
    markChips($("aspects"), "id", "free");
    markChips($("presets"), "id", "");
    makeWorking(item);
    resetCropForItem(item);
    syncOutFields();
    layoutStage();
    if (settingsChanged) invalidateSettings();
    else invalidateItem(item);
  }

  async function downloadAll() {
    if (items.length < 2) return;
    var myBatch = ++batchVersion;
    var capturedSettings;
    var batchItems = items.slice();
    var editVersions = batchItems.map(function (item) { return item.editVersion; });
    try {
      capturedSettings = captureSettings();
      status("正在打包…");
      if (!window.JSZip) await Jiudi.loadScript("js/vendor/jszip.min.js");
      function batchStale() {
        if (myBatch !== batchVersion || settingsVersion !== capturedSettings.version || items.length !== batchItems.length) return true;
        for (var n = 0; n < batchItems.length; n++) {
          if (items[n] !== batchItems[n] || batchItems[n].editVersion !== editVersions[n]) return true;
        }
        return false;
      }
      throwIfCancelled(batchStale);
      var zip = new JSZip();
      var usedNames = Object.create(null);
      for (var i = 0; i < batchItems.length; i++) {
        throwIfCancelled(batchStale);
        var batchItem = batchItems[i];
        status("处理 " + (i + 1) + " / " + batchItems.length + " …");
        if (!isResultValid(batchItem)) {
          var snapshot = captureItem(batchItem, capturedSettings);
          var best = await runExclusive(function (snap) {
            return function () { return encodeSnapshot(snap, batchStale); };
          }(snapshot));
          throwIfCancelled(batchStale);
          publishResult(snapshot, best);
        }
        if (!JiudiImageSize.fits(batchItem.outBlob, capturedSettings.targetBytes)) {
          throw new Error((batchItem.file.name || "图片") + " 的结果为 " + fmtBytes(batchItem.outBlob.size) +
            "，超过 " + capturedSettings.targetKB + " KB。请提高目标大小、解锁输出尺寸或更换格式后再打包");
        }
        zip.file(uniqueArchiveName(batchItem.file, capturedSettings.ext, usedNames), batchItem.outBlob);
      }
      var blob = await zip.generateAsync({ type: "blob" });
      throwIfCancelled(batchStale);
      Jiudi.downloadBlob(blob, "就地-图片.zip");
      applyCurrentResult();
      status("已打包 " + batchItems.length + " 张 · " + fmtBytes(blob.size), "ok");
    } catch (err) {
      if (myBatch === batchVersion) {
        if (isStaleError(err)) status("设置或裁切已变化，已停止打包", "warn");
        else status(err.message || String(err), "warn");
      }
    }
  }

  function buildChips() {
    var box = $("aspects");
    ASPECTS.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.dataset.id = a.id;
      if (a.id === "free") b.className = "on";
      b.addEventListener("click", function () {
        var item = cur();
        if (!item) return;
        var settingsChanged = lockOut;
        lockOut = false;
        item.presetId = "";
        markChips($("presets"), "id", "");
        setAspect(a.id, a.ratio, true, settingsChanged);
      });
      box.appendChild(b);
    });
    var pbox = $("presets");
    PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = p.label;
      b.dataset.id = p.id;
      b.addEventListener("click", function () { applyPreset(p); });
      pbox.appendChild(b);
    });
  }

  function onDimInput(which) {
    var item = cur();
    if (!item) return;
    lockOut = true;
    item.presetId = "";
    markChips($("presets"), "id", "");
    if (keepAsp) {
      var r = item.crop.w / item.crop.h;
      if (which === "w") $("hVal").value = String(Math.max(1, Math.round(Number($("wVal").value) / r)));
      else $("wVal").value = String(Math.max(1, Math.round(Number($("hVal").value) * r)));
    }
    invalidateSettings();
  }

  Jiudi.markNav("image.html");
  Jiudi.bindDrop($("drop"), enqueueFiles, Jiudi.isImage);
  Jiudi.bindPaste(Jiudi.isImage, enqueueFiles);
  $("swap").addEventListener("click", function () { $("file").click(); });
  if ($("resetImage")) $("resetImage").addEventListener("click", resetCurrentImage);

  $("kbRange").addEventListener("input", function () { syncKB(true); invalidateSettings(); });
  $("kbNum").addEventListener("input", function () { syncKB(false); invalidateSettings(); });
  Jiudi.bindSeg($("fmtSeg"), "fmt", function (fmt) {
    if (fmt === "webp" && !webpOk) return;
    format = fmt;
    $("pngWarn").classList.toggle("show", fmt === "png" && targetKB() < 200);
    invalidateSettings();
  });

  $("keepAsp").addEventListener("click", function () {
    keepAsp = !keepAsp;
    $("keepAsp").classList.toggle("on", keepAsp);
    $("keepAsp").setAttribute("aria-pressed", keepAsp ? "true" : "false");
  });
  $("wVal").addEventListener("input", function () { onDimInput("w"); });
  $("hVal").addEventListener("input", function () { onDimInput("h"); });

  $("rotL").addEventListener("click", function () { transform("l"); });
  $("rotR").addEventListener("click", function () { transform("r"); });
  $("flipH").addEventListener("click", function () { transform("h"); });
  $("flipV").addEventListener("click", function () { transform("v"); });

  $("cropEl").addEventListener("pointerdown", onCropDown);
  $("cropEl").addEventListener("pointermove", onCropMove);
  $("cropEl").addEventListener("pointerup", onCropUp);
  $("cropEl").addEventListener("pointercancel", onCropUp);

  $("stageTabs").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b && b.dataset.view) setView(b.dataset.view);
  });

  var cmpDrag = false;
  $("compareView").addEventListener("pointerdown", function (e) {
    cmpDrag = true;
    $("compareView").setPointerCapture(e.pointerId);
    moveCmp(e);
  });
  $("compareView").addEventListener("pointermove", function (e) {
    if (cmpDrag) moveCmp(e);
  });
  $("compareView").addEventListener("pointerup", function () { cmpDrag = false; });
  function moveCmp(e) {
    var r = $("compareView").getBoundingClientRect();
    cmpX = clamp((e.clientX - r.left) / r.width, 0.02, 0.98);
    layoutCompare();
  }

  $("dl").addEventListener("click", function (e) {
    var item = cur();
    if (!isResultValid(item)) {
      e.preventDefault();
      clearCurrentResult();
      return;
    }
    if ($("dl").getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      status("结果超过 " + item.outTargetKB + " KB，下载已停用。请提高目标大小、解锁输出尺寸或更换格式", "warn");
    }
  });
  $("dlAll").addEventListener("click", downloadAll);

  document.addEventListener("keydown", function (e) {
    var item = cur();
    if (!item || view !== "crop") return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    var step = e.shiftKey ? 10 : 1;
    var c = { x: item.crop.x, y: item.crop.y, w: item.crop.w, h: item.crop.h };
    if (e.key === "ArrowLeft") c.x -= step;
    else if (e.key === "ArrowRight") c.x += step;
    else if (e.key === "ArrowUp") c.y -= step;
    else if (e.key === "ArrowDown") c.y += step;
    else return;
    e.preventDefault();
    item.crop = constrainCrop(item, c);
    placeCrop();
    syncOutFields();
    invalidateItem(item);
  });

  window.addEventListener("resize", function () {
    layoutStage();
  });
  window.addEventListener("beforeunload", function () {
    clearTimeout(debounceT);
    batchVersion++;
    requestVersion++;
    items.forEach(function (item) {
      releaseOutput(item);
      if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
      releaseCanvas(item.work);
      releaseImage(item.src);
    });
    items.length = 0;
    retainedPixels = 0;
  });
  if (window.ResizeObserver) {
    new ResizeObserver(layoutStage).observe($("stage"));
  }

  async function detectWebP() {
    var c;
    try {
      c = document.createElement("canvas");
      c.width = 2;
      c.height = 2;
      var b = await toBlobP(c, "image/webp", 0.8);
      webpOk = b && b.type === "image/webp";
    } catch (e) {
      webpOk = false;
    } finally {
      releaseCanvas(c);
    }
    if (!webpOk) {
      if (format === "webp") {
        format = "jpeg";
        markChips($("fmtSeg"), "fmt", "jpeg");
        invalidateSettings();
      }
      $("webpBtn").disabled = true;
      $("webpBtn").textContent = "WebP 不可用";
    }
  }

  buildChips();
  syncKB(true);
  detectWebP();
})();
