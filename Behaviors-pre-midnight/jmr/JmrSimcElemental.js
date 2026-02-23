import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import KeyBinding from "@/Core/KeyBinding";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";

const auras = {
  // Buffs
  lightningShield: 192106,
  thunderstrikeWard: 462757,
  skyfury: 462854,
  earthShield: 974,
  stormkeeper: 191634,
  surgeOfPower: 285514,
  masterOfTheElements: 260734,
  primordialWave: 375986,
  ancestralSwiftness: 443454,
  ascendance: 114050,
  lavaSurge: 77762,
  arcDischarge: 455096,
  stormFrenzy: 462725,
  fusionOfElementsNature: 462841,
  fusionOfElementsFire: 462840,
  echoesOfGreatSunderingES: 384088,
  echoesOfGreatSunderingEB: 384089,
  tempest: 454009,
  icefuryDmg: 210714,
  callOfTheAncestors: 443454,
  windGust: 263806,
  spiritWalkersGrace: 79206,
  
  // Debuffs
  flameShock: 188389,
  lightningRod: 197209,
  
  // Talents (checked via hasAura)
  improvedFlametongueWeapon: 382027,
  swellingMaelstrom: 381707,
  primordialCapacity: 462818,
  heraldOfTheStorms: 462131,
  firstAscendant: 462440,
  furyOfTheStorms: 191717,
  surgeOfPowerTalent: 285514,
  eyeOfTheStorm: 381708,
  echoesOfGreatSundering: 384087,
  elementalBlast: 117014,
  lightningRodTalent: 210689,
  fusionOfElements: 462841,
  callOfTheAncestorsTalent: 443454,
  eruptingLava: 462620,
  tempestTalent: 454009
};

export class JmrSimcElementalBehavior extends Behavior {
  name = "Jmr SimC Elemental Shaman";
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Elemental;
  version = 1;

