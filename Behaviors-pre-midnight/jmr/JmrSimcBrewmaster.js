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

const auras = {
  // Buffs
  blackoutComboBuff: 228563,
  aspectOfHarmonyAccumulator: 443506,
  weaponsOfOrder: 310454,
  weaponsOfOrderBuff: 387184,
  callToArmsInvokeNiuzao: 395519,
  invokeNiuzao: 132578,
  balancedStratagemMagic: 394012,
  charredPassions: 386965,
  rushingJadeWind: 116847,
  elusiveBrawler: 195630,
  celestialInfusion: 325153,
  fortifyingBrew: 120954,
  dampenHarm: 122278,
  vivaciousVivication: 392883,
  innerResilience: 451508,
  
  // Debuffs
  weaponsOfOrderDebuff: 312106,
  aspectOfHarmonyDamage: 443506,
  breathOfFire: 123725,
  
  // Stagger levels
  lightStagger: 124275,
  moderateStagger: 124274,
  heavyStagger: 124273,
  
  // Talents (checked via hasAura)
  aspectOfHarmony: 443506,
  weaponsOfOrderTalent: 387184,
  callToArms: 395519,
  fluidityOfMotion: 387230,
  scaldingBrew: 383994,
  charredPassionsTalent: 386965,
  rushingJadeWindTalent: 116847,
  strengthOfSpirit: 387276
};

export class JmrSimcBrewmasterBehavior extends Behavior {
  name = "Jmr SimC Brewmaster Monk";
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Brewmaster;
  version = 1;

