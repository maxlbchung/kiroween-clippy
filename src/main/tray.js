import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

export function createTray({ iconDir, pet, panels, settings, onQuit }) {
  const file = process.platform === 'win32' ? 'icon.ico' : 'tray.png';
  const image = nativeImage.createFromPath(path.join(iconDir, file));
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Clippy');

  const build = () => {
    const hotkey = settings.data.voice.hotkey;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: pet.visible ? 'Hide Clippy' : 'Show Clippy', click: () => (pet.visible ? hidePet() : pet.show()) },
      { type: 'separator' },
      { label: 'Chat', click: () => panels.open('chat') },
      { label: 'Direct', accelerator: hotkey || undefined, click: () => panels.open('direct') },
      { label: 'Wardrobe', click: () => panels.open('customize') },
      { label: 'Arcade', click: () => panels.open('games') },
      { label: 'Settings', click: () => panels.open('settings') },
      { type: 'separator' },
      { label: 'Quit Clippy', click: onQuit },
    ]));
  };

  const hidePet = async () => {
    await panels.close();
    pet.hide();
  };

  tray.on('click', () => {
    if (!pet.visible) return pet.show();
    pet.win.focus(); // so clicking elsewhere closes the menu again
    pet.send('pet:toggle-menu');
  });
  pet.win?.on('show', build);
  pet.win?.on('hide', build);
  settings.on('change', build);
  build();
  return { tray, refresh: build, hidePet };
}
