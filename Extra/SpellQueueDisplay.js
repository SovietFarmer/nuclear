import CommandListener from "@/Core/CommandListener";
import Settings from "@/Core/Settings";
import colors from "@/Enums/Colors";

const TARGET_TYPES = ["target", "focus", "me"];

const SpellQueueDisplay = {
  tabName: "Spell Queue",

  options: [
    { type: "checkbox", uid: "SpellQueueSystemEnabled", text: "Enable spell queue (keybinds + on-screen queue)", default: true },
    { type: "slider", uid: "SpellQueueExpirationTimer", text: "Spell queue expiration (ms)", min: 2000, max: 5000, default: 3000 },
    { type: "slider", uid: "SpellCastDelay", text: "Spell cast delay (ms)", min: 0, max: 1000, default: 0 },
    { type: "checkbox", uid: "SpellDebugCompare", text: "Log default rotation comparison", default: false },
    { type: "slider", uid: "FailedCastPauseMs", text: "Failed cast pause duration (ms)", min: 0, max: 5000, default: 50 },
    { type: "checkbox", uid: "FailedCastPauseDebugLogs", text: "Failed cast pause debug logs", default: false }
  ],

  _slotInputs: {},

  _getSlotInputs(index, slot) {
    if (!this._slotInputs[index]) {
      this._slotInputs[index] = {
        spellName: new imgui.MutableVariable(slot.spellName || ""),
        targetIndex: new imgui.MutableVariable(Math.max(0, TARGET_TYPES.indexOf(slot.target)))
      };
    }
    return this._slotInputs[index];
  },

  _syncSlotInputs() {
    const slots = CommandListener.getSlots();
    const staleKeys = Object.keys(this._slotInputs).filter(k => parseInt(k) >= slots.length);
    staleKeys.forEach(k => delete this._slotInputs[k]);
  },

  renderOptions: function(renderOptionsGroup) {
    renderOptionsGroup([
      { header: "Spell queue", options: this.options.slice(0, 4) },
      { header: "When \"pause on failed casts\" is on (General tab)", options: this.options.slice(4, 6) }
    ]);

    imgui.spacing();

    if (!Settings.SpellQueueSystemEnabled) {
      imgui.textWrapped(
        "Spell queue is disabled above. Turn it on to use keybind slots, the overlay, and queued casts."
      );
      imgui.spacing();
    }

    if (imgui.collapsingHeader("Active Queue", imgui.TreeNodeFlags.DefaultOpen)) {
      const queuedSpells = CommandListener.spellQueue;

      if (queuedSpells.length === 0) {
        imgui.textColored([0.7, 0.7, 0.7, 1.0], "No spells in queue");
      } else {
        if (imgui.beginTable("##spellQueueTable", 4, imgui.TableFlags.Borders | imgui.TableFlags.RowBg)) {
          imgui.tableSetupColumn("#", imgui.TableColumnFlags.WidthFixed, 30);
          imgui.tableSetupColumn("Spell", imgui.TableColumnFlags.WidthStretch);
          imgui.tableSetupColumn("Target", imgui.TableColumnFlags.WidthFixed, 60);
          imgui.tableSetupColumn("", imgui.TableColumnFlags.WidthFixed, 30);
          imgui.tableHeadersRow();

          queuedSpells.forEach((spell, index) => {
            imgui.tableNextRow();
            imgui.tableSetColumnIndex(0);
            imgui.text(`${index + 1}`);
            imgui.tableSetColumnIndex(1);
            imgui.textColored([0.2, 0.8, 1.0, 1.0], spell.spellName);
            imgui.tableSetColumnIndex(2);
            imgui.text(spell.target);
            imgui.tableSetColumnIndex(3);
            if (imgui.button(`X##rem${index}`, { x: 22, y: 20 })) {
              CommandListener.removeSpellFromQueue(spell.spellName);
            }
          });

          imgui.endTable();
        }

        if (imgui.button("Clear Queue", { x: 100, y: 25 })) {
          CommandListener.clearQueue();
        }
      }
    }

    imgui.spacing();

    if (imgui.collapsingHeader("Spell Queue Slots (Character-Specific)", imgui.TreeNodeFlags.DefaultOpen)) {
      imgui.textWrapped("Configure keybinds to queue spells. Press the key in-game to queue the spell on the selected target.");
      imgui.spacing();

      const slots = CommandListener.getSlots();
      this._syncSlotInputs();

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const inputs = this._getSlotInputs(i, slot);

        imgui.pushID(`slot${i}`);
        imgui.separator();
        imgui.text(`Slot ${i + 1}`);

        imgui.text("Key:");
        imgui.sameLine();
        CommandListener.renderSlotKeyBinding(i);

        imgui.text("Target:");
        imgui.sameLine();
        imgui.setNextItemWidth(100);
        if (imgui.combo("##target", inputs.targetIndex, TARGET_TYPES)) {
          CommandListener.updateSlot(i, { target: TARGET_TYPES[inputs.targetIndex.value] });
        }

        imgui.text("Spell:");
        imgui.sameLine();
        imgui.setNextItemWidth(160);
        if (imgui.inputText("##spell", inputs.spellName)) {
          CommandListener.updateSlot(i, { spellName: inputs.spellName.value });
        }

        imgui.sameLine();
        if (imgui.button("Remove")) {
          CommandListener.removeSlot(i);
          delete this._slotInputs[i];
          this._syncSlotInputs();
        }

        imgui.popID();
      }

      imgui.spacing();
      imgui.separator();
      imgui.spacing();

      if (slots.length < 20) {
        if (imgui.button("+ Add Slot", { x: 100, y: 25 })) {
          CommandListener.addSlot();
        }
      } else {
        imgui.textColored([0.7, 0.7, 0.7, 1.0], "Maximum 20 slots reached");
      }

      if (CommandListener.isBindingSlot !== null) {
        imgui.spacing();
        imgui.pushStyleColor(imgui.Col.Text, [1.0, 0.8, 0.0, 1.0]);
        imgui.text("Press a key combination to bind (ESC to cancel)...");
        imgui.popStyleColor();
      }
    }
  }
};

export default SpellQueueDisplay;