  // Runtime toggles for overlay
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(true),
    defensives: new imgui.MutableVariable(true),
    interrupts: new imgui.MutableVariable(true),
    cooldowns: new imgui.MutableVariable(true)
  };

  // Burst mode toggle state
  burstModeActive = false;
  burstToggleTime = 0;

  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("100784"); // Default to Blackout Kick

  // Spell cycling system - cycles through ALL possible spell IDs
  maxSpellId = 999999;
  currentSpellId = 65000;
  lastSpellCycleTime = 0;
  isCycling = false;

  // Damage tracking for defensives
  damageTracker = [];
  staggerFull = 0;
  staggerDamage = [];
  incomingDamage = [];

  constructor() {
    super();
    // Initialize the burst toggle keybinding with default
    KeyBinding.setDefault("BurstToggleKeybind", imgui.Key.F1);
  }

  static settings = [
    {
      header: "DPS Settings",
      options: [
        { type: "checkbox", uid: "UseTouchOfDeath", text: "Use Touch of Death", default: true },
        { type: "checkbox", uid: "TouchOfDeathOnBoss", text: "Touch of Death on Boss", default: true },
        { type: "checkbox", uid: "TouchOfDeathOnElite", text: "Touch of Death on Elite", default: true },
        { type: "checkbox", uid: "TouchOfDeathOnNormal", text: "Touch of Death on Normal", default: false }
      ]
    },
    {
      header: "Threat Management",
      options: [
        { type: "checkbox", uid: "UseThreatGathering", text: "Use Threat Gathering", default: true },
        { type: "checkbox", uid: "ThreatGatheringDebug", text: "Debug Threat Targeting", default: false }
      ]
    },
    {
      header: "Defensive Settings",
      options: [
        { type: "checkbox", uid: "UseFortifyingBrew", text: "Use Fortifying Brew", default: true },
        { type: "slider", uid: "FortifyingBrewHealthPct", text: "Fortifying Brew Health %", min: 1, max: 100, default: 40 },
        { type: "checkbox", uid: "UseDampenHarm", text: "Use Dampen Harm", default: true },
        { type: "slider", uid: "DampenHarmHealthPct", text: "Dampen Harm Health %", min: 1, max: 100, default: 50 },
        { type: "checkbox", uid: "UseDiffuseMagic", text: "Use Diffuse Magic", default: true },
        { type: "slider", uid: "DiffuseMagicHealthPct", text: "Diffuse Magic Health %", min: 1, max: 100, default: 80 },
        { type: "checkbox", uid: "UseExpelHarmLow", text: "Use Expel Harm (Low Orbs)", default: true },
        { type: "slider", uid: "ExpelHarmLowHealthPct", text: "Expel Harm Low Health %", min: 1, max: 100, default: 50 },
        { type: "checkbox", uid: "UseExpelHarmHigh", text: "Use Expel Harm (High Orbs)", default: true },
        { type: "slider", uid: "ExpelHarmHighHealthPct", text: "Expel Harm High Health %", min: 1, max: 100, default: 75 },
        { type: "checkbox", uid: "UsePurifyingBrew", text: "Use Purifying Brew", default: true },
        { type: "slider", uid: "PurifyingBrewStaggerPct", text: "Purifying Brew Stagger %", min: 1, max: 100, default: 30 },
        { type: "checkbox", uid: "UseVivify", text: "Use Vivify (Vivacious Vivification)", default: true },
        { type: "slider", uid: "VivifyHealthPct", text: "Vivify Health %", min: 1, max: 100, default: 75 },
        { type: "slider", uid: "CelestialBrewStacks", text: "Celestial Brew Stacks", min: 1, max: 10, default: 3 },
        { type: "slider", uid: "CelestialInfusionHealthPct", text: "Celestial Infusion Health %", min: 1, max: 100, default: 15 }
      ]
    },
    {
      header: "Interrupts & Utility",
      options: [
        { type: "checkbox", uid: "UseProvoke", text: "Taunt", default: true },
        { type: "checkbox", uid: "UseSpearHandStrike", text: "Use Spear Hand Strike (Interrupt)", default: true }
      ]
    },
    {
      header: "Cooldown Usage",
      options: [
        { type: "checkbox", uid: "UseWeaponsOfOrder", text: "Use Weapons of Order", default: true },
        { type: "checkbox", uid: "UseInvokeNiuzao", text: "Use Invoke Niuzao", default: true },
        { type: "checkbox", uid: "UseBlackOxBrew", text: "Use Black Ox Brew", default: true }
      ]
    },
    {
      header: "Racial Abilities",
      options: [
        { type: "checkbox", uid: "UseBloodFury", text: "Use Blood Fury", default: true },
        { type: "checkbox", uid: "UseBerserking", text: "Use Berserking", default: true },
        { type: "checkbox", uid: "UseArcaneTorrent", text: "Use Arcane Torrent", default: true },
        { type: "checkbox", uid: "UseLightsJudgment", text: "Use Light's Judgment", default: true },
        { type: "checkbox", uid: "UseFireblood", text: "Use Fireblood", default: true },
        { type: "checkbox", uid: "UseAncestralCall", text: "Use Ancestral Call", default: true },
        { type: "checkbox", uid: "UseBagOfTricks", text: "Use Bag of Tricks", default: true }
      ]
    },
    {
      header: "Burst Toggle System",
      options: [
        { type: "checkbox", uid: "UseBurstToggle", text: "Use Burst Toggle", default: true },
        { type: "hotkey", uid: "BurstToggleKeybind", text: "Burst Toggle Key", default: imgui.Key.F1 },
        { type: "checkbox", uid: "BurstModeWindow", text: "Use Window Mode (unchecked = Toggle Mode)", default: false },
        { type: "slider", uid: "BurstWindowDuration", text: "Burst Window Duration (seconds)", min: 5, max: 60, default: 15 }
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
            this.currentSpellId = 65000;
            this.lastSpellCycleTime = Date.now();
            console.info(`Started spell cycling from ${this.currentSpellId.toLocaleString()} to ${this.maxSpellId.toLocaleString()}`);
          }
        }

        // Handle burst toggle system
        this.handleBurstToggle();
        
        // Handle spell cycling with 1ms delay
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
              console.info(`Finished cycling through all spell IDs (${this.currentSpellId.toLocaleString()} to ${this.maxSpellId.toLocaleString()})`);
              this.isCycling = false;
              this.currentSpellId = 65000;
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
      spell.cast("Provoke",
        on => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking),
        req => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking) !== undefined),
      spell.cast("Spinning Crane Kick",
        on => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 10 && !unit.isTanking),
        req => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 10 && !unit.isTanking) !== undefined),
      spell.cast("Crackling Jade Lightning",
        on => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 40 && unit.distanceTo(me) > 10 && !unit.isTanking),
        req => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 40 && unit.distanceTo(me) > 10 && !unit.isTanking) !== undefined),
      // Precombat preparation
      new bt.Decorator(
        () => !me.inCombat(),
        this.buildPrecombat(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Main rotation
      new bt.Selector(
        // Interrupts
        new bt.Decorator(
          () => Settings.UseSpearHandStrike && this.overlayToggles.interrupts.value,
          spell.interrupt("Spear Hand Strike"),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Defensives (only when tanking)
        new bt.Decorator(
          () => this.isTanking() && this.overlayToggles.defensives.value,
          this.buildDefensives(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Racial abilities
        new bt.Decorator(
          () => me.inCombat(),
          this.buildRacials(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Main rotation
        new bt.Decorator(
          () => me.inCombat(),
          this.buildMainRotation(),
          new bt.Action(() => bt.Status.Success)
        ),
      ),
    );
  }

  buildPrecombat() {
    return new bt.Selector(
      // Chi Burst
      spell.cast("Chi Burst"),
      
      // Keg Smash opener
      spell.cast("Keg Smash", on => this.getCurrentTarget())
    );
  }

  buildDefensives() {
    return new bt.Selector(
      // Celestial Brew with Aspect of Harmony conditions
      spell.cast("Celestial Brew", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth && 
        me.hasAura(auras.weaponsOfOrder) && 
        !this.getCurrentTarget()?.hasAura(auras.aspectOfHarmonyDamage)
      ),
      
      spell.cast("Celestial Brew", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth && 
        !this.hasTalent("Weapons of Order") && 
        !this.getCurrentTarget()?.hasAura(auras.aspectOfHarmonyDamage)
      ),
      
      spell.cast("Celestial Brew", () => 
        this.getTargetTimeToDeath() < 20 && 
        this.getTargetTimeToDeath() > 14 && 
        this.getAspectOfHarmonyValue() > 0.2 * me.maxHealth
      ),
      
      spell.cast("Celestial Brew", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth && 
        spell.getCooldown("Weapons of Order").timeleft > 20000 && 
        !this.getCurrentTarget()?.hasAura(auras.aspectOfHarmonyDamage)
      ),
      
      spell.cast("Celestial Brew", () => 
        !me.hasAura(auras.blackoutComboBuff) && 
        (spell.getCharges("Celestial Brew") > 1.8 || 
        (spell.getCharges("Celestial Brew") > 1.2 && spell.getCooldown("Black Ox Brew").ready))
      ),

      spell.cast("Celestial Infusion", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth && 
        me.hasAura(auras.weaponsOfOrder) && 
        !this.getCurrentTarget()?.hasAura(auras.aspectOfHarmonyDamage)
      ),
      
      spell.cast("Celestial Infusion", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth && 
        !this.hasTalent("Weapons of Order") && 
        !this.getCurrentTarget()?.hasAura(auras.aspectOfHarmonyDamage)
      ),
      
      spell.cast("Celestial Infusion", () => 
        this.getTargetTimeToDeath() < 20 && 
        this.getTargetTimeToDeath() > 14 && 
        this.getAspectOfHarmonyValue() > 0.2 * me.maxHealth
      ),
      
      spell.cast("Celestial Infusion", () => 
        this.getAspectOfHarmonyValue() > 0.3 * me.maxHealth && 
        spell.getCooldown("Weapons of Order").timeleft > 20000 && 
        !this.getCurrentTarget()?.hasAura(auras.aspectOfHarmonyDamage)
      ),
      
      spell.cast("Celestial Infusion", () => 
        !me.hasAura(auras.blackoutComboBuff) && 
        (spell.getCharges("Celestial Infusion") > 1.8 || 
        (spell.getCharges("Celestial Infusion") > 1.2 && spell.getCooldown("Black Ox Brew").ready))
      ),
      
      // Purifying Brew
      spell.cast("Purifying Brew", () => 
        Settings.UsePurifyingBrew && 
        this.shouldPurify() && 
        !me.hasAura(auras.blackoutComboBuff)
      ),
      
      // Expel Harm with orb count logic
      spell.cast("Expel Harm", () => 
        Settings.UseExpelHarmLow && 
        me.pctHealth <= Settings.ExpelHarmLowHealthPct && 
        this.getExpelHarmOrbCount() <= 3
      ),
      
      spell.cast("Expel Harm", () => 
        Settings.UseExpelHarmHigh && 
        me.pctHealth <= Settings.ExpelHarmHighHealthPct && 
        this.getExpelHarmOrbCount() > 3
      ),
      
      // Dampen Harm
      spell.cast("Dampen Harm", () => 
        Settings.UseDampenHarm && 
        !me.hasAura(auras.fortifyingBrew) && 
        me.pctHealth <= Settings.DampenHarmHealthPct
      ),
      
      // Fortifying Brew
      spell.cast("Fortifying Brew", () => 
        Settings.UseFortifyingBrew && 
        !me.hasAura(auras.dampenHarm) && 
        me.pctHealth <= Settings.FortifyingBrewHealthPct
      ),
      
      // Vivify with proc
      spell.cast("Vivify", () => 
        Settings.UseVivify && 
        me.hasAura(auras.vivaciousVivication) && 
        me.pctHealth <= Settings.VivifyHealthPct
      ),
      
      // Diffuse Magic
      spell.cast("Diffuse Magic", () => 
        Settings.UseDiffuseMagic && 
        me.pctHealth <= Settings.DiffuseMagicHealthPct && 
        this.shouldUseDiffuseMagic()
      )
    );
  }

  buildRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", () => Settings.UseBloodFury && this.shouldUseBurstAbility()),
      spell.cast("Berserking", () => Settings.UseBerserking && this.shouldUseBurstAbility()),
      spell.cast("Arcane Torrent", () => Settings.UseArcaneTorrent && this.shouldUseBurstAbility()),
      spell.cast("Light's Judgment", () => Settings.UseLightsJudgment && this.shouldUseBurstAbility()),
      spell.cast("Fireblood", () => Settings.UseFireblood && this.shouldUseBurstAbility()),
      spell.cast("Ancestral Call", () => Settings.UseAncestralCall && this.shouldUseBurstAbility()),
      spell.cast("Bag of Tricks", () => Settings.UseBagOfTricks && this.shouldUseBurstAbility())
    );
  }

  buildMainRotation() {
    return new bt.Selector(
      common.useTrinkets(() => this.getCurrentTarget(), () => me.hasVisibleAura(auras.weaponsOfOrderBuff)),
      
      // Immediate threat response - Provoke (taunt) high priority targets
      spell.cast("Provoke", on => this.getHighPriorityThreatTarget(), req => 
        Settings.UseProvoke && 
        Settings.UseThreatGathering && 
        this.getHighPriorityThreatTarget() !== null
      ),
      
      // Threat gathering with Crackling Jade Lightning (ranged enemies)
      spell.cast("Crackling Jade Lightning", on => this.getThreatTargetRanged(), req => 
        Settings.UseThreatGathering && 
        this.getThreatTargetRanged() !== null && 
        me.distanceTo(this.getThreatTargetRanged()) > 10
      ),
      
      // Threat gathering with Spinning Crane Kick (melee enemies)  
      spell.cast("Spinning Crane Kick", on => this.getThreatTargetMelee(), req => 
        Settings.UseThreatGathering && 
        this.getThreatTargetMelee() !== null && 
        me.distanceTo(this.getThreatTargetMelee()) <= 10
      ),
      
      // Black Ox Brew
      spell.cast("Black Ox Brew", () => 
        Settings.UseBlackOxBrew && 
        me.powerByType(PowerType.Energy) < 40 && 
        (!this.hasTalent("Aspect of Harmony") || (spell.getCharges("Celestial Brew") < 1 || spell.getCharges("Celestial Infusion") < 1))
      ),
      
      // Touch of Death
      spell.cast("Touch of Death", on => this.getTouchOfDeathTarget(), req => 
        Settings.UseTouchOfDeath && 
        this.getTouchOfDeathTarget() !== null
      ),
      
      // Blackout Kick (high priority)
      spell.cast("Blackout Kick", on => this.getCurrentTarget()),
      
      // Chi Burst
      spell.cast("Chi Burst", () => 
        !this.hasTalent("Aspect of Harmony") || 
        me.getAuraStacks(auras.balancedStratagemMagic) > 3
      ),
      
      // Weapons of Order
      spell.cast("Weapons of Order", () => 
        Settings.UseWeaponsOfOrder && 
        this.overlayToggles.cooldowns.value && 
        this.shouldUseBurstAbility()
      ),

      spell.cast(1241059, () => 
        spell.getCharges(1241059) > 1
      ),
      
      // Invoke Niuzao
      spell.cast("Invoke Niuzao, the Black Ox", () => 
        Settings.UseInvokeNiuzao && 
        this.overlayToggles.cooldowns.value && 
        this.shouldUseBurstAbility() && 
        !this.hasTalent("Call to Arms")
      ),
      
      spell.cast("Invoke Niuzao, the Black Ox", () => 
        Settings.UseInvokeNiuzao && 
        this.overlayToggles.cooldowns.value && 
        this.shouldUseBurstAbility() && 
        this.hasTalent("Call to Arms") && 
        !me.hasAura(auras.callToArmsInvokeNiuzao) && 
        this.getAuraRemainingTime(auras.weaponsOfOrder) < 16000
      ),
      
      // Rising Sun Kick
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        !this.hasTalent("Fluidity of Motion")
      ),
      
      // Keg Smash with Weapons of Order
      spell.cast("Keg Smash", on => this.getCurrentTarget(), req => 
        me.hasAura(auras.weaponsOfOrder) && 
        (this.getDebuffRemainingTime(auras.weaponsOfOrderDebuff) < 1800 || 
        this.getCurrentTarget()?.getAuraStacks(auras.weaponsOfOrderDebuff) < 3 - (me.hasAura(auras.blackoutComboBuff) ? 1 : 0) || 
        (this.getAuraRemainingTime(auras.weaponsOfOrder) < 3000 - (me.hasAura(auras.blackoutComboBuff) ? 1000 : 0) && 
        this.getAuraRemainingTime(auras.weaponsOfOrder) < 1000 + spell.getCooldown("Rising Sun Kick").timeleft))
      ),
      
      // Tiger Palm with Blackout Combo
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        me.hasAura(auras.blackoutComboBuff)
      ),
      
      // Keg Smash with Scalding Brew
      spell.cast("Keg Smash", on => this.getCurrentTarget(), req => 
        this.hasTalent("Scalding Brew")
      ),
      
      // Spinning Crane Kick with Charred Passions
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.hasTalent("Charred Passions") && 
        this.hasTalent("Scalding Brew") && 
        me.hasAura(auras.charredPassions) && 
        this.getAuraRemainingTime(auras.charredPassions) < 3000 && 
        this.getDebuffRemainingTime(auras.breathOfFire) < 9000 && 
        this.getEnemiesInRange(5) > 4
      ),
      
      // Rising Sun Kick with Fluidity of Motion
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.hasTalent("Fluidity of Motion")
      ),
      
      // Breath of Fire
      spell.cast("Breath of Fire", on => this.getCurrentTarget(), req => 
        (me.hasAura(auras.charredPassions) && (!this.hasTalent("Scalding Brew") || this.getEnemiesInRange(5) < 5)) || 
        !this.hasTalent("Charred Passions") || 
        (this.getDebuffRemainingTime(auras.breathOfFire) < 3000 && this.hasTalent("Scalding Brew"))
      ),
      
      // Exploding Keg
      spell.cast("Exploding Keg", on => this.getCurrentTarget(), req => 
        !this.hasTalent("Rushing Jade Wind") || 
        me.hasAura(auras.rushingJadeWind)
      ),
      
      // Rushing Jade Wind with Aspect of Harmony
      spell.cast("Rushing Jade Wind", () => 
        this.hasTalent("Aspect of Harmony") && 
        ((this.getAuraRemainingTime(auras.rushingJadeWind) < 2500 && me.hasAura(auras.rushingJadeWind)) || 
        !me.hasAura(auras.rushingJadeWind))
      ),
      
      // Keg Smash (general)
      spell.cast("Keg Smash", on => this.getCurrentTarget()),
      
      // Rushing Jade Wind without Aspect of Harmony
      spell.cast("Rushing Jade Wind", () => 
        !this.hasTalent("Aspect of Harmony") && 
        ((this.getAuraRemainingTime(auras.rushingJadeWind) < 2500 && me.hasAura(auras.rushingJadeWind)) || 
        !me.hasAura(auras.rushingJadeWind))
      ),
      
      // Tiger Palm with energy condition
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Energy) > 40 - spell.getCooldown("Keg Smash").timeleft * this.getEnergyRegen()
      ),
      
      // Spinning Crane Kick with energy condition
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Energy) > 40 - spell.getCooldown("Keg Smash").timeleft * this.getEnergyRegen()
      )
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

  isTanking() {
    const target = this.getCurrentTarget();
    return (target && target.isTanking()) || me.isTanking();
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

  getTargetTimeToDeath() {
    const target = this.getCurrentTarget();
    return target ? (target.timeToDeath() || 999) : 999;
  }

  getAspectOfHarmonyValue() {
    const aura = me.getAura(auras.aspectOfHarmonyAccumulator);
    return aura ? (aura.points ? aura.points[2] || 0 : 0) : 0;
  }

  getExpelHarmOrbCount() {
    // This would need to be implemented based on available API
    // For now, return a reasonable estimate
    return me.getUnitsAroundCount(20);
  }

  getEnergyRegen() {
    // Basic energy regen rate for monks
    return 10;
  }

  shouldPurify() {
    if (!Settings.UsePurifyingBrew) return false;
    
    // Check stagger percentage
    const staggerPct = this.getStaggerPercentage();
    if (staggerPct >= Settings.PurifyingBrewStaggerPct) {
      return true;
    }
    
    // Purify if at Heavy Stagger
    if (me.hasAura(auras.heavyStagger)) {
      return true;
    }
    
    // Purify if about to cap charges and have Moderate+ Stagger
    if (spell.getCharges("Purifying Brew") >= 1.8 && 
        (me.hasAura(auras.heavyStagger) || me.hasAura(auras.moderateStagger))) {
      return true;
    }
    
    return false;
  }

  getUntankedTarget() {
    return combat.targets.find(unit => unit.inCombat() && unit.target && !unit.isTanking());
  }

  getStaggerPercentage() {
    // Estimate stagger percentage based on which stagger level we have
    if (me.hasAura(auras.heavyStagger)) return 60;
    if (me.hasAura(auras.moderateStagger)) return 30;
    if (me.hasAura(auras.lightStagger)) return 15;
    return 0;
  }

  shouldUseDiffuseMagic() {
    const enemiesCasting = combat.targets.filter(enemy => {
      if (enemy.isCastingOrChanneling && enemy.spellInfo) {
        const target = enemy.spellInfo.spellTargetGuid;
        if (target && target.equals(me.guid)) {
          const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
          return castRemains < 1500;
        }
      }
      return false;
    });
    return enemiesCasting.length > 1;
  }

  // Get highest priority threat target for immediate taunting
  getHighPriorityThreatTarget() {
    const allEnemies = me.getEnemies(40);
    
    // Look for enemies attacking healers or low health party members first
    const priorityTargets = [];
    
    for (const enemy of allEnemies) {
      if (!common.validTarget(enemy)) continue;
      if (me.distanceTo(enemy) > 30) continue; // Provoke range
      
      try {
        // Check if enemy has threat entries
        if (enemy.threatEntries && enemy.threatEntries.length > 0) {
          let weHaveThreat = false;
          let highPriorityTarget = null;
          
          // Check threat entries
          for (const threatEntry of enemy.threatEntries) {
            if (threatEntry.guid && threatEntry.guid.equals(me.guid)) {
              weHaveThreat = true;
              break;
            } else if (threatEntry.guid) {
              const threatUnit = threatEntry.guid.toUnit();
              if (threatUnit && threatUnit.isPlayer() && !threatUnit.inCombatWith(me)) {
                // Skip if it's another tank
                if (this.isUnitATank(threatUnit)) continue;
                
                // Prioritize healers and low health players
                const isHealer = this.isUnitAHealer(threatUnit);
                const isLowHealth = threatUnit.pctHealth < 50;
                
                if (isHealer || isLowHealth) {
                  highPriorityTarget = {
                    enemy: enemy,
                    threatUnit: threatUnit,
                    priority: isHealer ? 100 : (100 - threatUnit.pctHealth)
                  };
                  break;
                }
              }
            }
          }
          
          // If others have threat but we don't, and it's a priority target
          if (highPriorityTarget && !weHaveThreat) {
            priorityTargets.push(highPriorityTarget);
            if (Settings.ThreatGatheringDebug) {
              console.log(`[Brewmaster] High priority threat target: ${enemy.unsafeName} attacking ${highPriorityTarget.threatUnit.unsafeName} (priority: ${highPriorityTarget.priority})`);
            }
          }
        }
      } catch (error) {
        // Ignore errors accessing threat data
        if (Settings.ThreatGatheringDebug) {
          console.warn(`[Brewmaster] Error checking high priority threat for ${enemy.unsafeName}: ${error.message}`);
        }
      }
    }
    
    // Return highest priority target
    if (priorityTargets.length > 0) {
      priorityTargets.sort((a, b) => b.priority - a.priority);
      return priorityTargets[0].enemy;
    }
    
    return null;
  }

  // Check if a unit is a healer based on their spec or auras
  isUnitAHealer(unit) {
    if (!unit) return false;
    
    try {
      // Check specialization if available
      if (unit.specialization) {
        const healerSpecs = [
          105, // Restoration Druid
          270, // Mistweaver Monk
          65,  // Holy Paladin
          256, // Discipline Priest
          257, // Holy Priest
          264  // Restoration Shaman
        ];
        
        if (healerSpecs.includes(unit.specialization)) {
          return true;
        }
      }
      
      // Check for healer-specific auras as backup
      const healerAuras = [
        "Restoration", "Holy", "Discipline", "Mistweaver", 
        "Tree of Life", "Spirit of Redemption", "Healing Rain"
      ];
      
      for (const aura of healerAuras) {
        if (unit.hasVisibleAura(aura) || unit.hasAura(aura)) {
          return true;
        }
      }
      
    } catch (error) {
      // Ignore errors checking healer status
      if (Settings.ThreatGatheringDebug) {
        console.warn(`[Brewmaster] Error checking healer status for ${unit.unsafeName}: ${error.message}`);
      }
    }
    
    return false;
  }

  getTouchOfDeathTarget() {
    if (!spell.getCooldown("Touch of Death").ready) return null;
    
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy && !enemy.deadOrGhost && me.distanceTo(enemy) <= 5) {
        // Check target type settings
        let validTarget = false;
        if (Settings.TouchOfDeathOnNormal) validTarget = true;
        if (Settings.TouchOfDeathOnElite && enemy.classification >= 1) validTarget = true;
        if (Settings.TouchOfDeathOnBoss && enemy.classification >= 3) validTarget = true;
        
        if (!validTarget) continue;
        
        // Check Touch of Death conditions
        if (this.hasTalent("Improved Touch of Death")) {
          if (enemy.pctHealth <= 15) {
            return enemy;
          }
        } else {
          if (me.health > enemy.health) {
            return enemy;
          }
        }
      }
    }
    return null;
  }
  
  // Get ranged enemy that needs threat (for Crackling Jade Lightning)
  getThreatTargetRanged() {
    const allEnemies = me.getEnemies(40);
    
    if (Settings.ThreatGatheringDebug) {
      console.log(`[Brewmaster] Checking ranged threat targets - total enemies in 40y: ${allEnemies.length}`);
    }
    
    const enemies = allEnemies.filter(target => {
      if (!common.validTarget(target)) return false;
      if (me.distanceTo(target) <= 10 || me.distanceTo(target) > 40) return false;
      
      // Only consider enemies that are in combat with me or party members
      let inCombatWithGroup = false;
      
      if (target.inCombatWith(me)) {
        inCombatWithGroup = true;
      } else {
        // Check if any party member is in combat with this enemy
        const friends = me.getFriends(40);
        for (const friend of friends) {
          if (target.inCombatWith(friend)) {
            if (Settings.ThreatGatheringDebug) {
              console.log(`[Brewmaster] ${target.unsafeName} is in combat with party member ${friend.unsafeName}`);
            }
            inCombatWithGroup = true;
            break;
          }
        }
      }
      
      if (!inCombatWithGroup) return false;
      
      // For threat gathering, we need to be able to face the target to cast on it
      // But we'll be more lenient - if we can't face it now, we might be able to after turning
      if (!me.isFacing(target)) {
        // Check if the target is in a reasonable arc that we could face
        const angle = me.angleTo(target);
        if (Math.abs(angle) > Math.PI) {
          if (Settings.ThreatGatheringDebug) {
            console.log(`[Brewmaster] ${target.unsafeName} is behind us (angle: ${(angle * 180 / Math.PI).toFixed(1)}°), skipping`);
          }
          return false;
        }
      }
      
      return true;
    });
    
    if (Settings.ThreatGatheringDebug) {
      console.log(`[Brewmaster] Ranged enemies (>10y, <=40y, faceable): ${enemies.length}`);
      enemies.forEach(enemy => {
        const angle = me.angleTo(enemy);
        console.log(`[Brewmaster] - ${enemy.unsafeName}: distance=${me.distanceTo(enemy).toFixed(1)}y, facing=${me.isFacing(enemy)}, angle=${(angle * 180 / Math.PI).toFixed(1)}°`);
      });
    }
    
    return this.findEnemyWithoutOurThreat(enemies);
  }
  
  // Get melee enemy that needs threat (for Spinning Crane Kick)
  getThreatTargetMelee() {
    const allEnemies = me.getEnemies(40);
    
    const enemies = allEnemies.filter(target => {
      if (!common.validTarget(target)) return false;
      if (me.distanceTo(target) > 10) return false;
      
      // Only consider enemies that are in combat with me or party members
      let inCombatWithGroup = false;
      
      if (target.inCombatWith(me)) {
        inCombatWithGroup = true;
      } else {
        // Check if any party member is in combat with this enemy
        const friends = me.getFriends(40);
        for (const friend of friends) {
          if (target.inCombatWith(friend)) {
            if (Settings.ThreatGatheringDebug) {
              console.log(`[Brewmaster] ${target.unsafeName} is in combat with party member ${friend.unsafeName}`);
            }
            inCombatWithGroup = true;
            break;
          }
        }
      }
      
      if (!inCombatWithGroup) return false;
      
      // For melee threat gathering, facing is less critical since Spinning Crane Kick is AoE
      // But we still want to avoid targets completely behind us
      if (!me.isFacing(target)) {
        const angle = me.angleTo(target);
        if (Math.abs(angle) > Math.PI * 0.75) { // Allow wider arc for melee AoE
          if (Settings.ThreatGatheringDebug) {
            console.log(`[Brewmaster] ${target.unsafeName} is too far behind us (angle: ${(angle * 180 / Math.PI).toFixed(1)}°), skipping`);
          }
          return false;
        }
      }
      
      return true;
    });
    
    if (Settings.ThreatGatheringDebug) {
      console.log(`[Brewmaster] Melee enemies (<=10y, faceable): ${enemies.length}`);
      enemies.forEach(enemy => {
        const angle = me.angleTo(enemy);
        console.log(`[Brewmaster] - ${enemy.unsafeName}: distance=${me.distanceTo(enemy).toFixed(1)}y, facing=${me.isFacing(enemy)}, angle=${(angle * 180 / Math.PI).toFixed(1)}°`);
      });
    }
    
    return this.findEnemyWithoutOurThreat(enemies);
  }
  
  // Find enemy that other players have threat on but we don't
  findEnemyWithoutOurThreat(enemies) {
    for (const enemy of enemies) {
      if (!enemy || enemy.deadOrGhost) continue;
      
      try {
        // Check if enemy has threat entries
        if (enemy.threatEntries && enemy.threatEntries.length > 0) {
          let weHaveThreat = false;
          let othersHaveThreat = false;
          
          // Check threat entries
          for (const threatEntry of enemy.threatEntries) {
            if (threatEntry.guid && threatEntry.guid.equals(me.guid)) {
              weHaveThreat = true;
            } else if (threatEntry.guid) {
              // Check if it's a party/raid member with threat
              const threatUnit = threatEntry.guid.toUnit();
              if (threatUnit && threatUnit.isPlayer()) {
                // Debug: Show all threat holders
                if (Settings.ThreatGatheringDebug) {
                  console.log(`[Brewmaster] Player ${threatUnit.unsafeName} has threat on ${enemy.unsafeName}, inCombatWith(me): ${threatUnit.inCombatWith(me)}`);
                }
                
                if (!threatUnit.inCombatWith(me)) {
                  // Check if this unit is a tank - if so, don't steal threat from them
                  if (this.isUnitATank(threatUnit)) {
                    if (Settings.ThreatGatheringDebug) {
                      console.log(`[Brewmaster] Skipping ${enemy.unsafeName} - tank ${threatUnit.unsafeName} has threat`);
                    }
                    return null; // Don't steal from other tanks
                  }
                  othersHaveThreat = true;
                  if (Settings.ThreatGatheringDebug) {
                    console.log(`[Brewmaster] Valid threat target: ${threatUnit.unsafeName} (non-tank) has threat on ${enemy.unsafeName}`);
                  }
                } else {
                  if (Settings.ThreatGatheringDebug) {
                    console.log(`[Brewmaster] Skipping ${threatUnit.unsafeName} - in combat with me`);
                  }
                }
              } else {
                if (Settings.ThreatGatheringDebug) {
                  console.log(`[Brewmaster] Threat unit is null or not a player: ${threatUnit?.unsafeName || 'null'}`);
                }
              }
            }
          }
          
          // If others have threat but we don't, this is a good target
          if (othersHaveThreat && !weHaveThreat) {
            if (Settings.ThreatGatheringDebug) {
              console.log(`[Brewmaster] Found threat target: ${enemy.unsafeName} (others have threat, we don't)`);
            }
            return enemy;
          }
        }
      } catch (error) {
        // Ignore errors accessing threat data
        if (Settings.ThreatGatheringDebug) {
          console.warn(`[Brewmaster] Error checking threat for ${enemy.unsafeName}: ${error.message}`);
        }
      }
    }
    
    if (Settings.ThreatGatheringDebug) {
      console.log(`[Brewmaster] No threat targets found`);
    }
    return null;
  }
  
  // Check if a unit is a tank based on their auras
  isUnitATank(unit) {
    if (!unit) return false;
    
    try {
      // Check for tank-specific auras/stances
      const tankAuras = [
        // Brewmaster Monk
        "Stagger", "Brewmaster Monk", "Shuffle",
        
        // Protection Paladin  
        "Protection Paladin", "Shield of the Righteous",
        
        // Guardian Druid
        "Guardian Druid",
        
        // Vengeance Demon Hunter
        "Vengeance", "Demon Spikes",
        
        // Blood Death Knight
        "Blood", "Death Knight", "Bone Shield", "Vampiric Blood",
        
        // Protection Warrior
        "Protection Warrior", "Shield Block", "Defensive Stance"
      ];
      
      // Check visible auras for tank indicators
      for (const aura of tankAuras) {
        if (unit.hasVisibleAura(aura) || unit.hasAura(aura)) {
          if (Settings.ThreatGatheringDebug) {
            console.log(`[Brewmaster] Detected tank: ${unit.unsafeName} has ${aura}`);
          }
          return true;
        }
      }
      
      // Check specialization if available (more reliable)
      if (unit.specialization) {
        const tankSpecs = [
          268, // Brewmaster Monk
          66,  // Protection Paladin
          104, // Guardian Druid
          581, // Vengeance Demon Hunter
          250, // Blood Death Knight
          73   // Protection Warrior
        ];
        
        if (tankSpecs.includes(unit.specialization)) {
          if (Settings.ThreatGatheringDebug) {
            console.log(`[Brewmaster] Detected tank by spec: ${unit.unsafeName} (${unit.specialization})`);
          }
          return true;
        }
      }
      
    } catch (error) {
      // Ignore errors checking tank status
      if (Settings.ThreatGatheringDebug) {
        console.warn(`[Brewmaster] Error checking tank status for ${unit.unsafeName}: ${error.message}`);
      }
    }
    
    return false;
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
    const overlaySize = { x: 280, y: 350 };
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

    if (imgui.begin("Brewmaster Monk Controls", this.overlayToggles.showOverlay, windowFlags)) {
      
      // Tank Status
      if (imgui.collapsingHeader("Tank Status", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        const isTanking = this.isTanking();
        const tankColor = isTanking ? 
          { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.6, b: 0.2, a: 1.0 };
        imgui.textColored(tankColor, isTanking ? "TANKING" : "Not Tanking");
        
        // Stagger status
        const staggerPct = this.getStaggerPercentage();
        let staggerColor = { r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
        if (staggerPct >= 50) staggerColor = { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
        else if (staggerPct >= 25) staggerColor = { r: 1.0, g: 0.8, b: 0.2, a: 1.0 };
        
        imgui.textColored(staggerColor, `Stagger: ${staggerPct}%`);
        
        imgui.unindent();
      }
      
      // Major Cooldowns section
      if (imgui.collapsingHeader("Controls", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        imgui.checkbox("Defensives", this.overlayToggles.defensives);
        imgui.checkbox("Cooldowns", this.overlayToggles.cooldowns);
        imgui.checkbox("Interrupts", this.overlayToggles.interrupts);
        
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

      // Burst Status section
      imgui.spacing();
      imgui.separator();
      
      // Show burst mode status
      if (Settings.UseBurstToggle) {       
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
          this.currentSpellId = 65000;
          console.log("Spell cycling stopped manually");
        }
      } else {
        imgui.spacing();
        imgui.text("Press LeftArrow to cycle ALL spell IDs");
      }
      
      imgui.end();
    }
  }
}
