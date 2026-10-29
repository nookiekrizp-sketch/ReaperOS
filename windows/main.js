// ReaperOS for Windows: hosts the shared ReaperOS interface full-screen and answers its
// "Reaper" bridge calls with Windows equivalents (Start menu apps, Steam, winget, RetroArch).
const { app, BrowserWindow, ipcMain, shell, nativeImage, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const { spawn, spawnSync } = require("child_process");

let win = null;
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";
const L = isLinux ? require("./linux") : null;   // ReaperOS OS (Bazzite) support

// ------------------------------------------------------------------ helpers

function js(code) {
  if (win && !win.isDestroyed()) win.webContents.executeJavaScript(code).catch(() => {});
}
const q = (s) => JSON.stringify(s == null ? "" : String(s));
function toast(msg) { js(`window.reaperToast && reaperToast(${q(msg)})`); }

function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error("Too many redirects"));
    const req = https.get(url, { headers: { "User-Agent": "ReaperOS-Windows", Accept: "*/*" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), hops + 1));
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
  });
}
async function getText(url) {
  const res = await get(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function powershell(cmd) {
  if (!isWin) return "";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd],
    { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.stdout || "";
}

// ------------------------------------------------------------------ installed apps

const NOISE = /uninstall|readme|read me|help|website|documentation|license|release notes|changelog|manual|faq|support|report|crash|debug|safe mode|recovery|odbc|^windows |command prompt|powershell|console host|character map|disk cleanup|registry|remote desktop|task manager|component services|event viewer|services$|system information|resource monitor|steps recorder|memory diagnostic|iscsi|defragment|^administrative|quick assist|^narrator|^magnifier|on-screen keyboard|speech recognition|^math input/i;

let appsCache = null;
let shortcutIndex = null;   // lower-case name -> .lnk path, for icons

function indexShortcuts() {
  shortcutIndex = {};
  const roots = [
    path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft\\Windows\\Start Menu\\Programs"),
    path.join(process.env.APPDATA || "", "Microsoft\\Windows\\Start Menu\\Programs")
  ];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.lnk$/i.test(e.name)) shortcutIndex[e.name.replace(/\.lnk$/i, "").toLowerCase()] = p;
    }
  };
  roots.forEach((r) => walk(r, 0));
}

function loadApps() {
  if (isLinux) { appsCache = L.loadApps(); return appsCache; }
  if (!shortcutIndex) indexShortcuts();
  let list = [];
  try {
    const raw = powershell("Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress");
    list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) list = [list];
  } catch (e) { list = []; }
  const seen = {};
  const out = [];
  for (const a of list) {
    if (!a || !a.Name || !a.AppID) continue;
    if (NOISE.test(a.Name) || /^steam:\/\//i.test(a.AppID) || /^https?:/i.test(a.AppID)) continue;
    const key = a.Name.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ pkg: a.AppID, label: a.Name, tv: true, system: false });
  }
  // Fallback when Get-StartApps isn't available: plain Start-menu shortcuts.
  if (!out.length) {
    for (const name of Object.keys(shortcutIndex)) {
      if (NOISE.test(name)) continue;
      out.push({ pkg: "lnk:" + shortcutIndex[name], label: path.basename(shortcutIndex[name], ".lnk"), tv: true, system: false });
    }
  }
  out.sort((x, y) => x.label.localeCompare(y.label));
  appsCache = out;
  return out;
}

