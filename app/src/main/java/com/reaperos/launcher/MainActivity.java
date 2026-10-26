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
import java.util.HashMap;
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
        String name = keyName(e.getKeyCode());
        if (name == null) return super.dispatchKeyEvent(e);
        if (e.getAction() == KeyEvent.ACTION_DOWN) {
            final String n = name;
            final boolean repeat = e.getRepeatCount() > 0;
            web.evaluateJavascript(
                    "window.reaperKey ? reaperKey('" + n + "'," + repeat + ") : false",
                    value -> {
                        if ("Back".equals(n) && !repeat && !"true".equals(value)) {
                            moveTaskToBack(true);
                        }
                    });
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
