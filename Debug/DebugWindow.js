import nuclear from '@/nuclear';
import objMgr, { me } from '../Core/ObjectManager';
import Settings from "../Core/Settings";
import { renderBehaviorTree } from './BehaviorTreeDebug';
import PerfMgr from './PerfMgr';
import KeyBinding from '@/Core/KeyBinding';

class DebugWindow {
  constructor() {
    this.show = new imgui.MutableVariable(false);
    this.displayPerfMgr = new imgui.MutableVariable(false);
    this.selected = null;
    this.selectedSpell = null;
    this.toggleBindInitialized = false;
  }

  tick() {
    // Set default keybinding for toggling the debug window if not set yet
    if (!this.toggleBindInitialized) {
      KeyBinding.setDefault("toggleDebug", imgui.Key.F12);
      this.toggleBindInitialized = true;
    }

    // Don't process key presses if we're in key binding mode
    if (!KeyBinding.isBinding() && KeyBinding.isPressed("toggleDebug")) {
      this.show.value = !this.show.value;
    }

    if (this.show.value) {
      this.render(this.show);
    }
  }

  render(open) {
    const mainViewport = imgui.getMainViewport();
    const workPos = mainViewport.workPos;
    imgui.setNextWindowPos({ x: workPos.x + 20, y: workPos.y + 20 }, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize({ x: 550, y: 480 }, imgui.Cond.FirstUseEver);

    if (!imgui.begin("Debug", open)) {
      imgui.end();
      return;
    }

    if (imgui.checkbox("Display Performance", this.displayPerfMgr)) {
      PerfMgr.enabled = this.displayPerfMgr.value;
    }

    if (imgui.beginTabBar("debugTabs")) {
      if (imgui.beginTabItem("ObjectManager")) {
        this.renderObjectManager();
        imgui.endTabItem();
      }

      if (imgui.beginTabItem("GameUI")) {
        this.renderGameUI();
        imgui.endTabItem();
      }

      if (imgui.beginTabItem("SpellBook")) {
        this.renderSpellBook();
        imgui.endTabItem();
      }

      if (imgui.beginTabItem("Specialization Info")) {
        this.renderSpecializationInfo();
        imgui.endTabItem();
      }

      if (imgui.beginTabItem("Party Info")) {
        this.renderPartyInfo();
        imgui.endTabItem();
      }

      if (imgui.beginTabItem("Behaviors")) {
        if (nuclear.behaviorRoot) {
          renderBehaviorTree(nuclear.behaviorRoot);
        }
        imgui.endTabItem();
      }

      if (imgui.beginTabItem("Dump")) {
        this.renderDump();
        imgui.endTabItem();
      }
    }

    imgui.end();
  }

  renderObjectManager() {
    imgui.beginChild("object list", { x: 150, y: 0 });
    /** @type {Map<wow.ObjectTypeID, Array<wow.CGObject>>} */
    let sortedObjects = new Map();
    for (const typename in wow.ObjectTypeID) {
      const id = wow.ObjectTypeID[typename];
      sortedObjects.set(id, new Array());
    }
    objMgr.objects.forEach(obj => sortedObjects.get(obj.type).push(obj));
    for (const typename in wow.ObjectTypeID) {
      const id = wow.ObjectTypeID[typename];
      const objects = sortedObjects.get(id);
      if (objects.length === 0) {
        continue;
      }
      objects.sort((a, b) => a.unsafeName < b.unsafeName);
      if (imgui.treeNode(`${typename}`)) {
        objects.forEach(obj => {
          const guid = obj.guid;
          if (imgui.selectable(`${obj.unsafeName}##${guid.hash}`, this.selected && this.selected == guid.hash)) {
            this.selected = guid.hash;
          }
        });

        imgui.treePop();
      }
    }

    const object = this.selected ? objMgr.objects.get(this.selected) : undefined;
    if (object === undefined) {
      this.selected = null;
    }
    imgui.endChild();
    imgui.sameLine();

    imgui.beginGroup();
    imgui.beginChild("object info", { x: 0, y: -imgui.getFrameHeightWithSpacing() });
    if (object) {
      imgui.text(`${object.constructor.name}: ${object.unsafeName} 0x${object.baseAddress.toString(16)}`);
      imgui.sameLine();
      if (imgui.button("Copy base")) {
        imgui.setClipboardText(`0x${object.baseAddress.toString(16)}`);
      }
      if (imgui.button("Target")) {
        wow.GameUI.setTarget(object);
      }
      const screenCoordinates = wow.WorldFrame.getScreenCoordinates(object.position);
      if (screenCoordinates) {
        const x = parseInt(screenCoordinates.x.toString());
        imgui.text(`screen coordinates: <${x}, ${screenCoordinates.y}, ${screenCoordinates.z}>`);
      }
      imgui.separator();
      if (imgui.beginTable("data", 2)) {
        imgui.tableSetupColumn('key', imgui.TableColumnFlags.WidthFixed);
        imgui.tableSetupColumn('value', imgui.TableColumnFlags.WidthStretch);
        imgui.tableHeadersRow();
        Object.getOwnPropertyNames(Object.getPrototypeOf(object)).forEach(prop => {
          try {
            if (prop === 'constructor') {
              return;
            }
            imgui.tableNextRow();
            imgui.tableNextColumn();
            imgui.text(prop);
            imgui.tableNextColumn();

            const val = object[prop];
            if (typeof val === 'object') {
              imgui.text(JSON.stringify(val, (k, v) => {
                if (typeof v === 'bigint') {
                  return '0x' + v.toString(16);
                }
                return v;
              }, 2));
            } else {
              imgui.text(`${val}`);
            }
          } catch (e) {
            imgui.text(e.message);
          }
        });
        imgui.endTable();
      }
    }
    imgui.endChild();
    imgui.endGroup();
  }

  renderGameUI() {
    if (imgui.beginTable("CGGameUI##data", 2)) {
      imgui.tableSetupColumn('key', imgui.TableColumnFlags.WidthFixed);
      imgui.tableSetupColumn('value', imgui.TableColumnFlags.WidthStretch);
      imgui.tableHeadersRow();
      Object.keys(wow.GameUI).forEach(prop => {
        try {
          if (prop === 'constructor') {
            return;
          }
          imgui.tableNextRow();
          imgui.tableNextColumn();
          imgui.text(prop);
          imgui.tableNextColumn();

          const val = wow.GameUI[prop];
          if (typeof val === 'object') {
            imgui.text(JSON.stringify(val, (k, v) => {
              if (typeof v === 'bigint') {
                return '0x' + v.toString(16);
              }
              return v;
            }, 2));
          } else {
            imgui.text(`${val}`);
          }
        } catch (e) {
          imgui.text(e.message);
        }
      });
      imgui.endTable();
    }
  }

  renderSpellBook() {
    const playerSpells = wow.SpellBook.playerSpells;
    const petSpells = wow.SpellBook.petSpells;
    imgui.beginChild("spell list", { x: 200, y: 0 });
    if (playerSpells.length > 0) {
      if (imgui.treeNode("Player spells")) {
        playerSpells.forEach(spell => {
          if (imgui.selectable(`${spell.name}##${spell.id}`)) {
            this.selectedSpell = spell;
          }
        });
        imgui.treePop();
      }
    }
    if (petSpells.length > 0) {
      if (imgui.treeNode("Pet spells")) {
        petSpells.forEach(spell => {
          if (imgui.selectable(`${spell.name} (${spell.id})##${spell.id}`)) {
            this.selectedSpell = spell;
          }
        });
        imgui.treePop();
      }
    }
    imgui.endChild();
    imgui.sameLine();

    imgui.beginGroup();
    imgui.beginChild("spell info", { x: 0, y: -imgui.getFrameHeightWithSpacing() });
    const spell = this.selectedSpell;
    if (spell) {
      imgui.text(`${spell.constructor.name}: ${spell.name}`);
      imgui.separator();
      if (imgui.beginTable("data", 2)) {
        imgui.tableSetupColumn('key', imgui.TableColumnFlags.WidthFixed);
        imgui.tableSetupColumn('value', imgui.TableColumnFlags.WidthStretch);
        imgui.tableHeadersRow();
        Object.getOwnPropertyNames(Object.getPrototypeOf(spell)).forEach(prop => {
          try {
            if (prop === 'constructor') {
              return;
            }
            imgui.tableNextRow();
            imgui.tableNextColumn();
            imgui.text(prop);
            imgui.tableNextColumn();

            const val = spell[prop];
            if (typeof val === 'object') {
              imgui.text(JSON.stringify(val, (k, v) => {
                if (typeof v === 'bigint') {
                  return '0x' + v.toString(16);
                }
                return v;
              }, 2));
            } else {
              imgui.text(`${val}`);
            }
          } catch (e) {
            imgui.text(e.message);
          }
        });
        imgui.endTable();
      }
    }
    imgui.endChild();
    imgui.endGroup();
  }

  renderSpecializationInfo() {
    const specInfo = new wow.SpecializationInfo;
    if (imgui.beginTable("SpecializationInfo##data", 2)) {
      imgui.tableSetupColumn('key', imgui.TableColumnFlags.WidthFixed);
      imgui.tableSetupColumn('value', imgui.TableColumnFlags.WidthStretch);
      imgui.tableHeadersRow();

      Object.keys(wow.SpecializationInfo).forEach(prop => {
        try {
          if (prop === 'constructor') {
            return;
          }
          imgui.tableNextRow();
          imgui.tableNextColumn();
          imgui.text(prop);
          imgui.tableNextColumn();

          const val = wow.SpecializationInfo[prop];
          if (typeof val === 'object') {
            imgui.text(JSON.stringify(val, (k, v) => {
              if (typeof v === 'bigint') {
                return '0x' + v.toString(16);
              }
              return v;
            }, 2));
          } else {
            imgui.text(`${val}`);
          }
        } catch (e) {
          imgui.text(e.message);
        }
      });
      imgui.endTable();
    }
  }

  renderPartyInfo() {
    const party = wow.Party.currentParty;
    if (!party) {
      imgui.text("No party");
      return;
    }
    if (imgui.beginTable("Party##data", 2)) {
      imgui.tableSetupColumn('key', imgui.TableColumnFlags.WidthFixed);
      imgui.tableSetupColumn('value', imgui.TableColumnFlags.WidthStretch);
      imgui.tableHeadersRow();

      Object.getOwnPropertyNames(Object.getPrototypeOf(party)).forEach(prop => {
        try {
          if (prop === 'constructor') {
            return;
          }
          imgui.tableNextRow();
          imgui.tableNextColumn();
          imgui.text(prop);
          imgui.tableNextColumn();

          const val = party[prop];
          if (typeof val === 'object') {
            imgui.text(JSON.stringify(val, (k, v) => {
              if (typeof v === 'bigint') {
                return '0x' + v.toString(16);
              }
              return v;
            }, 2));
          } else {
            imgui.text(`${val}`);
          }
        } catch (e) {
          imgui.text(e.message);
        }
      });
      imgui.endTable();
    }
  }
  renderDump() {
    imgui.text("One-shot dumps to console log:");
    imgui.separator();

    if (imgui.button("Dump Player Auras")) {
      if (me && me.auras && me.auras.length > 0) {
        console.info('=== PLAYER AURAS ===');
        me.auras.forEach(aura => {
          console.info(`Aura ID: ${aura.spellId}, Name: ${aura.name || 'Unknown'}, Stacks: ${aura.stacks || 1}, Remaining: ${aura.remaining}ms`);
        });
        console.info('=== END PLAYER AURAS ===');
      } else {
        console.info('No player or no auras found');
      }
    }

    if (imgui.button("Dump Target Auras")) {
      const target = me ? me.targetUnit : null;
      if (target) {
        console.info(`=== TARGET AURAS (${target.unsafeName}) ===`);
        console.info(`type: ${target.type} | isPlayer: ${target.isPlayer()} | klass: ${target.klass} | creatureType: ${target.creatureType} | summonedBy: ${target.summonedBy}`);
        if (target.auras && target.auras.length > 0) {
          target.auras.forEach(aura => {
            console.info(`Aura ID: ${aura.spellId}, Name: ${aura.name || 'Unknown'}, Stacks: ${aura.stacks || 1}, Remaining: ${aura.remaining}ms`);
          });
        } else {
          console.info('No auras found');
        }
        console.info('=== END TARGET AURAS ===');
      } else {
        console.info('No target found');
      }
    }

    if (imgui.button("Dump Target Data")) {
      const target = me ? me.targetUnit : null;
      if (target) {
        console.info(`=== TARGET DATA (${target.unsafeName}) ===`);
        Object.getOwnPropertyNames(Object.getPrototypeOf(target)).forEach(key => {
          try {
            const val = target[key];
            if (typeof val === 'function') return;
            console.info(`${key}: ${JSON.stringify(val, (k, v) => typeof v === 'bigint' ? '0x' + v.toString(16) : v)}`);
          } catch (e) {
            console.info(`${key}: [error reading]`);
          }
        });
        console.info('=== END TARGET DATA ===');
      } else {
        console.info('No target found');
      }
    }
  }
}

export default new DebugWindow;
