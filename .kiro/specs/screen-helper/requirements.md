# Requirements Document

## Introduction

This feature separates talking from doing in the Clippy_Agent. The Chat_Agent talks with the user and hands every piece of on-screen work to a Helper through the Delegation_Action; the Chat_Agent sends no input itself. Each Do_Mode Task runs in exactly one Helper, which appears as a small baby Clippy that moves to each Target and acts there while the Pet waits at its Home_Position. While the Helper works, the Clippy_App takes over the user's mouse and keyboard so stray input cannot break the Task, and the Cancel_Key stops the Helper and returns control.

For Do_Mode Tasks, Requirements 4 and 5 of this document replace Requirement 9 (Interruption) and Requirement 19.4 of the clippy-agent requirements, and Requirement 3 of this document replaces Requirement 10 (Pet movement). Guide_Mode Tasks keep their existing behavior: the Pet walks to each Target and the user carries out each Step. Discarding input meant for elevated windows or the Windows secure desktop is out of scope.

## Glossary

Terms not listed here, such as Clippy_App, Clippy_Agent, Main_Model, Task, Step, Do_Mode, Guide_Mode, Target, Action, Input_Controller, Pet, Home_Position, Speech_Bubble, Overlay, Stop_Hotkey, Chat_Request, Direct_Command, Web_Lookup, Screenshot and Confirmation_Prompt, are defined in `.kiro/specs/clippy-agent/requirements.md`.

- **Chat_Agent**: The part of the Clippy_Agent that answers Chat_Requests with the Main_Model.
- **Delegation_Action**: The start-task Action, through which the Chat_Agent hands a goal and a mode to a new Task.
- **Helper**: The runner of one Do_Mode Task together with its on-screen character, a small Clippy figure drawn on the Overlay.
- **User_Event**: Any mouse or keyboard event that the Input_Controller did not send.
- **Takeover**: The state in which the Clippy_App discards User_Events while a Helper runs.
- **Cancel_Key**: The Esc key.
- **Takeover_Banner**: A message on the Overlay stating that Clippy has control of the mouse and keyboard and that the Cancel_Key stops the Helper.
- **User_Prompt**: A Confirmation_Prompt, or any other Speech_Bubble message with buttons that waits for the user's answer during a Do_Mode Task.

## Requirements

### Requirement 1: Chat delegates on-screen work

**User Story:** As a user, I want the chat to hand on-screen work to a helper, so that asking Clippy to do something gets it done instead of an explanation that he can't.

#### Acceptance Criteria

1. THE Chat_Agent SHALL limit the Actions offered to the Main_Model to the Delegation_Action, Web_Lookups, and Screenshot capture.
2. THE Chat_Agent SHALL state in the Main_Model's instructions that the Chat_Agent talks with the user and delegates all on-screen work through the Delegation_Action.
3. WHEN the Main_Model calls the Delegation_Action with a goal of 1 to 500 characters and the mode "do" or "guide", THE Chat_Agent SHALL start a Task with that goal and mode and end the Chat_Request's reply stream.
4. IF the Main_Model calls the Delegation_Action with an empty goal, a goal longer than 500 characters, or a mode other than "do" or "guide", THEN THE Chat_Agent SHALL return an error naming the invalid field to the Main_Model and start no Task.
5. WHEN a Task started by the Delegation_Action ends, THE Clippy_App SHALL restore the chat panel with a summary of the Task's result of at most 400 characters.

### Requirement 2: One helper at a time

**User Story:** As a user, I want only one helper controlling my screen at a time, so that two helpers never fight over the mouse and keyboard.

#### Acceptance Criteria

1. THE Clippy_Agent SHALL run at most one Task at any time.
2. WHEN a Task starts while another Task is running, THE Clippy_Agent SHALL end the running Task, remove the running Task's Helper, and end the running Task's Takeover before the new Task sends any input.
3. THE Overlay SHALL show at most one Helper at any time.

### Requirement 3: Baby Clippy helper

**User Story:** As a user, I want to see a small baby Clippy move around and carry out each step, so that I can follow what the helper is doing.

#### Acceptance Criteria

