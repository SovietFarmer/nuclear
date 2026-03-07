import objMgr, { me } from './Core/ObjectManager';
import dbgWindow from './Debug/DebugWindow';
import perfMgr from './Debug/PerfMgr';
import nuclear from './nuclear';
import extensions from './Extensions/Extensions';
import data from './Data/Data';
import nuclearWindow from './GUI/NuclearWindow';
import Settings from './Core/Settings';
import Radar from './Extra/Radar';
import Autolooter from './Extra/Autolooter';
import AntiAFK from './Extra/AntiAFK';
import General from './Extra/General';
import PVP from './Extra/PVP';
import ESP from './Extra/ESP';
import ToastNotification from './Extra/ToastNotification';
import commandListener from './Core/CommandListener';
import colors from './Enums/Colors';
import KeyBinding from './Core/KeyBinding';

let pauseCore = false;

const extraModules = [General, Radar, Autolooter, AntiAFK, PVP, ESP, ToastNotification];

// Set up default keybinding for pausing the core
KeyBinding.setDefault("pauseCore", imgui.Key.Pause);

nuclear.initialize().then(() => {
  // our "main loop", called every tick
  setInterval(_ => {
    // Don't process key presses if we're in key binding mode
    if (!KeyBinding.isBinding() && KeyBinding.isPressed("pauseCore")) {
      pauseCore = !pauseCore;
    }

    if (pauseCore) {
      imgui.getBackgroundDrawList()?.addText("PAUSED", {x: 20, y: 20}, colors.red);
      return;
    }

    perfMgr.begin("total");
    objMgr.tick();
    nuclear.tick();
    commandListener.tick();
    me && extraModules.forEach(module => module.tick());
    dbgWindow.tick();
    commandListener.renderQueuedSpells();
    nuclearWindow.tick();
    perfMgr.end("total");
    perfMgr.render();
  }, 1);

  console.info("Nuclear initialized");
}).catch(reason => {
  console.error(`${reason}`);
  console.error(`${reason.stack}`);
});
