import Spell from './Spell';
import { me } from './ObjectManager';
import Settings from './Settings';
import colors from '@/Enums/Colors';

const MAX_SPELL_QUEUE_SLOTS = 20;
const TARGET_TYPES = ["target", "focus", "me"];

class CommandListener {
  constructor() {
    this.spellQueue = [];
    this.targetFunctions = {
      me: () => me,
      focus: () => me.focusTarget,
      target: () => me.targetUnit
    };
    this.isBindingSlot = null;
    this.bindingModifiers = { ctrl: false, shift: false };
    this._lastFailedTime = {};
  }

  getSlots() {
    return Settings.SpellQueueSlots || [];
  }

  saveSlots(slots) {
    Settings.SpellQueueSlots = slots;
  }

  ensureSlotCount(count) {
    const slots = this.getSlots();
    while (slots.length < count) {
      slots.push({ key: imgui.Key.None, modifiers: { ctrl: false, shift: false }, target: "target", spellName: "" });
    }
    this.saveSlots(slots);
    return slots;
  }

  updateSlot(index, changes) {
    const slots = this.getSlots();
    if (index < 0 || index >= slots.length) return;
    slots[index] = { ...slots[index], ...changes };
    this.saveSlots(slots);
  }

  addSlot() {
    const slots = this.getSlots();
    if (slots.length >= MAX_SPELL_QUEUE_SLOTS) return false;
    slots.push({ key: imgui.Key.None, modifiers: { ctrl: false, shift: false }, target: "target", spellName: "" });
    this.saveSlots(slots);
    return true;
  }

  removeSlot(index) {
    const slots = this.getSlots();
    if (index < 0 || index >= slots.length) return;
    slots.splice(index, 1);
    this.saveSlots(slots);
  }

  tick() {
    if (!me) return;
    if (this.isBindingSlot !== null) return;

    const slots = this.getSlots();
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.spellName || slot.key === imgui.Key.None) continue;

      const ctrlDown = imgui.isKeyDown(imgui.Key.LeftCtrl) || imgui.isKeyDown(imgui.Key.RightCtrl);
      const shiftDown = imgui.isKeyDown(imgui.Key.LeftShift) || imgui.isKeyDown(imgui.Key.RightShift);

      if ((slot.modifiers?.ctrl || false) !== ctrlDown) continue;
      if ((slot.modifiers?.shift || false) !== shiftDown) continue;

