# Clippy (kiroween-clippy)

![Clippy: chat bubble, radial menu, wardrobe and Direct mode](docs/preview.png)

An agentic desktop pet for Windows, built with Electron. Clippy sits on your desktop, follows your cursor with his eyes, and can be dragged anywhere. Click him to open a radial menu:

| Button        | What it does                                                                                                              | Status                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Chat**      | Speech-bubble chat window anchored to Clippy, with streaming replies                                                      | UI done. The agent is a stub.               |
| **Direct**    | Push-to-talk voice commands with no reply text. Meant for a fast "system 1" model that acts through Windows UI Automation | Dictation done. The action agent is a stub. |
| **Customize** | Wardrobe with hats, eyewear, mustaches, capes, neckwear and finishes. Try on locked items, then buy them with credits     | Done                                        |
| **Games**     | Clippy's Arcade. In **Dodge!**, Clippy throws fireballs, pop-ups, dives and lasers at your cursor. Scores earn credits    | One game                                    |
| **Settings**  | API keys, models, voice engine, hotkey, behavior, hide/quit                                                               | Done                                        |

Other features: tray icon, right-click menu, global hotkey for Direct (`Ctrl+Alt+Space` by default), idle quips, sleep mode, drag wobble physics, Win95-style window zoom animations, and synthesized retro sounds (no audio files).

## Run it

```bash
yarn install
yarn start
```

To test Direct mode without Windows speech recognition, run with scripted dictation:

```bash
CLIPPY_FAKE_SPEECH=1 yarn start
```

`CLIPPY_USER_DATA=/some/dir` points settings at a throwaway profile.

## Build for Windows

On Windows, this builds the NSIS installer, a portable `.exe` and a `.zip` in `dist/`:

```bash
yarn dist:win
```

On macOS or Linux, the NSIS installer needs Wine. The zip target works without it:

```bash
yarn dist:win:zip
```

You can also run the **Build Windows** GitHub Actions workflow manually, or push a `v*` tag. It builds on `windows-latest` and uploads the installers as artifacts.

Other scripts: `yarn test` runs the placement and shop unit tests, and `yarn icons` regenerates the app and tray icons from the editable SVGs in `assets/icons/`.

## Voice (Direct mode)

- **Windows Speech (default, offline):** `native/speech-host.ps1` is a long-lived PowerShell host that runs `System.Speech` dictation and streams partial and final results as JSON lines. The mic is only open while listening. This needs a Windows speech language installed (Settings → Time & language → Speech).
- **Cloud transcription:** records in the renderer with `MediaRecorder` and voice-activity detection, then the main process posts the audio to `/v1/audio/transcriptions` using your OpenAI key.

## Architecture

```
src/
  main/            Electron main process
    main.js        app lifecycle, app:// protocol, IPC, hotkey
    pet.js         transparent click-through pet window, drag loop, cursor feed
    panels.js      one reusable panel window, anchored beside Clippy and following him
    arcade.js      full-screen overlay window for desktop-wide games
    placement.js   pure geometry (unit-tested)
    settings.js    JSON store; API keys encrypted with safeStorage (DPAPI)
    shop.js        wallet: awards credits for game rounds, sells costume items
    speech.js      dictation engines (Windows / cloud / fake)
    agent.js       chat + direct agent stubs  ← plug real agents in here
    tray.js
  preload/         sandboxed contextBridge API (window.clippy)
  shared/layout.js geometry shared by main and renderers
  shared/shop.js   costume prices and credit rules, shared by main and the wardrobe
  renderer/
    common/        design system CSS, Clippy SVG + costumes, pixel icons, sfx
    pet/           Clippy, radial menu, moods, speech bubble
    panel/         panel host + views (chat, direct, customize, games, settings)
    games/dodge/   Dodge overlay: attack coroutines, canvas engine, HUD and dialogs
native/            speech-host.ps1 (shipped via extraResources)
```

Design notes:

- **Click-through:** the windows ignore the mouse with `forward: true`. The renderer turns hit-testing back on only over elements marked `[data-hit]`, so the transparent areas never block your desktop.
- **Security:** `contextIsolation` and `sandbox` are on, there is no Node in renderers, a CSP is set, and files are served from a custom `app://` scheme. API keys never reach a renderer; it only sees "is set" flags.
- **Extending:**
  - Implement `agent.chat()` (an async generator of text chunks) and `agent.direct()` in `src/main/agent.js`. The streaming IPC is already wired.
  - Add games by pushing `{ id, name, blurb, color, mount }` into `GAMES` in `views/games.js`. `mount(el, ctx, back)` replaces the arcade's content.
  - Full-screen games get a page in `renderer/games/<id>/` and an entry in `PAGES` in `main/arcade.js`. The overlay starts with `api.launchGame(id)` and ends with `api.exitGame(result)`.
  - Add costumes to `ITEMS` in `common/costumes.js`. Give one a price in `PRICES` in `shared/shop.js` to lock it; items without a price are free.

## Credits

Pixel font: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) (SIL OFL, see `src/renderer/assets/fonts/OFL.txt`). All character art, costumes and icons are original SVG drawn for this project.
