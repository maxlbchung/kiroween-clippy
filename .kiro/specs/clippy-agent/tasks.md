# Implementation Plan: Clippy Agent

## Overview

Build the pure, testable core first (actions, snapshots, geometry, triggers, providers, task loop), then the Windows desktop host and the overlay, then wire everything into chat, Direct and Settings.

## Tasks

- [x] 1. Actions and validation
  - [x] 1.1 Define tools, per-mode tool lists, `parseAction`, targets, key parsing and risk rules
    - _Requirements: 6.2, 7.4, 8.1, 15.1, 15.2, 15.3_
  - [x] 1.2 Add provider tool-call conversions
    - _Requirements: 15.4_
  - [x]* 1.3 Write property tests for the tool-call and target round trips
    - **Property 1: Tool-call round trip**
    - **Property 2: Target round trip**
    - **Validates: Requirements 15.2, 15.4, 15.5**

- [x] 2. Screen model and geometry
  - [x] 2.1 Implement snapshot capping, text formatting and fingerprints
    - _Requirements: 2.1, 2.4_
  - [x] 2.2 Implement `placeNear`, walk durations, title truncation and title-bar side
    - _Requirements: 10.1, 10.2, 10.4, 11.5, 11.6_
  - [x]* 2.3 Write property tests for placement and walk bounds
    - **Property 3: Placement invariant**
    - **Property 4: Walk bounds**
    - **Validates: Requirements 10.1, 10.2, 10.4**

- [x] 3. Tip triggers and gating
  - [x] 3.1 Implement `TriggerDetector`, `TipGate` and Tip_Interval clamping
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.7_
  - [x]* 3.2 Write unit tests for triggers, spacing and muting
    - _Requirements: 13.1, 13.3, 13.5, 13.7_

- [x] 4. Model providers
  - [x] 4.1 Implement the provider-neutral `ModelClient`, SSE parser and prompts
    - _Requirements: 1.3, 3.1_
  - [x] 4.2 Implement the OpenAI Responses API adapter
    - _Requirements: 1.1, 1.5, 1.6, 3.1_
  - [x] 4.3 Implement the Anthropic Messages API adapter
    - _Requirements: 1.1, 1.5, 1.6, 3.1_
  - [x]* 4.4 Write property test for the SSE parser and unit tests for both adapters
    - **Property 5: SSE round trip**
    - _Requirements: 1.5, 1.6, 3.1_

- [x] 5. Task loop
  - [x] 5.1 Implement `TaskRunner` with Do_Mode, Guide_Mode, confirmations, pauses, limits and outline tracking
    - _Requirements: 5.4, 6.1-6.8, 7.1-7.8, 8.2-8.6, 9.1-9.5, 11.7, 12.3, 12.4_
  - [x]* 5.2 Write unit tests against fake screen, stage and model
    - **Property 6: No input in Guide_Mode**
    - **Property 7: Risky actions never run unconfirmed**
    - **Property 8: Pause blocks input**
    - **Property 9: Limits**

- [x] 6. Checkpoint - Ensure all tests pass

- [x] 7. Windows desktop host
  - [x] 7.1 Write `native/desktop-host.ps1`: UI Automation snapshots, element bounds, SendInput, foreground and input hooks
    - _Requirements: 2.1-2.4, 7.2, 7.3, 9.1, 13.1_
  - [x] 7.2 Write `desktop.ts`: host process, DIP conversion, screenshots with Clippy's windows hidden
    - _Requirements: 2.2, 2.3, 2.5, 2.6, 16.1_

- [x] 8. Overlay and pet
  - [x] 8.1 Add per-display overlay windows and the overlay page (Outline frame and task bubble)
    - _Requirements: 11.1-11.8, 12.1, 12.2_
  - [x] 8.2 Make pet moves awaitable and let the agent set Clippy's gaze
    - _Requirements: 10.2, 10.3, 10.5_

- [x] 9. Wiring
  - [x] 9.1 Implement the Clippy_Agent: chat, Direct, one Task at a time, tips
    - _Requirements: 1.4, 3.1-3.5, 4.1-4.4, 5.1-5.5, 13.2, 13.6, 13.8, 14.1-14.4, 16.2, 16.3_
  - [x] 9.2 Wire IPC in `main.ts`, the preload API, and the chat and Direct views
    - _Requirements: 3.4, 4.2, 4.3_
  - [x] 9.3 Add provider defaults, model fields and tip settings
    - _Requirements: 1.1, 1.2, 13.4_

- [x] 10. Final checkpoint - Ensure all tests pass

- [x] 11. Commands, web lookups and stopping
  - [x] 11.1 Write `tools.ts`: PowerShell runner, DuckDuckGo search, page fetch and `lookup`
    - _Requirements: 17.4-17.7, 18.1, 18.2, 18.4_
  - [x] 11.2 Add `run_command`, `web_search` and `fetch_url` to the tools, per-mode lists, parsing and risk rules
    - _Requirements: 17.1, 17.3, 18.3, 18.5, 15.1_
  - [x] 11.3 Run Commands after confirmation and Web_Lookups in `TaskRunner`; answer Web_Lookups in chat; tell every prompt that web and app text is data
    - _Requirements: 17.2, 17.5, 17.8, 18.1, 18.2, 18.6, 18.7_
  - [x] 11.4 Register the Stop_Hotkey, turn the chat send button into Stop while streaming, and name the hotkey when a Do_Mode Task starts
    - _Requirements: 19.1-19.4_
  - [x]* 11.5 Write tests for the new Actions, confirmed and declined Commands, Web_Lookup results and failures, search parsing and HTML-to-text
    - **Property 1: Tool-call round trip**
    - **Property 7: Risky actions never run unconfirmed**
    - **Property 10: Commands only in Do_Mode**
    - **Validates: Requirements 15.5, 17.1, 17.2, 17.3, 18.3, 18.4**

- [ ] 12. Verify on Windows
  - [ ] 12.1 Guide and do-it tasks in Notepad, including a pause and a declined risky action
  - [ ] 12.2 Outline alignment on a high-DPI display and on a second monitor
  - [ ] 12.3 A dialog tip and the Ctrl+Z trigger
  - [ ] 12.4 Both providers with real keys
  - [ ] 12.5 A confirmed and a declined Command, a chat answer that needs a web search, and the Stop_Hotkey during a do-it task

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