function launchApp(pkg) {
  if (isLinux && (pkg.startsWith("desktop:") || pkg.startsWith("flatpak:"))) return L.launch(pkg);
  try {
    if (pkg.startsWith("steam:")) { shell.openExternal("steam://rungameid/" + pkg.slice(6)); return true; }
    if (pkg.startsWith("lnk:")) { shell.openPath(pkg.slice(4)); return true; }
    if (/^[a-z]+:\/\//i.test(pkg)) { shell.openExternal(pkg); return true; }
    spawn("explorer.exe", ["shell:AppsFolder\\" + pkg], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch (e) { return false; }
}

async function iconFor(pkg) {
  if (pkg.startsWith("steam:")) {
    const id = pkg.slice(6);
    return { src: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`, banner: true };
  }
  if (isLinux) return L.iconFor(pkg);
  const app0 = (appsCache || []).find((a) => a.pkg === pkg);
  let target = pkg.startsWith("lnk:") ? pkg.slice(4) : null;
  if (!target && app0 && shortcutIndex) target = shortcutIndex[app0.label.toLowerCase()] || null;
  if (!target && /^[A-Za-z]:\\.*\.exe$/i.test(pkg)) target = pkg;
  if (!target) return {};
  try {
    let file = target;
    if (/\.lnk$/i.test(target)) {
      try { const l = shell.readShortcutLink(target); file = l.icon || l.target || target; } catch (e) { /* keep lnk */ }
    }
    const img = await app.getFileIcon(file, { size: "large" });
    if (!img || img.isEmpty()) return {};
    return { src: img.toDataURL(), banner: false };
  } catch (e) { return {}; }
}

// ------------------------------------------------------------------ Steam library

function steamRoot() {
  if (isLinux) return L.steamRoot();
  const reg = powershell("(Get-ItemProperty -Path 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath").trim();
  const candidates = [reg, "C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"].filter(Boolean);
  return candidates.find((p) => fs.existsSync(path.join(p, "steamapps"))) || null;
}

function steamGames() {
  const root = steamRoot();
  if (!root) return [];
  // Steam can list the same folder more than once with different spellings (C:/ vs c:\\), so
  // folders are compared after normalizing, and each game appears once.
  const libs = new Map();
  const addLib = (p) => { const n = path.resolve(p); libs.set(n.toLowerCase(), n); };
  addLib(path.join(root, "steamapps"));
  try {
    const vdf = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) addLib(path.join(m[1].replace(/\\\\/g, "\\"), "steamapps"));
  } catch (e) { /* single library */ }
  const SKIP = new Set(["228980", "1070560", "1391110", "1493710", "1628350", "2180100"]); // redistributables, runtimes, Proton
  const games = [];
  const seenIds = new Set();
  for (const lib of libs.values()) {
    let files = [];
    try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch (e) { continue; }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(lib, f), "utf8");
        const id = (/"appid"\s+"(\d+)"/.exec(acf) || [])[1];
        const name = (/"name"\s+"([^"]+)"/.exec(acf) || [])[1];
        if (!id || !name || SKIP.has(id) || /redistributable|proton|steamworks|steam linux runtime/i.test(name)) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        games.push({ id, name });
      } catch (e) { /* skip */ }
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name));
  return games;
}

// ------------------------------------------------------------------ winget

let wingetCache = {};      // PackageIdentifier (lower) -> version
let wingetLoaded = false;

function refreshWinget() {
  if (isLinux) return L.refreshFlatpak().then((map) => { wingetCache = map; wingetLoaded = true; });
  return new Promise((resolve) => {
    if (!isWin) { wingetLoaded = true; return resolve(); }
    const out = path.join(os.tmpdir(), "reaperos-winget.json");
    const p = spawn("winget", ["export", "-o", out, "--include-versions", "--accept-source-agreements", "--disable-interactivity"],
      { windowsHide: true });
    p.on("error", () => { wingetLoaded = true; resolve(); });
    p.on("close", () => {
      const map = {};
      try {
        const j = JSON.parse(fs.readFileSync(out, "utf8"));
        for (const src of j.Sources || []) for (const pk of src.Packages || []) map[pk.PackageIdentifier.toLowerCase()] = pk.Version || "installed";
      } catch (e) { /* winget missing or nothing exported */ }
      wingetCache = map;
      wingetLoaded = true;
      resolve();
    });
  });
}

function wingetArgs(spec) {
  // spec: "winget:Publisher.App" or "winget:msstore:9ABC..."
  let id = spec.replace(/^winget:/, "");
  let source = null;
  if (id.startsWith("msstore:")) { source = "msstore"; id = id.slice(8); }
  const args = ["install", "--id", id, "-e", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
  if (source) args.push("--source", source);
  return args;
}

function runWinget(id, args, verb, cmd = "winget") {
  if (!isWin && cmd === "winget") { js(`window.reaperInstallError && reaperInstallError(${q(id)}, "winget only works on Windows")`); return; }
  const p = spawn(cmd, args, { windowsHide: true });
  let last = -1, tail = "";
  const onData = (d) => {
    const s = d.toString();
    tail = (tail + s).slice(-400);
    const m = s.match(/(\d{1,3})\s*%/g);
    if (m) {
      const pct = Math.min(99, parseInt(m[m.length - 1], 10));
      if (pct !== last) { last = pct; js(`window.reaperProgress && reaperProgress(${q(id)}, ${pct}, 0)`); }
    }
  };
  p.stdout.on("data", onData);
  p.stderr.on("data", onData);
  p.on("error", () => js(`window.reaperInstallError && reaperInstallError(${q(id)}, ${q(cmd === "winget" ? "winget isn't available. Install App Installer from the Microsoft Store." : "Flatpak isn't available on this system.")})`));
  p.on("close", async (code) => {
    await refreshWinget();
    appsCache = null; loadApps();
    if (code === 0 || /already installed|No available upgrade|Successfully/i.test(tail)) {
      js(`window.reaperProgress && reaperProgress(${q(id)}, 100, 0)`);
      toast(verb + " finished.");
    } else {
      js(`window.reaperInstallError && reaperInstallError(${q(id)}, ${q("winget exit code " + code)})`);
    }
    js("window.reaperResume && reaperResume()");
  });
}

// ------------------------------------------------------------------ game files + RetroArch

function gamesDir() { return path.join(app.getPath("documents"), "ReaperOS", "ROMs"); }

async function saveGame(id, url, folder, name) {
  const dir = path.join(gamesDir(), folder.replace(/^ROMs\/?/, ""));
  const file = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const res = await get(url);
    const total = parseInt(res.headers["content-length"] || "0", 10);
    let done = 0, last = -1;
    const out = fs.createWriteStream(file);
    res.on("data", (c) => {
      done += c.length;
      const pct = total ? Math.floor((done * 100) / total) : -1;
      if (pct !== last) { last = pct; js(`window.reaperGameProgress && reaperGameProgress(${q(id)}, ${pct})`); }
    });
    await new Promise((resolve, reject) => { res.pipe(out); out.on("finish", resolve); out.on("error", reject); res.on("error", reject); });
    const shown = "Documents/ReaperOS/ROMs/" + folder.replace(/^ROMs\/?/, "") + "/" + name;
    js(`window.reaperGameSaved && reaperGameSaved(${q(id)}, ${q(shown)}, ${q(file)})`);
  } catch (e) {
    js(`window.reaperGameError && reaperGameError(${q(id)}, ${q(e.message)})`);
  }
}

function retroarchExe() {
  const c = [
    "C:\\RetroArch-Win64\\retroarch.exe",
    path.join(process.env.ProgramFiles || "C:\\Program Files", "RetroArch", "retroarch.exe"),
    path.join(process.env.APPDATA || "", "RetroArch", "retroarch.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "RetroArch", "retroarch.exe")
  ];
  const steam = steamRoot();
  if (steam) c.push(path.join(steam, "steamapps", "common", "RetroArch", "retroarch.exe"));
  return c.find((p) => p && fs.existsSync(p)) || null;
}

function playInRetroArch(rom, core) {
  if (isLinux) return L.playInRetroArch(rom, core, wingetCache);
  const exe = retroarchExe();
  if (!exe) return "not_installed";
  const dll = path.join(path.dirname(exe), "cores", core + "_libretro.dll");
  const args = fs.existsSync(dll) ? ["-L", dll, rom] : [rom];
  spawn(exe, args, { detached: true, stdio: "ignore", cwd: path.dirname(exe) }).unref();
  return fs.existsSync(dll) ? "" : "fallback";
}

// ------------------------------------------------------------------ updates

let updater = null;
function setupUpdater() {
  try { updater = require("electron-updater").autoUpdater; } catch (e) { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-available", (i) => js(`window.reaperUpdate && reaperUpdate("downloading", ${q(i.version)})`));
  updater.on("update-not-available", () => js(`window.reaperUpdate && reaperUpdate("current", "")`));
  updater.on("download-progress", (p) => js(`window.reaperUpdate && reaperUpdate("progress", ${q(Math.round(p.percent))})`));
  updater.on("update-downloaded", (i) => js(`window.reaperUpdate && reaperUpdate("ready", ${q(i.version)})`));
  updater.on("error", (e) => js(`window.reaperUpdate && reaperUpdate("error", ${q(e && e.message)})`));
}

// ------------------------------------------------------------------ ReaperOS Player (mpv)

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|flv|webm|ts|m2ts|mts|mpg|mpeg|vob|3gp|ogv|rmvb)$/i;
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|alac|ape|aiff|dsf)$/i;

function listMedia() {
  const roots = ["videos", "music", "downloads", "desktop"].map((n) => { try { return app.getPath(n); } catch (e) { return null; } }).filter(Boolean);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || out.length > 800) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      const kind = VIDEO_EXT.test(e.name) ? "video" : AUDIO_EXT.test(e.name) ? "audio" : null;
      if (!kind) continue;
      let st = null; try { st = fs.statSync(p); } catch (err) { continue; }
      out.push({ path: p, name: e.name, size: st.size, duration: 0, date: Math.floor(st.mtimeMs / 1000), kind, folder: path.basename(dir) });
    }
  };
  roots.forEach((r) => walk(r, 0));
  out.sort((a, b) => b.date - a.date);
  return out;
}

function mpvPath() {
  if (isLinux) return "mpv";
  const bundled = path.join(process.resourcesPath || "", "mpv", "mpv.exe");
  if (app.isPackaged && fs.existsSync(bundled)) return bundled;
  const dev = path.join(__dirname, "mpv", "mpv.exe");
  return fs.existsSync(dev) ? dev : "mpv";
}

const playerOptions = { passthrough: false };
function playMedia(file, title) {
  const args = [
    "--target-colorspace-hint=yes",          // HDR output on HDR displays
    "--video-sync=display-resample",         // smooth motion at any refresh rate
    "--fullscreen", "--force-window=yes", "--input-gamepad=yes", "--save-position-on-quit",
    "--osd-font-size=42", "--osd-bar=yes", "--keep-open=no", "--hwdec=auto-safe",
    "--title=ReaperOS Player - " + (title || path.basename(file))
  ];
  if (playerOptions.passthrough) args.push("--audio-spdif=ac3,eac3,dts,dts-hd,truehd");
  args.push(file);
  try {
    const p = spawn(mpvPath(), args, { windowsHide: false });
    p.on("error", () => toast("ReaperOS Player couldn't start. Reinstall ReaperOS to restore it."));
    p.on("exit", () => { if (win && !win.isDestroyed()) win.focus(); });
  } catch (e) { toast("ReaperOS Player couldn't start."); }
}


// Batocera on Windows: finds the Batocera drive (FAT, label starting with BATO) and asks the
// PC's firmware to start it once on the next restart. Exit codes match the Linux script.
const BATO_PS = String.raw`
param([string]$Action = "status")
$ErrorActionPreference = "Stop"
$drive = [System.IO.DriveInfo]::GetDrives() | Where-Object {
  $_.IsReady -and $_.VolumeLabel -like "BATO*" -and $_.DriveFormat -like "FAT*" } | Select-Object -First 1
if (-not $drive) { exit 3 }
$root = $drive.RootDirectory.FullName.TrimEnd("\")
$loader = $null
foreach ($p in "\EFI\batocera\bootx64.efi", "\EFI\BOOT\bootx64.efi") { if (Test-Path ($root + $p)) { $loader = $p; break } }
if (-not $loader) { exit 5 }
if ($Action -eq "status") { exit 0 }
try { $fw = bcdedit /enum firmware } catch { exit 4 }
if ($LASTEXITCODE -ne 0) { exit 4 }
# Remove an entry made earlier, so the drive letter is current.
$blocks = ($fw -join [Environment]::NewLine) -split '(?:\r?\n)\s*(?:\r?\n)'
foreach ($b in $blocks) {
  if ($b -match "Batocera \(ReaperOS\)") {
    $m = [regex]::Match($b, "\{[0-9a-fA-F-]{36}\}")
    if ($m.Success) { bcdedit /delete $m.Value | Out-Null }
  }
}
$out = bcdedit /copy "{bootmgr}" /d "Batocera (ReaperOS)"
$id = [regex]::Match(($out -join " "), "\{[0-9a-fA-F-]{36}\}").Value
if (-not $id) { exit 6 }
bcdedit /set $id device ("partition=" + $root) | Out-Null
bcdedit /set $id path $loader | Out-Null
bcdedit /set "{fwbootmgr}" displayorder $id /addlast | Out-Null
bcdedit /set "{fwbootmgr}" bootsequence $id | Out-Null
if ($LASTEXITCODE -ne 0) { exit 6 }
exit 0
`;
const BATO_WIN_CODES = { 0: "found", 3: "missing", 4: "no-efi", 5: "no-loader", 6: "error" };

function batoceraWindows(action) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), "reaperos-batocera.ps1");
    try { fs.writeFileSync(file, BATO_PS, "utf8"); } catch (e) { return resolve({ status: "error" }); }
    let cmd;
    if (action === "boot") {
      // Changing the boot entries needs administrator rights, so Windows shows its permission prompt.
      cmd = `try { $p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${file}"','boot'; exit $p.ExitCode } catch { exit 1223 }`;
    } else {
      cmd = `& '${file}' status; exit $LASTEXITCODE`;
    }
    const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], { windowsHide: true });
    p.on("error", () => resolve({ status: "error" }));
    p.on("close", (code) => resolve({ status: code === 1223 ? "cancelled" : (BATO_WIN_CODES[code] || "error") }));
  });
}

// ------------------------------------------------------------------ built-in web player

let webWin = null;
function openWebWindow(url, ua) {
  if (!/^https:\/\//i.test(url)) return;
  if (webWin && !webWin.isDestroyed()) webWin.close();
  webWin = new BrowserWindow({
    fullscreen: true, autoHideMenuBar: true, backgroundColor: "#000000", show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { partition: "persist:reaperweb", contextIsolation: true, sandbox: true }
  });
  webWin.removeMenu();
  if (ua) webWin.webContents.setUserAgent(ua);
  webWin.once("ready-to-show", () => webWin.show());
  // Pop-ups (sign-in windows and the like) open in the same player.
  webWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\//i.test(u)) { webWin.loadURL(u); }
    return { action: "deny" };
  });
  // Esc (when no video is full screen) or Alt+F4 returns to ReaperOS.
  let htmlFull = false;   // a video playing full screen inside the page
  webWin.on("enter-html-full-screen", () => { htmlFull = true; });
  webWin.on("leave-html-full-screen", () => { htmlFull = false; });
  webWin.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "Escape" && !htmlFull) { e.preventDefault(); webWin.close(); }
    if (input.key === "F11") { webWin.setFullScreen(!webWin.isFullScreen()); e.preventDefault(); }
  });
  webWin.on("closed", () => { webWin = null; if (win && !win.isDestroyed()) win.focus(); });
  webWin.loadURL(url);
}