      if (imgui.isKeyPressed(slot.key, false)) {
        this.queueFromSlot(slot);
      }
    }

    if (this.spellQueue.length > 0) {
      this.processQueuedSpell();
    }
  }

  handleFailedCast(eventData) {
    if (!me) return;
    if (me.isMounted) return;
    if (!eventData.source || !eventData.source.guid.equals(me.guid)) return;

    const spellId = eventData.args?.[0];
    if (!spellId) return;

    const botCastTime = Spell._lastCastTimes?.get(spellId);
    if (botCastTime && (wow.frameTime - botCastTime) < 500) return;

    const spell = new wow.Spell(spellId);
    if (!spell || !spell.name) return;

    const now = wow.frameTime;
    if (this._lastFailedTime[spellId] && (now - this._lastFailedTime[spellId]) < 500) return;
    this._lastFailedTime[spellId] = now;

    const spellName = spell.name.toLowerCase();

    const knownSpell = Spell.getSpell(spellName);
    if (!knownSpell || !knownSpell.isKnown) return;

    if (knownSpell.cooldown && knownSpell.cooldown.timeleft > 1500) return;

    const target = this.resolveTarget(eventData.destination, spellName, knownSpell);

    const targetUnit = this.targetFunctions[target]?.();
    if (!targetUnit) return;

    this.addSpellToQueue({
      target,
      spellName,
      spellId: knownSpell.id,
      fromFailedCast: true
    });
  }

  resolveTarget(destination, spellName, knownSpell) {
    // 1. User-configured slot (explicit intent — handles focus, self, ground-targeted)
    const slots = this.getSlots();
    const matchingSlot = slots.find(s => s.spellName && s.spellName.toLowerCase() === spellName);
    if (matchingSlot) return matchingSlot.target;

    // 2. CLEU destination GUID (available when bot is paused)
    if (destination?.guid && destination.guid.toString() !== "0:0 (0)") {
      if (me.guid.equals(destination.guid)) return "me";
      if (me.focusTarget?.guid?.equals(destination.guid)) return "focus";
      return "target";
    }

    // 3. PBAoE / self-buff: 0 range + not melee (Blinding Sleet, etc.)
    if (knownSpell && knownSpell.baseMaxRange === 0 && !knownSpell.usesMeleeRange) {
      return "me";
    }

    // 4. Default — most player-initiated failed casts are offensive
    return "target";
  }

  queueFromSlot(slot) {
    const target = slot.target;
    const spellName = slot.spellName.toLowerCase();

    if (!this.targetFunctions[target]) {
      console.info(`Invalid target type: ${target}`);
      return;
    }

    if (!this.targetFunctions[target]()) {
      console.info(`${target} does not exist. Cannot queue spell.`);
      return;
    }

    const spell = Spell.getSpell(spellName);
    if (!spell || !spell.isKnown) {
      console.info(`Spell ${spellName} is not known. Cannot queue.`);
      return;
    }

    if (spell.cooldown && spell.cooldown.timeleft > 2000) {
      console.info(`Spell ${spellName} is on cooldown. Cannot queue.`);
      return;
    }

    this.addSpellToQueue({ target, spellName, spellId: spell.id });
    this.processQueuedSpell();
  }

  addSpellToQueue(spellInfo) {
    if (this.spellQueue.some(spell => spell.spellId === spellInfo.spellId)) {
      return false;
    }
    this.spellQueue.push({ ...spellInfo, timestamp: wow.frameTime });
    console.info(`[SpellQueue] Added: ${spellInfo.spellName} on ${spellInfo.target}${spellInfo.fromFailedCast ? " [failed cast]" : " [keybind]"}`);
    return true;
  }

  getNextQueuedSpell() {
    const currentTime = wow.frameTime;
    const defaultExpiry = Settings.SpellQueueExpirationTimer || 5000;
    const failedCastExpiry = 3000;

    this.spellQueue = this.spellQueue.filter(spell => {
      const expiry = spell.fromFailedCast ? failedCastExpiry : defaultExpiry;
      return spell.timestamp >= currentTime - expiry;
    });

    return this.spellQueue[0] || null;
  }

  processQueuedSpell() {
    const spellInfo = this.getNextQueuedSpell();
    if (spellInfo) {
      const targetFunction = this.targetFunctions[spellInfo.target];
      if (!targetFunction) {
        console.error(`Invalid target type: ${spellInfo.target}`);
        return;
      }

      Spell.cast(spellInfo.spellName, targetFunction).tick({});
    }
  }

  removeSpellFromQueue(spellName) {
    const had = this.spellQueue.some(spell => spell.spellName === spellName);
    this.spellQueue = this.spellQueue.filter(spell => spell.spellName !== spellName);
    if (had) console.info(`[SpellQueue] Removed: ${spellName}`);
  }

  clearQueue() {
    if (this.spellQueue.length === 0) return;
    console.info(`[SpellQueue] Cleared ${this.spellQueue.length} spell(s)`);
    this.spellQueue.length = 0;
  }

  renderQueuedSpells() {
    if (this.spellQueue.length === 0) return;

    const drawList = imgui.getBackgroundDrawList();
    if (!drawList) return;

    const viewport = imgui.getMainViewport();
    const pos = {
      x: viewport.workPos.x + viewport.workSize.x * 0.35,
      y: viewport.workPos.y + viewport.workSize.y * 0.20
    };

    let text = "Queued Spells:\n";
    this.spellQueue.forEach((spell, index) => {
      text += `${index + 1}. ${spell.spellName} on ${spell.target}\n`;
    });

    drawList.addText(text, pos, colors.green);
  }

  formatSlotKey(slot) {
    if (!slot || slot.key === imgui.Key.None) return "Not Set";
    let display = "";
    if (slot.modifiers?.ctrl) display += "Ctrl+";
    if (slot.modifiers?.shift) display += "Shift+";
    display += imgui.getKeyName(slot.key);
    return display;
  }

  renderSlotKeyBinding(slotIndex) {
    const slots = this.getSlots();
    const slot = slots[slotIndex];
    if (!slot) return;

    const isBinding = this.isBindingSlot === slotIndex;
    const buttonText = isBinding ? "Press a key..." : this.formatSlotKey(slot);

    if (imgui.button(`${buttonText}##sqkey${slotIndex}`)) {
      this.isBindingSlot = slotIndex;
      this.bindingModifiers = { ctrl: false, shift: false };
    }

    imgui.sameLine();
    if (imgui.button(`Clear##sqclear${slotIndex}`)) {
      this.updateSlot(slotIndex, { key: imgui.Key.None, modifiers: { ctrl: false, shift: false } });
    }

    if (isBinding) {
      this.bindingModifiers.ctrl = imgui.isKeyDown(imgui.Key.LeftCtrl) || imgui.isKeyDown(imgui.Key.RightCtrl);
      this.bindingModifiers.shift = imgui.isKeyDown(imgui.Key.LeftShift) || imgui.isKeyDown(imgui.Key.RightShift);

      for (const keyName in imgui.Key) {
        const keyValue = imgui.Key[keyName];
        if (typeof keyValue !== 'number') continue;
        if (!imgui.isKeyPressed(keyValue, false)) continue;

        if (keyValue === imgui.Key.Escape) {
          this.isBindingSlot = null;
          return;
        }

        if (keyValue === imgui.Key.LeftCtrl || keyValue === imgui.Key.RightCtrl ||
            keyValue === imgui.Key.LeftShift || keyValue === imgui.Key.RightShift) {
          continue;
        }

        this.updateSlot(slotIndex, { key: keyValue, modifiers: { ...this.bindingModifiers } });
        this.isBindingSlot = null;
        return;
      }
    }
  }
}

const commandListener = new CommandListener();

class FailedCastListener extends wow.EventListener {
  onEvent(event) {
    if (event.name !== "COMBAT_LOG_EVENT_UNFILTERED") return;
    const [eventData] = event.args;

    if (eventData.eventType === 7 && Settings.AutoQueueFailedCasts) {
      commandListener.handleFailedCast(eventData);
    }
  }
}

new FailedCastListener();

export default commandListener;
