# ReaperOS

A Bazzite-style TV launcher for Amazon Fire TV, with a reaper load screen, your installed apps, cloud gaming shortcuts, and a Homebrew Store.

## What it does
- **Home:** a hero banner that follows your selection, Favorites (press **Menu** on any app to pin it), all your installed apps with their real icons, Cloud Gaming shortcuts, and Homebrew quick links.
- **Homebrew Store:** installs and updates Moonlight, GameNative (64-bit Fire TVs only), SmartTube and Jellyfin straight from F-Droid and GitHub. Fire OS shows its normal "Install?" screen to confirm.
- **Settings:** shortcuts to Fire TV settings and the install permission, a toggle for system apps, a toggle for load-screen music, and device info.
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
