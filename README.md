# ReaperOS

A Bazzite-style TV launcher for Amazon Fire TV, with a reaper load screen, your installed apps, cloud gaming shortcuts, and a Homebrew Store.

## What it does
- **Home:** a hero banner that follows your selection, Favorites (press **Menu** on any app to pin it), all your installed apps with their real icons, Cloud Gaming shortcuts, and Homebrew quick links.
- **Every app on the launcher:** the whole catalog sits on Home in category rows (streaming, game streaming, emulators, free games, app stores, tools). Installed apps open; the rest install with one press. Apps the device can't run (for example 64-bit-only apps on a 32-bit Fire TV) are hidden.
- **First launch installs everything:** ReaperOS queues every compatible app and installs them one after another. Fire OS asks you to press Install on each (no app can skip that). It checks free storage before each one and stops with a message if the device gets low. Rerun anytime from Store → Install all apps, or Install starter pack for just the essentials. On PCs (Windows and ReaperOS OS) the starter apps preload silently in the background on first run.
- **Movies & TV and Anime rows:** Netflix, Prime Video, Disney+, HBO Max, Hulu, Peacock, Paramount+, Apple TV, YouTube, Tubi, Pluto TV, Plex, Crunchyroll, HIDIVE and RetroCrush. Installed apps open directly; missing ones open their page in the Amazon Appstore (or Microsoft Store on Windows).
- **Music & social row:** Spotify, Apple Music and Discord (Discord also runs inside ReaperOS when its app isn't installed).
- **ReaperOS Player (Media tab):** plays nearly any video or music file on the device or a USB drive (MKV, MP4, AVI, HEVC, AV1, VP9, DTS, Dolby, FLAC, subtitles) using VLC's engine. Remote: OK pause, left/right seek, up audio track, down subtitles, Back exit. It remembers where you stopped.
- **PC & cloud gaming:** Xbox, GeForce NOW, Amazon Luna, Boosteroid and Steam Big Picture (via Valve's Steam Link) tiles open the real apps. If one isn't installed, the tile opens its Amazon Appstore page (GeForce NOW and Steam Link open in Aurora Store, since Amazon doesn't carry them).
- **Homebrew Store:** 48 open-source apps in six rows (streaming & media, game streaming & PC games, 18 emulators, 12 free games, alternate app stores, tools & Fire TV tweaks), from F-Droid, GitHub and Stremio.com. ReaperOS picks the build that matches your Fire TV's chip and Fire OS version, and checks each download before installing so 64-bit-only apps never fail halfway. For anything not listed, install Obtainium and add any GitHub project.
- **Built-in games:** five freely distributed NES and Game Boy homebrew games ship inside ReaperOS and play in its own emulator (EmulatorJS), with no other app needed. Remote: OK = A, Play/Pause = B, Menu = Start, Rewind = Select, Back = exit; controllers work too. Press Menu on a game to open it in RetroArch instead. See `app/src/main/assets/roms/CREDITS.md`.
- **Built-in player:** YouTube (TV interface), Tubi, Pluto TV, Plex, RetroCrush and Crunchyroll play inside ReaperOS when their app isn't installed. Netflix, Disney+, Max, Hulu, Peacock, Paramount+ and Prime Video need their official apps because of copy protection. On Windows, Xbox Cloud Gaming, GeForce NOW and Amazon Luna also run inside ReaperOS with a controller.
- **Settings:** shortcuts to Fire TV settings and the install permission, a theme switch (ReaperOS purple or Steam Big Picture blue), toggles for system apps and load-screen music, and device info.
- **Automatic updates:** ReaperOS checks GitHub for a new build when it opens and every 6 hours, downloads it in the background, and brings up the install prompt. It also checks your installed store apps and lets you update them all at once (Homebrew Store → Update all apps). Turn this off in Settings.
- **Load screen:** the reaper slashes a soul made of RAM sticks, catches one and eats it in three crunchy bites, then lights up with happy eyes; all with a synthesized slash, crunch and chime. To use your own audio instead, add `app/src/main/assets/splash.mp3`.

## Getting the APK
Every push to `main` builds the app with GitHub Actions and publishes it at:

`https://github.com/<your-username>/<repo>/releases/download/latest/ReaperOS.apk`

## Installing on Fire TV
1. On the Fire TV, install **Downloader** from the Appstore.
2. Go to Settings → My Fire TV → Developer Options → Install unknown apps, and turn it on for Downloader.
3. In Downloader, enter the APK link above and install.
4. ReaperOS appears in Your Apps & Games. Move it to the front row of the Fire TV home screen for quick access.

The first time you install from the Homebrew Store, ReaperOS asks for permission to install apps. Allow it, press Back, and the install continues.

## Remote controls
| Button | Action |
|---|---|
| D-pad | Move |
| OK | Open / launch |
| Menu (☰) | Pin or unpin an app; uninstall in the Store |
| Back | Return Home, then to the top, then to Fire TV |
| Rewind / Fast-forward | Jump to the start or end of a row |

## Building locally
Open the folder in Android Studio, or run `gradle assembleRelease` with Gradle 8.7+ and JDK 17.

## Windows version
ReaperOS also runs on Windows as a full-screen, controller-friendly launcher (the `windows/` folder, built with Electron from the same interface file).

- **Steam library** row with each game's cover art, read from your Steam folders; games launch through Steam.
- **Your apps** from the Start menu, including Microsoft Store apps like Xbox.
- **PC & cloud gaming:** GTA V · FiveM, Steam Big Picture, Xbox, GeForce NOW, Steam Link and Moonlight. Missing ones install with winget.
- **GTA V multiplayer:** FiveM (GTA V servers) and RedM (Red Dead Redemption 2 servers) install with winget, plus the Rockstar Games Launcher. They need your own copy of the game. FiveM is Windows-only, so it isn't in the Fire TV, iPhone or ReaperOS OS (Linux) versions.
- **Store:** launchers (Steam, Epic, GOG Galaxy, Heroic, Playnite, Sunshine), emulators (RetroArch, PPSSPP, DuckStation, PCSX2, Dolphin, Cemu, xemu, ScummVM), media apps and tools, all installed through winget.
- **Free homebrew games** saved to `Documents/ReaperOS/ROMs` and launched in RetroArch.
- **Controls:** arrow keys / Enter / Esc / M, or any Xbox or PlayStation controller. F11 toggles full screen.
- **Boot screen** in a Windows XP-style homage; **Start with Windows** option in Settings to use it like a console.
- **ReaperOS Player** on Windows uses the bundled mpv engine for nearly every codec; it finds media in Videos, Music, Downloads and Desktop.
- **Automatic updates** from the `windows-latest` release.

Installer: `https://github.com/nookiekrizp-sketch/ReaperOS/releases/download/windows-latest/ReaperOS-Setup.exe`
The installer isn't code-signed, so Windows SmartScreen may warn on first run: choose **More info → Run anyway**.

## iPhone & iPad (web app)
ReaperOS also runs as a home-screen web app on iPhone and iPad, published with GitHub Pages:
`https://nookiekrizp-sketch.github.io/ReaperOS/`

Open it in Safari, tap **Share → Add to Home Screen**, then launch it from the new icon. It runs full-screen with touch and controller support. Movie, anime and app tiles open the app if it's installed (or its App Store page if not); Xbox Cloud Gaming, GeForce NOW and Amazon Luna open in Safari, which is how they officially run on iOS. Free homebrew games save to the Files app for RetroArch or Delta. iOS doesn't let web apps list or install apps, so there's no Your apps row on iOS.

## ReaperOS OS (bootable, for PCs)
ReaperOS is also a full operating system for gaming PCs, built on [Bazzite](https://bazzite.gg) (Fedora Linux) the same way Universal Blue images are made. It boots straight into ReaperOS full screen, like SteamOS's Gaming Mode, and keeps everything Bazzite provides: GPU drivers, Steam with Proton, controller support and automatic background updates.

- **Boots into ReaperOS:** the main account signs in automatically to a full-screen ReaperOS session (gamescope).
- **Desktop mode:** Settings → Desktop mode switches to the full KDE desktop; **Return to ReaperOS** in the app menu switches back.
- **Store from Flathub:** Heroic, Lutris, Bottles, ProtonUp-Qt, RetroArch, RetroDECK, PCSX2, RPCS3, Dolphin, Cemu, Azahar, Stremio, Kodi, Plex, Spotify, Discord and more, installed per user with no password prompts.
- **Steam library, Your apps, Media player (mpv), built-in games, cloud gaming** all work as in the Windows version. Netflix and other copy-protected services open in the system browser.
- **Power controls:** Shut down, Restart and Sleep in Settings.
- **Batocera:** a **Batocera** tile (PC & cloud gaming) and **Settings → Restart into Batocera** start a Batocera USB stick or partition once; the next normal restart returns to ReaperOS. ReaperOS finds the drive by its `BATOCERA` label (or any FAT label starting with `BATO`) and its `EFI/batocera` or `EFI/BOOT` boot file. If none is found it opens [batocera.org/download](https://batocera.org/download); flash the image with **Impression** from the Store. Batocera doesn't support Secure Boot, so turn that off in your firmware if Batocera won't start. The Windows version does the same with an administrator prompt (and offers balenaEtcher).
- **Updates:** the image is rebuilt daily on top of the newest Bazzite, and your PC picks it up automatically.

### Installing
Installing an OS replaces what's on the target drive, so back up first.

1. Download Bazzite from [bazzite.gg](https://bazzite.gg) (choose the **Desktop** edition with **KDE Plasma**, for your GPU: AMD/Intel, or NVIDIA) and install it from a USB stick.
2. After the first boot, open a terminal and switch the system to ReaperOS:

   `sudo bootc switch ghcr.io/nookiekrizp-sketch/reaperos:latest`

3. Restart. The PC boots into ReaperOS.

To go back to plain Bazzite: `sudo bootc switch ghcr.io/ublue-os/bazzite:stable`, then restart.

The image is built by `.github/workflows/os.yml` from `os/Containerfile`.