1. WHEN a Do_Mode Task starts, THE Overlay SHALL show the Helper within 50 pixels of the Pet's bounds, without overlapping them, at a height between 30% and 50% of the Pet's height.
2. WHEN a Do_Mode Step with a Target begins, THE Helper SHALL move to the center of the Target's bounds, animating the move over 150 to 600 milliseconds, before the Input_Controller performs the Step's Action.
3. WHEN the Input_Controller performs a click, type-text, press-keys, or scroll Action, THE Helper SHALL play the animation for that Action type, at the Target when the Action has a Target and at the Helper's current position otherwise.
4. THE Overlay SHALL pass mouse input on the Helper's bounds through to the window beneath the Helper.
5. WHILE a Do_Mode Task runs, THE Pet SHALL stay at the Home_Position.
6. WHEN a Do_Mode Task ends, THE Overlay SHALL remove the Helper within 500 milliseconds.

### Requirement 4: Screen takeover

**User Story:** As a user, I want Clippy to take over my mouse and keyboard while the helper works, so that my stray input can't break the task.

#### Acceptance Criteria

1. WHEN a Do_Mode Task starts, THE Clippy_App SHALL begin a Takeover before the Input_Controller sends the Task's first input.
2. WHILE a Takeover is active, THE Clippy_App SHALL discard every User_Event except presses of the Cancel_Key and the Stop_Hotkey.
3. WHILE a Takeover is active, THE Input_Controller SHALL deliver the Input_Controller's own mouse and keyboard input to the target windows.
4. WHILE a Takeover is active, THE Overlay SHALL show the Takeover_Banner on every connected display.
5. WHEN a Helper shows a User_Prompt, THE Clippy_App SHALL suspend the Takeover until the user answers the User_Prompt or the User_Prompt times out, and SHALL then resume the Takeover if the Task continues.
6. WHEN a Do_Mode Task ends, whether by finishing, failing, or being cancelled, THE Clippy_App SHALL end the Takeover within 200 milliseconds.
7. IF the Input_Controller receives no message from the Clippy_App for 10 seconds during a Takeover, THEN THE Input_Controller SHALL end the Takeover.
8. IF the Clippy_App fails to begin a Takeover, THEN THE Clippy_Agent SHALL end the Do_Mode Task before sending any input and show a Speech_Bubble message stating that Clippy could not take control of the mouse and keyboard.
9. WHILE the Input_Controller is carrying out another command, THE Input_Controller SHALL apply a Takeover start or end within 200 milliseconds of receiving it.

### Requirement 5: Cancelling with Esc

**User Story:** As a user, I want to press Esc to stop the helper, so that I can take back control at any moment.

#### Acceptance Criteria

1. WHEN the user presses the Cancel_Key during a Takeover, THE Clippy_Agent SHALL end the Do_Mode Task within 200 milliseconds and send no further input through the Input_Controller.
2. WHEN the user presses the Cancel_Key during a Takeover, THE Clippy_App SHALL withhold that Cancel_Key press from every other application.
3. WHEN the user presses the Stop_Hotkey during a Takeover, THE Clippy_Agent SHALL end the Do_Mode Task as for the Cancel_Key.
4. WHEN a Do_Mode Task ends through the Cancel_Key or the Stop_Hotkey, THE Clippy_Agent SHALL show a Speech_Bubble message stating that the Task was stopped.
5. WHEN a Do_Mode Task starts, THE Clippy_Agent SHALL name the Cancel_Key in the Task's first Speech_Bubble message.
6. WHILE no Takeover is active, THE Clippy_App SHALL pass Cancel_Key presses to the foreground application.

### Requirement 6: Auto mode

**User Story:** As a user, I want an auto mode, so that baby Clippy finishes tasks without stopping to ask me.

#### Acceptance Criteria

1. WHERE auto mode is on, THE Clippy_Agent SHALL perform Risky_Actions and Commands without showing a User_Prompt.
2. WHERE auto mode is on, THE Clippy_App SHALL keep the Takeover active for the whole Do_Mode Task.
3. THE Clippy_App SHALL keep auto mode off until the user turns it on in Settings.
