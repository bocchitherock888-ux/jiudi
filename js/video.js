(function () {
  "use strict";

  var $ = Jiudi.$;
  var clamp = Jiudi.clamp;
  var fmtBytes = Jiudi.fmtBytes;
  var fmtTime = Jiudi.fmtTime;
  var downloadBlob = Jiudi.downloadBlob;
  var stem = Jiudi.stem;

  var player = $("player");
  var file = null;
  var url = null;
  var duration = 0;
  var startT = 0;
  var endT = 0;
  var res = "src";
  var audioKeep = true;
  var ffmpeg = null;
  var loadingFfmpeg = null;
  var readinessController = null;
  var ffmpegPromise = null;
  var ffmpegState = "idle";
  var running = false;
  var activeJob = null;
  var loadGeneration = 0;
  var encoderGeneration = 0;
  var filmDrag = null;
  var playGuard = null;
  var MAX_INPUT_BYTES = 512 * 1024 * 1024;
  var MEDIA_TIMEOUT_MS = 12000;

  function status(text, kind) {
    Jiudi.setStatus($("status"), text, kind);
  }

  function progress(p) {
    Jiudi.setProgress($("progressBar"), p);
  }

  function targetMB() {
    return clamp($("mbNum").value, 1, 200);
  }

  function clipSpan() {
    return Math.max(0, endT - startT);
  }

  function even(n) {
    n = Math.max(2, Math.round(n));
    return n % 2 ? n - 1 : n;
  }

  function outSize(choice) {
    var sw = player.videoWidth || 1280;
    var sh = player.videoHeight || 720;
    var selected = choice || res;
    var maxH = selected === "1080" ? 1080 : selected === "720" ? 720 : selected === "480" ? 480 : 0;
    if (!maxH || sh <= maxH) return { w: even(sw), h: even(sh) };
    var s = maxH / sh;
    return { w: even(sw * s), h: even(maxH) };
  }

  function updateMeta() {
    if (!file) {
      $("fileMeta").textContent = "";
      return;
    }
    var span = clipSpan();
    var sz = outSize();
    $("fileName").textContent = file.name;
    $("fileMeta").textContent =
      fmtBytes(file.size) + " · " + fmtTime(duration) + " · " +
      (player.videoWidth || "?") + "×" + (player.videoHeight || "?");
    $("tStartLab").textContent = fmtTime(startT);
    $("tEndLab").textContent = fmtTime(endT);
    $("tSpanLab").textContent = "裁 " + fmtTime(span) + " · " + sz.w + "×" + sz.h + " · " + targetMB() + " MB";
    $("tStart").value = startT.toFixed(1);
    $("tEnd").value = endT.toFixed(1);
  }

  function setEncoderBox() {
    var el = $("encBox");
    if (ffmpegState === "ready" || ffmpegState === "idle" || ffmpegState === "checking") {
      el.textContent = "";
    } else if (ffmpegState === "missing" || ffmpegState === "noiso") {
      el.textContent = "没有 ffmpeg，将实时重录这一段。";
    } else if (ffmpegState === "fail") {
      el.textContent = "ffmpeg 加载失败，改用实时重录。";
    } else {
      el.textContent = "";
    }
  }

  function layoutFilm() {
    if (!duration) return;
    var a = startT / duration;
    var b = endT / duration;
    $("shadeL").style.width = a * 100 + "%";
    $("shadeR").style.width = (1 - b) * 100 + "%";
    $("filmSel").style.left = a * 100 + "%";
    $("filmSel").style.width = (b - a) * 100 + "%";
    $("hStart").style.left = a * 100 + "%";
    $("hEnd").style.left = b * 100 + "%";
  }

  function setRange(a, b, seekTo) {
    if (!duration) return;
    startT = clamp(a, 0, Math.max(0, duration - 0.1));
    endT = clamp(b, startT + 0.1, duration);
    layoutFilm();
    updateMeta();
    if (seekTo != null) {
      try { player.currentTime = seekTo; } catch (e) {}
    }
  }

  function filmTime(clientX) {
    var r = $("film").getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  }

  function onFilmDown(e) {
    if (!duration || running) return;
    var t = filmTime(e.clientX);
    var which;
    if (e.target === $("hStart")) which = "start";
    else if (e.target === $("hEnd")) which = "end";
    else if (Math.abs(t - startT) < Math.abs(t - endT) && Math.abs(t - startT) < duration * 0.03) which = "start";
    else if (Math.abs(t - endT) < duration * 0.03) which = "end";
    else which = "seek";
    filmDrag = { which: which };
    $("film").setPointerCapture(e.pointerId);
    onFilmMove(e);
    e.preventDefault();
  }

  function onFilmMove(e) {
    if (!filmDrag) return;
    var t = filmTime(e.clientX);
    if (filmDrag.which === "start") setRange(Math.min(t, endT - 0.1), endT, t);
    else if (filmDrag.which === "end") setRange(startT, Math.max(t, startT + 0.1), t);
    else {
      try { player.currentTime = t; } catch (err) {}
    }
  }

  function onFilmUp() {
    filmDrag = null;
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(message)); }, ms);
      Promise.resolve(promise).then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function seek(video, t, token) {
    return new Promise(function (resolve, reject) {
      var timer = null;
      var cleanup = function () {
        if (timer) clearTimeout(timer);
        video.removeEventListener("seeked", done);
        video.removeEventListener("error", bad);
      };
      var done = function () {
        cleanup();
        if (token != null && token !== loadGeneration) reject(new Error("已换视频"));
        else resolve();
      };
      var bad = function () {
        cleanup();
        reject(new Error("无法定位视频画面"));
      };
      if (token != null && token !== loadGeneration) {
        reject(new Error("已换视频"));
        return;
      }
      if (Math.abs((video.currentTime || 0) - t) < 0.04) {
        resolve();
        return;
      }
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("error", bad, { once: true });
      timer = setTimeout(function () {
        cleanup();
        reject(new Error("读取视频画面超时"));
      }, MEDIA_TIMEOUT_MS);
      try { video.currentTime = t; } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  function waitForMedia(video, eventName, token, errorMessage) {
    return new Promise(function (resolve, reject) {
      var cleanup = function () {
        clearTimeout(timer);
        video.removeEventListener(eventName, done);
        video.removeEventListener("error", bad);
      };
      var done = function () {
        cleanup();
        if (token !== loadGeneration) reject(new Error("已换视频"));
        else resolve();
      };
      var bad = function () {
        cleanup();
        reject(new Error(errorMessage));
      };
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error(errorMessage + "（超时）"));
      }, MEDIA_TIMEOUT_MS);
      video.addEventListener(eventName, done, { once: true });
      video.addEventListener("error", bad, { once: true });
    });
  }

  async function buildStrip(token, sourceURL, sourceDuration) {
    var box = $("filmShots");
    box.innerHTML = "";
    if (!sourceDuration || !sourceURL || token !== loadGeneration) return;
    var n = Math.min(16, Math.max(8, Math.round(sourceDuration / 2)));
    var tmp = document.createElement("video");
    tmp.muted = true;
    tmp.preload = "auto";
    tmp.src = sourceURL;
    try {
      await waitForMedia(tmp, "loadeddata", token, "时间线读不出来");
      var w = 96;
      var h = 64;
      for (var i = 0; i < n && token === loadGeneration; i++) {
        var t = ((i + 0.5) / n) * sourceDuration;
        await seek(tmp, t, token);
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(tmp, 0, 0, w, h);
        if (token === loadGeneration) box.appendChild(c);
      }
    } finally {
      tmp.removeAttribute("src");
      tmp.load();
    }
  }

  function playSelection() {
    if (!duration) return;
    if (playGuard) {
      player.removeEventListener("timeupdate", playGuard);
      playGuard = null;
    }
    player.currentTime = startT;
    playGuard = function () {
      if (player.currentTime >= endT) {
        player.pause();
        player.removeEventListener("timeupdate", playGuard);
        playGuard = null;
      }
    };
    player.addEventListener("timeupdate", playGuard);
    player.play().catch(function () {});
  }

  async function encoderReady() {
    var deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      var controller = new AbortController();
      readinessController = controller;
      var timer = setTimeout(function () { controller.abort(); }, 22000);
      try {
        var response = await fetch("/__jiudi/encoder-ready", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return false;
        var result = await response.json();
        if (result && result.ready === true) return true;
        if (!result || result.state === "failed") return false;
      } catch (e) {
        return false;
      } finally {
        clearTimeout(timer);
        if (readinessController === controller) readinessController = null;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 300); });
    }
    return false;
  }

  async function loadFfmpeg() {
    if (ffmpeg) return ffmpeg;
    if (ffmpegPromise) return ffmpegPromise;
    var generation = ++encoderGeneration;
    ffmpegState = "checking";
    setEncoderBox();
    var core = "js/vendor/ffmpeg/ffmpeg-core.wasm";
    var js = "js/vendor/ffmpeg/ffmpeg.js";
    ffmpegPromise = (async function () {
      var ff = null;
      try {
        if (!Jiudi.isolated()) {
          ffmpegState = "noiso";
          return null;
        }
        if (!await encoderReady()) {
          ffmpegState = "missing";
          return null;
        }
        if (!window.FFmpegWASM) await Jiudi.loadScript(js);
        var FFmpeg = window.FFmpegWASM && window.FFmpegWASM.FFmpeg;
        if (!FFmpeg) throw new Error("no FFmpeg");
        ff = new FFmpeg();
        loadingFfmpeg = ff;
        ff.on("progress", function (e) {
          if (activeJob && !activeJob.cancelled && e && typeof e.progress === "number") {
            progress(e.progress);
            status("编码 " + Math.round(e.progress * 100) + "%");
          }
        });
        await withTimeout(ff.load({
          coreURL: new URL("js/vendor/ffmpeg/ffmpeg-core.js", location.href).href,
          wasmURL: new URL(core, location.href).href
        }), 30000, "ffmpeg 加载超时");
        if (generation !== encoderGeneration) {
          try { await Promise.resolve(ff.terminate()); } catch (e0) {}
          return null;
        }
        ffmpeg = ff;
        ffmpegState = "ready";
        return ff;
      } catch (err) {
        if (ff) {
          try { await Promise.resolve(ff.terminate()); } catch (e1) {}
        }
        if (generation === encoderGeneration) {
          ffmpeg = null;
          ffmpegState = "fail";
        }
        return null;
      } finally {
        if (loadingFfmpeg === ff) loadingFfmpeg = null;
        if (generation === encoderGeneration) ffmpegPromise = null;
        setEncoderBox();
      }
    })();
    return ffmpegPromise;
  }

  function pickMime() {
    var list = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm",
      "video/mp4"
    ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "video/webm";
    for (var i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return "video/webm";
  }

  async function execChecked(ff, args) {
    var exitCode = await ff.exec(args);
    if (exitCode !== 0) throw new Error("ffmpeg 退出码 " + exitCode);
  }

  async function runFfmpeg(job, ff) {
    var span = job.end - job.start;
    var sz = outSize(job.resolution);
    var audioBits = job.keepAudio ? 96000 : 0;
    var inName = "input-" + job.id + ".bin";
    var outName = "output-" + job.id + ".mp4";
    var last = null;
    try {
      var data = new Uint8Array(await job.file.arrayBuffer());
      if (job.cancelled) throw new Error("已取消");
      await ff.writeFile(inName, data);
      data = null;

      var proportional = job.file.size * (span / Math.max(job.duration, 0.1));
      var canCopy = job.resolution === "src" && job.keepAudio && proportional <= job.targetBytes;
      if (canCopy) {
        try {
          status("无损裁切（不重编码）…");
          await execChecked(ff, [
            "-ss", String(job.start), "-i", inName, "-t", String(span),
            "-c", "copy", "-movflags", "+faststart", outName
          ]);
          if (job.cancelled) throw new Error("已取消");
          var copied = await ff.readFile(outName);
          var copyBuf = copied.buffer ? copied : new Uint8Array(copied);
          var copyBlob = new Blob([copyBuf], { type: "video/mp4" });
          try { await ff.deleteFile(outName); } catch (e2) {}
          if (copyBlob.size > 0 && copyBlob.size <= job.targetBytes) {
            return { blob: copyBlob, name: stem(job.file.name, "video") + "-就地.mp4" };
          }
          status("无损结果超过目标，改为压缩…");
        } catch (copyError) {
          try { await ff.deleteFile(outName); } catch (e3) {}
          if (job.cancelled) throw copyError;
          status("无损裁切不可用，改为压缩…", "warn");
        }
      }

      for (var pass = 0; pass < 3; pass++) {
        if (job.cancelled) throw new Error("已取消");
        var srcBits = job.file.size * 8 / Math.max(job.duration, 0.1);
        var videoBits = Math.max(80000, Math.floor(job.targetBytes * 8 / span * (pass === 0 ? 0.82 : 0.72)) - audioBits);
        if (job.resolution === "src") videoBits = Math.min(videoBits, Math.floor(srcBits * 1.15));
        if (last && last.size > job.targetBytes) {
          videoBits = Math.max(80000, Math.floor(videoBits * (job.targetBytes / last.size) * 0.92));
        }
        status("ffmpeg 第 " + (pass + 1) + " 遍 · " + Math.round(videoBits / 1000) + " kbps");
        var args = [
          "-ss", String(job.start), "-i", inName, "-t", String(span),
          "-vf", "scale=" + sz.w + ":" + sz.h,
          "-c:v", "libx264", "-preset", "veryfast",
          "-b:v", String(videoBits), "-maxrate", String(videoBits),
          "-bufsize", String(videoBits * 2)
        ];
        if (job.keepAudio) args.push("-c:a", "aac", "-b:a", "96k");
        else args.push("-an");
        args.push("-movflags", "+faststart", outName);
        await execChecked(ff, args);
        if (job.cancelled) throw new Error("已取消");
        var out = await ff.readFile(outName);
        try { await ff.deleteFile(outName); } catch (e4) {}
        var buf = out.buffer ? out : new Uint8Array(out);
        last = new Blob([buf], { type: "video/mp4" });
        if (last.size <= job.targetBytes * 1.06 || pass === 2) break;
      }
      if (!last || !last.size) throw new Error("编码结果为空");
      return { blob: last, name: stem(job.file.name, "video") + "-就地.mp4" };
    } finally {
      if (ff === ffmpeg) {
        try { await ff.deleteFile(outName); } catch (e0) {}
        try { await ff.deleteFile(inName); } catch (e1) {}
      }
    }
  }

  async function recordFallback(job) {
    var span = job.end - job.start;
    var bitrate = Math.max(80000, Math.floor(job.targetBytes * 8 / span * 0.78));
    var sz = outSize(job.resolution);
    if (bitrate < 350000) {
      var s = Math.min(1, 480 / sz.h);
      sz = { w: even(sz.w * s), h: even(sz.h * s) };
    }

    var canvasStream = null;
    var sourceStream = null;
    var rec = null;
    var guard = null;
    var stopped = false;
    var wasMuted = player.muted;
    var chunks = [];
    try {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        throw new Error("当前浏览器不支持实时重录，请安装本地 ffmpeg 编码器。");
      }
      var canvas = document.createElement("canvas");
      canvas.width = sz.w;
      canvas.height = sz.h;
      var ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("无法创建视频画布");
      canvasStream = canvas.captureStream(24);

      if (job.keepAudio) {
        try {
          sourceStream = player.captureStream ? player.captureStream() : (player.mozCaptureStream && player.mozCaptureStream());
        } catch (e) {
          sourceStream = null;
        }
        var audioTracks = sourceStream && sourceStream.getAudioTracks ? sourceStream.getAudioTracks() : [];
        if (!audioTracks || !audioTracks.length) {
          throw new Error("当前浏览器无法在实时重录时保留声音。请选择“去掉声音”，或安装本地 ffmpeg 编码器。");
        }
        audioTracks.forEach(function (t) { canvasStream.addTrack(t); });
      }

      var mime = pickMime();
      try {
        rec = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: bitrate });
      } catch (e1) {
        try {
          rec = new MediaRecorder(canvasStream);
        } catch (e2) {
          throw new Error("无法启动实时重录");
        }
      }
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      job.recorder = rec;
      job.stream = canvasStream;

      player.pause();
      player.muted = !job.keepAudio;
      await seek(player, job.start);
      if (job.cancelled) throw new Error("已取消");

      var finished = new Promise(function (resolve, reject) {
        rec.onstop = resolve;
        rec.onerror = function (e) { reject((e && e.error) || new Error("录制失败")); };
      });
      rec.start(200);
      try {
        await player.play();
      } catch (playError) {
        player.muted = true;
        try {
          await player.play();
        } catch (mutedPlayError) {
          throw new Error("视频无法播放，实时重录无法开始");
        }
      }

      function pump() {
        if (stopped || job.cancelled) {
          if (!stopped) {
            stopped = true;
            player.pause();
            if (rec.state !== "inactive") rec.stop();
          }
          return;
        }
        if (player.currentTime >= job.end || player.ended) {
          stopped = true;
          player.pause();
          if (rec.state !== "inactive") rec.stop();
          return;
        }
        ctx.drawImage(player, 0, 0, sz.w, sz.h);
        var done = Math.min(1, (player.currentTime - job.start) / span);
        progress(done);
        status("重录 " + (player.currentTime - job.start).toFixed(1) + "s / " + span.toFixed(1) + "s");
        requestAnimationFrame(pump);
      }
      requestAnimationFrame(pump);
      guard = setInterval(function () {
        if (stopped) return;
        if (job.cancelled || player.currentTime >= job.end || player.ended) {
          stopped = true;
          player.pause();
          if (rec.state !== "inactive") rec.stop();
        }
      }, 80);

      await withTimeout(finished, Math.max(30000, span * 3000), "实时重录超时");
      if (job.cancelled) throw new Error("已取消");
      var blob = new Blob(chunks, { type: rec.mimeType || mime });
      if (!blob.size) throw new Error("没有录到画面");
      var ext = blob.type.indexOf("mp4") !== -1 ? "mp4" : "webm";
      return { blob: blob, name: stem(job.file.name, "video") + "-就地." + ext };
    } finally {
      stopped = true;
      if (guard) clearInterval(guard);
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch (e3) {}
      }
      if (canvasStream) canvasStream.getTracks().forEach(function (t) { t.stop(); });
      if (sourceStream && sourceStream !== canvasStream) {
        sourceStream.getTracks().forEach(function (t) { t.stop(); });
      }
      player.pause();
      player.muted = wasMuted;
      job.recorder = null;
      job.stream = null;
    }
  }

  function resetLoadedFile() {
    ++loadGeneration;
    if (playGuard) {
      player.removeEventListener("timeupdate", playGuard);
      playGuard = null;
    }
    player.pause();
    player.removeAttribute("src");
    player.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
    file = null;
    duration = 0;
    startT = 0;
    endT = 0;
    $("empty").classList.remove("hidden");
    $("work").classList.add("hidden");
    $("fileName").textContent = "—";
    $("fileMeta").textContent = "";
    $("filmShots").innerHTML = "";
    $("tStartLab").textContent = "0:00";
    $("tEndLab").textContent = "0:00";
    $("tSpanLab").textContent = "整段";
    $("tStart").value = "0";
    $("tEnd").value = "0";
    $("run").disabled = true;
  }

  async function handleFile(f) {
    if (running) return;
    resetLoadedFile();
    if (!Jiudi.isVideo(f)) {
      status("请选择视频", "warn");
      return;
    }
    if (f.size > MAX_INPUT_BYTES) {
      status("视频超过 512 MiB。本地浏览器编码需要同时保存输入和输出，较大文件会耗尽内存。", "warn");
      return;
    }
    var token = loadGeneration;
    file = f;
    url = URL.createObjectURL(f);
    var sourceURL = url;
    player.src = url;
    $("empty").classList.add("hidden");
    $("work").classList.remove("hidden");
    status("读取视频信息…");
    try {
      await waitForMedia(player, "loadedmetadata", token, "无法读取视频信息");
    } catch (err) {
      if (token === loadGeneration) status(err.message || "无法读取这段视频", "warn");
      return;
    }
    if (token !== loadGeneration) return;
    duration = player.duration;
    if (!isFinite(duration) || duration <= 0) {
      status("视频时长无效", "warn");
      return;
    }
    startT = 0;
    endT = duration;
    $("run").disabled = false;
    layoutFilm();
    updateMeta();
    status("拉时间线，设好再处理。", "ok");
    buildStrip(token, sourceURL, duration).catch(function (err) {
      if (token === loadGeneration && err.message !== "已换视频") {
        $("filmShots").innerHTML = "";
      }
    });
  }

  function setLocked(locked) {
    var ids = ["file", "swap", "playSel", "markIn", "markOut", "tStart", "tEnd", "mbRange", "mbNum", "run"];
    ids.forEach(function (id) { $(id).disabled = locked; });
    ["resSeg", "audSeg"].forEach(function (id) {
      var buttons = $(id).querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = locked;
    });
    $("film").style.pointerEvents = locked ? "none" : "";
    $("drop").setAttribute("aria-disabled", locked ? "true" : "false");
    player.controls = !locked;
    if (locked) player.pause();
  }

  async function run() {
    if (!file || running) return;
    if (clipSpan() < 0.15) {
      status("终点要大于起点", "warn");
      return;
    }
    var job = {
      id: Date.now().toString(36),
      file: file,
      duration: duration,
      start: startT,
      end: endT,
      targetBytes: targetMB() * 1000 * 1000,
      resolution: res,
      keepAudio: audioKeep,
      cancelled: false,
      recorder: null,
      stream: null
    };
    running = true;
    activeJob = job;
    setLocked(true);
    $("cancel").classList.remove("hidden");
    var t0 = Date.now();
    try {
      var result;
      var ff = await loadFfmpeg();
      if (job.cancelled) throw new Error("已取消");
      if (ff) {
        try {
          result = await runFfmpeg(job, ff);
        } catch (e) {
          if (job.cancelled) throw e;
          status("ffmpeg 失败，改用实时重录…", "warn");
          result = await recordFallback(job);
        }
      } else {
        result = await recordFallback(job);
      }
      if (job.cancelled) throw new Error("已取消");
      downloadBlob(result.blob, result.name);
      var used = ((Date.now() - t0) / 1000).toFixed(1);
      var over = result.blob.size > job.targetBytes * 1.08;
      status(
        "完成：出 " + fmtBytes(result.blob.size) + " · " + used + "s" + (over ? "（略高于目标）" : ""),
        over ? "warn" : "ok"
      );
    } catch (err) {
      status(err.message || String(err), "warn");
    } finally {
      if (job.stream) job.stream.getTracks().forEach(function (t) { t.stop(); });
      if (activeJob === job) activeJob = null;
      running = false;
      setLocked(false);
      $("cancel").classList.add("hidden");
      progress(null);
    }
  }

  async function cancel() {
    var job = activeJob;
    if (!job || job.cancelled) return;
    job.cancelled = true;
    status("正在取消…", "warn");
    if (readinessController) readinessController.abort();
    try { player.pause(); } catch (e) {}
    if (job.recorder && job.recorder.state !== "inactive") {
      try { job.recorder.stop(); } catch (e1) {}
    }
    if (job.stream) job.stream.getTracks().forEach(function (t) { t.stop(); });
    var old = ffmpeg;
    var loading = loadingFfmpeg;
    ffmpeg = null;
    loadingFfmpeg = null;
    ffmpegState = "idle";
    ++encoderGeneration;
    ffmpegPromise = null;
    if (old && old.terminate) {
      try { await Promise.resolve(old.terminate()); } catch (e2) {}
    }
    if (loading && loading !== old && loading.terminate) {
      try { await Promise.resolve(loading.terminate()); } catch (e3) {}
    }
    setEncoderBox();
  }

  function syncMB(fromRange) {
    var v = clamp(fromRange ? $("mbRange").value : $("mbNum").value, 1, 200);
    $("mbRange").value = String(v);
    $("mbNum").value = String(v);
    updateMeta();
  }

  Jiudi.markNav("video.html");
  Jiudi.bindDrop($("drop"), function (files) { return handleFile(files[0]); }, Jiudi.isVideo);
  $("swap").addEventListener("click", function () { $("file").click(); });
  $("run").addEventListener("click", run);
  $("cancel").addEventListener("click", cancel);
  $("playSel").addEventListener("click", playSelection);
  $("markIn").addEventListener("click", function () {
    setRange(player.currentTime || 0, endT, player.currentTime);
  });
  $("markOut").addEventListener("click", function () {
    setRange(startT, player.currentTime || duration, player.currentTime);
  });
  $("tStart").addEventListener("input", function () {
    setRange(Number($("tStart").value), endT);
  });
  $("tEnd").addEventListener("input", function () {
    setRange(startT, Number($("tEnd").value));
  });
  $("mbRange").addEventListener("input", function () { syncMB(true); });
  $("mbNum").addEventListener("input", function () { syncMB(false); });
  Jiudi.bindSeg($("resSeg"), "res", function (v) { res = v; updateMeta(); });
  Jiudi.bindSeg($("audSeg"), "aud", function (v) { audioKeep = v === "keep"; });

  $("film").addEventListener("pointerdown", onFilmDown);
  $("film").addEventListener("pointermove", onFilmMove);
  $("film").addEventListener("pointerup", onFilmUp);
  $("film").addEventListener("pointercancel", onFilmUp);

  window.addEventListener("resize", layoutFilm);
  setEncoderBox();
})();
