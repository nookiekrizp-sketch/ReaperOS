# ReaperOS

A Bazzite-style TV launcher for Amazon Fire TV, with a reaper load screen, your installed apps, cloud gaming shortcuts, and a Homebrew Store.

## What it does
- **Home:** a hero banner that follows your selection, Favorites (press **Menu** on any app to pin it), all your installed apps with their real icons, Cloud Gaming shortcuts, and Homebrew quick links.
- **First launch:** ReaperOS automatically installs its core apps (SmartTube, Stremio, Kodi, Moonlight, RetroArch, Obtainium, plus GameNative on 64-bit Fire TVs). Fire OS asks you to press Install for each one. You can rerun this anytime from Homebrew Store → Install starter pack.
- **PC & cloud gaming:** Xbox, GeForce NOW, Amazon Luna, Boosteroid and Steam Big Picture (via Valve's Steam Link) tiles open the real apps. If one isn't installed, the tile opens its Amazon Appstore page (GeForce NOW and Steam Link open in Aurora Store, since Amazon doesn't carry them).
- **Homebrew Store:** 48 open-source apps in six rows (streaming & media, game streaming & PC games, 18 emulators, 12 free games, alternate app stores, tools & Fire TV tweaks), from F-Droid, GitHub and Stremio.com. ReaperOS picks the build that matches your Fire TV's chip and Fire OS version, and checks each download before installing so 64-bit-only apps never fail halfway. For anything not listed, install Obtainium and add any GitHub project.
- **Free homebrew games:** downloads freely distributed NES and Game Boy homebrew into `Downloads/ReaperOS/ROMs/<system>` and adds a Your games row on Home that launches each game straight into RetroArch.
- **Settings:** shortcuts to Fire TV settings and the install permission, a theme switch (ReaperOS purple or Steam Big Picture blue), toggles for system apps and load-screen music, and device info.
- **Automatic updates:** ReaperOS checks GitHub for a new build when it opens and every 6 hours, downloads it in the background, and brings up the install prompt. It also checks your installed store apps and lets you update them all at once (Homebrew Store → Update all apps). Turn this off in Settings.
- **Load screen:** an animated reaper with an original spooky jingle. To use your own audio instead, add `app/src/main/assets/splash.mp3`.

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
