package com.reaperos.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ReaperOS: a Bazzite-style TV launcher for Fire TV.
 * The interface lives in assets/index.html; this activity hosts it in a WebView and
 * gives it a small native bridge ("Reaper") for launching apps and installing APKs.
 */
public class MainActivity extends Activity {

    private static final String AUTHORITY = "com.reaperos.launcher.files";
    private static final String UA = "ReaperOS-Launcher/1.0 (Fire TV)";

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Map<String, String> iconCache = Collections.synchronizedMap(new HashMap<String, String>());
    private File pendingInstall;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        web = new WebView(this);
        // Transparent until the page paints, so the native reaper splash shows through.
        web.setBackgroundColor(0x00000000);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.addJavascriptInterface(new Bridge(), "Reaper");
        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:")) return false;
                openExternal(url);
                return true;
            }
        });

        setContentView(web);
        web.requestFocus();
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstall != null && canInstallPackages()) {
            File f = pendingInstall;
            pendingInstall = null;
            startInstall(f);
        }
        js("window.reaperResume && reaperResume()");
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }

    /** Remote buttons are forwarded straight to the interface so navigation stays predictable. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        final int code = e.getKeyCode();
        String name = keyName(code);
        if (name == null) return super.dispatchKeyEvent(e);
        if (e.getAction() == KeyEvent.ACTION_DOWN) {
            final String n = name;
            final boolean repeat = e.getRepeatCount() > 0;
            web.evaluateJavascript(
                    "window.reaperKey ? reaperKey('" + n + "'," + repeat + "," + code + ") : false",
                    value -> {
                        if ("Back".equals(n) && !repeat && !"true".equals(value)) {
                            moveTaskToBack(true);
                        }
                    });
        } else if (e.getAction() == KeyEvent.ACTION_UP) {
            web.evaluateJavascript("window.reaperKeyUp && reaperKeyUp('" + name + "'," + code + ")", null);
        }
        return true;
    }

    private static String keyName(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return "ArrowUp";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "ArrowDown";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "ArrowLeft";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "ArrowRight";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A: return "Enter";
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
            case KeyEvent.KEYCODE_BUTTON_B: return "Back";
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_BUTTON_Y: return "Menu";
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_BUTTON_L1: return "PageLeft";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_BUTTON_R1: return "PageRight";
            case KeyEvent.KEYCODE_BUTTON_X: return "X";
            case KeyEvent.KEYCODE_BUTTON_START: return "Start";
            case KeyEvent.KEYCODE_BUTTON_SELECT: return "Select";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "PlayPause";
            default: return null;
        }
    }

    // ---------------------------------------------------------------- helpers

    private void js(final String code) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    private void toast(String msg) {
        js("window.reaperToast && reaperToast(" + q(msg) + ")");
    }

    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException ex) {
            toast("No browser found. Install Silk Browser or Firefox from the Appstore.");
        }
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT >= 26) return getPackageManager().canRequestPackageInstalls();
        return true;
    }

    private void openUnknownSources() {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= 26) {
                i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
            } else {
                i = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ex) {
            openSystemSettings();
        }
    }

    private void openSystemSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ignored) {
            toast("Couldn't open Settings.");
        }
    }

    private File apkDir() {
        File base = getExternalFilesDir(null);
        File dir = new File(base != null ? base : getCacheDir(), "apks");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private void startInstall(File f) {
        if (!canInstallPackages()) {
            pendingInstall = f;
            toast("Allow ReaperOS to install apps, then press Back to continue.");
            openUnknownSources();
            return;
        }
        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= 24) {
                uri = FileProvider.getUriForFile(this, AUTHORITY, f);
            } else {
                f.setReadable(true, false);
                uri = Uri.fromFile(f);
            }
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ex) {
            toast("Couldn't open the installer: " + ex.getMessage());
        }
    }

    private static String httpGet(String url) throws Exception {
        HttpURLConnection c = open(url);
        try {
            int code = c.getResponseCode();
            if (code >= 400) throw new Exception("HTTP " + code);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    /** Opens a connection and follows redirects manually (GitHub hops between hosts). */
    private static HttpURLConnection open(String url) throws Exception {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "*/*");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Redirect without location");
                current = new URL(new URL(current), loc).toString();
                continue;
            }
            return c;
        }
        throw new Exception("Too many redirects");
    }

    // ---------------------------------------------------------------- game files

    private static final int REQ_STORAGE = 42;
    private static final int REQ_MEDIA = 43;

    private String[] mediaPermissions() {
        if (Build.VERSION.SDK_INT >= 33) return new String[]{"android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_AUDIO"};
        return new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    private boolean hasMediaAccess() {
        if (Build.VERSION.SDK_INT < 23) return true;
        for (String p : mediaPermissions()) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    /** Videos and music the system knows about (internal storage and USB drives), newest first. */
    private String listMediaJson() {
        JSONArray arr = new JSONArray();
        if (!hasMediaAccess()) return arr.toString();
        Uri[] sources = {
                android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        };
        String[] kinds = {"video", "audio"};
        for (int k = 0; k < sources.length; k++) {
            String[] cols = k == 0 ? new String[]{
                    android.provider.MediaStore.MediaColumns.DATA,
                    android.provider.MediaStore.MediaColumns.DISPLAY_NAME,
                    android.provider.MediaStore.MediaColumns.SIZE,
                    "duration",
                    android.provider.MediaStore.MediaColumns.DATE_MODIFIED,
                    "width",
                    "height"
            } : new String[]{
                    android.provider.MediaStore.MediaColumns.DATA,
                    android.provider.MediaStore.MediaColumns.DISPLAY_NAME,
                    android.provider.MediaStore.MediaColumns.SIZE,
                    "duration",
                    android.provider.MediaStore.MediaColumns.DATE_MODIFIED
            };
            android.database.Cursor c = null;
            try {
                c = getContentResolver().query(sources[k], cols, null, null,
                        android.provider.MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
                int n = 0;
                while (c != null && c.moveToNext() && n < 400) {
                    String path = c.getString(0);
                    if (path == null) continue;
                    if (k == 1 && (path.contains("/Notifications/") || path.contains("/Ringtones/") || path.contains("/Alarms/"))) continue;
                    JSONObject o = new JSONObject();
                    o.put("path", path);
                    o.put("name", c.getString(1));
                    o.put("size", c.getLong(2));
                    o.put("duration", c.getLong(3));
                    o.put("date", c.getLong(4));
                    o.put("kind", kinds[k]);
                    if (k == 0) { o.put("width", c.getInt(5)); o.put("height", c.getInt(6)); }
                    File parent = new File(path).getParentFile();
                    o.put("folder", parent != null ? parent.getName() : "");
                    arr.put(o);
                    n++;
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
        }
        return arr.toString();
    }
    private String[] pendingGame;

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_MEDIA) {
            js("window.reaperMediaPermission && reaperMediaPermission(" + hasMediaAccess() + ")");
            return;
        }
        if (requestCode != REQ_STORAGE || pendingGame == null) return;
        final String[] job = pendingGame;
        pendingGame = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            io.execute(() -> saveGameNow(job[0], job[1], job[2], job[3]));
        } else {
            js("window.reaperGameError && reaperGameError(" + q(job[0]) + "," + q("Storage permission was declined") + ")");
        }
    }

    /** Downloads a game file into Downloads/ReaperOS/<folder>/ where emulators can find it. */
    private void saveGameNow(String id, String url, String folder, String name) {
        HttpURLConnection c = null;
        OutputStream os = null;
        String shownPath = "Downloads/ReaperOS/" + folder + "/" + name;
        String absPath = new File(android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_DOWNLOADS), "ReaperOS/" + folder + "/" + name).getAbsolutePath();
        try {
            c = open(url);
            int code = c.getResponseCode();
            if (code >= 400) throw new Exception("HTTP " + code);
            long total = c.getContentLength();

            if (Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
                v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                        android.os.Environment.DIRECTORY_DOWNLOADS + "/ReaperOS/" + folder);
                Uri dest = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (dest == null) throw new Exception("Couldn't create the file");
                os = getContentResolver().openOutputStream(dest);
            } else {
                File dir = new File(android.os.Environment.getExternalStoragePublicDirectory(
                        android.os.Environment.DIRECTORY_DOWNLOADS), "ReaperOS/" + folder);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Couldn't create the folder");
                os = new FileOutputStream(new File(dir, name));
            }
            if (os == null) throw new Exception("Couldn't open the file");

            InputStream in = c.getInputStream();
            byte[] buf = new byte[65536];
            long done = 0;
            int last = -1, n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                done += n;
                int pct = total > 0 ? (int) (done * 100 / total) : -1;
                if (pct != last) {
                    last = pct;
                    js("window.reaperGameProgress && reaperGameProgress(" + q(id) + "," + pct + ")");
                }
            }
            in.close();
            os.close();
            os = null;
            js("window.reaperGameSaved && reaperGameSaved(" + q(id) + "," + q(shownPath) + "," + q(absPath) + ")");
        } catch (Exception ex) {
            js("window.reaperGameError && reaperGameError(" + q(id) + "," + q(String.valueOf(ex.getMessage())) + ")");
        } finally {
            try { if (os != null) os.close(); } catch (Exception ignored) { }
            if (c != null) c.disconnect();
        }
    }

    /** Returns a message if the APK only contains native code for chips this device lacks. */
    private static String abiProblem(File apk) {
        Set<String> abis = new HashSet<>();
        ZipFile zip = null;
        try {
            zip = new ZipFile(apk);
            Enumeration<? extends ZipEntry> en = zip.entries();
            while (en.hasMoreElements()) {
                String n = en.nextElement().getName();
                if (n.startsWith("lib/") && n.endsWith(".so")) {
                    String[] parts = n.split("/");
                    if (parts.length >= 3) abis.add(parts[1]);
                }
            }
        } catch (Exception ex) {
            return null;   // can't inspect it: let the Fire OS installer decide
        } finally {
            try { if (zip != null) zip.close(); } catch (Exception ignored) { }
        }
        if (abis.isEmpty()) return null;
        for (String a : Build.SUPPORTED_ABIS) if (abis.contains(a)) return null;
        if (abis.contains("arm64-v8a")) return "This app needs a 64-bit Fire TV";
        return "This app isn't built for this Fire TV's chip";
    }

    private String iconFor(String pkg) {
        String cached = iconCache.get(pkg);
        if (cached != null) return cached;
        PackageManager pm = getPackageManager();
        boolean banner = false;
        Drawable d = null;
        try {
            d = pm.getApplicationBanner(pkg);
            if (d != null) banner = true;
        } catch (Exception ignored) { }
        try {
            if (d == null) d = pm.getApplicationIcon(pkg);
        } catch (Exception ignored) { }
        if (d == null) return "{}";

        int w = d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 192;
        int h = d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : 192;
        int max = banner ? 400 : 192;
        float scale = Math.min(1f, (float) max / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        Bitmap bmp;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null && scale == 1f) {
            bmp = ((BitmapDrawable) d).getBitmap();
        } else {
            bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, w, h);
            d.draw(c);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
        String src = "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        String json;
        try {
            JSONObject o = new JSONObject();
            o.put("src", src);
            o.put("banner", banner);
            json = o.toString();
        } catch (Exception ex) {
            json = "{}";
        }
        iconCache.put(pkg, json);
        return json;
    }

    // ---------------------------------------------------------------- bridge

    private class Bridge {

        @JavascriptInterface
        public String getApps() {
            PackageManager pm = getPackageManager();
            Map<String, JSONObject> found = new LinkedHashMap<>();
            String[] cats = {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER};
            for (String cat : cats) {
                Intent i = new Intent(Intent.ACTION_MAIN).addCategory(cat);
                List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
                for (ResolveInfo ri : list) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(getPackageName())) continue;
                    try {
                        JSONObject o = found.get(pkg);
                        if (o == null) {
                            o = new JSONObject();
                            o.put("pkg", pkg);
                            o.put("label", ri.loadLabel(pm).toString());
                            ApplicationInfo ai = ri.activityInfo.applicationInfo;
                            o.put("system", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                            o.put("tv", false);
                            found.put(pkg, o);
                        }
                        if (Intent.CATEGORY_LEANBACK_LAUNCHER.equals(cat)) o.put("tv", true);
                    } catch (Exception ignored) { }
                }
            }
            List<JSONObject> sorted = new ArrayList<>(found.values());
            Collections.sort(sorted, (a, b) ->
                    a.optString("label").toLowerCase(Locale.ROOT)
                            .compareTo(b.optString("label").toLowerCase(Locale.ROOT)));
            JSONArray arr = new JSONArray();
            for (JSONObject o : sorted) arr.put(o);
            return arr.toString();
        }

        @JavascriptInterface
        public void requestIcon(final String pkg) {
            io.execute(() -> {
                String json = iconFor(pkg);
                js("window.reaperIcon && reaperIcon(" + q(pkg) + "," + json + ")");
            });
        }

        @JavascriptInterface
        public boolean launch(String pkg) {
            PackageManager pm = getPackageManager();
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception ex) {
                return false;
            }
        }

        @JavascriptInterface
        public String installedVersion(String pkg) {
            try {
                PackageInfo p = getPackageManager().getPackageInfo(pkg, 0);
                return p.versionName == null ? "installed" : p.versionName;
            } catch (PackageManager.NameNotFoundException ex) {
                return "";
            }
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            ui.post(() -> openExternal(url));
        }

        /**
         * Opens an app's store page: the Amazon Appstore first, then any Play-compatible
         * store (such as Aurora Store), then an Appstore search as a last resort.
         */
        @JavascriptInterface
        public void openAppstore(final String pkg, final String query, final boolean preferPlay) {
            ui.post(() -> {
                List<String> uris = new ArrayList<>();
                String q = Uri.encode(query == null ? "" : query);
                boolean hasPkg = pkg != null && pkg.length() > 0;
                if (preferPlay && hasPkg) uris.add("market://details?id=" + pkg);
                if (hasPkg) uris.add("amzn://apps/android?p=" + pkg);
                if (!preferPlay && hasPkg) uris.add("market://details?id=" + pkg);
                uris.add("amzn://apps/android?s=" + q);
                uris.add("market://search?q=" + q);
                for (String u : uris) {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    } catch (ActivityNotFoundException ignored) { }
                }
                toast("No app store found on this device.");
            });
        }

        @JavascriptInterface
        public void openSettings(final String which) {
            ui.post(() -> {
                if ("unknown".equals(which)) openUnknownSources();
                else openSystemSettings();
            });
        }

        @JavascriptInterface
        public void uninstall(final String pkg) {
            ui.post(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ex) {
                    toast("Couldn't uninstall that app.");
                }
            });
        }

        @JavascriptInterface
        public void saveGame(final String id, final String url, final String folder, final String name) {
            if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT < 29
                    && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingGame = new String[]{id, url, folder, name};
                ui.post(() -> requestPermissions(
                        new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
                return;
            }
            io.execute(() -> saveGameNow(id, url, folder, name));
        }

        /**
         * Starts a game directly in RetroArch with the given libretro core
         * (the same launch extras RetroArch's own Android frontend and other launchers use).
         * Returns "" on success, "not_installed", or "fallback" if only the app could be opened.
         */
        @JavascriptInterface
        public String playInRetroArch(String romPath, String core) {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai;
            try {
                ai = pm.getApplicationInfo("com.retroarch", 0);
            } catch (PackageManager.NameNotFoundException ex) {
                return "not_installed";
            }
            String sd = android.os.Environment.getExternalStorageDirectory().getAbsolutePath();
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.setComponent(new android.content.ComponentName("com.retroarch",
                    "com.retroarch.browser.retroactivity.RetroActivityFuture"));
            i.putExtra("ROM", romPath);
            i.putExtra("LIBRETRO", ai.dataDir + "/cores/" + core + "_libretro_android.so");
            i.putExtra("CONFIGFILE", sd + "/Android/data/com.retroarch/files/retroarch.cfg");
            i.putExtra("IME", Settings.Secure.getString(getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD));
            i.putExtra("DATADIR", ai.dataDir);
            i.putExtra("APK", ai.sourceDir);
            i.putExtra("SDCARD", sd);
            i.putExtra("EXTERNAL", sd + "/Android/data/com.retroarch/files");
            i.putExtra("QUITFOCUS", "");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try {
                startActivity(i);
                return "";
            } catch (Exception ex) {
                return launch("com.retroarch") ? "fallback" : "not_installed";
            }
        }

        /** A game file bundled inside ReaperOS (assets/roms), as base64 for the built-in player. */
        @JavascriptInterface
        public String readRom(String path) {
            if (path == null || path.contains("..")) return "";
            try {
                InputStream in = getAssets().open(path);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Exception ex) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean hasMediaPermission() { return hasMediaAccess(); }

        @JavascriptInterface
        public void requestMediaPermission() {
            if (Build.VERSION.SDK_INT < 23 || hasMediaAccess()) {
                js("window.reaperMediaPermission && reaperMediaPermission(true)");
                return;
            }
            ui.post(() -> requestPermissions(mediaPermissions(), REQ_MEDIA));
        }

        @JavascriptInterface
        public String listMedia() { return listMediaJson(); }

        /** ReaperOS Player options: "passthrough" (Dolby/DTS to a receiver) and "matchFrameRate". */
        @JavascriptInterface
        public void setPlayerOption(String key, boolean on) {
            getSharedPreferences("reaper_player", MODE_PRIVATE).edit().putBoolean(key, on).apply();
        }

        @JavascriptInterface
        public boolean getPlayerOption(String key, boolean fallback) {
            return getSharedPreferences("reaper_player", MODE_PRIVATE).getBoolean(key, fallback);
        }

        /** Plays a video or music file in ReaperOS Player (VLC's engine). */
        @JavascriptInterface
        public void playMedia(final String path, final String title) {
            ui.post(() -> {
                Intent i = new Intent(MainActivity.this, VideoPlayerActivity.class);
                i.putExtra(VideoPlayerActivity.EXTRA_PATH, path);
                i.putExtra(VideoPlayerActivity.EXTRA_TITLE, title == null ? "" : title);
                startActivity(i);
            });
        }

        /** Opens a service's website in ReaperOS's own full-screen player. */
        @JavascriptInterface
        public void openWeb(final String url, final String ua) {
            ui.post(() -> {
                Intent i = new Intent(MainActivity.this, WebPlayerActivity.class);
                i.putExtra(WebPlayerActivity.EXTRA_URL, url);
                i.putExtra(WebPlayerActivity.EXTRA_UA, ua == null ? "" : ua);
                startActivity(i);
            });
        }

        @JavascriptInterface
        public boolean canInstall() {
            return canInstallPackages();
        }

        @JavascriptInterface
        public String deviceInfo() {
            try {
                JSONObject o = new JSONObject();
                JSONArray abis = new JSONArray();
                for (String a : Build.SUPPORTED_ABIS) abis.put(a);
                o.put("abis", abis);
                o.put("model", Build.MODEL);
                o.put("sdk", Build.VERSION.SDK_INT);
                PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
                o.put("version", p.versionName);
                return o.toString();
            } catch (Exception ex) {
                return "{}";
            }
        }

        /** Background GET, so the interface can read F-Droid / GitHub without CORS limits. */
        @JavascriptInterface
        public void fetch(final String id, final String url) {
            io.execute(() -> {
                boolean ok;
                String body;
                try {
                    body = httpGet(url);
                    ok = true;
                } catch (Exception ex) {
                    body = String.valueOf(ex.getMessage());
                    ok = false;
                }
                js("window.reaperFetched && reaperFetched(" + q(id) + "," + ok + "," + q(body) + ")");
            });
        }

        /** Downloads an APK with progress updates, then hands it to the Fire OS installer. */
        @JavascriptInterface
        public void install(final String id, final String url) {
            io.execute(() -> {
                File dir = apkDir();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File out = new File(dir, id.replaceAll("[^A-Za-z0-9_.-]", "_") + ".apk");
                HttpURLConnection c = null;
                try {
                    c = open(url);
                    int code = c.getResponseCode();
                    if (code >= 400) throw new Exception("HTTP " + code);
                    long total = c.getContentLength();
                    InputStream in = c.getInputStream();
                    OutputStream os = new FileOutputStream(out);
                    byte[] buf = new byte[65536];
                    long done = 0;
                    int lastPct = -1;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != lastPct && (pct < 0 ? done % (1 << 20) < 65536 : true)) {
                            lastPct = pct;
                            js("window.reaperProgress && reaperProgress(" + q(id) + "," + pct + "," + done + ")");
                        }
                    }
                    os.close();
                    in.close();
                    // Learn the real package name, and refuse builds this chip can't run.
                    String pkgName = "";
                    try {
                        PackageInfo pi = getPackageManager().getPackageArchiveInfo(out.getAbsolutePath(), 0);
                        if (pi != null && pi.packageName != null) pkgName = pi.packageName;
                    } catch (Exception ignored) { }
                    String abiProblem = abiProblem(out);
                    js("window.reaperApk && reaperApk(" + q(id) + "," + q(pkgName) + ")");
                    if (abiProblem != null) throw new Exception(abiProblem);
                    js("window.reaperProgress && reaperProgress(" + q(id) + ",100," + done + ")");
                    final File apk = out;
                    ui.post(() -> startInstall(apk));
                } catch (Exception ex) {
                    out.delete();
                    js("window.reaperInstallError && reaperInstallError(" + q(id) + "," + q(String.valueOf(ex.getMessage())) + ")");
                } finally {
                    if (c != null) c.disconnect();
                }
            });
        }
    }
}
