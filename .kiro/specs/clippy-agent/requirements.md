# Requirements Document

## Introduction

The Clippy_Agent replaces the stubbed chat and Direct agents in the Clippy_App, the Electron desktop pet for Windows. The Clippy_Agent sees the screen through Windows UI Automation and Screenshots, decides how to help, and acts through the Pet: walking to on-screen controls, explaining Steps in the Speech_Bubble, framing controls with retro window-styled Outlines, and clicking and typing in other applications when asked to do a Task. The Watcher also offers Tips unprompted when a Trigger_Event suggests the user could use help.

The Clippy_Agent supports OpenAI and Anthropic models, with OpenAI as the default. OpenAI-compatible endpoints, memory that persists across Sessions, and filters that keep specific applications out of Screenshots are out of scope.

The first milestone delivers every requirement in this document end to end at a basic level of polish.

## Glossary

- **Clippy_App**: The Electron desktop application that hosts the Pet, the panels, and the Clippy_Agent.
- **Clippy_Agent**: The component that interprets Chat_Requests, Direct_Commands, and Tips, calls the Model_Provider, and directs the Screen_Reader, Input_Controller, Pet, Speech_Bubble, and Overlay.
- **Model_Provider**: The adapter that sends model requests to one AI provider (OpenAI or Anthropic) and returns reply text and Actions.
- **Main_Model**: The user-configured model used for Chat_Requests, Tasks started from chat, and writing Tips.
- **Fast_Model**: The user-configured model used for Direct_Commands and for the Watcher's first evaluation of a Trigger_Event.
- **Screen_Reader**: The component that produces UIA_Snapshots and Screenshots.
- **UIA_Snapshot**: A list of UI elements read through Windows UI Automation, where each element has an identifier, a name, a control type, and screen bounds.
- **Screenshot**: A captured image of one display.
- **Clippy_Window**: Any window created by the Clippy_App, including the Pet, the panels, and the Overlay.
- **Target**: The UI element or screen rectangle that an Action, Outline, or Tip refers to.
- **Action**: One operation the Clippy_Agent performs: click, double-click, right-click, type text, press keys, scroll, outline a Target, show a Speech_Bubble message, ask for confirmation, or finish the Task.
- **Task**: A user goal that the Clippy_Agent completes in one or more Steps, started by a Chat_Request, a Direct_Command, or a Tip's follow-up button.
- **Step**: One unit of progress within a Task: one Action in Do_Mode, or one instruction the user carries out in Guide_Mode.
- **Guide_Mode**: The Task mode where the Clippy_Agent outlines Targets and explains each Step, and the user carries out each Step.
- **Do_Mode**: The Task mode where the Clippy_Agent carries out each Step through the Input_Controller.
- **Chat_Request**: A message the user sends from the chat panel.
- **Direct_Command**: A transcribed voice command dispatched from the Direct panel.
- **Input_Controller**: The component that sends synthesized mouse and keyboard input to the operating system.
- **User_Input**: Mouse movement of more than 8 pixels, a mouse button press, or a key press made by the user, excluding input sent by the Input_Controller.
- **Pet**: The window that shows the Clippy character.
- **Home_Position**: The Pet's position immediately before a Task begins.
- **Speech_Bubble**: The message bubble attached to the Pet.
- **Overlay**: Transparent, always-on-top windows covering every connected display, on which Outlines are drawn.
- **Outline**: A frame drawn on the Overlay around a Target in the Clippy_App's retro Win9x window style, with a transparent center and a Title_Bar.
- **Title_Bar**: The top bar of an Outline, showing a Step counter, a description, and buttons.
- **Risky_Action**: An Action that sends a message or form, deletes data, makes a purchase or payment, closes a window with unsaved changes, runs a command or script, installs or uninstalls software, or changes operating-system settings.
- **Confirmation_Prompt**: A Speech_Bubble message that describes a Risky_Action and shows Yes and No buttons.
- **Watcher**: The component that observes Trigger_Events and decides whether to show a Tip.
- **Trigger_Event**: A foreground window change where the new window stays in the foreground for at least 3 seconds, the opening of a dialog window, the user making no User_Input for 20 seconds while a dialog window has focus, or three Ctrl+Z key presses within 10 seconds.
- **Tip**: An unprompted Speech_Bubble message from the Watcher, optionally with an Outline and a follow-up button.
- **Tip_Interval**: The minimum time between two Tips.
- **Full_Screen_Window**: A foreground window whose bounds cover the entire display it is on.
- **Session**: The period from the Clippy_App's launch to its exit.

