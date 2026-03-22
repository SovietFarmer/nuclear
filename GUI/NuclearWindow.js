import settings from "@/Core/Settings";
import colors from "@/Enums/Colors";
import AntiAFK from "@/Extra/AntiAFK";
import Autolooter from "@/Extra/Autolooter";
import Radar from "@/Extra/Radar";
import General from "@/Extra/General";
import ProfileSettings from "@/Extra/ProfileSettings";
import SpellQueueDisplay from "@/Extra/SpellQueueDisplay";
import PVP from "@/Extra/PVP";
import ESP from "@/Extra/ESP";
import ToastNotification from "@/Extra/ToastNotification";
import nuclear from "@/nuclear";
import { me } from "@/Core/ObjectManager";
import KeyBinding from "@/Core/KeyBinding";

class NuclearWindow {
  constructor() {
    this.show = new imgui.MutableVariable(false);
    this.modules = [General, SpellQueueDisplay, Radar, Autolooter, AntiAFK, ProfileSettings, PVP, ESP, ToastNotification];
    this.initialized = false;
    // Initialize state for each option from Settings
    this.state = {};
    this.modules.forEach(module => {
      module.options.forEach(option => {
        const settingValue = settings[option.uid];
        const defaultValue = option.default;
        this.state[option.uid] = new imgui.MutableVariable(settingValue !== undefined ? settingValue : defaultValue);
      });
    });
    // Color definitions
    this.colors = {
      headerColor: colors.blue,
      enabledColor: colors.green,
      disabledColor: colors.lightgrey
    };
    this.toggleBindInitialized = false;
  }

  tick() {
    if (!me) {
      return;
    }

    // Set default keybinding for toggling the window if not set yet
    if (!this.toggleBindInitialized) {
      KeyBinding.setDefault("toggleWindow", imgui.Key.Insert);
      this.toggleBindInitialized = true;
    }

    // Don't process key presses if we're in key binding mode
    if (!KeyBinding.isBinding() && KeyBinding.isPressed("toggleWindow")) {
      this.show.value = !this.show.value;
    }

    if (this.show.value) {
      this.render(this.show);
    }
  }

  initializeSettings() {
    if (this.initialized) {
      return;
    }

    const unsetOptions = this.modules
      .flatMap(module => module.options)
      .filter(option => !option.header && settings[option.uid] === undefined);

    if (unsetOptions.length > 0) {
      unsetOptions.forEach(option => {
        settings[option.uid] = option.default;
      });
      settings.saveSettings();
    }

    this.initialized = true;
  }

  render(open) {
    const mainViewport = imgui.getMainViewport();
    const workPos = mainViewport.workPos;
    imgui.setNextWindowPos({ x: workPos.x + 20, y: workPos.y + 20 }, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize({ x: 350, y: 450 }, imgui.Cond.FirstUseEver);

    imgui.pushStyleColor(imgui.Col.Text, [1.0, 1.0, 1.0, 1.0]);
    imgui.pushStyleColor(imgui.Col.WindowBg, [0.1, 0.1, 0.1, 0.9]);

    if (!imgui.begin("Nuclear", open)) {
      imgui.popStyleColor(2);
      imgui.end();
      return;
    }

    if (imgui.beginTabBar("NuclearTabs")) {
      this.modules.forEach(module => {
        if (imgui.beginTabItem(module.tabName)) {
          module.renderOptions(this.renderOptionsGroup.bind(this));
          imgui.endTabItem();
        }
      });

      // Add Keybindings tab
      if (imgui.beginTabItem("Keybindings")) {
        nuclear.renderKeybindingUI();
        imgui.endTabItem();
      }

      imgui.endTabBar();
    }

    imgui.popStyleColor(2);
    imgui.end();
  }

  renderOptionsGroup(groups) {
    groups.forEach(group => {
      imgui.pushStyleColor(imgui.Col.Header, this.colors.headerColor);
      if (imgui.collapsingHeader(group.header)) {
        imgui.popStyleColor();
        this.renderOptions(group.options);
      } else {
        imgui.popStyleColor();
      }
    });
  }

  renderOptions(options) {
    options.forEach(option => {
      if (option.header) {
        imgui.text(option.header);
        imgui.separator();
      } else {
        const settingValue = settings[option.uid];
        if (!this.state[option.uid]) {
          this.state[option.uid] = new imgui.MutableVariable(settingValue !== undefined ? settingValue : option.default);
        }
        if (option.type === "checkbox") {
          this.state[option.uid].value = settingValue !== undefined ? settingValue : option.default;
          imgui.pushStyleColor(imgui.Col.Text, this.state[option.uid].value ? this.colors.enabledColor : this.colors.disabledColor);
          if (imgui.checkbox(option.text, this.state[option.uid])) {
            settings[option.uid] = this.state[option.uid].value;
          }
          imgui.popStyleColor();
        } else if (option.type === "slider") {
          this.state[option.uid].value = settingValue !== undefined ? settingValue : option.default;
          if (imgui.sliderInt(option.text, this.state[option.uid], option.min, option.max)) {
            settings[option.uid] = this.state[option.uid].value;
          }
        } else if (option.type === "combobox") {
          this.state[option.uid].value = settingValue !== undefined ? settingValue : option.default;
          if (imgui.beginCombo(option.text, this.state[option.uid].value)) {
            const optionsArray = option.options || option.values;
            optionsArray.forEach(item => {
              const isSelected = (item === this.state[option.uid].value);
              if (imgui.selectable(item, isSelected)) {
                const oldValue = this.state[option.uid].value;
                this.state[option.uid].value = item;
                settings[option.uid] = item;
                if (option.uid === "profileSelector" && oldValue !== item) {
                  const specializationId = wow.SpecializationInfo.activeSpecializationId;
                  const profileKey = `profile${specializationId}`;
                  settings[profileKey] = item;
                  nuclear.rebuild();  // Call rebuild after changing the profile
                }
              }
              if (isSelected) {
                imgui.setItemDefaultFocus();
              }
            });
            imgui.endCombo();
          }
        } else if (option.type === "hotkey") {
          // Render the label text
          imgui.text(`${option.text}:`);
          imgui.sameLine();

          // Create unique ID for the button
          const buttonId = `##hotkey_${option.uid}`;

          // Render the hotkey binding UI
          KeyBinding.renderHotkeySetting(option.uid, settingValue, newValue => {
            // This callback is called when the binding changes
            // We don't need to store anything in settings as KeyBinding manages its own storage
          });
        }
      }
    });
  }
}

export default new NuclearWindow();
