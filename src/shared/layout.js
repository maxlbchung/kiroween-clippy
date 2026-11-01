// Geometry shared by the main process (window placement) and renderers (drawing).
// All values are CSS pixels at pet scale 1.

export const PET = {
  width: 300,
  height: 372,
  // Clippy's <svg> box. viewBox is "0 -40 200 320", so 1 unit = 0.7px.
  svg: { left: 80, top: 90, width: 140, height: 224 },
  // Radial menu, centred on Clippy's body.
  ring: { cx: 150, cy: 220, rx: 116, ry: 136, button: 54 },
  // Visible body box, used for screen clamping and panel placement.
  body: { x: 118, y: 136, width: 64, height: 168 },
  // Eye level, where speech-bubble tails point.
  eyeY: 189,
};

export const PET_SCALES = [0.8, 1, 1.25];

// Transparent padding around every panel (room for shadows and the bubble tail).
export const PANEL_PAD = 22;
export const PANEL_TAIL = 18;

export const PANELS = {
  chat: { width: 340, height: 440, kind: 'bubble', title: 'Chat' },
  // Direct never takes focus: the app you're talking about must stay in front.
  direct: { width: 300, height: 178, kind: 'bubble', title: 'Direct', focus: false },
  customize: { width: 560, height: 420, kind: 'window', title: 'Wardrobe' },
  games: { width: 400, height: 336, kind: 'window', title: "Clippy's Arcade" },
  settings: { width: 480, height: 490, kind: 'window', title: 'Settings' },
};

// Radial menu items, clockwise from the top.
export const MENU = [
  { id: 'chat', label: 'Chat', angle: -90, color: '#2f7cf6' },
  { id: 'direct', label: 'Direct', angle: -18, color: '#e5484d' },
  { id: 'games', label: 'Games', angle: 54, color: '#30a46c' },
  { id: 'settings', label: 'Settings', angle: 126, color: '#8b8d98' },
  { id: 'customize', label: 'Customize', angle: 198, color: '#8e4ec6' },
];