## Requirements

### Requirement 1: Model providers

**User Story:** As a user, I want to choose OpenAI or Anthropic models, so that Clippy uses the provider and models I have keys for.

#### Acceptance Criteria

1. THE Clippy_App SHALL offer OpenAI and Anthropic as Model_Provider choices in Settings, with OpenAI selected by default.
2. THE Clippy_App SHALL let the user set the Main_Model and the Fast_Model in Settings.
3. WHEN a model request starts, THE Clippy_Agent SHALL send the request through the Model_Provider, Main_Model, and Fast_Model selected in Settings at that moment.
4. IF the selected Model_Provider has no saved API key when a Chat_Request, Direct_Command, or Tip follow-up arrives, THEN THE Clippy_Agent SHALL show a Speech_Bubble message naming the missing key and SHALL start no Task.
5. IF a model request fails or receives no complete response within 60 seconds, THEN THE Clippy_Agent SHALL end the current Task and show a Speech_Bubble message describing the failure.
6. IF the selected model rejects image input, THEN THE Clippy_Agent SHALL continue the Task with UIA_Snapshots only and show a Speech_Bubble message stating that the model cannot read Screenshots.

### Requirement 2: Seeing the screen

**User Story:** As a user, I want Clippy to see what is on my screen, so that his help matches what I am doing.

#### Acceptance Criteria

1. WHEN the Clippy_Agent prepares a model request for a Step or a Tip, THE Screen_Reader SHALL produce a UIA_Snapshot of the foreground window plus the titles and bounds of all visible top-level windows within 1500 milliseconds.
2. THE Screen_Reader SHALL report element bounds in virtual-screen pixel coordinates spanning all connected displays.
3. THE Screen_Reader SHALL exclude Clippy_Windows from UIA_Snapshots and Screenshots.
4. THE Screen_Reader SHALL limit a UIA_Snapshot to 500 elements, keeping the focused element and the focused element's ancestors before other elements.
5. WHEN the Main_Model or Fast_Model requests visual detail, THE Screen_Reader SHALL attach a Screenshot of the display containing the center of the foreground window to the next model request.
6. IF Windows UI Automation returns no elements for the foreground window, THEN THE Screen_Reader SHALL attach a Screenshot to the model request for that Step.

### Requirement 3: Chat requests

**User Story:** As a user, I want to chat with Clippy about what is on my screen, so that his answers fit my situation.

#### Acceptance Criteria

1. WHEN the user sends a Chat_Request, THE Clippy_Agent SHALL stream the Main_Model's reply text into the chat panel.
2. WHEN the user sends a Chat_Request, THE Clippy_Agent SHALL include the Session's chat history and a UIA_Snapshot in the model request.
3. WHEN the Main_Model's reply starts a Task, THE Clippy_Agent SHALL run the Task in the mode chosen under Requirement 5.
4. WHILE a Task started from a Chat_Request is running, THE Clippy_App SHALL hide the chat panel and SHALL restore the chat panel with a summary of the Task's result when the Task ends.
5. WHEN the user cancels a Chat_Request from the chat panel, THE Clippy_Agent SHALL stop the reply stream and end any Task started by that Chat_Request within 500 milliseconds.

### Requirement 4: Direct commands

**User Story:** As a user, I want to say a command and have Clippy carry it out, so that I can control my PC hands-free.

#### Acceptance Criteria

1. WHEN the Direct panel dispatches a non-empty Direct_Command, THE Clippy_Agent SHALL start a Do_Mode Task for the Direct_Command using the Fast_Model.
2. WHILE a Direct_Command Task is running, THE Clippy_App SHALL hide the Direct panel.
3. WHEN a Direct_Command Task ends, THE Clippy_Agent SHALL show a Speech_Bubble message of at most 80 characters summarizing the result.
4. IF a Direct_Command is empty after trimming whitespace, THEN THE Clippy_Agent SHALL start no Task.

