# Implementation Plan: Screen Helper

## Overview

Build from the host outward: the takeover in the desktop host, then the Electron wrapper, the overlay's baby Clippy and banner, and finally the runner and agent wiring, with tests beside each layer.

## Tasks

- [x] 1. Make chat a pure delegator
  - [x] 1.1 State in `CHAT_SYSTEM` that chat only chats and delegates through `start_task`, and keep chat's tools to start_task, web_search, fetch_url and screenshot
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Write a unit test for chat's tool list and prompt
    - _Requirements: 1.1, 1.2_

- [x] 2. Add takeover to the desktop host
  - [x] 2.1 Swallow non-injected presses and moves in the low-level hooks while a takeover is on, passing releases
    - _Requirements: 4.2, 4.3_
  - [x] 2.2 End the takeover and emit `cancel` on Esc or Ctrl+Alt+Backspace
    - _Requirements: 5.1, 5.2, 5.3, 5.6_
  - [x] 2.3 Add the `takeover` command, the `ping` line and the 10 s watchdog
    - _Requirements: 4.7, 4.8_

- [x] 3. Wrap takeover in Electron
  - [x] 3.1 Add `DesktopHost.takeover` with a one-second ping, `DesktopScreen.takeover`, and the `cancel` event type
    - _Requirements: 4.1, 4.7_

- [x] 4. Draw baby Clippy and the takeover banner
  - [x] 4.1 Add the helper size, placement and slide-time functions to `geometry.ts`
    - _Requirements: 3.1, 3.2_
  - [x] 4.2 Write property tests for the geometry functions
    - **Property 1: Baby Clippy's size and starting spot**
    - **Property 2: Baby Clippy stays visible beside his target**
    - **Property 3: Slide timing**
    - **Validates: Requirements 3.1, 3.2, 3.4**
  - [x] 4.3 Add `Overlay.helper` and `Overlay.banner`, and draw both in the overlay page, with per-action animations
    - _Requirements: 3.3, 3.4, 3.6, 4.4_

- [x] 5. Wire the runner and agent
  - [x] 5.1 In Do_Mode, show baby Clippy and take over before acting, slide him to each Target instead of walking the Pet, lift the takeover during confirmations, and release everything when the Task ends
    - _Requirements: 2.2, 3.2, 3.5, 4.1, 4.5, 4.6, 4.8, 5.5_
  - [x] 5.2 Remove the pause-on-user-input flow, which the takeover replaces
    - _Requirements: 4.2_
  - [x] 5.3 Map the host's `cancel` event to `stopTask` in `agent.ts`
    - _Requirements: 5.1, 5.4_
  - [x] 5.4 Write unit tests for takeover order, confirmations, a failed takeover and abort cleanup
    - _Requirements: 3.5, 4.1, 4.5, 4.6, 4.8_

- [x] 6. Prompt answers and auto mode
  - [x] 6.1 Apply takeover commands in the desktop host as they arrive, ahead of queued commands, and cap a snapshot at 2 s with a level-by-level read when the whole-tree read is slow
    - _Requirements: 4.5, 4.9_
  - [x] 6.2 Re-check the element under a resting pointer after each overlay update, so prompt buttons stay clickable
    - _Requirements: 4.5_
  - [x] 6.3 Add the `ai.autoMode` setting, its Settings switch, and skip Confirmation_Prompts when it is on
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 6.4 Write a unit test for auto mode
    - _Requirements: 6.1, 6.2_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Requirement 2.1 and 2.3 hold through `startTask`, which already ends a running Task before starting another.
- Esc during a real takeover is verified by hand, since the hook lets injected test input through by design.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.2", "4.3"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["5.1", "5.3"] },
    { "id": 4, "tasks": ["5.2"] },
    { "id": 5, "tasks": ["5.4"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 7, "tasks": ["6.4"] }
  ]
}
```
