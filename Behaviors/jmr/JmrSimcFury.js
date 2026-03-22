import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";
import drTracker from "@/Core/DRTracker";
import pvpData, { pvpHelpers, pvpReflect, pvpInterrupts } from "@/Data/PVPData";
import { drHelpers } from "@/Data/PVPDRList";
import KeyBinding from "@/Core/KeyBinding";

export class JmrSimcFuryBehavior extends Behavior {
  name = "Jmr SimC Warrior Fury";
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Fury;
  version = 1;
  
  // Runtime toggles for overlay (independent of settings)
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(false),
    interrupts: new imgui.MutableVariable(true),
    recklessness: new imgui.MutableVariable(true),
    avatar: new imgui.MutableVariable(true),
    pummel: new imgui.MutableVariable(true),
    stormBolt: new imgui.MutableVariable(true)
  };

  // Burst mode toggle state
  burstModeActive = false;
  
  // Burst toggle system
  burstToggleTime = 0;
  
  constructor() {
    super();
    // Initialize the burst toggle keybinding with default
    KeyBinding.setDefault("BurstToggleKeybind", imgui.Key.F1);
  }
  
  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("1161");
  
  // Timing trackers (now using Spell.js _lastSuccessfulCastTimes instead)

  // Spell cycling system
  spellList = [
    355, 1161, 6795, 23687, 24275, 26679, 31790, 51399, 51723, 56222, 60443, 62124, 64382, 70075, 71170, 73602, 73604, 73613, 73614, 73631, 73711, 73755, 73838, 74103, 74113, 74916, 75100, 75849, 75891, 76990, 77011, 77384, 77391, 77435, 77856, 78027, 78716, 78952, 79045, 79130, 82747, 82845, 84350, 84689, 84690, 84764, 85247, 85589, 85667, 85705, 89087, 92833, 93530, 93686, 94659, 96150, 96504, 99351, 99353, 100950, 101518, 103397, 103436, 103443, 104461, 114014, 114420, 116189, 118635, 122719, 122875, 122960, 133085, 137576, 145058, 145422, 156151, 156297, 168562, 175366, 178393, 183100, 184252, 185245, 185565, 185763, 188114, 188148, 188516, 190223, 190224, 191231, 193056, 193056, 193056, 193088, 193093, 193093, 193093, 193093, 193159, 193171, 196955, 196988, 197197, 197269, 197365, 197445, 197452, 197665, 197667, 197669, 197671, 197808, 197809, 197835, 198512, 198670, 199553, 202111, 202114, 202895, 203704, 204763, 204939, 205644, 209783, 209784, 210487, 212836, 215537, 216188, 218793, 218794, 218795, 219414, 220901, 221144, 221355, 222409, 223591, 226211, 228932, 229906, 233444, 235903, 235904, 235905, 238469, 239017, 240448, 241543, 241682, 243912, 246515, 247956, 249394, 251664, 256215, 261028, 262875, 262905, 263699, 264333, 265341, 265407, 267064, 269267, 270137, 270587, 275615, 275631, 275641, 275649, 283510, 283676, 284478, 287082, 287083, 287084, 288328, 288330, 288332, 288333, 288769, 291355, 295188, 295214, 295241, 295808, 298156, 298938, 302895, 303594, 306399, 306758, 309763, 314582, 315341, 316508, 319190, 320789, 321768, 323327, 323406, 323406, 323406, 323406, 323766, 323950, 326761, 327528, 327952, 328897, 329293, 330453, 330562, 330664, 330669, 331606, 332629, 332698, 333845, 334939, 334960, 335304, 341441, 341771, 342126, 342135, 342589, 342675, 346866, 348363, 350411, 350411, 350411, 350411, 351119, 351180, 351591, 351603, 351946, 353777, 354642, 355492, 355507, 355508, 358773, 358774, 358968, 365680, 365681, 369184, 369268, 372262, 372266, 372399, 374586, 374615, 378113, 378223, 378454, 383706, 384110, 384253, 384407, 384503, 386071, 387030, 391046, 391819, 392088, 392366, 392582, 392848, 393544, 394352, 394354, 396478, 396533, 396740, 396841, 396991, 397022, 398676, 400513, 401008, 401258, 401321, 404467, 406984, 408873, 410254, 410255, 410258, 410351, 410353, 410535, 415207, 417339, 418059, 418060, 418061, 418155, 418220, 418491, 420095, 420557, 420889, 420890, 420895, 420945, 421318, 422817, 422839, 423120, 423411, 424829, 426592, 426593, 426660, 428066, 428926, 428942, 430524, 430974, 431002, 431048, 431147, 431878, 431879, 431880, 432436, 433539, 434701, 434705, 434831, 437675, 437676, 437678, 438959, 439027, 439034, 439065, 439136, 440406, 440758, 443939, 444348, 446068, 446081, 446447, 446769, 447240, 447240, 449492, 449495, 449496, 449499, 450344, 450451, 450710, 450902, 450973, 452333, 453216, 453222, 458000, 458183, 460290, 460304, 460468, 463161, 463164, 463576, 463577, 464065, 468832, 468912, 471633, 472466, 473090, 473091, 473092, 473093, 473199, 1217329, 1217371, 1226418, 1237771, 1239395, 1239397, 1240754, 1242556
  ];
  
  spellCycleIndex = 0;
  lastSpellCycleTime = 0;
  isCycling = false;
  
  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("1161");
  
  static settings = [
    {
      header: "PVP Settings",
      options: [
        { type: "checkbox", uid: "EnablePVPRotation", text: "Enable PVP Rotation", default: false },
        { type: "slider", uid: "DefensiveStanceHealthPct", text: "Defensive Stance Health %", min: 20, max: 80, default: 50 },
        { type: "checkbox", uid: "UseBerserkerShout", text: "Use Berserker Shout for Healer", default: true },
        { type: "checkbox", uid: "UseHamstring", text: "Use Hamstring for Movement Control", default: true }
      ]
    },
    {
      header: "Defensive Abilities",
      options: [
        { type: "checkbox", uid: "UseRallyingCry", text: "Use Rallying Cry", default: true },
        { type: "slider", uid: "RallyingCryHealthPct", text: "Rallying Cry Health %", min: 10, max: 50, default: 30 },
        { type: "checkbox", uid: "UseVictoryRush", text: "Use Victory Rush", default: true },
        { type: "slider", uid: "VictoryRushHealthPct", text: "Victory Rush Health %", min: 30, max: 90, default: 70 },
        { type: "checkbox", uid: "UseEnragedRegeneration", text: "Use Enraged Regeneration", default: true },
        { type: "slider", uid: "EnragedRegenerationHealthPct", text: "Enraged Regeneration Health %", min: 30, max: 80, default: 60 },
        { type: "checkbox", uid: "UseBloodthirstHealing", text: "Use Bloodthirst for Healing", default: true },
        { type: "slider", uid: "BloodthirstHealingHealthPct", text: "Bloodthirst Healing Health %", min: 40, max: 90, default: 70 }
      ]
    },
    {
      header: "Interrupts & Utility",
      options: [
        { type: "checkbox", uid: "UsePummel", text: "Use Pummel (Interrupt)", default: true },
        { type: "checkbox", uid: "UseStormBoltInterrupt", text: "Use Storm Bolt (Interrupt)", default: true }
      ]
    },
    {
      header: "Major Cooldowns", 
      options: [
        { type: "checkbox", uid: "UseRecklessness", text: "Use Recklessness", default: true },
        { type: "checkbox", uid: "UseAvatar", text: "Use Avatar", default: true }
      ]
    },
    {
      header: "Burst Toggle System",
      options: [
        { type: "checkbox", uid: "UseBurstToggle", text: "Use Burst Toggle", default: true },
        { type: "hotkey", uid: "BurstToggleKeybind", text: "Burst Toggle Key", default: imgui.Key.X },
        { type: "checkbox", uid: "BurstModeWindow", text: "Use Window Mode (unchecked = Toggle Mode)", default: false },
        { type: "slider", uid: "BurstWindowDuration", text: "Burst Window Duration (seconds)", min: 5, max: 60, default: 15 },
        { type: "checkbox", uid: "BurstIncludeBloodFury", text: "Include Blood Fury in Burst", default: true }
      ]
    },
    {
      header: "Time to Death Settings",
      options: [
        { type: "checkbox", uid: "IgnoreTimeToDeath", text: "Ignore Time to Death (Use abilities regardless)", default: false },
        { type: "slider", uid: "MinTimeToDeath", text: "Minimum Time to Death (seconds)", min: 5, max: 60, default: 15 }
      ]
    }
  ];

  build() {    
    return new bt.Selector(
      new bt.Action(() => {
        this.renderOverlay();
        
        const target = this.getCurrentTarget();

        if (imgui.isKeyPressed(imgui.Key.RightArrow)) {
          const target = me.targetUnit || me;
          const spellId = parseInt(this.spellIdInput.value, 10);
          const spellObject = spell.getSpell(spellId);

          if (spellObject) {
            const spellName = spellObject.name || "Unknown Spell";
            console.log(`Casting spell "${spellName}" (ID: ${spellId}) on ${target.unsafeName}`);
            spell.castPrimitive(spellObject, target);
          } else {
            console.log(`Spell ID ${spellId} not found. Please enter a valid spell ID.`);
          }
        }

        // Spell cycling with LeftArrow key
        if (imgui.isKeyPressed(imgui.Key.LeftArrow)) {
          if (!this.isCycling) {
            // Start cycling
            this.isCycling = true;
            this.spellCycleIndex = 0;
            this.lastSpellCycleTime = Date.now();
            console.log("Started spell cycling. Total spells:", this.spellList.length);
          }
        }

        // Handle burst toggle system
        this.handleBurstToggle();
        
        // Legacy: Burst mode toggle with X key (if not using burst toggle system)
        if (!Settings.UseBurstToggle && imgui.isKeyPressed(imgui.Key.X)) {
          this.burstModeActive = !this.burstModeActive;
          console.log(`Burst mode ${this.burstModeActive ? 'ACTIVATED' : 'DEACTIVATED'}`);
        }
        
        // Handle spell cycling with 200ms delay
        if (this.isCycling) {
          const currentTime = Date.now();
          if (currentTime - this.lastSpellCycleTime >= 200) {
            if (this.spellCycleIndex < this.spellList.length) {
              const spellId = this.spellList[this.spellCycleIndex];
              const spellObject = spell.getSpell(spellId);
              
              if (spellObject) {
                const spellName = spellObject.name || "Unknown Spell";
                const targetUnit = me.targetUnit || me;
                console.log(`[${this.spellCycleIndex + 1}/${this.spellList.length}] Trying spell "${spellName}" (ID: ${spellId})`);
                
                const success = spell.castPrimitive(spellObject, targetUnit);
                if (success) {
                  console.log(`Successfully cast "${spellName}" on ${targetUnit.unsafeName}`);
                } else {
                  console.log(`Failed to cast "${spellName}"`);
                }
              } else {
                console.log(`[${this.spellCycleIndex + 1}/${this.spellList.length}] Spell ID ${spellId} not found`);
              }
              
              this.spellCycleIndex++;
              this.lastSpellCycleTime = currentTime;
            } else {
              // Finished cycling through all spells
              console.log("Finished cycling through all spells");
              this.isCycling = false;
              this.spellCycleIndex = 0;
            }
          }
        }
        
        return bt.Status.Failure; // Always continue to the rest of the rotation
      }),
      
      common.waitForNotMounted(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      common.waitForCastOrChannel(),
      
      // PVP rotation takes priority if enabled
      new bt.Decorator(
        () => Settings.EnablePVPRotation,
        this.buildPVPRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Standard rotation if PVP is disabled
      new bt.Decorator(
        () => !Settings.EnablePVPRotation,
        new bt.Selector(
          // Defensive abilities
          this.buildDefensives(),
          
          // Trinkets and racials
          new bt.Decorator(
            () => this.shouldUseAvatar() && (me.hasVisibleAura("Recklessness") || me.hasVisibleAura("Avatar")),
            this.useTrinkets(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.shouldUseAvatar(),
            this.useRacials(),
            new bt.Action(() => bt.Status.Success)
          ),
          
          // Hero talent rotations
          new bt.Decorator(
            () => this.hasTalent("Slayer's Dominance"),
            this.slayerRotation(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            () => this.hasTalent("Lightning Strikes"),
            this.thaneRotation(),
            new bt.Action(() => bt.Status.Success)
          )
        ),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  renderOverlay() {
    // Safety check
    if (!me) return;
    
    if (!this.overlayToggles.showOverlay.value) {
      return;
    }

    const viewport = imgui.getMainViewport();
    if (!viewport) {
      return;
    }
    
    const workPos = viewport.workPos;
    const workSize = viewport.workSize;
    
    // Position overlay in top-right corner
    const overlaySize = { x: 250, y: 220 };
    const overlayPos = { 
      x: workPos.x + workSize.x - overlaySize.x - 20, 
      y: workPos.y + 20 
    };

    imgui.setNextWindowPos(overlayPos, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize(overlaySize, imgui.Cond.FirstUseEver);
    
    // Make background more opaque
    imgui.setNextWindowBgAlpha(0.30);
    
    // Window flags for overlay behavior
    const windowFlags = 
      imgui.WindowFlags.NoResize |
      imgui.WindowFlags.AlwaysAutoResize;

    if (imgui.begin("Fury Warrior Controls", this.overlayToggles.showOverlay, windowFlags)) {
      
      // Major Cooldowns section - collapsible
      if (imgui.collapsingHeader("Major Cooldowns", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Recklessness toggle
        const reckColor = this.overlayToggles.recklessness.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, reckColor);
        imgui.checkbox("Recklessness", this.overlayToggles.recklessness);
        imgui.popStyleColor();
        
        // Avatar toggle  
        const avatarColor = this.overlayToggles.avatar.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, avatarColor);
        imgui.checkbox("Avatar", this.overlayToggles.avatar);
        imgui.popStyleColor();
        
        imgui.unindent();
      }
      
      // Manual spell casting section - collapsible
      if (imgui.collapsingHeader("Manual Spell Casting")) {
        imgui.indent();
        
        imgui.text("Spell ID:");
        imgui.sameLine();
        imgui.setNextItemWidth(80);
        imgui.inputText("##spellId", this.spellIdInput);
        
        // Show spell name for current ID
        const currentSpellId = parseInt(this.spellIdInput.value, 10);
        if (currentSpellId > 0) {
          const currentSpellObject = spell.getSpell(currentSpellId);
          if (currentSpellObject) {
            const spellName = currentSpellObject.name || "Unknown Spell";
            imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, `"${spellName}"`);
          } else {
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, "Invalid Spell ID");
          }
        }
        
        imgui.text("Press RightArrow to cast");
        
        imgui.unindent();
      }
      
      // Interrupts section - collapsible
      if (imgui.collapsingHeader("Interrupts", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Interrupts master toggle
        const interruptColor = this.overlayToggles.interrupts.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, interruptColor);
        imgui.checkbox("Interrupts", this.overlayToggles.interrupts);
        imgui.popStyleColor();
        
        // Individual interrupt toggles (indented)
        if (this.overlayToggles.interrupts.value) {
          imgui.indent();
          
          const pummelColor = this.overlayToggles.pummel.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, pummelColor);
          imgui.checkbox("Pummel", this.overlayToggles.pummel);
          imgui.popStyleColor();
          
          const stormBoltColor = this.overlayToggles.stormBolt.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, stormBoltColor);
          imgui.checkbox("Storm Bolt", this.overlayToggles.stormBolt);
          imgui.popStyleColor();
          
          imgui.unindent();
        }
        
        imgui.unindent();
      }

      // PVP Status section - always visible
      imgui.spacing();
      imgui.separator();
      
      // PVP Mode indicator
      if (Settings.EnablePVPRotation) {
        imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, "PVP MODE ACTIVE");
        
        // Show active PVP features
        const shatterTarget = this.findShatteringThrowTarget();
        if (shatterTarget) {
          imgui.textColored({ r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, `Shattering Throw: ${shatterTarget.unsafeName}`);
        }
        
        const pummelTarget = this.findPummelTarget();
        if (pummelTarget) {
          imgui.textColored({ r: 1.0, g: 0.8, b: 0.2, a: 1.0 }, `Pummel Ready: ${pummelTarget.unsafeName}`);
        }
        
        if (this.shouldSpellReflectPVP()) {
          imgui.textColored({ r: 0.8, g: 0.2, b: 1.0, a: 1.0 }, "Spell Reflect Ready!");
        }
        

        
        // Show if current target has Blessing of Freedom
        const currentTarget = this.getCurrentTargetPVP();
        if (currentTarget && currentTarget.hasVisibleAura(1044)) {
          imgui.textColored({ r: 1.0, g: 1.0, b: 0.2, a: 1.0 }, `${currentTarget.unsafeName} has Freedom`);
        }
        
        // Show priority CC targets with cooldown info
        const priorityTarget = this.findEnhancedCCTarget();
        if (priorityTarget) {
          imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, `Priority CC: ${priorityTarget.name} (${priorityTarget.reason})`);
        }
        
        // Show immunity targets
        const immuneTarget = this.findImmuneTarget();
        if (immuneTarget) {
          imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, `Immune: ${immuneTarget.unsafeName}`);
        }
        
        // Show burst mode status
        if (Settings.UseBurstToggle) {       
          // New burst toggle system
          if (combat.burstToggle) {
            const statusText = Settings.BurstModeWindow ? 
              `BURST WINDOW ACTIVE (${Math.max(0, Settings.BurstWindowDuration - Math.floor((wow.frameTime - this.burstToggleTime) / 1000))}s)` :
              "BURST TOGGLE ACTIVE";
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, statusText);
            if (imgui.button("Disable Burst", { x: 120, y: 0 })) {
              combat.burstToggle = false;
              this.burstModeActive = false;
              this.burstToggleTime = 0;
              console.log("Burst mode DEACTIVATED via UI");
            }
          } else {
            const keyName = KeyBinding.formatKeyBinding(KeyBinding.keybindings["BurstToggleKeybind"]) || "F1";
            imgui.text(`Press ${keyName} to ${Settings.BurstModeWindow ? "start burst window" : "toggle burst"}`);
            if (imgui.button("Enable Burst", { x: 120, y: 0 })) {
              combat.burstToggle = true;
              this.burstModeActive = true;
              if (Settings.BurstModeWindow) {
                this.burstToggleTime = wow.frameTime;
              }
              console.log("Burst mode ACTIVATED via UI");
            }
          }
        } else {
          // Legacy X key system
          if (this.burstModeActive) {
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, "SLAYER BURST ACTIVE");
            if (imgui.button("Disable Burst", { x: 120, y: 0 })) {
              this.burstModeActive = false;
              console.log("Burst mode DEACTIVATED via UI");
            }
          } else {
            imgui.text("Press X to toggle Slayer Burst");
            if (imgui.button("Enable Burst", { x: 120, y: 0 })) {
              this.burstModeActive = true;
              console.log("Burst mode ACTIVATED via UI");
            }
          }
        }
      } else {
        imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, "PVE Mode");
      }
      
      imgui.spacing();
      
      // Quick controls
      if (imgui.button("Enable All", { x: 100, y: 0 })) {
        this.overlayToggles.interrupts.value = true;
        this.overlayToggles.recklessness.value = true;
        this.overlayToggles.avatar.value = true;
        this.overlayToggles.pummel.value = true;
        this.overlayToggles.stormBolt.value = true;
      }
      
      imgui.sameLine();
      
      if (imgui.button("Disable All", { x: 100, y: 0 })) {
        this.overlayToggles.interrupts.value = false;
        this.overlayToggles.recklessness.value = false;
        this.overlayToggles.avatar.value = false;
        this.overlayToggles.pummel.value = false;
        this.overlayToggles.stormBolt.value = false;
      }
      
      // Spell cycling status
      if (this.isCycling) {
        imgui.spacing();
        imgui.separator();
        imgui.textColored({ r: 0.2, g: 1.0, b: 0.8, a: 1.0 }, "Spell Cycling Active");
        const progress = (this.spellCycleIndex / this.spellList.length) * 100;
        imgui.text(`Progress: ${this.spellCycleIndex}/${this.spellList.length} (${progress.toFixed(1)}%)`);
        imgui.progressBar(this.spellCycleIndex / this.spellList.length, { x: 200, y: 0 });
        
        if (imgui.button("Stop Cycling", { x: 100, y: 0 })) {
          this.isCycling = false;
          this.spellCycleIndex = 0;
          console.log("Spell cycling stopped manually");
        }
      } else {
        imgui.spacing();
        imgui.text("Press LeftArrow to start spell cycling");
      }
      
      imgui.end();
    }
  }

  buildDefensives() {
    return new bt.Selector(
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura("Battle Shout")),

      // Defensive abilities with user options
      spell.cast("Rallying Cry", () => Settings.UseRallyingCry && me.pctHealth < Settings.RallyingCryHealthPct),
      spell.cast("Victory Rush", () => Settings.UseVictoryRush && me.effectiveHealthPercent < Settings.VictoryRushHealthPct),
      spell.cast("Enraged Regeneration", () => Settings.UseEnragedRegeneration && me.pctHealth < Settings.EnragedRegenerationHealthPct),
      spell.cast("Bloodthirst", () => Settings.UseBloodthirstHealing && me.pctHealth < Settings.BloodthirstHealingHealthPct && me.hasVisibleAura("Enraged Regeneration")),

      // Interrupts only for PVE (not PVP) - respect both settings and overlay toggles
      new bt.Decorator(
        () => !Settings.EnablePVPRotation,
        new bt.Selector(
          new bt.Decorator(
            req => Settings.UsePummel && this.overlayToggles.interrupts.value && this.overlayToggles.pummel.value,
            spell.interrupt("Pummel"),
          ),
          new bt.Decorator(
            req => Settings.UseStormBoltInterrupt && this.overlayToggles.interrupts.value && this.overlayToggles.stormBolt.value,
            spell.interrupt("Storm Bolt"),
          ),
        ),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  slayerRotation() {
    return new bt.Selector(
      // actions.slayer=recklessness
      spell.cast("Recklessness", req => Settings.UseRecklessness && this.overlayToggles.recklessness.value && this.shouldUseRecklessness() && this.shouldUseBurstAbility()),
      
      // actions.slayer+=/avatar,if=cooldown.recklessness.remains
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseAvatar() && this.shouldUseBurstAbility() && spell.getCooldown("Recklessness").timeleft > 0),
      
      // actions.slayer+=/execute,if=buff.ashen_juggernaut.up&buff.ashen_juggernaut.remains<=gcd
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura("Ashen Juggernaut") && this.getAuraRemainingTime("Ashen Juggernaut") <= 1.5),
      
      // actions.slayer+=/champions_spear,if=buff.enrage.up&(cooldown.bladestorm.remains>=2|cooldown.bladestorm.remains>=16&debuff.marked_for_execution.stack=3)
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseChampionsSpear() && me.hasVisibleAura("Enrage") && (spell.getCooldown("Bladestorm").timeleft >= 2 || (spell.getCooldown("Bladestorm").timeleft >= 16 && this.getCurrentTarget().getAuraStacks("Marked for Execution") === 3))),
      
      // actions.slayer+=/ravager,if=buff.enrage.up
      spell.cast("Ravager", on => this.getCurrentTarget(), req => me.hasVisibleAura("Enrage") && this.shouldUseBurstAbility()),
      
      // actions.slayer+=/bladestorm,if=buff.enrage.up&(talent.reckless_abandon&cooldown.avatar.remains>=24|talent.anger_management&cooldown.recklessness.remains>=18)
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => me.hasVisibleAura("Enrage") && ((this.hasTalent("Reckless Abandon") && spell.getCooldown("Avatar").timeleft >= 24) || (this.hasTalent("Anger Management") && spell.getCooldown("Recklessness").timeleft >= 18))),
      
      // actions.slayer+=/odyns_fury,if=(buff.enrage.up|talent.titanic_rage)&cooldown.avatar.remains
      spell.cast("Odyn's Fury", on => this.getCurrentTarget(), req => this.shouldUseOdynsFury() && (me.hasVisibleAura("Enrage") || this.hasTalent("Titanic Rage")) && spell.getCooldown("Avatar").timeleft > 0),
      
      // actions.slayer+=/whirlwind,if=active_enemies>=2&talent.meat_cleaver&buff.meat_cleaver.stack=0
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) >= 2 && this.hasTalent("Meat Cleaver") && me.getAuraStacks("Whirlwind") === 0),
      
      // actions.slayer+=/execute,if=buff.sudden_death.stack=2&buff.sudden_death.remains<7
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.getAuraStacks("Sudden Death") === 2 && this.getAuraRemainingTime("Sudden Death") < 7),
      
      // actions.slayer+=/execute,if=buff.sudden_death.up&buff.sudden_death.remains<2
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura("Sudden Death") && this.getAuraRemainingTime("Sudden Death") < 2),
      
      // actions.slayer+=/execute,if=buff.sudden_death.up&buff.imminent_demise.stack<3&cooldown.bladestorm.remains<25
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.hasAura("Sudden Death") && me.getAuraStacks("Imminent Demise") < 3 && spell.getCooldown("Bladestorm").timeleft < 25),
      
      // actions.slayer+=/onslaught,if=talent.tenderize
      spell.cast("Onslaught", on => this.getCurrentTarget(), req => this.hasTalent("Tenderize")),
      
      // actions.slayer+=/rampage,if=!buff.enrage.up|buff.slaughtering_strikes.stack>=4
      spell.cast("Rampage", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Enrage") || me.getAuraStacks("Slaughtering Strikes") >= 4),
      
      // actions.slayer+=/crushing_blow,if=action.raging_blow.charges=2|buff.brutal_finish.up&(!debuff.champions_might.up|debuff.champions_might.up&debuff.champions_might.remains>gcd)
      spell.cast("Crushing Blow", on => this.getCurrentTarget(), req => spell.getCharges("Raging Blow") === 2 || (me.hasAura("Brutal Finish") && (!this.getCurrentTarget().hasAuraByMe("Champion's Might") || (this.getCurrentTarget().hasAuraByMe("Champion's Might") && this.getDebuffRemainingTime("Champion's Might") > 1.5)))),
      
      // actions.slayer+=/thunderous_roar,if=buff.enrage.up&!buff.brutal_finish.up
      spell.cast("Thunderous Roar", on => this.getCurrentTarget(), req => me.hasVisibleAura("Enrage") && !me.hasAura("Brutal Finish")),
      
      // actions.slayer+=/execute,if=debuff.marked_for_execution.stack=3
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.getCurrentTarget().getAuraStacks("Marked for Execution") === 3),
      
      // actions.slayer+=/bloodbath,if=buff.bloodcraze.stack>=1|(talent.uproar&dot.bloodbath_dot.remains<40&talent.bloodborne)|buff.enrage.up&buff.enrage.remains<gcd
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 1 || (this.hasTalent("Uproar") && this.getDebuffRemainingTime("Bloodbath") < 40 && this.hasTalent("Bloodborne")) || (me.hasVisibleAura("Enrage") && this.getAuraRemainingTime("Enrage") < 1.5)),
      
      // actions.slayer+=/raging_blow,if=buff.brutal_finish.up&buff.slaughtering_strikes.stack<5&(!debuff.champions_might.up|debuff.champions_might.up&debuff.champions_might.remains>gcd)
      spell.cast("Raging Blow", on => this.getCurrentTarget(), req => me.hasAura("Brutal Finish") && me.getAuraStacks("Slaughtering Strikes") < 5 && (!this.getCurrentTarget().hasAuraByMe("Champion's Might") || (this.getCurrentTarget().hasAuraByMe("Champion's Might") && this.getDebuffRemainingTime("Champion's Might") > 1.5))),
      
      // actions.slayer+=/bloodthirst,if=active_enemies>3
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) > 3),
      
      // actions.slayer+=/rampage,if=action.raging_blow.charges<=1&rage>=100&talent.anger_management&buff.recklessness.down
      spell.cast("Rampage", on => this.getCurrentTarget(), req => spell.getCharges("Raging Blow") <= 1 && me.powerByType(PowerType.Rage) >= 100 && this.hasTalent("Anger Management") && !me.hasAura("Recklessness")),
      
      // actions.slayer+=/rampage,if=rage>=120|talent.reckless_abandon&buff.recklessness.up&buff.slaughtering_strikes.stack>=3
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 120 || (this.hasTalent("Reckless Abandon") && me.hasAura("Recklessness") && me.getAuraStacks("Slaughtering Strikes") >= 3)),
      
      // actions.slayer+=/bloodbath,if=buff.bloodcraze.stack>=4|crit_pct_current>=85|active_enemies>2
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 4 || this.getCritPct() >= 85 || this.getEnemiesInRange(8) > 2) || me.hasAura("Recklessness"),
      
      // actions.slayer+=/crushing_blow
      spell.cast("Crushing Blow", on => this.getCurrentTarget()),
      
      // actions.slayer+=/bloodbath
      spell.cast("Bloodbath", on => this.getCurrentTarget()),
      
      // actions.slayer+=/raging_blow,if=buff.opportunist.up
      spell.cast("Raging Blow", on => this.getCurrentTarget(), req => me.hasAura("Opportunist")),
      
      // actions.slayer+=/bloodthirst,if=(target.health.pct<35&talent.vicious_contempt&buff.bloodcraze.stack>=2)|active_enemies>2
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => (this.getCurrentTarget().pctHealth < 35 && this.hasTalent("Vicious Contempt") && me.getAuraStacks(393951) >= 2) || this.getEnemiesInRange(8) > 2),
      
      // actions.slayer+=/rampage,if=rage>=100&talent.anger_management&buff.recklessness.up
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 100 && this.hasTalent("Anger Management") && me.hasAura("Recklessness")),
      
      // actions.slayer+=/bloodthirst,if=buff.bloodcraze.stack>=4|crit_pct_current>=85
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 4 || this.getCritPct() >= 85) || me.hasAura("Recklessness"),
      
      // actions.slayer+=/raging_blow
      spell.cast("Raging Blow", on => this.getCurrentTarget()),
      
      // actions.slayer+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      
      // actions.slayer+=/bloodthirst
      spell.cast("Bloodthirst", on => this.getCurrentTarget()),
      
      // actions.slayer+=/rampage
      spell.cast("Rampage", on => this.getCurrentTarget()),
      
      // actions.slayer+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      
      // actions.slayer+=/whirlwind,if=talent.improved_whirlwind
      spell.cast("Whirlwind", on => this.getCurrentTarget(), req => this.hasTalent("Improved Whirlwind")),
      
      // actions.slayer+=/slam,if=!talent.improved_whirlwind
      spell.cast("Slam", on => this.getCurrentTarget(), req => !this.hasTalent("Improved Whirlwind")),
      
      // actions.slayer+=/storm_bolt,if=buff.bladestorm.up
      spell.cast("Storm Bolt", on => this.getCurrentTarget(), req => me.hasAura("Bladestorm"))
    );
  }

  thaneRotation() {
    return new bt.Selector(
      // actions.thane=recklessness
      spell.cast("Recklessness", req => Settings.UseRecklessness && this.overlayToggles.recklessness.value && this.shouldUseRecklessness() && this.shouldUseBurstAbility()),
      
      // actions.thane+=/avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.shouldUseAvatar() && this.shouldUseBurstAbility()),
      
      // actions.thane+=/ravager
      spell.cast("Ravager", req => this.shouldUseBurstAbility(), on => this.getCurrentTarget()),
      
      // actions.thane+=/thunder_blast,if=buff.enrage.up&talent.meat_cleaver
      spell.cast("Thunder Blast", req => me.hasVisibleAura("Enrage") && this.hasTalent("Meat Cleaver"), on => this.getCurrentTarget()),
      
      // actions.thane+=/thunder_clap,if=buff.meat_cleaver.stack=0&talent.meat_cleaver&active_enemies>=2
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => me.getAuraStacks("Whirlwind") === 0 && this.hasTalent("Meat Cleaver") && this.getEnemiesInRange(8) >= 2),
      
      // actions.thane+=/thunderous_roar,if=buff.enrage.up
      spell.cast("Thunderous Roar", req => me.hasVisibleAura("Enrage") && this.shouldUseBurstAbility(), on => this.getCurrentTarget()),
      
      // actions.thane+=/champions_spear,if=buff.enrage.up
      spell.cast("Champion's Spear", on => this.getCurrentTarget(), req => this.shouldUseChampionsSpear() && me.hasVisibleAura("Enrage") && this.shouldUseBurstAbility()),
      
      // actions.thane+=/odyns_fury,if=(buff.enrage.up|talent.titanic_rage)&cooldown.avatar.remains
      spell.cast("Odyn's Fury", on => this.getCurrentTarget(), req => this.shouldUseOdynsFury() && (me.hasVisibleAura("Enrage") || this.hasTalent("Titanic Rage")) && spell.getCooldown("Avatar").timeleft > 0.1),
      
      // actions.thane+=/rampage,if=buff.enrage.down
      spell.cast("Rampage", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Enrage")),
      
      // actions.thane+=/execute,if=talent.ashen_juggernaut&buff.ashen_juggernaut.remains<=gcd
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.hasTalent("Ashen Juggernaut") && this.getAuraRemainingTime("Ashen Juggernaut") <= 1.5),
      
      // actions.thane+=/rampage,if=talent.bladestorm&cooldown.bladestorm.remains<=gcd&!debuff.champions_might.up
      spell.cast("Rampage", on => this.getCurrentTarget(), req => this.hasTalent("Bladestorm") && spell.getCooldown("Bladestorm").timeleft <= 1.5 && !this.getCurrentTarget().hasAuraByMe("Champion's Might")),
      
      // actions.thane+=/bladestorm,if=buff.enrage.up&talent.unhinged
      spell.cast("Bladestorm", on => this.getCurrentTarget(), req => me.hasVisibleAura("Enrage") && this.hasTalent("Unhinged")),
      
      // actions.thane+=/bloodbath,if=buff.bloodcraze.stack>=2
      spell.cast("Bloodbath", on => this.getCurrentTarget(), req => me.getAuraStacks(393951) >= 2),
      
      // actions.thane+=/rampage,if=rage>=115&talent.reckless_abandon&buff.recklessness.up&buff.slaughtering_strikes.stack>=3
      spell.cast("Rampage", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 115 && this.hasTalent("Reckless Abandon") && me.hasAura("Recklessness") && me.getAuraStacks("Slaughtering Strikes") >= 3),
      
      // actions.thane+=/crushing_blow
      spell.cast("Crushing Blow", on => this.getCurrentTarget()),
      
      // actions.thane+=/bloodbath
      spell.cast("Bloodbath", on => this.getCurrentTarget()),
      
      // actions.thane+=/onslaught,if=talent.tenderize
      spell.cast("Onslaught", on => this.getCurrentTarget(), req => this.hasTalent("Tenderize")),
      
      // actions.thane+=/rampage
      spell.cast("Rampage", on => this.getCurrentTarget()),
      
      // actions.thane+=/bloodthirst,if=talent.vicious_contempt&target.health.pct<35&buff.bloodcraze.stack>=2|!buff.ravager.up&buff.bloodcraze.stack>=3|active_enemies>=6
      spell.cast("Bloodthirst", on => this.getCurrentTarget(), req => (this.hasTalent("Vicious Contempt") && this.getCurrentTarget().pctHealth < 35 && me.getAuraStacks(393951) >= 2) || (!me.hasAura("Ravager") && me.getAuraStacks(393951) >= 3) || this.getEnemiesInRange(8) >= 6),
      
      // actions.thane+=/raging_blow
      spell.cast("Raging Blow", on => this.getCurrentTarget()),
      
      // actions.thane+=/execute,if=talent.ashen_juggernaut
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.hasTalent("Ashen Juggernaut")),
      
      // actions.thane+=/thunder_blast
      spell.cast("Thunder Blast", on => this.getCurrentTarget()),
      
      // actions.thane+=/wrecking_throw
      spell.cast("Wrecking Throw", on => this.getCurrentTarget()),
      
      // actions.thane+=/bloodthirst
      spell.cast("Bloodthirst", on => this.getCurrentTarget()),
      
      // actions.thane+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      
      // actions.thane+=/thunder_clap
      spell.cast("Thunder Clap", on => this.getCurrentTarget())
    );
  }

  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Skarmorak Shard"),
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Lights Judgment", on => this.getCurrentTarget(), req => this.shouldUseOnGCDRacials()),
      spell.cast("Bag of Tricks", on => this.getCurrentTarget(), req => this.shouldUseOnGCDRacials()),
      spell.cast("Berserking", on => this.getCurrentTarget(), req => me.hasAura("Recklessness")),
      spell.cast("Blood Fury", on => this.getCurrentTarget(), req => !Settings.BurstIncludeBloodFury || this.shouldUseBurstAbility()),
      spell.cast("Fireblood", on => this.getCurrentTarget()),
      spell.cast("Ancestral Call", on => this.getCurrentTarget())
    );
  }

  shouldUseRecklessness() {
    if (Settings.IgnoreTimeToDeath) {
      return !me.hasAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasAura("Smothering Shadows");
  }

  shouldUseAvatar() {
    if (Settings.IgnoreTimeToDeath) {
      return !me.hasAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasAura("Smothering Shadows");
  }

  handleBurstToggle() {
    if (!Settings.UseBurstToggle) return;
    
    // Check for keybind press using the KeyBinding system
    if (KeyBinding.isPressed("BurstToggleKeybind")) {
      
      if (!Settings.BurstModeWindow) {
        // Toggle mode: flip the state
        combat.burstToggle = !combat.burstToggle;
        this.burstModeActive = combat.burstToggle;
        console.log(`Burst toggle ${combat.burstToggle ? 'ACTIVATED' : 'DEACTIVATED'} (Toggle mode)`);
      } else {
        // Window mode: start the burst window
        combat.burstToggle = true;
        this.burstModeActive = true;
        this.burstToggleTime = wow.frameTime;
        console.log(`Burst window ACTIVATED for ${Settings.BurstWindowDuration} seconds`);
      }
    }
    
    // Handle burst window timeout - always check if we're in window mode and burst is active
    if (Settings.BurstModeWindow && combat.burstToggle && this.burstToggleTime > 0) {
      const elapsed = (wow.frameTime - this.burstToggleTime) / 1000;
      
      if (elapsed >= Settings.BurstWindowDuration) {
        combat.burstToggle = false;
        this.burstModeActive = false;
        this.burstToggleTime = 0; // Reset the timer
        console.log(`Burst window EXPIRED after ${elapsed.toFixed(1)}s`);
      }
    }
  }

  shouldUseBurstAbility() {
    if (Settings.UseBurstToggle) {
      return combat.burstToggle;
    }
    // Legacy burst mode for X key
    return this.burstModeActive;
  }

  shouldUseChampionsSpear() {
    if (Settings.IgnoreTimeToDeath) {
      return !me.hasAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasAura("Smothering Shadows");
  }

  shouldUseOdynsFury() {
    if (Settings.IgnoreTimeToDeath) {
      return !me.hasAura("Smothering Shadows");
    }
    
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > Settings.MinTimeToDeath && !me.hasAura("Smothering Shadows");
  }

  shouldUseOnGCDRacials() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    
    const timeToDeathOk = Settings.IgnoreTimeToDeath || target.timeToDeath() > Settings.MinTimeToDeath;
    
    return !me.hasAura("Recklessness") &&
           timeToDeathOk && !me.hasAura("Smothering Shadows") &&
           !me.hasAura("Avatar") &&
           me.powerByType(PowerType.Rage) < 80 &&
           !me.hasAura("Bloodbath") &&
           !me.hasAura("Crushing Blow") &&
           !me.hasAura("Sudden Death") &&
           !spell.getCooldown("Bladestorm").ready &&
           (!spell.getCooldown("Execute").ready || !this.isExecutePhase());
  }

  isExecutePhase() {
    const target = this.getCurrentTarget();
    return (this.hasTalent("Massacre") && target.pctHealth < 35) || target.pctHealth < 20;
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getCurrentTargetPVP() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit) && !pvpHelpers.hasImmunity(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  getCritPct() {
    // This would need to be implemented based on available stats API
    // For now, return a reasonable estimate
    return 19;
  }

  // PVP Helper Methods

  buildPVPRotation() {
    return new bt.Selector(
      // Always Perform actions
      this.buildPVPAlwaysPerform(),
      
      // Slayer Burst (toggle with 'X' key)
      new bt.Decorator(
        () => this.burstModeActive,
        this.buildSlayerBurst(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Regular PVP Priority
      this.buildPVPRegularPriority()
    );
  }

  buildPVPAlwaysPerform() {
    return new bt.Selector(
      // Battle Shout if any party member doesn't have it
      spell.cast("Battle Shout", () => this.shouldCastBattleShoutPVP()),
      
      // Defensive stance if below health threshold
      spell.cast("Defensive Stance", () => me.pctHealth < Settings.DefensiveStanceHealthPct && !me.hasAura("Defensive Stance")),
      spell.cast("Berserker Stance", () => me.pctHealth >= Settings.DefensiveStanceHealthPct && !me.hasAura("Berserker Stance")),
      
      // Shattering Throw for Ice Block/Divine Shield
      spell.cast("Shattering Throw", on => this.findShatteringThrowTarget(), req => this.findShatteringThrowTarget() !== null),
      
      // Spell Reflect for spells in blacklist targeting us
      spell.cast(23920, () => this.shouldSpellReflectPVP()),
      
      // Pummel interrupts for PVP
      spell.interrupt("Pummel", on => this.findPummelTarget(), req => this.findPummelTarget() !== null),
      
      // Hamstring - use successful cast tracking from Spell.js
      spell.cast("Hamstring", () => {
        if (!Settings.UseHamstring) return false;
        
        const target = this.getCurrentTargetPVP();
        if (!target) return false;
        
        // Don't cast if target has movement debuffs already
        if (target.hasVisibleAura(1715) || target.hasVisibleAura(12323)) return false;
        
        // Don't cast if target has immunity or slow immunity
        if (pvpHelpers.hasImmunity(target)) return false;
        if (target.hasVisibleAura(1044)) return false; // Blessing of Freedom
        
        // Check timing based on ACTUAL successful casts from Spell.js
        const lastSuccessfulTime = spell._lastSuccessfulCastTimes.get("hamstring");
        const now = wow.frameTime;
        const timeSinceSuccess = lastSuccessfulTime ? now - lastSuccessfulTime : 999999;
        
        // Only cast every 12 seconds after successful cast
        if (lastSuccessfulTime && timeSinceSuccess < 12000) {
          return false;
        }
        
        return true;
      }),
      
      // CC enemies with major cooldowns
      spell.cast(236077, on => this.findDisarmTarget(), req => this.findDisarmTarget() !== null),
      spell.cast("Storm Bolt", on => this.findStormBoltCCTarget(), req => this.findStormBoltCCTarget() !== null),
      spell.cast("Intimidating Shout", on => this.findIntimidatingShoutTarget(), req => this.findIntimidatingShoutTarget() !== null),
      
      // Defensive abilities (excluding pummel/storm bolt interrupts)
      this.buildPVPDefensives(),
      
      // Berserker Shout if near healer and healer is disoriented
      spell.cast("Berserker Shout", () => Settings.UseBerserkerShout && this.shouldUseBerserkerShout()),
      
      // Piercing Howl if 2+ enemies in 12 yards (avoid targets with Blessing of Freedom)
      spell.cast("Piercing Howl", () => this.shouldCastPiercingHowl()),

      // Whirlwind if 2+ enemies in 12 yards
      //spell.cast("Whirlwind", () => this.getEnemiesInRange(12) >= 2 && me.getAuraStacks("Whirlwind") === 0)
    );
  }

  buildSlayerBurst() {
    return new bt.Selector(
      // CC healer with Storm Bolt
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), req => this.findHealerForStunCC() !== null),
      
      // CC current target with Storm Bolt if healer has stun DR
      spell.cast("Storm Bolt", on => this.getCurrentTargetPVP(), req => this.shouldStormBoltCurrentTarget() && this.burstModeActive),
      
      // Champion's Spear current target
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), req => this.shouldUseChampionsSpear() && this.burstModeActive),
      
      // Recklessness
      spell.cast("Recklessness", req => Settings.UseRecklessness && this.overlayToggles.recklessness.value && this.burstModeActive),
      
      // Onslaught
      spell.cast("Onslaught", on => this.getCurrentTargetPVP()),
      
      // Rampage
      spell.cast("Rampage", on => this.getCurrentTargetPVP()),
      
      // Avatar
      spell.cast("Avatar", req => Settings.UseAvatar && this.overlayToggles.avatar.value && this.burstModeActive),
      
      // Thunderous Roar
      spell.cast("Thunderous Roar", on => this.getCurrentTargetPVP()),
      
      // Execute if Sudden Death is up
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => me.hasAura("Sudden Death")),
      
      // Rampage if no enrage or rage capped
      spell.cast("Rampage", on => this.getCurrentTargetPVP(), req => !me.hasVisibleAura("Enrage") || me.powerByType(PowerType.Rage) >= 110),
      
      // Bladestorm
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP()),
      
      // Continue with regular priority
      this.buildPVPRegularPriority()
    );
  }

  buildPVPRegularPriority() {
    return new bt.Selector(
      // Rampage if no enrage or rage capped
      spell.cast("Rampage", on => this.getCurrentTargetPVP(), req => !me.hasVisibleAura("Enrage") || me.powerByType(PowerType.Rage) >= 110),
      
      // Execute if Slayer's Dominance at 3 stacks
      spell.cast("Execute", on => this.getCurrentTargetPVP(), req => this.getCurrentTargetPVP()?.getAuraStacks("Marked for Execution") === 3),
      
      // Onslaught
      spell.cast("Onslaught", on => this.getCurrentTargetPVP()),
      
      // Rampage
      spell.cast("Rampage", on => this.getCurrentTargetPVP()),
      
      // Execute
      spell.cast("Execute", on => this.getCurrentTargetPVP()),
      
      // Bloodthirst at 3+ stacks of Bloodcraze
      spell.cast("Bloodthirst", on => this.getCurrentTargetPVP(), req => me.getAuraStacks(393951) >= 3),
      
      // Raging Blow
      spell.cast("Raging Blow", on => this.getCurrentTargetPVP()),
      
      // Bloodthirst
      spell.cast("Bloodthirst", on => this.getCurrentTargetPVP())
    );
  }

  buildPVPDefensives() {
    return new bt.Selector(
      // Battle Shout
      spell.cast("Battle Shout", () => !me.hasAura("Battle Shout")),
      
      // Defensive abilities with user options
      spell.cast("Rallying Cry", () => 
        Settings.UseRallyingCry && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.RallyingCryHealthPct
      ),
      spell.cast("Victory Rush", () => 
        Settings.UseVictoryRush && 
        this.overlayToggles.defensives.value &&
        me.effectiveHealthPercent < Settings.VictoryRushHealthPct
      ),
      spell.cast("Enraged Regeneration", () => 
        Settings.UseEnragedRegeneration && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.EnragedRegenerationHealthPct
      ),
      spell.cast("Bloodthirst", () => 
        Settings.UseBloodthirstHealing && 
        this.overlayToggles.defensives.value &&
        me.pctHealth < Settings.BloodthirstHealingHealthPct && 
        me.hasVisibleAura("Enraged Regeneration")
      )
      // Note: Pummel and Storm Bolt interrupts are NOT included here for PVP
    );
  }

  // PVP Helper Methods

  shouldCastBattleShoutPVP() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (!friend.deadOrGhost && !friend.hasAura("Battle Shout")) {
        return true;
      }
    }
    return false;
  }

  shouldSpellReflectPVP() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && enemy.isPlayer()) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo && target && target.equals(me.guid)) {
          const spellId = enemy.spellInfo.spellCastId;
          // Check if spell should be reflected using new data
          if (pvpHelpers.shouldReflectSpell(spellId)) {
            const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
            return castRemains < 1000; // Reflect within 1 second of cast completion
          }
        }
      }
    }
    return false;
  }

  findPummelTarget() {
    const enemies = me.getEnemies();
    
    // Priority 1: Enemy casting an interruptible spell within 8 yards
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && 
          enemy.isPlayer() && 
          me.distanceTo(enemy) <= 8 && 
          me.isWithinMeleeRange(enemy)) {
        const spellInfo = enemy.spellInfo;
        if (spellInfo) {
          const spellId = spellInfo.spellCastId;
          const interruptInfo = pvpHelpers.getInterruptInfo(spellId);
          if (interruptInfo && interruptInfo.useKick) {
            console.log(`Pummel target found: ${enemy.unsafeName} casting ${interruptInfo.name} (${interruptInfo.zone})`);
            return enemy;
          }
        }
      }
    }
    
    // Priority 2: Enemy healer within 8 yards if any enemy near me is under 50% health
    const lowHealthEnemyNearby = enemies.some(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 15 && 
      enemy.pctHealth < 50
    );
    
    if (lowHealthEnemyNearby) {
      for (const enemy of enemies) {
        if (enemy.isCastingOrChanneling && 
            enemy.isPlayer() && 
            enemy.isHealer() &&
            me.distanceTo(enemy) <= 8 && 
            me.isWithinMeleeRange(enemy)) {
          console.log(`Pummel healer target found: ${enemy.unsafeName} (low health enemy nearby)`);
          return enemy;
        }
      }
    }
    
    return null;
  }

  findDisarmTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.isWithinMeleeRange(enemy) && 
          this.isMeleeClass(enemy) && 
          this.hasMajorCooldowns(enemy) &&
          drTracker.getDRStacks(enemy.guid, "disarm") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  findStormBoltCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          me.distanceTo(enemy) > 7 && 
          me.distanceTo(enemy) <= 30 &&
          this.isCasterClass(enemy) && 
          this.hasMajorCooldowns(enemy) &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy) &&
          !enemy.isCCd()) {
        return enemy;
      }
    }
    return null;
  }

  findIntimidatingShoutTarget() {
    const enemies = me.getEnemies();
    
    // Count eligible enemies within 8 yards (not DR'd, not immune, not already CC'd)
    const eligibleEnemies = enemies.filter(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 8 && 
      drTracker.getDRStacks(enemy.guid, "disorient") < 2 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.isCCd()
    );
    
    // Only use Intimidating Shout if we can fear 2+ enemies
    if (eligibleEnemies.length < 2) {
      return null;
    }
    
    // Prefer enemies with major cooldowns, but any eligible enemy works
    const priorityTarget = eligibleEnemies.find(enemy => this.hasMajorCooldowns(enemy));
    return priorityTarget || eligibleEnemies[0];
  }

  findHealerForStunCC() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && 
          enemy.isHealer() &&
          me.distanceTo(enemy) <= 30 &&
          drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
          !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return null;
  }

  shouldStormBoltCurrentTarget() {
    const target = this.getCurrentTargetPVP();
    if (!target || !target.isPlayer()) return false;
    
    const healer = this.findHealerForStunCC();
    const healerHasStunDR = healer && drTracker.getDRStacks(healer.guid, "stun") >= 2;
    const targetIsNotHealer = !target.isHealer();
    
    return healerHasStunDR && targetIsNotHealer && drTracker.getDRStacks(target.guid, "stun") < 2;
  }

  shouldUseBerserkerShout() {
    if (!this.hasTalent("Berserker Shout")) return false;
    
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isHealer() && 
          me.distanceTo(friend) <= 12 && 
          drTracker.isCCdByCategory(friend.guid, "disorient")) {
        return true;
      }
    }
    return false;
  }

  isMeleeClass(unit) {
    if (!unit.isPlayer()) return false;
    // PowerType: 1=Rage, 2=Focus, 3=Energy, 4=ComboPoints, 5=Runes, 6=RunicPower, 12=Fury, 17=Maelstrom, 18=Chi, 19=Insanity
    const meleePowerTypes = [1, 2, 3, 4, 5, 6, 12, 17, 18, 19];
    return meleePowerTypes.includes(unit.powerType);
  }

  isCasterClass(unit) {
    if (!unit.isPlayer()) return false;
    // PowerType 0 = Mana (typically casters)
    return unit.powerType === 0;
  }

  hasMajorCooldowns(unit) {
    if (!unit.isPlayer()) return false;
    // Check for major damage cooldowns with sufficient duration
    const majorDamageCooldown = pvpHelpers.hasMajorDamageCooldown(unit, 3);
    const disarmableBuff = pvpHelpers.hasDisarmableBuff(unit, false, 3);
    return majorDamageCooldown !== null || disarmableBuff !== null;
  }

  findEnhancedCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.isPlayer() || me.distanceTo(enemy) > 30) continue;
      
      // Check for major damage cooldowns
      const damageCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
      if (damageCooldown) {
        return { 
          unit: enemy, 
          name: enemy.unsafeName, 
          reason: `${damageCooldown.name} (${damageCooldown.remainingTime.toFixed(1)}s)` 
        };
      }
      
      // Check for disarmable buffs
      const disarmableBuff = pvpHelpers.hasDisarmableBuff(enemy, false, 3);
      if (disarmableBuff) {
        return { 
          unit: enemy, 
          name: enemy.unsafeName, 
          reason: `${disarmableBuff.name} (${disarmableBuff.remainingTime.toFixed(1)}s)` 
        };
      }
    }
    return null;
  }

  findImmuneTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30 && pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }
    return null;
  }



  shouldCastPiercingHowl() {
    // Get enemies within 12 yards
    const enemies = me.getEnemies();
    const enemiesInRange = enemies.filter(enemy => 
      enemy.isPlayer() && 
      me.distanceTo(enemy) <= 12 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.hasVisibleAura(1044) // Don't target enemies with Blessing of Freedom
    );
    
    return enemiesInRange.length >= 2;
  }

  findShatteringThrowTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30) {
        // Check specifically for Ice Block (45438) or Divine Shield (642)
        const hasIceBlock = enemy.hasAura(45438);
        const hasDivineShield = enemy.hasAura(642);
        
        if (hasIceBlock || hasDivineShield) {
          return enemy;
        }
      }
    }
    return null;
  }
}