### Requirement 5: Choosing Guide_Mode or Do_Mode

**User Story:** As a user, I want Clippy to either show me how or do it for me depending on how I ask, so that I can learn or save time.

#### Acceptance Criteria

1. WHEN a Chat_Request asks to be shown or taught how to do something, THE Clippy_Agent SHALL run the resulting Task in Guide_Mode.
2. WHEN a Chat_Request asks Clippy to carry out something, THE Clippy_Agent SHALL run the resulting Task in Do_Mode.
3. IF a Chat_Request that starts a Task asks for neither Guide_Mode nor Do_Mode, THEN THE Clippy_Agent SHALL run the Task in Guide_Mode.
4. WHEN a Task starts, THE Clippy_Agent SHALL show a Speech_Bubble message stating whether Clippy will guide the user or carry out the Task.
5. WHEN a new Task starts while another Task is running, THE Clippy_Agent SHALL end the running Task and remove the running Task's Outlines before the new Task's first Step.

### Requirement 6: Guide_Mode

**User Story:** As a user, I want Clippy to show me each step on screen, so that I learn how to do it myself.

#### Acceptance Criteria

1. WHEN a Guide_Mode Step begins, THE Clippy_Agent SHALL show an Outline around the Step's Target and a Speech_Bubble message of at most 200 characters explaining the Step.
2. WHILE a Guide_Mode Task is running, THE Clippy_Agent SHALL send no input through the Input_Controller.
3. WHEN the user clicks inside the current Step's Target, or the foreground window's UI changes, THE Clippy_Agent SHALL determine from a new UIA_Snapshot within 1000 milliseconds whether the Step is complete.
4. WHEN the Clippy_Agent determines a Guide_Mode Step is complete, THE Clippy_Agent SHALL remove the Step's Outline and begin the next Step.
5. WHEN the user clicks the Title_Bar's Skip button, THE Clippy_Agent SHALL treat the current Step as complete.
6. WHEN the user clicks the Title_Bar's Close button, THE Clippy_Agent SHALL end the Task and remove all Outlines.
7. IF a Guide_Mode Step stays incomplete for 5 minutes, or a Guide_Mode Task reaches 20 Steps, THEN THE Clippy_Agent SHALL end the Task and show a Speech_Bubble message stating why the Task ended.
8. WHEN the final Guide_Mode Step completes, THE Clippy_Agent SHALL show a Speech_Bubble message confirming that the Task is done.

### Requirement 7: Do_Mode

**User Story:** As a user, I want Clippy to carry out a task in my apps, so that I don't have to do it myself.

#### Acceptance Criteria

1. WHEN a Do_Mode Step begins, THE Clippy_Agent SHALL show an Outline around the Step's Target for at least 400 milliseconds before the Input_Controller performs the Step's Action.
2. WHEN a Do_Mode Step's Action is a click, double-click, or right-click, THE Input_Controller SHALL press the mouse button at the center of the Target's bounds.
3. WHEN a Do_Mode Step's Action is type text, press keys, or scroll, THE Input_Controller SHALL send the input to the window that contains the Target.
4. THE Input_Controller SHALL limit each type-text Action to 2000 characters.
5. WHEN a Do_Mode Action completes, THE Clippy_Agent SHALL produce a new UIA_Snapshot before choosing the next Step.
6. IF a Do_Mode Step's Target is missing from the latest UIA_Snapshot and Screenshot, THEN THE Clippy_Agent SHALL report the missing Target to the model and request a different Step, up to 3 times per Step, before ending the Task with a Speech_Bubble message.
7. IF a Do_Mode Task reaches 30 Steps, THEN THE Clippy_Agent SHALL end the Task and show a Speech_Bubble message stating that the Step limit was reached.
8. WHEN a Do_Mode Task completes, THE Clippy_Agent SHALL remove all Outlines and show a Speech_Bubble message of at most 200 characters summarizing the result.

### Requirement 8: Confirming risky actions

**User Story:** As a user, I want Clippy to ask before risky actions, so that he cannot send, delete, or buy something without my approval.

#### Acceptance Criteria