// ------------------------------------------------------------------ bridge

// ------------------------------------------------------------------ live desktop wallpaper (Lively Wallpaper)
// Copies the reaper night scene into a Lively wallpaper project and applies it with
// "Lively.exe setwp --file <folder>". Installs Lively (free, open source) with winget if needed.
function findLively() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const spots = [
    path.join(local, "Programs", "Lively Wallpaper", "Lively.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Lively Wallpaper", "Lively.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Lively Wallpaper", "Lively.exe"),
    path.join(local, "Microsoft", "WindowsApps", "Lively.exe")         // Microsoft Store version's app alias
  ];
  return spots.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}
function wallpaperProject() {
  const dir = path.join(app.getPath("userData"), "LiveWallpaper", "ReaperOS Night");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), fs.readFileSync(path.join(__dirname, "ui", "wallpaper.html")));
  fs.writeFileSync(path.join(dir, "livewall.js"), fs.readFileSync(path.join(__dirname, "ui", "livewall.js")));
  fs.writeFileSync(path.join(dir, "LivelyInfo.json"), JSON.stringify({
    AppVersion: "1.0.0.0", Title: "ReaperOS Night", Desc: "The reaper harvests RAM-stick souls under a full moon.",
    Author: "ReaperOS", License: "", Contact: "", Type: 1, FileName: "index.html", Arguments: null, IsAbsolutePath: false
  }, null, 2));
  return dir;
}
function applyLively(exe, dir) {
  const run = () => { try { spawn(exe, ["setwp", "--file", dir], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch (e) {} };
  run();
  setTimeout(run, 7000);   // if Lively was just starting up, send it again once it's ready
  toast("Live wallpaper is on your desktop. Lively pauses it automatically while you play.");
}
function setDesktopWallpaper() {
  if (!isWin) { toast("Desktop live wallpaper is for Windows."); return; }
  let dir;
  try { dir = wallpaperProject(); } catch (e) { toast("Couldn't prepare the wallpaper: " + e.message); return; }
  const exe = findLively();
  if (exe) { applyLively(exe, dir); return; }
  toast("Installing Lively Wallpaper (free)\u2026");
  const p = spawn("winget", ["install", "--id", "rocksdanister.LivelyWallpaper", "-e", "--silent",
    "--accept-package-agreements", "--accept-source-agreements"], { windowsHide: true });
  p.on("error", () => { shell.openPath(dir); toast("Install Lively Wallpaper from the Microsoft Store, then drag the ReaperOS Night folder into it."); });
  p.on("close", () => {
    const now = findLively();
    if (now) applyLively(now, dir);
    else { shell.openPath(path.dirname(dir)); toast("Lively is installed. Open it and drag the ReaperOS Night folder in to use the wallpaper."); }
  });
}

const syncHandlers = {
  deviceInfo: () => JSON.stringify({
    platform: isLinux ? "linux" : "windows",
    session: isLinux ? L.inSession() : false,
    version: app.getVersion(),
    model: (isLinux ? "ReaperOS PC (" : "Windows PC (") + os.hostname() + ")",
    abis: [process.arch === "arm64" ? "arm64" : "x86_64"],
    sdk: 0
  }),
  getApps: () => JSON.stringify(appsCache || loadApps()),
  getSteamGames: () => JSON.stringify(steamGames()),
  installedVersion: (id) => {
    if (!id) return "";
    if (id.startsWith("steam:") || id.startsWith("lnk:")) return "installed";
    return wingetCache[String(id).toLowerCase()] || "";
  },
  launch: (pkg) => launchApp(String(pkg || "")),
  playInRetroArch: (rom, core) => playInRetroArch(rom, core),
  freeSpaceMb: () => {
    try { const st = fs.statfsSync(os.homedir()); return Math.floor((st.bavail * st.bsize) / 1048576); } catch (e) { return -1; }
  },
  getLoginItem: () => (isLinux ? false : app.getLoginItemSettings().openAtLogin),
  // Bundled games for the built-in player
  listMedia: () => JSON.stringify(listMedia()),
  getPlayerOption: (key, def) => (key in playerOptions ? playerOptions[key] : def),
  readRom: (rel) => {
    const p = path.normalize(path.join(__dirname, "ui", String(rel || "")));
    if (!p.startsWith(path.join(__dirname, "ui"))) return "";
    try { return fs.readFileSync(p).toString("base64"); } catch (e) { return ""; }
  }
};

const asyncHandlers = {
  requestIcon: async (pkg) => {
    const data = await iconFor(String(pkg));
    js(`window.reaperIcon && reaperIcon(${q(pkg)}, ${JSON.stringify(data)})`);
  },
  fetch: async (id, url) => {
    try {
      // IMDb only serves browsers: fetch it through Chromium's own network stack, like ReaperOS's web windows.
      const body = /^https:\/\/([a-z0-9-]+\.)*imdb\.com\//.test(String(url))
        ? await (await session.fromPartition("persist:reaperweb").fetch(String(url), { headers: { "Accept-Language": "en-US,en;q=0.9" } })).text()
        : await getText(url); js(`window.reaperFetched && reaperFetched(${q(id)}, true, ${q(body)})`); }
    catch (e) { js(`window.reaperFetched && reaperFetched(${q(id)}, false, ${q(e.message)})`); }
  },
  install: (id, spec) => {
    if (String(spec).startsWith("winget:")) return runWinget(id, wingetArgs(spec), "Install");
    if (isLinux && String(spec).startsWith("flatpak:")) {
      L.ensureFlathub();
      return runWinget(id, L.installArgs(String(spec).slice(8)), "Install", "flatpak");
    }
    js(`window.reaperInstallError && reaperInstallError(${q(id)}, "Not available on this system")`);
  },
  uninstall: (id) => (isLinux
    ? runWinget("uninstall:" + id, ["uninstall", "--user", "-y", "--noninteractive", String(id)], "Uninstall", "flatpak")
    : runWinget("uninstall:" + id, ["uninstall", "--id", id, "-e", "--disable-interactivity"], "Uninstall")),
  upgradeAll: (ids) => {
    if (isLinux) return runWinget("upgrade", ["update", "--user", "-y", "--noninteractive"], "Updates", "flatpak");
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return runWinget("upgrade", ["upgrade", "--all", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], "Updates");
    // one package at a time, in order
    const next = () => {
      const id = list.shift(); if (!id) return;
      const p = spawn("winget", ["upgrade", "--id", id, "-e", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { windowsHide: true });
      p.on("close", next); p.on("error", next);
    };
    next();
    toast("Updating " + list.length + " apps in the background.");
  },
  saveGame: (id, url, folder, name) => saveGame(id, url, folder, name),
  openUrl: (url) => shell.openExternal(String(url)),
  openSettings: () => (isLinux ? L.openSettings() : shell.openExternal("ms-settings:")),
  openAppstore: (pkg, query) => shell.openExternal(isLinux
    ? "https://flathub.org/apps/search?q=" + encodeURIComponent(query || pkg || "")
    : "ms-windows-store://search/?query=" + encodeURIComponent(query || pkg || "")),
  checkForUpdates: () => {
    if (isLinux || !updater || !app.isPackaged) { js(`window.reaperUpdate && reaperUpdate("current", "")`); return; }
    updater.checkForUpdates().catch((e) => js(`window.reaperUpdate && reaperUpdate("error", ${q(e.message)})`));
  },
  installUpdate: () => { if (updater) updater.quitAndInstall(false, true); },
  setLoginItem: (on) => { if (!isLinux) app.setLoginItemSettings({ openAtLogin: !!on, args: ["--startup"] }); },
  // Shut down / restart / sleep, from Settings.
  power: (action) => {
    if (isLinux) { if (!L.power(String(action))) toast("Couldn't " + action + "."); return; }
    const args = { shutdown: ["/s", "/t", "0"], restart: ["/r", "/t", "0"] }[String(action)];
    if (args) spawn("shutdown", args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  },
  // Batocera: check for a Batocera drive, or set it to start once and restart.
  batoceraStatus: async () => {
    const r = isLinux ? L.batocera("status") : isWin ? await batoceraWindows("status") : { status: "unsupported" };
    js(`window.reaperBatocera && reaperBatocera(${q(r.status)})`);
  },
  batoceraBoot: async () => {
    const r = isLinux ? L.batocera("boot") : isWin ? await batoceraWindows("boot") : { status: "unsupported" };
    if (r.status !== "found") { js(`window.reaperBatocera && reaperBatocera(${q(r.status)}, true)`); return; }
    js(`window.reaperBatocera && reaperBatocera("restarting", true)`);
    setTimeout(() => {
      if (isLinux) L.power("restart");
      else spawn("shutdown", ["/r", "/t", "0"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }, 1500);
  },
  // ReaperOS OS: next sign-in goes to the KDE desktop, then this session ends.
  desktopMode: () => {
    if (!isLinux) return;
    if (L.desktopMode()) app.quit();
    else toast("Desktop mode isn't set up on this system.");
  },
  // Built-in player window for services' websites (Xbox Cloud Gaming, GeForce NOW, YouTube...).
  openWeb: (url, ua) => openWebWindow(String(url), ua ? String(ua) : ""),
  requestMediaPermission: () => js("window.reaperMediaPermission && reaperMediaPermission(true)"),
  playMedia: (file, title) => playMedia(String(file), title ? String(title) : ""),
  setPlayerOption: (key, on) => { playerOptions[String(key)] = !!on; },
  setDesktopWallpaper: () => setDesktopWallpaper(),
  quit: () => app.quit()
};

ipcMain.on("reaper-sync", (e, name, args) => {
  try { e.returnValue = syncHandlers[name] ? syncHandlers[name](...args) : null; }
  catch (err) { e.returnValue = null; }
});
ipcMain.on("reaper-async", (e, name, args) => {
  try { const r = asyncHandlers[name] && asyncHandlers[name](...args); if (r && r.catch) r.catch(() => {}); }
  catch (err) { /* ignore */ }
});

// ------------------------------------------------------------------ window

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  win = new BrowserWindow({
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: "#0B0714",
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false }
  });
  win.removeMenu();
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); } });
  // F11 toggles full screen; the page handles everything else.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Coming back to ReaperOS after playing refreshes the library, like the Fire TV version.
  win.on("focus", () => js("window.reaperResume && reaperResume()"));

  win.loadFile(path.join(__dirname, "ui", "index.html"));

  setTimeout(() => { loadApps(); refreshWinget().then(() => js("window.reaperResume && reaperResume()")); }, 200);
  if (isWin) setupUpdater();
});

app.on("window-all-closed", () => app.quit());
