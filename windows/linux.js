// ReaperOS on Linux (the ReaperOS operating system, built on Bazzite).
// Apps come from .desktop files, the store installs from Flathub, and the
// Settings page can shut down, restart or switch to the KDE desktop.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const HOME = os.homedir();

function dataDirs() {
  const env = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [...new Set([
    path.join(HOME, ".local/share"),
    path.join(HOME, ".local/share/flatpak/exports/share"),
    "/var/lib/flatpak/exports/share",
    ...env,
    "/usr/local/share",
    "/usr/share"
  ])];
}

// ------------------------------------------------------------------ installed apps

function parseDesktop(file) {
  let txt;
  try { txt = fs.readFileSync(file, "utf8"); } catch (e) { return null; }
  const start = txt.indexOf("[Desktop Entry]");
  if (start < 0) return null;
  let sec = txt.slice(start + 15);
  const next = sec.search(/^\[/m);
  if (next >= 0) sec = sec.slice(0, next);
  const get = (k) => { const m = sec.match(new RegExp("^" + k + "\\s*=\\s*(.*)$", "m")); return m ? m[1].trim() : ""; };
  return {
    name: get("Name"), exec: get("Exec"), icon: get("Icon"), type: get("Type"),
    noDisplay: /^true$/i.test(get("NoDisplay")), hidden: /^true$/i.test(get("Hidden")),
    terminal: /^true$/i.test(get("Terminal")), onlyShowIn: get("OnlyShowIn"), notShowIn: get("NotShowIn"),
    categories: get("Categories")
  };
}

const SYSTEM_CATS = /(^|;)(System|Settings|Development|Utility|Monitor|PackageManager|TerminalEmulator)(;|$)/;
const KEEP_CATS = /(^|;)(Game|AudioVideo|Audio|Video|Network|Graphics)(;|$)/;
const SKIP_NAMES = /^(reaperos|return to reaperos)$/i;

let iconNames = {};   // pkg -> Icon= value

function loadApps() {
  const byId = new Map();
  for (const dir of dataDirs()) {
    const appsDir = path.join(dir, "applications");
    let files = [];
    try { files = fs.readdirSync(appsDir).filter((f) => f.endsWith(".desktop")); } catch (e) { continue; }
    for (const f of files) {
      if (byId.has(f)) continue;                 // earlier (user) directories win
      const file = path.join(appsDir, f);
      const d = parseDesktop(file);
      byId.set(f, d ? { d, file } : null);
    }
  }
  const out = [];
  for (const entry of byId.values()) {
    if (!entry) continue;
    const { d, file } = entry;
    if (d.type !== "Application" || !d.name || d.noDisplay || d.hidden || d.terminal) continue;
    if (d.onlyShowIn && !/KDE/i.test(d.onlyShowIn)) continue;
    if (d.notShowIn && /KDE/i.test(d.notShowIn)) continue;
    if (SKIP_NAMES.test(d.name)) continue;
    const pkg = "desktop:" + file;
    iconNames[pkg] = d.icon;
    out.push({
      pkg, label: d.name, tv: true,
      system: SYSTEM_CATS.test(d.categories) && !KEEP_CATS.test(d.categories)
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function detached(cmd, args) {
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.on("error", () => {});
    p.unref();
    return true;
  } catch (e) { return false; }
}

function launch(pkg) {
  if (pkg.startsWith("flatpak:")) return detached("flatpak", ["run", pkg.slice(8)]);
  if (!pkg.startsWith("desktop:")) return false;
  const file = pkg.slice(8);
  // gio launches the entry the same way the desktop would (handles field codes, D-Bus activation).
  const r = spawnSync("sh", ["-c", "command -v gio"], { encoding: "utf8" });
  if (r.status === 0) return detached("gio", ["launch", file]);
  const d = parseDesktop(file);
  if (!d || !d.exec) return false;
  const cmd = d.exec.replace(/%[fFuUdDnNickvm]/g, "").trim();
  return detached("sh", ["-c", cmd]);
}

function findIcon(name) {
  if (!name) return null;
  if (name.startsWith("/") && fs.existsSync(name)) return name;
  const sizes = ["512x512", "256x256", "192x192", "128x128", "96x96", "64x64", "48x48", "scalable"];
  const themes = ["hicolor", "breeze", "Adwaita"];
  for (const dir of dataDirs()) {
    for (const theme of themes) {
      for (const size of sizes) {
        for (const ext of [".png", ".svg"]) {
          const p = path.join(dir, "icons", theme, size, "apps", name + ext);
          if (fs.existsSync(p)) return p;
        }
      }
    }
    for (const ext of [".png", ".svg", ".xpm"]) {
      const p = path.join(dir, "pixmaps", name + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function iconFor(pkg) {
  const file = findIcon(iconNames[pkg]);
  if (!file || file.endsWith(".xpm")) return {};
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 600000) return {};
    const mime = file.endsWith(".svg") ? "image/svg+xml" : "image/png";
    return { src: "data:" + mime + ";base64," + buf.toString("base64"), banner: false };
  } catch (e) { return {}; }
}

// ------------------------------------------------------------------ Steam

function steamRoot() {
  const c = [
    path.join(HOME, ".local/share/Steam"),
    path.join(HOME, ".steam/steam"),
    path.join(HOME, ".var/app/com.valvesoftware.Steam/.local/share/Steam")
  ];
  return c.find((p) => fs.existsSync(path.join(p, "steamapps"))) || null;
}

// ------------------------------------------------------------------ Flathub

function refreshFlatpak() {
  return new Promise((resolve) => {
    const map = {};
    const p = spawn("flatpak", ["list", "--app", "--columns=application,version"]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => resolve(map));
    p.on("close", () => {
      for (const line of out.split("\n")) {
        const [id, ver] = line.split("\t");
        if (id && id.trim()) map[id.trim().toLowerCase()] = (ver && ver.trim()) || "installed";
      }
      resolve(map);
    });
  });
}

// Install as the user, so no password prompt is needed in the full-screen session.
function installArgs(appId) {
  return ["install", "--user", "-y", "--noninteractive", "flathub", appId];
}

function ensureFlathub() {
  spawnSync("flatpak", ["remote-add", "--user", "--if-not-exists", "flathub",
    "https://dl.flathub.org/repo/flathub.flatpakrepo"], { encoding: "utf8" });
}

// ------------------------------------------------------------------ RetroArch

function playInRetroArch(rom, core, installedMap) {
  const flatpakId = "org.libretro.RetroArch";
  if (installedMap[flatpakId.toLowerCase()]) {
    const so = path.join(HOME, ".var/app", flatpakId, "config/retroarch/cores", core + "_libretro.so");
    const args = fs.existsSync(so) ? ["run", flatpakId, "-L", so, rom] : ["run", flatpakId, rom];
    detached("flatpak", args);
    return fs.existsSync(so) ? "" : "fallback";
  }
  const native = spawnSync("sh", ["-c", "command -v retroarch"], { encoding: "utf8" });
  if (native.status === 0) {
    const so = path.join(HOME, ".config/retroarch/cores", core + "_libretro.so");
    detached("retroarch", fs.existsSync(so) ? ["-L", so, rom] : [rom]);
    return fs.existsSync(so) ? "" : "fallback";
  }
  return "not_installed";
}

// ------------------------------------------------------------------ system controls

const inSession = () => !!process.env.REAPEROS_SESSION;

function power(action) {
  const map = { shutdown: "poweroff", restart: "reboot", sleep: "suspend" };
  if (!map[action]) return false;
  return detached("systemctl", [map[action]]);
}

// Switches the next sign-in to the KDE desktop. The caller then quits ReaperOS, which ends the session.
function desktopMode() {
  const r = spawnSync("/usr/bin/reaperos-desktop-mode", [], { encoding: "utf8" });
  return r.status === 0;
}

// Batocera: status -> found / missing / no-efi / no-loader / error. boot -> adds a one-time boot entry.
const BATO_CODES = { 0: "found", 3: "missing", 4: "no-efi", 5: "no-loader", 6: "error" };
function batocera(action) {
  const r = spawnSync("sudo", ["-n", "/usr/libexec/reaperos-batocera", action], { encoding: "utf8", timeout: 30000 });
  if (r.error) return { status: "unsupported" };
  return { status: BATO_CODES[r.status] || (r.status === 1 ? "unsupported" : "error"), detail: (r.stdout || r.stderr || "").trim() };
}

function openSettings() {
  return detached("systemsettings", []) || detached("kcmshell6", ["kcm_landingpage"]);
}

module.exports = {
  loadApps, launch, iconFor, steamRoot, refreshFlatpak, installArgs, ensureFlathub,
  playInRetroArch, power, desktopMode, openSettings, inSession, batocera
};