1. THE Clippy_Agent SHALL treat an Action as a Risky_Action when the model marks the Action as risky or when the Target's name contains a word from the Clippy_App's risky-word list.
2. WHEN the next Do_Mode Action is a Risky_Action, THE Clippy_Agent SHALL show a Confirmation_Prompt describing the Action before the Input_Controller performs the Action.
3. WHILE a Confirmation_Prompt is shown, THE Clippy_Agent SHALL keep the Risky_Action's Target outlined.
4. WHEN the user clicks Yes on a Confirmation_Prompt, THE Clippy_Agent SHALL perform the Risky_Action.
5. WHEN the user clicks No on a Confirmation_Prompt, THE Clippy_Agent SHALL end the Task without performing the Risky_Action.
6. IF the user answers a Confirmation_Prompt with neither Yes nor No within 30 seconds, THEN THE Clippy_Agent SHALL end the Task without performing the Risky_Action.

### Requirement 9: Interruption

**User Story:** As a user, I want Clippy to stop the moment I touch the mouse or keyboard, so that we never fight over control.

#### Acceptance Criteria

1. WHEN User_Input occurs during a Do_Mode Task, THE Clippy_Agent SHALL pause the Task within 200 milliseconds and send no further input through the Input_Controller while paused.
2. WHEN a Do_Mode Task pauses, THE Clippy_Agent SHALL show a Speech_Bubble message asking whether to continue, with Continue and Stop buttons.
3. WHEN the user clicks Continue, THE Clippy_Agent SHALL produce a new UIA_Snapshot and resume the Task from the screen state in that UIA_Snapshot.
4. WHEN the user clicks Stop, THE Clippy_Agent SHALL end the Task and remove all Outlines.
5. IF the user clicks neither Continue nor Stop within 60 seconds, THEN THE Clippy_Agent SHALL end the Task and remove all Outlines.

### Requirement 10: Pet movement

**User Story:** As a user, I want Clippy to walk over to what he is talking about, so that I can follow along.

#### Acceptance Criteria

1. WHEN an Outline for a Step or Tip appears, THE Pet SHALL move to a position on the Target's display whose bounds do not overlap the Target's bounds and lie inside the display's work area.
2. WHEN the Pet moves to a Target, THE Pet SHALL animate the move over 300 to 1000 milliseconds.
3. WHEN the Pet arrives next to a Target, THE Pet SHALL direct the Pet's gaze at the center of the Target's bounds.
4. IF every position next to the Target on the Target's display overlaps the Target, THEN THE Pet SHALL move to the corner of the display's work area farthest from the Target's center.
5. WHEN a Task ends, THE Pet SHALL return to the Home_Position.

### Requirement 11: Outlines

**User Story:** As a user, I want the control Clippy means to be framed clearly, so that I know exactly where to look.

#### Acceptance Criteria

1. WHEN the Clippy_Agent outlines a Target, THE Overlay SHALL draw an Outline whose inner edge lies within 4 pixels of the Target's bounds at every display scale factor.
2. THE Overlay SHALL draw each Outline in the Clippy_App's retro Win9x window style, with a transparent center that passes mouse input to the window beneath.
3. WHERE an Outline belongs to a Task Step, THE Title_Bar SHALL show the Step number and Step count, a description, a Skip button, and a Close button.
4. WHERE an Outline belongs to a Tip, THE Title_Bar SHALL show a description and a Close button.
5. IF a Title_Bar description exceeds 60 characters, THEN THE Overlay SHALL truncate the description to 60 characters ending in an ellipsis.
6. IF the space between the Target's top edge and the display's top edge is shorter than the Title_Bar's height, THEN THE Overlay SHALL draw the Title_Bar below the Target.
7. WHEN an outlined Target's bounds change, THE Overlay SHALL move the Outline to the new bounds within 250 milliseconds.
8. WHEN an Outline is removed, THE Overlay SHALL fade the Outline out over 150 to 300 milliseconds.

### Requirement 12: Messages and moods

**User Story:** As a user, I want Clippy's messages and reactions to appear on the Pet, so that help shows up right where he is.

#### Acceptance Criteria

