(function (global) {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function fmtBytes(bytes) {
    var n = Math.max(0, Math.round(Number(bytes) || 0));
    if (n < 1000) return n + " B";
    var kb = n / 1000;
    if (kb < 1000) return kb.toFixed(1) + " KB";
    var mb = kb / 1000;
    if (mb < 1000) return mb.toFixed(1) + " MB";
    return (mb / 1000).toFixed(1) + " GB";
  }

  function fmtBytesExact(bytes) {
    var n = Math.max(0, Math.round(Number(bytes) || 0));
    return fmtBytes(n) + "（" + n.toLocaleString("zh-CN") + " 字节）";
  }

  function fmtTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    var sign = "";
    if (!isFinite(sec)) return "—";
    var ms = Math.round(sec * 10);
    var s = Math.floor(ms / 10);
    var t = ms % 10;
    var m = Math.floor(s / 60);
    s = s % 60;
    var h = Math.floor(m / 60);
    m = m % 60;
    if (h) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s) + (t ? "." + t : "");
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function stem(name, fallback) {
    var n = (name || fallback || "file").replace(/[/\\?%*:|"<>]/g, "-");
    var i = n.lastIndexOf(".");
    return i > 0 ? n.slice(0, i) : n;
  }

  function takeFiles(fileList, acceptPred) {
    var files = [];
    if (!fileList) return files;
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (!acceptPred || acceptPred(f)) files.push(f);
    }
    return files;
  }

  function bindDrop(el, onFiles, acceptPred) {
    function take(list) {
      var files = takeFiles(list, acceptPred);
      var hint = $("importStatus");
      if (hint) hint.textContent = "";
      if (!files.length && list && list.length) {
        setStatus($("status"), "文件格式暂不支持，请选择此工具支持的文件。", "warn");
        return;
      }
      if (files.length) Promise.resolve().then(function () { return onFiles(files); }).catch(function (err) {
        setStatus($("status"), err.message || "文件打开失败，请重试。", "warn");
      });
    }
    el.addEventListener("click", function (e) {
      if (e.target && e.target.matches("input[type=file]")) return;
      var input = el.querySelector("input[type=file]");
      if (input) input.click();
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var input = el.querySelector("input[type=file]");
        if (input) input.click();
      }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        e.preventDefault();
        el.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        e.preventDefault();
        el.classList.remove("over");
      });
    });
    el.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("over");
      take(e.dataTransfer && e.dataTransfer.files);
    });
    var input = el.querySelector("input[type=file]");
    if (input) {
      input.addEventListener("change", function () {
        take(input.files);
        input.value = "";
      });
    }
    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      if (e.target && e.target.closest && e.target.closest("input, textarea")) return;
      e.preventDefault();
      el.classList.remove("over");
      take(e.dataTransfer && e.dataTransfer.files);
    });
  }

  function bindPaste(acceptPred, onFiles) {
    document.addEventListener("paste", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var items = e.clipboardData && e.clipboardData.files;
      var files = takeFiles(items, acceptPred);
      if (files.length) {
        e.preventDefault();
        onFiles(files);
      }
    });
  }

  function markNav(which) {
    var links = document.querySelectorAll(".nav-links a");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      var active = href.indexOf(which) !== -1;
      links[i].classList.toggle("on", active);
      if (active) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }

  function setStatus(el, text, kind) {
    var hint = $("importStatus");
    if (hint && $("empty") && !$("empty").classList.contains("hidden")) hint.textContent = text || "";
    if (!el) return;
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function setProgress(bar, p) {
    if (!bar) return;
    bar.parentElement.classList.toggle("hidden", p == null);
    if (p == null) return;
    bar.parentElement.setAttribute("role", "progressbar");
    bar.parentElement.setAttribute("aria-label", "处理进度");
    bar.parentElement.setAttribute("aria-valuemin", "0");
    bar.parentElement.setAttribute("aria-valuemax", "100");
    bar.parentElement.setAttribute("aria-valuenow", String(Math.round(clamp(p, 0, 1) * 100)));
    bar.style.transform = "scaleX(" + clamp(p, 0, 1) + ")";
  }

  function bindSeg(el, key, onChange) {
    el.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.classList.contains("on"))); });
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || b.disabled || !b.dataset[key]) return;
      var btns = el.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("on", btns[i] === b);
        btns[i].setAttribute("aria-pressed", String(btns[i] === b));
      }
      onChange(b.dataset[key], b);
    });
  }

  function toBlobP(canvas, mime, q) {
    return new Promise(function (resolve, reject) {
      var args = [function (b) {
        if (b) resolve(b);
        else reject(new Error("编码失败"));
      }, mime];
      if (mime !== "image/png" && typeof q === "number") args.push(q);
      canvas.toBlob.apply(canvas, args);
    });
  }

  function parseRanges(str, pageCount) {
    var raw = String(str || "").trim();
    if (!raw) return Array.from({ length: pageCount }, function (_, i) { return i; });
    // Normalize range separators before tokenization, retaining spaces around ranges.
    raw = raw.replace(/(\d)\s*[-~—–到至]\s*(?=\d)/g, "$1-");
    var out = [], seen = new Set();
    raw.split(/[,，;；\s]+/).filter(Boolean).forEach(function (part) {
      var match = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!match) throw new Error("页码格式有误：" + part + "。请填写 3 或 7-9。");
      var a = Number(match[1]), b = match[2] ? Number(match[2]) : a;
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1 || a > pageCount || b > pageCount) {
        throw new Error("页码须在 1–" + pageCount + " 之间：" + part);
      }
      if (a > b) { var t = a; a = b; b = t; }
      for (var n = a; n <= b; n++) {
        if (!seen.has(n)) { seen.add(n); out.push(n - 1); }
      }
    });
    if (!out.length) throw new Error("请填写有效页码，如 3 或 7-9。");
    return out;
  }

  function isImage(f) {
    if (!f) return false;
    if (f.type && f.type.indexOf("image/") === 0) return true;
    return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name || "");
  }

  function isPdf(f) {
    if (!f) return false;
    if (f.type === "application/pdf") return true;
    return /\.pdf$/i.test(f.name || "");
  }

  function isVideo(f) {
    if (!f) return false;
    if (f.type && f.type.indexOf("video/") === 0) return true;
    return /\.(mp4|webm|mov|mkv|ogv|m4v)$/i.test(f.name || "");
  }

  function isolated() {
    return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
  }

  var scriptLoads = Object.create(null);
  function loadScript(src) {
    if (scriptLoads[src]) return scriptLoads[src];
    scriptLoads[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        s.remove();
        delete scriptLoads[src];
        reject(new Error("组件加载失败，请重试：" + src));
      };
      document.head.appendChild(s);
    });
    return scriptLoads[src];
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest('a[aria-disabled="true"]')) e.preventDefault();
  });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "o") {
      var input = $("file");
      if (input && !input.disabled) { e.preventDefault(); input.click(); }
    }
  });

  global.Jiudi = {
    $: $,
    clamp: clamp,
    fmtBytes: fmtBytes,
    fmtBytesExact: fmtBytesExact,
    fmtTime: fmtTime,
    downloadBlob: downloadBlob,
    stem: stem,
    bindDrop: bindDrop,
    bindPaste: bindPaste,
    markNav: markNav,
    setStatus: setStatus,
    setProgress: setProgress,
    bindSeg: bindSeg,
    toBlobP: toBlobP,
    parseRanges: parseRanges,
    isImage: isImage,
    isPdf: isPdf,
    isVideo: isVideo,
    isolated: isolated,
    loadScript: loadScript
  };
})(window);