  // Runtime toggles for overlay
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(true),
    interrupts: new imgui.MutableVariable(true),
    windShear: new imgui.MutableVariable(true),
    stormkeeper: new imgui.MutableVariable(true),
    ascendance: new imgui.MutableVariable(true),
    elementals: new imgui.MutableVariable(true)
  };

  // Burst mode toggle state
  burstModeActive = false;
  burstToggleTime = 0;

  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("188389"); // Default to Flame Shock

  // Spell cycling system - cycles through ALL possible spell IDs
  maxSpellId = 999999;
  currentSpellId = 0;
  lastSpellCycleTime = 0;
  isCycling = false;

  constructor() {
    super();
    this.maelCapVariable = 0;
    this.lastInterruptCheck = 0;
    // Initialize the burst toggle keybinding with default
    KeyBinding.setDefault("BurstToggleKeybind", imgui.Key.F1);
  }

  static settings = [
    {
      header: "Defensive Settings",
      options: [
        { type: "checkbox", uid: "UseAstralShift", text: "Use Astral Shift", default: true },
        { type: "slider", uid: "AstralShiftHealthPct", text: "Astral Shift Health %", min: 20, max: 80, default: 50 },
        { type: "checkbox", uid: "UseHealingStreamTotem", text: "Use Healing Stream Totem", default: true },
        { type: "slider", uid: "HealingStreamTotemHealthPct", text: "Healing Stream Totem Health %", min: 30, max: 90, default: 70 },
        { type: "checkbox", uid: "UseStoneBulwarkTotem", text: "Use Stone Bulwark Totem", default: true },
        { type: "slider", uid: "StoneBulwarkTotemHealthPct", text: "Stone Bulwark Totem Health %", min: 20, max: 80, default: 40 }
      ]
    },
    {
      header: "Buffs & Utility",
      options: [
        { type: "checkbox", uid: "UseSkyfury", text: "Use Skyfury", default: true },
        { type: "checkbox", uid: "UseEarthShield", text: "Use Earth Shield", default: true },
        { type: "checkbox", uid: "UsePurge", text: "Use Purge", default: true },
        { type: "checkbox", uid: "UsePoisonCleansingTotem", text: "Use Poison Cleansing Totem", default: true }
      ]
    },
    {
      header: "Interrupts & Utility",
      options: [
        { type: "checkbox", uid: "UseWindShear", text: "Use Wind Shear (Interrupt)", default: true }
      ]
    },
    {
      header: "Cooldown Usage",
      options: [
        { type: "checkbox", uid: "UseStormkeeper", text: "Use Stormkeeper", default: true },
        { type: "checkbox", uid: "UseAscendance", text: "Use Ascendance", default: true },
        { type: "checkbox", uid: "UseFireElemental", text: "Use Fire Elemental", default: true },
        { type: "checkbox", uid: "UseStormElemental", text: "Use Storm Elemental", default: true }
      ]
    },
    {
      header: "Racial Abilities",
      options: [
        { type: "checkbox", uid: "UseBloodFury", text: "Use Blood Fury", default: true },
        { type: "checkbox", uid: "UseBerserking", text: "Use Berserking", default: true },
        { type: "checkbox", uid: "UseFireblood", text: "Use Fireblood", default: true },
        { type: "checkbox", uid: "UseAncestralCall", text: "Use Ancestral Call", default: true }
      ]
    },
    {
      header: "Burst Toggle System",
      options: [
        { type: "checkbox", uid: "UseBurstToggle", text: "Use Burst Toggle", default: true },
        { type: "hotkey", uid: "BurstToggleKeybind", text: "Burst Toggle Key", default: imgui.Key.F1 },
        { type: "checkbox", uid: "BurstModeWindow", text: "Use Window Mode (unchecked = Toggle Mode)", default: false },
        { type: "slider", uid: "BurstWindowDuration", text: "Burst Window Duration (seconds)", min: 5, max: 60, default: 15 },
        { type: "checkbox", uid: "BurstIncludeBloodFury", text: "Include Blood Fury in Burst", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      new bt.Action(() => {
        this.renderOverlay();
        
        const target = this.getCurrentTarget();

        // Manual spell casting with RightArrow
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
            this.currentSpellId = 141500;
            this.lastSpellCycleTime = Date.now();
            console.info(`Started spell cycling from 0 to ${this.maxSpellId.toLocaleString()}`);
          }
        }

        // Handle burst toggle system
        this.handleBurstToggle();
        
        // Handle spell cycling with 200ms delay
        if (this.isCycling) {
          const currentTime = Date.now();
          if (currentTime - this.lastSpellCycleTime >= 1) {
            if (this.currentSpellId <= this.maxSpellId) {
              const spellId = this.currentSpellId;
              const spellObject = spell.getSpell(spellId);
              
              if (spellObject) {
                const spellName = spellObject.name || "Unknown Spell";
                const targetUnit = me.targetUnit || me;
                console.info(`[${this.currentSpellId.toLocaleString()}/${this.maxSpellId.toLocaleString()}] Trying spell "${spellName}" (ID: ${spellId})`);
                
                const success = spell.castPrimitive(spellObject, targetUnit);
                if (success) {
                  console.info(`Successfully cast "${spellName}" on ${targetUnit.unsafeName}`);
                } else {
                  console.info(`Failed to cast "${spellName}"`);
                }
              } else {
                // Only log if we find a valid spell to reduce spam
                if (spellId % 10000 === 0) {
                  console.info(`[${this.currentSpellId.toLocaleString()}/${this.maxSpellId.toLocaleString()}] Checking spell ID ${spellId}...`);
                }
              }
              
              this.currentSpellId++;
              this.lastSpellCycleTime = currentTime;
            } else {
              // Finished cycling through all spells
              console.info(`Finished cycling through all spell IDs (0 to ${this.maxSpellId.toLocaleString()})`);
              this.isCycling = false;
              this.currentSpellId = 0;
            }
          }
        }
        
        return bt.Status.Failure; // Always continue to the rest of the rotation
      }),
      
      common.waitForNotMounted(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null || this.isCycling) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      common.waitForCastOrChannel(),
      
      // Precombat preparation
      new bt.Decorator(
        () => !me.inCombat(),
        this.buildPrecombat()
      ),
      
      // Main rotation
      new bt.Selector(
        // Defensive abilities
        this.buildDefensives(),
        
        // Interrupts
        new bt.Decorator(
          () => Settings.UseWindShear && this.overlayToggles.interrupts.value && this.overlayToggles.windShear.value && wow.frameTime - this.lastInterruptCheck > 200,
          new bt.Action(() => {
            this.lastInterruptCheck = wow.frameTime;
            return bt.Status.Failure;
          })
        ),
        spell.interrupt("Wind Shear"),
        
        // Racial abilities
        this.buildRacials(),
        
        // AoE rotation for 2+ targets
        new bt.Decorator(
          () => this.getEnemiesAroundTarget() >= 2,
          new bt.Selector(
            this.buildAoERotation(),
            new bt.Action(() => bt.Status.Success)
          )
        ),
        
        // Single target rotation
        new bt.Decorator(
          () => this.getEnemiesAroundTarget() < 2,
          this.buildSingleTargetRotation()
        )
      )
    );
  }

  buildPrecombat() {
    return new bt.Selector(
      // Weapon enchant if Improved Flametongue Weapon is talented
      spell.cast("Flametongue Weapon", () => this.hasTalent("Improved Flametongue Weapon") && !me.hasAura("Flametongue Weapon")),
      
      // Lightning Shield
      spell.cast("Lightning Shield", () => !me.hasAura(auras.lightningShield)),
      
      // Thunderstrike Ward
      spell.cast("Thunderstrike Ward", () => !me.hasAura(auras.thunderstrikeWard)),
      
      // Skyfury
      spell.cast("Skyfury", () => Settings.UseSkyfury && !me.hasAura(auras.skyfury)),
      
      // Earth Shield (apply to tank, not self)
      spell.cast("Earth Shield", on => this.getActiveTankWithoutEarthShield(), req => Settings.UseEarthShield && this.getActiveTankWithoutEarthShield() !== null),
      
      // Update maelstrom cap variable (using maxPowerByType is more reliable)
      new bt.Action(() => {
        this.maelCapVariable = this.getMaxMaelstrom();
        return bt.Status.Success;
      }),
      
      // Stormkeeper
      spell.cast("Stormkeeper", () => Settings.UseStormkeeper && this.overlayToggles.stormkeeper.value)
    );
  }

  buildDefensives() {
    return new bt.Selector(
      // Astral Shift
      spell.cast("Astral Shift", () => Settings.UseAstralShift && me.pctHealth < Settings.AstralShiftHealthPct),
      
      // Stone Bulwark Totem
      spell.cast("Stone Bulwark Totem", () => Settings.UseStoneBulwarkTotem && me.pctHealth < Settings.StoneBulwarkTotemHealthPct),
      
      // Healing Stream Totem
      spell.cast("Healing Stream Totem", () => Settings.UseHealingStreamTotem && me.pctHealth < Settings.HealingStreamTotemHealthPct),
      
      // Poison Cleansing Totem
      spell.cast("Poison Cleansing Totem", () => Settings.UsePoisonCleansingTotem && this.shouldUsePoisonCleansing()),
      
      // Purge
      spell.cast("Purge", on => this.getPurgeTarget(), req => Settings.UsePurge && this.getPurgeTarget() !== null)
    );
  }

  buildRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", () => Settings.UseBloodFury && this.shouldUseBurstAbility() && (!Settings.BurstIncludeBloodFury || this.shouldUseBurstAbility()) && (!this.hasTalent("Ascendance") || me.hasAura(auras.ascendance) || spell.getCooldown("Ascendance").timeleft > 50000)),
      spell.cast("Berserking", () => Settings.UseBerserking && this.shouldUseBurstAbility() && (!this.hasTalent("Ascendance") || me.hasAura(auras.ascendance))),
      spell.cast("Fireblood", () => Settings.UseFireblood && this.shouldUseBurstAbility() && (!this.hasTalent("Ascendance") || me.hasAura(auras.ascendance) || spell.getCooldown("Ascendance").timeleft > 50000)),
      spell.cast("Ancestral Call", () => Settings.UseAncestralCall && this.shouldUseBurstAbility() && (!this.hasTalent("Ascendance") || me.hasAura(auras.ascendance) || spell.getCooldown("Ascendance").timeleft > 50000))
    );
  }

  buildAoERotation() {
    return new bt.Selector(
      // Fire Elemental
      spell.cast("Fire Elemental", () => Settings.UseFireElemental && this.overlayToggles.elementals.value && this.shouldUseBurstAbility() && this.canCastWhileMoving()),
      
      // Storm Elemental
      spell.cast("Storm Elemental", () => Settings.UseStormElemental && this.overlayToggles.elementals.value && this.shouldUseBurstAbility() && (!me.hasAura("Storm Elemental") || !this.hasTalent("Echo of the Elementals")) && !me.hasAura(auras.ancestralSwiftness) && this.canCastWhileMoving()),
      
      // Stormkeeper
      spell.cast("Stormkeeper", () => Settings.UseStormkeeper && this.overlayToggles.stormkeeper.value && (this.hasTalent("Herald of the Storms") || spell.getCooldown("Primordial Wave").timeleft < 1500 || !this.hasTalent("Primordial Wave")) && this.canCastWhileMoving()),
      
      // Liquid Magma Totem for Flame Shock spread
      spell.cast("Liquid Magma Totem", on => this.getCurrentTarget(), req => 
        (spell.getCooldown("Primordial Wave").timeleft < 7500 || !this.hasTalent("Primordial Wave")) &&
        (this.getActiveFlameShockCount() <= this.getEnemiesAroundTarget() - 3 || this.getActiveFlameShockCount() < Math.min(this.getEnemiesAroundTarget(), 3))
      ),
      
      // Flame Shock for Primordial Wave setup
      spell.cast("Flame Shock", on => this.getTargetWithoutFlameShock(), req => 
        (spell.getCooldown("Primordial Wave").timeleft < 1500 || spell.getCooldown("Primodial Wave").ready)&& 
        (this.hasTalent(375982) || this.getEnemiesAroundTarget() <= 3) && 
        spell.getCooldown("Ascendance").timeleft > 10000
      ),
      
      // Primordial Wave
      spell.cast("Primordial Wave", on => this.getCurrentTarget(), req => 
        this.getActiveFlameShockCount() === Math.min(this.getEnemiesAroundTarget(), 6) ||
        (spell.getCooldown("Liquid Magma Totem").timeleft > 15000 || !this.hasTalent("Liquid Magma Totem")) &&
        spell.getCooldown("Ascendance").timeleft > 15000
      ),
      
      // Ancestral Swiftness
      spell.cast("Ancestral Swiftness"),
      
      // Ascendance
      spell.cast("Ascendance", () => Settings.UseAscendance && this.overlayToggles.ascendance.value && this.shouldUseBurstAbility() && this.shouldUseAscendance() && (me.hasAura(auras.furyOfTheStorms) || !this.hasTalent("Fury of the Storms")) && this.canCastWhileMoving()),
      
      // Tempest with Surge of Power
      spell.cast("Tempest", on => this.getTargetWithMinLightningRod(), req => 
        me.getAuraStacks(auras.arcDischarge) < 2 && 
        (me.hasAura(auras.surgeOfPower) || !this.hasTalent("Surge of Power"))
      ),
      
      // Lightning Bolt with Stormkeeper and Surge of Power on 2 targets
      spell.cast("Lightning Bolt", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura(auras.stormkeeper) && 
        me.hasVisibleAura(auras.surgeOfPower) && 
        this.getEnemiesAroundTarget() === 2
      ),
      
      // Chain Lightning with Surge of Power on 6+ targets
      spell.cast("Chain Lightning", on => this.getCurrentTarget(), req => 
        this.getEnemiesAroundTarget() >= 6 && 
        me.hasVisibleAura(auras.surgeOfPower)
      ),
      
      // Lightning Bolt with Storm Frenzy and Stormkeeper
      spell.cast("Lightning Bolt", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.stormFrenzy) === 2 && 
        !this.hasTalent("Surge of Power") && 
        this.getCurrentMaelstrom() < this.maelCapVariable - (15 + (me.hasVisibleAura(auras.stormkeeper) ? this.getEnemiesAroundTarget() * this.getEnemiesAroundTarget() : 0)) &&
        me.hasVisibleAura(auras.stormkeeper) && 
        !me.hasVisibleAura(auras.callOfTheAncestors) && 
        this.getEnemiesAroundTarget() === 2
      ),
      
      // Chain Lightning with Storm Frenzy
      spell.cast("Chain Lightning", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.stormFrenzy) === 2 && 
        !this.hasTalent("Surge of Power") && 
        this.getCurrentMaelstrom() < this.maelCapVariable - (15 + (me.hasVisibleAura(auras.stormkeeper) ? this.getEnemiesAroundTarget() * this.getEnemiesAroundTarget() : 0))
      ),
      
      // Lava Burst with Fusion of Elements
      spell.cast("Lava Burst", on => this.getTargetWithFlameShock(), req => 
        spell.getCooldown("Lava Burst").ready && 
        me.hasVisibleAura(auras.lavaSurge) && 
        me.hasVisibleAura(auras.fusionOfElementsFire) && 
        !me.hasVisibleAura(auras.masterOfTheElements) && 
        (this.getCurrentMaelstrom() > 52 - 5 * (this.hasTalent("Eye of the Storm") ? 1 : 0) && 
        (me.hasVisibleAura(auras.echoesOfGreatSunderingES) || !this.hasTalent("Echoes of Great Sundering")))
      ),
      
      // Earthquake spender
      spell.cast("Earthquake", on => this.getCurrentTarget(), req => 
        (this.getCurrentMaelstrom() > this.maelCapVariable - 10 * (this.getEnemiesAroundTarget() + 1) ||
        me.hasVisibleAura(auras.masterOfTheElements) ||
        me.hasVisibleAura(auras.ascendance) && this.getAuraRemainingTime(auras.ascendance) < 3000) &&
        (me.hasVisibleAura(auras.echoesOfGreatSunderingES) || me.hasVisibleAura(auras.echoesOfGreatSunderingEB) || 
        (!this.hasTalent("Echoes of Great Sundering") && (!this.hasTalent("Elemental Blast") || this.getEnemiesAroundTarget() > 1 + 3 * (this.hasTalent("Tempest") ? 1 : 0))))
      ),
      
      // Elemental Blast spender
      spell.cast("Elemental Blast", on => this.getTargetWithMinLightningRod(), req => 
        (this.getCurrentMaelstrom() > this.maelCapVariable - 10 * (this.getEnemiesAroundTarget() + 1) ||
        me.hasVisibleAura(auras.masterOfTheElements) ||
        me.hasVisibleAura(auras.ascendance) && this.getAuraRemainingTime(auras.ascendance) < 3000)
      ),
      
      // Earth Shock spender
      spell.cast("Earth Shock", on => this.getTargetWithMinLightningRod(), req => 
        (this.getCurrentMaelstrom() > this.maelCapVariable - 10 * (this.getEnemiesAroundTarget() + 1) ||
        me.hasVisibleAura(auras.masterOfTheElements) ||
        me.hasVisibleAura(auras.ascendance) && this.getAuraRemainingTime(auras.ascendance) < 3000)
      ),
      
      // Icefury for Fusion of Elements
      spell.cast("Icefury", () => 
        this.hasTalent("Fusion of Elements") && 
        !(me.hasVisibleAura(auras.fusionOfElementsNature) || me.hasVisibleAura(auras.fusionOfElementsFire)) &&
        (this.getEnemiesAroundTarget() <= 4 || !this.hasTalent("Elemental Blast") || !this.hasTalent("Echoes of Great Sundering"))
      ),
      
      // Lava Burst for Master of the Elements on 2-3 targets
      spell.cast("Lava Burst", on => this.getTargetWithFlameShock(), req => 
        spell.getCooldown("Lava Burst").ready && 
        me.hasVisibleAura(auras.lavaSurge) && 
        !me.hasVisibleAura(auras.masterOfTheElements) && 
        this.hasTalent("Master of the Elements") && 
        this.getEnemiesAroundTarget() <= 3
      ),
      
      // Frost Shock with Icefury
      spell.cast("Frost Shock", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura(auras.icefuryDmg) && 
        !me.hasVisibleAura(auras.ascendance) && 
        !me.hasVisibleAura(auras.stormkeeper) &&
        (me.hasAura(443450) || this.getEnemiesAroundTarget() <= 3)
      ),
      
      // Chain Lightning filler
      spell.cast("Chain Lightning", on => this.getCurrentTarget()),
      
      // Movement abilities - Lava Burst with Lava Surge (instant cast)
      spell.cast("Lava Burst", on => this.getTargetWithFlameShock(), req => me.isMoving() && me.hasVisibleAura(auras.lavaSurge) && this.getTargetWithFlameShock() !== null, { skipMovingCheck: true }),
      
      spell.cast("Flame Shock", on => this.getCurrentTarget(), req => me.isMoving() && this.getCurrentTarget() && !this.getCurrentTarget().hasAuraByMe(auras.flameShock)),
      spell.cast("Frost Shock", on => this.getCurrentTarget(), req => me.isMoving())
    );
  }

  buildSingleTargetRotation() {
    return new bt.Selector(
      // Fire Elemental
      spell.cast("Fire Elemental", () => Settings.UseFireElemental && this.overlayToggles.elementals.value && this.shouldUseBurstAbility() && this.canCastWhileMoving()),
      
      // Storm Elemental
      spell.cast("Storm Elemental", () => Settings.UseStormElemental && this.overlayToggles.elementals.value && this.shouldUseBurstAbility() && (!me.hasAura("Storm Elemental") || !this.hasTalent("Echo of the Elementals")) && !me.hasAura(auras.ancestralSwiftness) && this.canCastWhileMoving()),
      
      // Stormkeeper
      spell.cast("Stormkeeper", () => Settings.UseStormkeeper && this.overlayToggles.stormkeeper.value && (this.hasTalent("Herald of the Storms") || spell.getCooldown("Primordial Wave").timeleft < 1500 || !this.hasTalent("Primordial Wave")) && this.canCastWhileMoving()),
      
      // Liquid Magma Totem for Flame Shock application
      spell.cast("Liquid Magma Totem", on => this.getCurrentTarget(), req => 
        this.getActiveFlameShockCount() === 0 && 
        !me.hasVisibleAura(auras.surgeOfPower) && 
        !me.hasVisibleAura(auras.masterOfTheElements)
      ),
      
      // Liquid Magma Totem for refreshable Flame Shock
      spell.cast("Liquid Magma Totem", on => this.getCurrentTarget(), req => 
        this.getCurrentTarget() && this.getCurrentTarget().getAuraByMe(auras.flameShock) && 
        this.getDebuffRemainingTime(auras.flameShock) < 5400 &&
        !me.hasVisibleAura(auras.surgeOfPower) && 
        !me.hasVisibleAura(auras.masterOfTheElements) && 
        spell.getCooldown("Ascendance").ready
      ),
      
      // Flame Shock application
      spell.cast("Flame Shock", on => this.getCurrentTarget(), req => 
        this.getActiveFlameShockCount() === 0 && 
        !me.hasVisibleAura(auras.surgeOfPower) && 
        !me.hasVisibleAura(auras.masterOfTheElements)
      ),
      
      // Primordial Wave
      spell.cast("Primordial Wave", on => this.getCurrentTarget()),
      
      // Ancestral Swiftness
      spell.cast("Ancestral Swiftness"),
      
      // Ascendance
      spell.cast("Ascendance", () => Settings.UseAscendance && this.overlayToggles.ascendance.value && this.shouldUseBurstAbility() && this.shouldUseAscendance() && (me.hasVisibleAura(auras.furyOfTheStorms) || !this.hasTalent("Fury of the Storms")) && (spell.getCooldown("Primordial Wave").timeleft > 25000 || !this.hasTalent("Primordial Wave")) && this.canCastWhileMoving()),
      
      // Tempest with Surge of Power
      spell.cast("Tempest", on => this.getCurrentTarget(), req => me.hasVisibleAura(auras.surgeOfPower)),
      
      // Lightning Bolt with Surge of Power
      spell.cast("Lightning Bolt", on => this.getCurrentTarget(), req => me.hasVisibleAura(auras.surgeOfPower)),
      
      // Tempest with Storm Frenzy
      spell.cast("Tempest", on => this.getCurrentTarget(), req => me.getAuraStacks(auras.stormFrenzy) === 2 && !this.hasTalent("Surge of Power")),
      
      // Liquid Magma Totem for ancestors multicasting
      spell.cast("Liquid Magma Totem", on => this.getCurrentTarget(), req => 
        this.getCurrentTarget() && this.getCurrentTarget().getAuraByMe(auras.flameShock) && 
        this.getDebuffRemainingTime(auras.flameShock) < 5400 &&
        !me.hasVisibleAura(auras.masterOfTheElements) && 
        !this.hasTalent("Call of the Ancestors")
      ),
      
      // Liquid Magma Totem general usage
      spell.cast("Liquid Magma Totem", on => this.getCurrentTarget(), req => 
        spell.getCooldown("Primordial Wave").timeleft > 24000 && 
        !me.hasVisibleAura(auras.ascendance) && 
        this.getCurrentMaelstrom() < this.maelCapVariable - 10 && 
        !me.hasVisibleAura(auras.ancestralSwiftness) && 
        !me.hasVisibleAura(auras.masterOfTheElements)
      ),
      
      // Flame Shock refresh for Erupting Lava
      spell.cast("Flame Shock", on => this.getCurrentTarget(), req => 
        this.getCurrentTarget() && this.getCurrentTarget().getAuraByMe(auras.flameShock) && 
        this.getDebuffRemainingTime(auras.flameShock) < 5400 &&
        !me.hasVisibleAura(auras.surgeOfPower) && 
        !me.hasVisibleAura(auras.masterOfTheElements) && 
        this.hasTalent("Erupting Lava")
      ),
      
      // Elemental Blast spender
      spell.cast("Elemental Blast", on => this.getCurrentTarget(), req => 
        this.getCurrentMaelstrom() > this.maelCapVariable - 15 || 
        me.hasVisibleAura(auras.masterOfTheElements) || 
        (me.hasVisibleAura(auras.ancestralSwiftness) && this.getAuraRemainingTime(auras.ancestralSwiftness) < 2000)
      ),
      
      // Earth Shock spender
      spell.cast("Earth Shock", on => this.getCurrentTarget(), req => 
        this.getCurrentMaelstrom() > this.maelCapVariable - 15 || 
        me.hasVisibleAura(auras.masterOfTheElements) || 
        (me.hasAura(auras.ancestralSwiftness) && this.getAuraRemainingTime(auras.ancestralSwiftness) < 2000)
      ),
      
      // Icefury for Fusion of Elements
      spell.cast("Icefury", () => !(me.hasVisibleAura(auras.fusionOfElementsNature) || me.hasVisibleAura(auras.fusionOfElementsFire))),
      
      // Lava Burst for Master of the Elements
      spell.cast("Lava Burst", on => this.getTargetWithFlameShock(), req => 
        !me.hasVisibleAura(auras.masterOfTheElements) && 
        (me.hasVisibleAura(auras.lavaSurge) || me.hasVisibleAura(auras.tempest) || me.hasVisibleAura(auras.stormkeeper) || 
        spell.getCharges("Lava Burst") > 1.8 || this.getCurrentMaelstrom() > this.maelCapVariable - 30)
      ),
      
      // Tempest
      spell.cast("Tempest", on => this.getCurrentTarget()),
      
      // Lightning Bolt with Wind Gust stacking
      spell.cast("Lightning Bolt", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura("Storm Elemental") && 
        me.getAuraStacks(auras.windGust) < 4
      ),
      
      // Frost Shock with Icefury
      spell.cast("Frost Shock", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura(auras.icefuryDmg) && 
        !me.hasVisibleAura(auras.ascendance) && 
        !me.hasVisibleAura(auras.stormkeeper) && 
        this.hasTalent("Call of the Ancestors")
      ),
      
      // Lightning Bolt filler
      spell.cast("Lightning Bolt", on => this.getCurrentTarget()),
      
      // Movement abilities - Lava Burst with Lava Surge (instant cast)
      spell.cast("Lava Burst", on => this.getTargetWithFlameShock(), req => me.isMoving() && me.hasVisibleAura(auras.lavaSurge) && this.getTargetWithFlameShock() !== null, { skipMovingCheck: true }),
      
      spell.cast("Flame Shock", on => this.getCurrentTarget(), req => me.isMoving() && this.getCurrentTarget() && !this.getCurrentTarget().hasAuraByMe(auras.flameShock)),
      spell.cast("Flame Shock", on => this.getCurrentTarget(), req => me.isMoving() && me.distanceTo(this.getCurrentTarget()) > 6),
      spell.cast("Frost Shock", on => this.getCurrentTarget(), req => me.isMoving())
    );
  }

  // Helper methods
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.distanceTo(unit) <= 40 && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getEnemiesAroundTarget(range = 8) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    return target.getUnitsAroundCount(range);
  }

  getCurrentMaelstrom() {
    return me.powerByType(PowerType.Maelstrom) || 0;
  }

  getMaxMaelstrom() {
    return me.maxPowerByType(PowerType.Maelstrom) || 100;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  getAuraRemainingTime(auraId) {
    const aura = me.getAura(auraId);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffId) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAuraByMe(debuffId);
    return debuff ? debuff.remaining : 0;
  }

  getActiveFlameShockCount() {
    const enemies = combat.targets.filter(target => 
      common.validTarget(target) && 
      me.distanceTo(target) <= 40 && 
      target.hasAuraByMe(auras.flameShock)
    );
    return enemies.length;
  }

  getTargetWithoutFlameShock() {
    const enemies = combat.targets.filter(target => 
      common.validTarget(target) && 
      me.distanceTo(target) <= 40 && 
      me.isFacing(target) &&
      !target.hasAuraByMe(auras.flameShock)
    );
    return enemies[0] || null;
  }

  getTargetWithFlameShock() {
    const enemies = combat.targets.filter(target => 
      common.validTarget(target) && 
      me.distanceTo(target) <= 40 && 
      me.isFacing(target) &&
      target.hasAuraByMe(auras.flameShock) &&
      target.getAuraByMe(auras.flameShock).remaining >= 2000
    );
    return enemies[0] || null;
  }

  getTargetWithMinLightningRod() {
    if (!this.hasTalent("Lightning Rod")) {
      return this.getCurrentTarget();
    }
    
    const enemies = combat.targets.filter(target => 
      common.validTarget(target) && 
      me.distanceTo(target) <= 40 && 
      me.isFacing(target)
    );
    
    // Sort by lightning rod remaining time (ascending)
    enemies.sort((a, b) => {
      const aRod = a.getAura(auras.lightningRod);
      const bRod = b.getAura(auras.lightningRod);
      const aTime = aRod ? aRod.remaining : 0;
      const bTime = bRod ? bRod.remaining : 0;
      return aTime - bTime;
    });
    
    return enemies[0] || null;
  }

  shouldUseAscendance() {
    if (!this.hasTalent("First Ascendant")) {
      // Add other ascendance conditions here based on fight length, trinkets, etc.
      return true;
    }
    return true;
  }

  // Burst system methods (from JmrSimcFury.js)
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

  canCastWhileMoving() {
    return !me.isMoving() || me.hasAura(auras.spiritWalkersGrace);
  }

  // Utility helper methods
  shouldUsePoisonCleansing() {
    // Check if any party member has poison debuff
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend && !friend.deadOrGhost && friend.hasAura("Poison")) {
        return true;
      }
    }
    return false;
  }

  getPurgeTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy && !enemy.deadOrGhost && me.distanceTo(enemy) <= 30) {
        // Check for magic buffs that can be purged
        const auras = enemy.auras;
        for (const aura of auras) {
          if (aura.dispelType === WoWDispelType.Magic && !aura.isDebuff) {
            return enemy;
          }
        }
      }
    }
    return null;
  }

  getActiveTankWithoutEarthShield() {
    const tanks = heal.friends.Tanks;

    // First, try to find an active tank without Earth Shield
    const activeTankWithoutShield = tanks.find(tank =>
      tank && !tank.deadOrGhost && tank.isTanking() && !tank.hasAura(auras.earthShield) && 
      me.distanceTo(tank) <= 40 && me.withinLineOfSight(tank)
    );

    if (activeTankWithoutShield) {
      return activeTankWithoutShield;
    }

    // If no active tank without shield, just return any tank without shield
    return tanks.find(tank => 
      tank && !tank.deadOrGhost && !tank.hasAura(auras.earthShield) && 
      me.distanceTo(tank) <= 40 && me.withinLineOfSight(tank)
    ) || null;
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

    if (imgui.begin("Elemental Shaman Controls", this.overlayToggles.showOverlay, windowFlags)) {
      
      // Major Cooldowns section - collapsible
      if (imgui.collapsingHeader("Major Cooldowns", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        // Stormkeeper toggle
        const stormkeeperColor = this.overlayToggles.stormkeeper.value ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, stormkeeperColor);
        imgui.checkbox("Stormkeeper", this.overlayToggles.stormkeeper);
        imgui.popStyleColor();
        
        // Ascendance toggle  
        const ascendanceColor = this.overlayToggles.ascendance.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, ascendanceColor);
        imgui.checkbox("Ascendance", this.overlayToggles.ascendance);
        imgui.popStyleColor();
        
        // Elementals toggle  
        const elementalsColor = this.overlayToggles.elementals.value ?
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        imgui.pushStyleColor(imgui.Col.Text, elementalsColor);
        imgui.checkbox("Elementals", this.overlayToggles.elementals);
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
          
          const windShearColor = this.overlayToggles.windShear.value ?
            { r: 0.2, g: 0.8, b: 1.0, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.pushStyleColor(imgui.Col.Text, windShearColor);
          imgui.checkbox("Wind Shear", this.overlayToggles.windShear);
          imgui.popStyleColor();
          
          imgui.unindent();
        }
        
        imgui.unindent();
      }

      // Burst Status section
      imgui.spacing();
      imgui.separator();
      
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
        imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, "Burst Toggle Disabled");
      }
      
      imgui.spacing();
      
      // Spell cycling status
      if (this.isCycling) {
        imgui.spacing();
        imgui.separator();
        imgui.textColored({ r: 0.2, g: 1.0, b: 0.8, a: 1.0 }, "Spell Cycling Active");
        const progress = (this.currentSpellId / this.maxSpellId) * 100;
        imgui.text(`Progress: ${this.currentSpellId.toLocaleString()}/${this.maxSpellId.toLocaleString()} (${progress.toFixed(3)}%)`);
        imgui.progressBar(this.currentSpellId / this.maxSpellId, { x: 200, y: 0 });
        
        if (imgui.button("Stop Cycling", { x: 100, y: 0 })) {
          this.isCycling = false;
          this.currentSpellId = 0;
          console.log("Spell cycling stopped manually");
        }
      } else {
        imgui.spacing();
        imgui.text("Press LeftArrow to cycle ALL spell IDs (0-9,999,999)");
      }
      
      imgui.spacing();
      
      // Quick controls
      if (imgui.button("Enable All", { x: 100, y: 0 })) {
        this.overlayToggles.interrupts.value = true;
        this.overlayToggles.stormkeeper.value = true;
        this.overlayToggles.ascendance.value = true;
        this.overlayToggles.elementals.value = true;
        this.overlayToggles.windShear.value = true;
      }
      
      imgui.sameLine();
      
      if (imgui.button("Disable All", { x: 100, y: 0 })) {
        this.overlayToggles.interrupts.value = false;
        this.overlayToggles.stormkeeper.value = false;
        this.overlayToggles.ascendance.value = false;
        this.overlayToggles.elementals.value = false;
        this.overlayToggles.windShear.value = false;
      }
      
      imgui.end();
    }
  }
}