1. WHEN the Clippy_Agent shows a message, THE Speech_Bubble SHALL display the message text inside the work area of the Pet's display.
2. WHEN a message includes buttons, THE Speech_Bubble SHALL show the buttons and report the clicked button to the Clippy_Agent.
3. WHILE a Task is running, THE Speech_Bubble SHALL keep the current Step's message visible until the next Step's message replaces it or the Task ends.
4. WHILE the Clippy_Agent waits for a model response, THE Pet SHALL show the thinking mood.

### Requirement 13: Proactive tips

**User Story:** As a user, I want Clippy to offer helpful tips on his own, so that I learn useful things without asking.

#### Acceptance Criteria

1. WHERE proactive Tips are enabled in Settings, THE Watcher SHALL evaluate each Trigger_Event by sending a UIA_Snapshot without a Screenshot to the Fast_Model, at most once every 30 seconds.
2. WHEN the Fast_Model judges a Tip worthwhile, THE Watcher SHALL request the Tip text from the Main_Model with a UIA_Snapshot and a Screenshot.
3. THE Watcher SHALL show at most one Tip per Tip_Interval.
4. THE Clippy_App SHALL let the user enable or disable proactive Tips in Settings, enabled by default, and set the Tip_Interval from 1 to 30 minutes in 1-minute increments, defaulting to 3 minutes.
5. WHILE a Task is running, the Pet is hidden, a Speech_Bubble message is visible, a Full_Screen_Window is in the foreground, or the selected Model_Provider has no saved API key, THE Watcher SHALL skip Trigger_Events.
6. WHERE a Tip offers a follow-up, THE Speech_Bubble SHALL show a Show-me button that starts a Guide_Mode Task for the Tip's subject.
7. WHEN the user closes a Tip, THE Watcher SHALL skip Tips about the same application for 30 minutes.
8. IF the user does not interact with a Tip for 15 seconds, THEN THE Speech_Bubble SHALL hide the Tip and THE Overlay SHALL remove the Tip's Outline.

### Requirement 14: Session memory

**User Story:** As a user, I want Clippy to remember our conversation while the app runs, so that I don't repeat myself, without keeping anything after I quit.

#### Acceptance Criteria

1. WHILE the Session is active, THE Clippy_Agent SHALL keep chat history, Task history, and closed-Tip records in memory.
2. THE Clippy_Agent SHALL keep UIA_Snapshots and Screenshots in memory and write neither to disk.
3. WHEN the Clippy_App exits, THE Clippy_Agent SHALL discard chat history, Task history, closed-Tip records, UIA_Snapshots, and Screenshots.
4. THE Clippy_Agent SHALL include at most the latest 40 chat messages in one model request.

### Requirement 15: Action validation

**User Story:** As a developer, I want every model-proposed Action validated before it runs, so that malformed or out-of-bounds Actions never reach the Input_Controller.

#### Acceptance Criteria

1. WHEN the Model_Provider returns an Action, THE Clippy_Agent SHALL validate the Action's type, parameters, and Target against the Action schema before running the Action.
2. IF an Action references a UI element identifier missing from the latest UIA_Snapshot, or a Target whose bounds lie outside all connected displays, THEN THE Clippy_Agent SHALL reject the Action.
3. IF an Action fails validation, THEN THE Clippy_Agent SHALL return a validation error to the model without running the Action, up to 3 times per Step, before ending the Task with a Speech_Bubble message.
4. THE Model_Provider SHALL convert Actions to and from the provider's tool-call format.
5. FOR ALL valid Actions, converting an Action to the provider's tool-call format and back SHALL produce an equal Action (round-trip property).

### Requirement 16: Platforms other than Windows

**User Story:** As a developer, I want the agent to run in a reduced form on macOS and Linux, so that I can work on the agent without a Windows machine.

#### Acceptance Criteria

1. WHILE the Clippy_App runs on macOS or Linux, THE Screen_Reader SHALL use Screenshots as the only source of screen content.
2. IF a Do_Mode Task starts while the Clippy_App runs on macOS or Linux, THEN THE Clippy_Agent SHALL end the Task and show a Speech_Bubble message stating that Do_Mode requires Windows.
3. WHILE the Clippy_App runs on macOS or Linux, THE Watcher SHALL stay inactive.
