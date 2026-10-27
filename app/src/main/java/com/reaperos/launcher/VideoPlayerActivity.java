package com.reaperos.launcher;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.io.File;
import java.util.ArrayList;
import java.util.Locale;

/**
 * ReaperOS Player: plays nearly any video or audio file with VLC's engine (libVLC),
 * using hardware decoding where the Fire TV supports it and software decoding otherwise.
 *
 * Remote: OK / Play-Pause = pause, Left/Right (or Rewind/Fast-forward) = seek 10 s,
 * Up = next audio track, Down = next subtitle track, Menu = info, Back = exit.
 */
public class VideoPlayerActivity extends Activity {

    public static final String EXTRA_PATH = "path";
    public static final String EXTRA_TITLE = "title";

    private LibVLC libVLC;
    private MediaPlayer player;
    private VLCVideoLayout videoLayout;
    private LinearLayout overlay;
    private TextView titleView, timeView, statusView;
    private ProgressBar progress;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable hideOverlay = () -> { if (overlay != null) overlay.setVisibility(View.GONE); };
    private final Runnable tick = new Runnable() {
        @Override public void run() { updateTime(); ui.postDelayed(this, 500); }
    };
    private String path;
    private SharedPreferences prefs;
    private boolean resumed = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("reaper_player", MODE_PRIVATE);

        path = getIntent().getStringExtra(EXTRA_PATH);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        if (path == null || path.length() == 0) { finish(); return; }
        if (title == null || title.length() == 0) title = new File(path).getName();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        videoLayout = new VLCVideoLayout(this);
        root.addView(videoLayout, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(buildOverlay(title), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        setContentView(root);

        ArrayList<String> args = new ArrayList<>();
        args.add("--audio-time-stretch");
        args.add("--network-caching=1500");
        args.add("--subsdec-encoding=UTF-8");
        libVLC = new LibVLC(this, args);
        player = new MediaPlayer(libVLC);
        player.attachViews(videoLayout, null, true, false);
        player.setEventListener(event -> {
            switch (event.type) {
                case MediaPlayer.Event.Playing:
                    if (!resumed) { resumed = true; resumePosition(); }
                    status("");
                    break;
                case MediaPlayer.Event.EndReached:
                    prefs.edit().remove(path).apply();
                    finish();
                    break;
                case MediaPlayer.Event.EncounteredError:
                    status("This file couldn't be played.");
                    showOverlay(true);
                    break;
                default:
                    break;
            }
        });

        Media media = path.contains("://") ? new Media(libVLC, Uri.parse(path)) : new Media(libVLC, path);
        media.setHWDecoderEnabled(true, false);   // hardware first, software fallback
        player.setMedia(media);
        media.release();
        player.play();
        showOverlay(false);
        ui.post(tick);
    }

    // ---------------------------------------------------------------- overlay

    private View buildOverlay(String title) {
        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setPadding(dp(48), dp(20), dp(48), dp(36));
        GradientDrawable shade = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0x00000000, 0xCC0B0714});
        overlay.setBackground(shade);

        titleView = text(title, 24, true, 0xFFF2EEFB);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFF22E3FF));
        timeView = text("0:00 / 0:00", 16, false, 0xFFA99CC7);
        statusView = text("", 16, false, 0xFFFF4D6D);
        TextView hint = text("OK pause   ◀ ▶ seek 10s   ▲ audio   ▼ subtitles   BACK exit", 14, false, 0xFF6E6290);

        overlay.addView(titleView);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8));
        lp.topMargin = dp(12);
        overlay.addView(progress, lp);
        overlay.addView(timeView);
        overlay.addView(statusView);
        overlay.addView(hint);
        return overlay;
    }

    private TextView text(String s, int sp, boolean bold, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(4), 0, 0);
        return t;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void showOverlay(boolean stay) {
        overlay.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideOverlay);
        if (!stay) ui.postDelayed(hideOverlay, 3500);
    }

    private void status(String s) {
        statusView.setText(s);
        statusView.setVisibility(s.length() == 0 ? View.GONE : View.VISIBLE);
    }

    private static String fmt(long ms) {
        long s = Math.max(0, ms / 1000);
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }

    private void updateTime() {
        if (player == null) return;
        long t = player.getTime(), len = player.getLength();
        timeView.setText(fmt(t) + " / " + fmt(len) + (player.isPlaying() ? "" : "   ❚❚ paused"));
        progress.setProgress(len > 0 ? (int) (t * 1000 / len) : 0);
        if (len > 0 && t > 0) prefs.edit().putLong(path, t).apply();
    }

    private void resumePosition() {
        long saved = prefs.getLong(path, 0);
        long len = player.getLength();
        if (saved > 15000 && (len <= 0 || saved < len - 30000)) {
            player.setTime(saved);
            status("Resumed from " + fmt(saved));
            showOverlay(false);
        }
    }

    // ---------------------------------------------------------------- tracks

    private void cycleAudio() {
        MediaPlayer.TrackDescription[] tracks = player.getAudioTracks();
        if (tracks == null || tracks.length < 2) { status("Only one audio track"); showOverlay(false); return; }
        int cur = player.getAudioTrack(), next = 0;
        for (int i = 0; i < tracks.length; i++) if (tracks[i].id == cur) next = (i + 1) % tracks.length;
        if (tracks[next].id == -1) next = (next + 1) % tracks.length;   // skip "Disable"
        player.setAudioTrack(tracks[next].id);
        status("Audio: " + tracks[next].name);
        showOverlay(false);
    }

    private void cycleSubtitles() {
        MediaPlayer.TrackDescription[] tracks = player.getSpuTracks();
        if (tracks == null || tracks.length == 0) { status("No subtitles in this file"); showOverlay(false); return; }
        int cur = player.getSpuTrack(), next = 0;
        for (int i = 0; i < tracks.length; i++) if (tracks[i].id == cur) next = (i + 1) % tracks.length;
        player.setSpuTrack(tracks[next].id);
        status("Subtitles: " + tracks[next].name);
        showOverlay(false);
    }

    private void seek(long deltaMs) {
        long len = player.getLength();
        long t = Math.max(0, player.getTime() + deltaMs);
        if (len > 0) t = Math.min(t, len - 1000);
        player.setTime(t);
        updateTime();
        showOverlay(false);
    }

    // ---------------------------------------------------------------- remote

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (player == null) return super.onKeyDown(keyCode, event);
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_SPACE:
                if (event.getRepeatCount() == 0) {
                    if (player.isPlaying()) player.pause(); else player.play();
                    updateTime();
                    showOverlay(!player.isPlaying());
                }
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY: player.play(); showOverlay(false); return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: player.pause(); showOverlay(true); return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_BUTTON_R1:
                seek(event.getRepeatCount() > 6 ? 30000 : 10000); return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_BUTTON_L1:
                seek(event.getRepeatCount() > 6 ? -30000 : -10000); return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_BUTTON_Y:
                if (event.getRepeatCount() == 0) cycleAudio(); return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_BUTTON_X:
                if (event.getRepeatCount() == 0) cycleSubtitles(); return true;
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_INFO:
                showOverlay(false); return true;
            default:
                return super.onKeyDown(keyCode, event);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        updateTime();
        if (player != null && player.isPlaying()) player.pause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (player != null) {
            player.stop();
            player.detachViews();
            player.release();
            player = null;
        }
        if (libVLC != null) { libVLC.release(); libVLC = null; }
        super.onDestroy();
    }
}
