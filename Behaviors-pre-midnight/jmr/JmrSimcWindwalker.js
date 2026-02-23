import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";
import KeyBinding from "@/Core/KeyBinding";
import EvokerCommon from "@/Behaviors/EvokerCommon";

const auras = {
  // Buffs
  stormEarthAndFire: 137639,
  invokeXuen: 123904,
  invokersDelight: 388663,
  heartOfTheJadeSerpentCDR: 443421,
  heartOfTheJadeSerpentCDRCelestial: 443616,
  heartOfTheJadeSerpentTWW3Tier: 443616,
  teachingsOfTheMonastery: 202090,
  blackoutKick: 116768, // Blackout Kick! proc
  bokProc: 116768,
  danceOfChiji: 325201,
  chiEnergy: 393057,
  orderedElements: 451524,
  pressurePoint: 247255,
  charredPassions: 386965,
  theEmperorsCapacitor: 393039,
  wisdomOfTheWallFlurry: 452685,
  memoryOfTheMonastery: 454970,
  vivaciousVivification: 392883,
  fortifyingBrew: 120954,
  dampenHarm: 122278,
  diffuseMagic: 122783,
  touchOfKarma: 125174,
  
  // Debuffs
  markOfTheCrane: 228287,
  acclamation: 451432,
  galeForce: 451580,
  
  // Talents (checked via hasAura)
  innerPeace: 397768,
  energyBurst: 451498,
  orderedElementsTalent: 451524,
  hitCombo: 196740,
  flurryStrikes: 451594,
  xuensBattlegear: 392993,
  celestialConduit: 443028,
  lastEmperorsCapacitor: 392989,
  sequencedStrikes: 392912,
  revolvingWhirl: 451524,
  xuensBond: 392994,
  shadowboxingTreads: 392982,
  courageousImpulse: 451495,
  knowledgeOfTheBrokenTemple: 451529,
  craneVortex: 388848,
  jadefire: 388849,
  singularlyFocusedJade: 451497,
  jadefireHarmony: 391412,
  gloryOfTheDawn: 392958,
  powerOfTheThunderKing: 393047,
  memoryOfTheMonasteryTalent: 454970
};

export class JmrSimcWindwalkerBehavior extends Behavior {
  name = "Jmr SimC Windwalker Monk";
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Windwalker;
  version = 1;

  // Runtime toggles for overlay
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(true),
    defensives: new imgui.MutableVariable(true),
    interrupts: new imgui.MutableVariable(true),
    cooldowns: new imgui.MutableVariable(true),
    touchOfDeath: new imgui.MutableVariable(true)
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

  // Variables for rotation logic
  invokeXuenCount = 0;
  sefCondition = false;
  xuenCondition = false;
  xuenDungeonsliceCondition = false;
  xuenDungeonrouteCondition = false;
  
  // Fight style detection
  patchwerk = false;
  dungeonslice = false;
  dungeonroute = false;
  fightRemains = 11111;
  sefDungeonrouteCondition = false;
  smallHotjsActive = false;
  
  // Simple combo strike tracking - just track the last combo strike ability
  lastComboStrikeAbility = null;

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
        { type: "checkbox", uid: "SmartAoE", text: "Smart AoE Detection", default: true }
      ]
    },
    {
      header: "Tier Set Bonuses (Placeholder)",
      options: [
        { type: "checkbox", uid: "HasTWW3_2pc", text: "Has TWW3 2-piece", default: false },
        { type: "checkbox", uid: "HasTWW3_4pc", text: "Has TWW3 4-piece", default: false }
      ]
    },
    {
      header: "Defensive Settings",
      options: [
        { type: "checkbox", uid: "UseVivify", text: "Use Vivify (Vivacious Vivification)", default: true },
        { type: "slider", uid: "VivifyHealthPct", text: "Vivify Health %", min: 1, max: 100, default: 75 },
        { type: "checkbox", uid: "UseFortifyingBrew", text: "Use Fortifying Brew", default: true },
        { type: "slider", uid: "FortifyingBrewHealthPct", text: "Fortifying Brew Health %", min: 1, max: 100, default: 35 },
        { type: "checkbox", uid: "UseDiffuseMagic", text: "Use Diffuse Magic", default: true },
        { type: "slider", uid: "DiffuseMagicHealthPct", text: "Diffuse Magic Health %", min: 1, max: 100, default: 20 },
        { type: "checkbox", uid: "UseDampenHarm", text: "Use Dampen Harm", default: true },
        { type: "slider", uid: "DampenHarmHealthPct", text: "Dampen Harm Health %", min: 1, max: 100, default: 50 },
        { type: "checkbox", uid: "UseTouchOfKarma", text: "Use Touch of Karma", default: true },
        { type: "slider", uid: "TouchOfKarmaHealthPct", text: "Touch of Karma Health %", min: 1, max: 100, default: 15 }
      ]
    },
    {
      header: "Interrupts & Utility",
      options: [
        { type: "checkbox", uid: "UseSpearHandStrike", text: "Use Spear Hand Strike (Interrupt)", default: true },
        { type: "slider", uid: "JadefireStompMovingThreshold", text: "Jadefire Stomp - Stand Still Threshold (sec)", min: 0, max: 10, default: 1.5 },
        { type: "slider", uid: "JadefireStompRange", text: "Jadefire Stomp Range", min: 5, max: 30, default: 15 },
        { type: "slider", uid: "SlicingWindsEmpowerLevel", text: "Slicing Winds Empower Level", min: 1, max: 4, default: 1 }
      ]
    },
    {
      header: "Cooldown Usage",
      options: [
        { type: "checkbox", uid: "UseStormEarthAndFire", text: "Use Storm, Earth, and Fire", default: true },
        { type: "checkbox", uid: "UseInvokeXuen", text: "Use Invoke Xuen", default: true },
        { type: "checkbox", uid: "UseStrikeOfTheWindlord", text: "Use Strike of the Windlord", default: true },
        { type: "checkbox", uid: "UseCelestialConduit", text: "Use Celestial Conduit", default: true },
        { type: "checkbox", uid: "UseTrinkets", text: "Use Trinkets", default: true },
        { type: "checkbox", uid: "TrinketsWithCooldowns", text: "Use Trinkets with Major Cooldowns Only", default: false }
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
        { type: "checkbox", uid: "UseBagOfTricks", text: "Use Bag of Tricks", default: true },
        { type: "checkbox", uid: "UseHaymaker", text: "Use Haymaker", default: true },
        { type: "checkbox", uid: "UseRocketBarrage", text: "Use Rocket Barrage", default: true },
        { type: "checkbox", uid: "UseArcanePulse", text: "Use Arcane Pulse", default: true }
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
            // console.info(`Started spell cycling from ${this.currentSpellId.toLocaleString()} to ${this.maxSpellId.toLocaleString()}`);
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
                // console.info(`[${this.currentSpellId.toLocaleString()}/${this.maxSpellId.toLocaleString()}] Trying spell "${spellName}" (ID: ${spellId})`);
                
                const success = spell.castPrimitive(spellObject, targetUnit);
                if (success) {
                  // console.info(`Successfully cast "${spellName}" on ${targetUnit.unsafeName}`);
                } else {
                  // console.info(`Failed to cast "${spellName}"`);
                }
              } else {
                // Only log if we find a valid spell to reduce spam
                if (spellId % 10000 === 0) {
                  // console.info(`[${this.currentSpellId.toLocaleString()}/${this.maxSpellId.toLocaleString()}] Checking spell ID ${spellId}...`);
                }
              }
              
              this.currentSpellId++;
              this.lastSpellCycleTime = currentTime;
            } else {
              // Finished cycling through all spells
              // console.info(`Finished cycling through all spell IDs (${this.currentSpellId.toLocaleString()} to ${this.maxSpellId.toLocaleString()})`);
              this.isCycling = false;
              this.currentSpellId = 65000;
            }
          }
        }
        
        // Update rotation variables
        this.updateRotationVariables();
        
        // Update combo strike tracking
        this.updateLastComboStrike();
        
        return bt.Status.Failure; // Always continue to the rest of the rotation
      }),
      
      // Handle empowered spells
      new bt.Action(() => {
        return EvokerCommon.handleEmpoweredSpell();
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
      // new bt.Decorator(
      //   () => !me.inCombat(),
      //   this.buildPrecombat()
      // ),
      
      // Main rotation
      new bt.Selector(
        // Interrupts
        new bt.Decorator(
          () => Settings.UseSpearHandStrike && this.overlayToggles.interrupts.value,
          spell.interrupt("Spear Hand Strike"),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Defensives
        new bt.Decorator(
          () => this.overlayToggles.defensives.value,
          this.buildDefensives(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Normal opener for first 4 seconds with <3 enemies
        // new bt.Decorator(
        //   () => this.getCombatTime() < 4 && me.getEnemies(10).length < 3,
        //   this.buildNormalOpener(),
        //   new bt.Action(() => bt.Status.Success)
        // ),
        
        // Cooldowns
        new bt.Decorator(
          () => this.overlayToggles.cooldowns.value,
          this.buildCooldowns(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // AoE rotation for 5+ enemies
        new bt.Decorator(
          () => me.getEnemies(10).length >= 5,
          this.buildDefaultAoE(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Cleave rotation for 2-4 enemies
        new bt.Decorator(
          () => me.getEnemies(10).length > 1 && me.getEnemies(10).length < 5,
          this.buildDefaultCleave(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Single target rotation
        new bt.Decorator(
          () => me.getEnemies(10).length < 2,
          this.buildDefaultST(),
          new bt.Action(() => bt.Status.Success)
        ),
        
        // Fallback rotation
        this.buildFallback(),
        
        // Racial abilities (fallback)
        this.buildRacials()
      )
    );
  }

  buildPrecombat() {
    return new bt.Selector(
      // Tiger Palm opener
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => this.comboStrike("Tiger Palm")),
      
      // Rising Sun Kick
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick")
      )
    );
  }

  buildDefensives() {
    return new bt.Selector(
      // Vivify with proc
      spell.cast("Vivify", () => 
        Settings.UseVivify && 
        me.hasVisibleAura(auras.vivaciousVivification) && 
        me.pctHealth <= Settings.VivifyHealthPct
      ),
      
      // Touch of Karma
      spell.cast("Touch of Karma", () => this.getCurrentTarget(), req => 
        Settings.UseTouchOfKarma && 
        me.pctHealth <= Settings.TouchOfKarmaHealthPct && 
        this.noDefensivesUp()
      ),
      
      // Fortifying Brew
      spell.cast("Fortifying Brew", () => 
        Settings.UseFortifyingBrew && 
        me.pctHealth <= Settings.FortifyingBrewHealthPct && 
        this.noDefensivesUp()
      ),
      
      // Diffuse Magic
      spell.cast("Diffuse Magic", () => 
        Settings.UseDiffuseMagic && 
        me.pctHealth <= Settings.DiffuseMagicHealthPct && 
        this.noDefensivesUp()
      ),
      
      // Dampen Harm
      spell.cast("Dampen Harm", () => 
        Settings.UseDampenHarm && 
        me.pctHealth <= Settings.DampenHarmHealthPct && 
        this.noDefensivesUp()
      )
    );
  }

  buildNormalOpener() {
    return new bt.Selector(
      // Tiger Palm
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Chi) < 6 && 
        this.comboStrike("Tiger Palm")
      ),
      
      // Rising Sun Kick
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick") && 
        this.hasTalent("Ordered Elements")
      )
    );
  }

  buildCooldowns() {
    return new bt.Selector(
      // Trinkets - use with major cooldowns or standalone
      common.useTrinkets(() => this.getCurrentTarget(), () => {
        if (!Settings.UseTrinkets) {
          return false;
        }
        
        const target = this.getCurrentTarget();
        const inCombat = me.inCombat();
        const hasTarget = target && !target.deadOrGhost;
        
        // If setting is enabled, use trinkets with major cooldowns only
        if (Settings.TrinketsWithCooldowns) {
          return me.hasVisibleAura(auras.stormEarthAndFire) || 
                 me.hasVisibleAura(auras.invokeXuen) ||
                 me.hasVisibleAura("Bloodlust") ||
                 me.hasVisibleAura("Heroism") ||
                 me.hasVisibleAura("Time Warp");
        }
        
        // Otherwise, use trinkets on cooldown in combat
        return inCombat && hasTarget;
      }),
      spell.cast("Storm, Earth, and Fire", () => {
        if (!Settings.UseStormEarthAndFire || !this.shouldUseBurstAbility()) return false;
        
        const target = this.getCurrentTarget();
        const targetTTD = this.getTargetTimeToDeath();
        const enemyCount = this.getEnemiesInRange(8);
        const chi = me.powerByType(PowerType.Chi);
        const energy = me.powerByType(PowerType.Energy);
        const combatTime = this.getCombatTime();
        
        // (target.time_to_die>14&!fight_style.dungeonroute|target.time_to_die>22)
        const ttdCondition = (targetTTD > 14 && !this.dungeonroute) || targetTTD > 22;
        
        // (active_enemies>2|cooldown.rising_sun_kick.remains|!talent.ordered_elements)
        const basicCondition = enemyCount > 2 || 
                              spell.getCooldown("Rising Sun Kick").timeleft > 0 || 
                              !this.hasTalent("Ordered Elements");
        
        // Complex buff and cooldown conditions
        const invokersDelightRemains = me.getAura(auras.invokersDelight)?.remaining || 0;
        const bloodlustUp = me.hasVisibleAura("Bloodlust") || me.hasVisibleAura("Heroism") || me.hasVisibleAura("Time Warp");
        const strikeWindlordRemains = spell.getCooldown("Strike of the Windlord").timeleft;
        const sefFullRecharge = spell.getCooldown("Storm, Earth, and Fire").charges < 2 ? spell.getCooldown("Storm, Earth, and Fire").timeleft : 0;
        const xuenRemains = spell.getCooldown("Invoke Xuen, the White Tiger").timeleft;
        
        // Main condition logic
        const mainCondition = ttdCondition && basicCondition && (
          // Invoker's Delight + Bloodlust condition
          ((invokersDelightRemains > 10 && !bloodlustUp) || (bloodlustUp && sefFullRecharge < 1)) ||
          
          // SEF ready before Xuen condition  
          (sefFullRecharge < xuenRemains && !bloodlustUp && 
           (enemyCount > 1 || (strikeWindlordRemains < 2 && (this.hasTalent("Flurry Strikes") || me.hasVisibleAura(auras.heartOfTheJadeSerpentCDR)))) &&
           (chi > 3 || (chi > 1 && this.hasTalent("Ordered Elements")))) ||
          
          // Quick SEF condition
          (sefFullRecharge < 10 && (chi > 3 || (chi > 1 && this.hasTalent("Ordered Elements")))) ||
          
          // Fight ending condition
          this.fightRemains < 30 ||
          
          // Previous Xuen condition
          this.wasPreviousSpell("Invoke Xuen, the White Tiger") ||
          
          // Dungeon slice condition
          (invokersDelightRemains > 10 && this.dungeonslice && basicCondition)
        );
        
        return mainCondition;
      }),
      
      // Tiger Palm before Xuen
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        spell.getCooldown("Invoke Xuen, the White Tiger").ready && 
        (me.powerByType(PowerType.Chi) < 5 && !this.hasTalent("Ordered Elements") || me.powerByType(PowerType.Chi) < 3) && 
        (this.comboStrike("Tiger Palm"))
      ),
      
      spell.cast(123904, () => me.hasVisibleAura(137639)),
      
      // Touch of Karma
      spell.cast("Touch of Karma", () => this.getCurrentTarget(), req => 
        Settings.UseTouchOfKarma && 
        this.overlayToggles.touchOfDeath.value
      ),
      
      // Racial abilities with complex conditions
      spell.cast("Ancestral Call", () => 
        Settings.UseAncestralCall && 
        this.shouldUseBurstAbility() && 
        this.shouldUseRacialWithXuen()
      ),
      
      spell.cast("Blood Fury", () => 
        Settings.UseBloodFury && 
        this.shouldUseBurstAbility() && 
        this.shouldUseRacialWithXuen()
      ),
      
      spell.cast("Fireblood", () => 
        Settings.UseFireblood && 
        this.shouldUseBurstAbility() && 
        this.shouldUseRacialWithXuen()
      ),
      
      spell.cast("Berserking", () => 
        Settings.UseBerserking && 
        this.shouldUseBurstAbility() && 
        this.shouldUseRacialWithXuen()
      )
    );
  }

  buildDefaultAoE() {
    return new bt.Selector(
      // Tiger Palm with complex energy/chi conditions
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        ((me.powerByType(PowerType.Energy) > 55 && this.hasTalent("Inner Peace")) || 
        (me.powerByType(PowerType.Energy) > 60 && !this.hasTalent("Inner Peace"))) && 
        this.comboStrike("Tiger Palm") && 
        this.getChiDeficit() >= 2 && 
        me.getAuraStacks(auras.teachingsOfTheMonastery) < this.getTeachingsMaxStacks() && 
        (this.hasTalent("Energy Burst") && !me.hasVisibleAura(auras.bokProc)) && 
        !me.hasVisibleAura(auras.orderedElements)
      ),
      
      // Touch of Death
      spell.cast("Touch of Death", on => this.getTouchOfDeathTarget(), req => 
        Settings.UseTouchOfDeath && 
        this.overlayToggles.touchOfDeath.value && 
        !this.smallHotjsActive && 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        this.getTouchOfDeathTarget() !== null
      ),
      
      // Strike of the Windlord with 2pc
      spell.cast("Strike of the Windlord", () => this.getCurrentTarget(), req => 
        Settings.UseStrikeOfTheWindlord && 
        this.hasTalent("Gale Force") && 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000 && 
        Settings.HasTWW3_2pc && 
        !this.hasTalent("Flurry Strikes")
      ),
      
      // Slicing Winds with 2pc
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => 
        Settings.HasTWW3_2pc && 
        this.hasTalent("Celestial Conduit") && 
        this.smallHotjsActive && 
        !this.hasTalent("Flurry Strikes")
      ),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.danceOfChiji) === 2 && 
        this.comboStrike("Spinning Crane Kick") && me.getEnemies(10).length > 1
      ),
      
      // Whirling Dragon Punch
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.danceOfChiji) < 2
      ),
      
      // Tiger Palm with Flurry Strikes and 4pc
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        (me.getAura(auras.stormEarthAndFire)?.remaining || 0) > 2000 && 
        this.hasTalent("Flurry Strikes") && 
        this.getEnergyTimeToMax() <= me.gcd * 3 && 
        spell.getCooldown("Fists of Fury").timeleft > 0 && 
        (!this.hasTalent("Xuen's Battlegear") || me.powerByType(PowerType.Chi) < 6) && 
        Settings.HasTWW3_4pc
      ),
      
      // Slicing Winds
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => 
        this.smallHotjsActive || 
        me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial)
      ),
      
      // Celestial Conduit
      spell.cast("Celestial Conduit", () => 
        Settings.UseCelestialConduit && 
        me.hasVisibleAura(auras.stormEarthAndFire) && 
        spell.getCooldown("Strike of the Windlord").timeleft > 0 && 
        (!this.smallHotjsActive || this.getDebuffRemainingTime(auras.galeForce) < 5000)
      ),
      
      // Fists of Fury
      spell.cast("Fists of Fury", on => this.getCurrentTarget(), req => 
        this.comboStrike("Fists of Fury") && 
        (me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) || this.smallHotjsActive) && me.getEnemies(10).length > 1
      ),
      
      // Rising Sun Kick
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick") && 
        spell.getCooldown("Whirling Dragon Punch").timeleft < 2000 && 
        spell.getCooldown("Fists of Fury").timeleft > 1000 && 
        me.getAuraStacks(auras.danceOfChiji) < 2
      ),
      
      // Blackout Kick with proc
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        me.hasVisibleAura(auras.bokProc) && 
        me.powerByType(PowerType.Chi) < 2 && 
        this.hasTalent("Energy Burst") && 
        me.powerByType(PowerType.Energy) < 55
      ),
      
      // Strike of the Windlord
      spell.cast("Strike of the Windlord", () => this.getCurrentTarget(), req => 
        Settings.UseStrikeOfTheWindlord && 
        (this.getCombatTime() > 5 || (me.hasVisibleAura(auras.invokersDelight) && me.hasVisibleAura(auras.stormEarthAndFire))) && 
        (spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 15000 || this.hasTalent("Flurry Strikes"))
      ),
      
      // Slicing Winds (general)
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => true),
      
      // Blackout Kick with Teachings stacks
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        me.getAuraStacks(auras.teachingsOfTheMonastery) === 8 && 
        this.hasTalent("Shadowboxing Treads")
      ),
      
      // Crackling Jade Lightning with Emperor's Capacitor
      spell.cast("Crackling Jade Lightning", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.theEmperorsCapacitor) > 19 && 
        this.comboStrike("Crackling Jade Lightning") && 
        this.hasTalent("Power of the Thunder King") && 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000
      ),
      
      // Fists of Fury (general AoE)
      spell.cast("Fists of Fury", on => this.getCurrentTarget(), req => 
        (this.hasTalent("Flurry Strikes") || 
        this.hasTalent("Xuen's Battlegear") || 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000) && me.getEnemies(10).length > 1
      ),
      
      // Tiger Palm with Flurry Strikes
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        this.getEnergyTimeToMax() <= me.gcd * 3 && 
        this.hasTalent("Flurry Strikes") && 
        me.hasVisibleAura(auras.wisdomOfTheWallFlurry) && 
        me.powerByType(PowerType.Chi) < 6
      ),
      
      // Spinning Crane Kick with chi
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Spinning Crane Kick") && 
        me.powerByType(PowerType.Chi) > 5 && me.getEnemies(10).length > 1
      ),
      
      // Rising Sun Kick with Pressure Point
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick") && 
        me.hasVisibleAura(auras.pressurePoint) && 
        spell.getCooldown("Fists of Fury").timeleft > 2000
      ),
      
      // Blackout Kick with procs
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.hasTalent("Shadowboxing Treads") && 
        this.hasTalent("Courageous Impulse") && 
        this.comboStrike("Blackout Kick") && 
        me.getAuraStacks(auras.bokProc) === 2
      ),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Spinning Crane Kick") && 
        me.hasVisibleAura(auras.danceOfChiji) && me.getEnemies(10).length > 1
      ),
      
      // Tiger Palm with chi deficit
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        this.getChiDeficit() >= 2 && 
        (!me.hasVisibleAura(auras.orderedElements) || this.getEnergyTimeToMax() <= me.gcd * 3)
      ),
      
      // Jadefire Stomp
      spell.cast("Jadefire Stomp", () => this.getCurrentTarget(), req => 
        (this.hasTalent("Singularly Focused Jade") || this.hasTalent("Jadefire Harmony")) && 
        this.canUseJadefireStomp()
      ),
      
      // Spinning Crane Kick with conditions
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Spinning Crane Kick") && 
        (me.powerByType(PowerType.Chi) > 3 || me.powerByType(PowerType.Energy) > 55) && me.getEnemies(10).length > 1
      ),
      
      // Blackout Kick with Fists of Fury on cooldown
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        spell.getCooldown("Fists of Fury").timeleft > 0 && 
        (me.getAuraStacks(auras.teachingsOfTheMonastery) > 3 || me.hasVisibleAura(auras.orderedElements)) && 
        (this.hasTalent("Shadowboxing Treads") || me.hasVisibleAura(auras.bokProc))
      ),
      
      // Chi Burst
      spell.cast("Chi Burst", () => !me.hasVisibleAura(auras.orderedElements)),
      
      // Tiger Palm with Ordered Elements
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        me.hasVisibleAura(auras.orderedElements) && 
        this.getChiDeficit() >= 1
      )
    );
  }

  buildDefaultCleave() {
    return new bt.Selector(
      // Rising Sun Kick with Storm, Earth, and Fire
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        (me.getAura(auras.stormEarthAndFire)?.remaining || 0) > 13000 && 
        this.comboStrike("Rising Sun Kick")
      ),
      
      // Strike of the Windlord with conditions
      spell.cast("Strike of the Windlord", () => this.getCurrentTarget(), req => 
        Settings.UseStrikeOfTheWindlord && 
        this.hasTalent("Gale Force") && 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000 && 
        Settings.HasTWW3_2pc && 
        !this.hasTalent("Flurry Strikes")
      ),
      
      // Slicing Winds with 2pc
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => 
        Settings.HasTWW3_2pc && 
        this.hasTalent("Celestial Conduit") && 
        this.smallHotjsActive && 
        !this.hasTalent("Flurry Strikes")
      ),
      
      // Spinning Crane Kick priority
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.danceOfChiji) === 2 && 
        this.comboStrike("Spinning Crane Kick") && me.getEnemies(10).length > 1
      ),
      
      // Whirling Dragon Punch
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        this.smallHotjsActive && 
        me.getAuraStacks(auras.danceOfChiji) < 2
      ),
      
      // Rising Sun Kick with Pressure Point
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura(auras.pressurePoint) && 
        this.getEnemiesInRange(8) < 4 && 
        spell.getCooldown("Fists of Fury").timeleft > 4000
      ),
      
      // Tiger Palm with complex conditions
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        ((me.powerByType(PowerType.Energy) > 55 && this.hasTalent("Inner Peace")) || 
        (me.powerByType(PowerType.Energy) > 60 && !this.hasTalent("Inner Peace"))) && 
        this.getChiDeficit() >= 2 && 
        me.getAuraStacks(auras.teachingsOfTheMonastery) < this.getTeachingsMaxStacks() && 
        !me.hasVisibleAura(auras.orderedElements)
      ),
      
      // Touch of Death
      spell.cast("Touch of Death", on => this.getTouchOfDeathTarget(), req => 
        Settings.UseTouchOfDeath && 
        this.overlayToggles.touchOfDeath.value && 
        !this.smallHotjsActive && 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        this.getTouchOfDeathTarget() !== null
      ),
      
      // Whirling Dragon Punch (general)
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.danceOfChiji) < 2
      ),
      
      // Slicing Winds (general)
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => 
        this.smallHotjsActive || 
        me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial)
      ),
      
      // Celestial Conduit
      spell.cast("Celestial Conduit", () => 
        Settings.UseCelestialConduit && 
        me.hasVisibleAura(auras.stormEarthAndFire) && 
        this.getDebuffRemainingTime(auras.galeForce) < 5000 && 
        spell.getCooldown("Strike of the Windlord").timeleft > 0
      ),
      
      // Fists of Fury
      spell.cast("Fists of Fury", on => this.getCurrentTarget(), req => 
        this.comboStrike("Fists of Fury") && 
        (me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) || this.smallHotjsActive) && me.getEnemies(10).length > 1
      ),
      
      // Blackout Kick with Teachings stacks
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        me.getAuraStacks(auras.teachingsOfTheMonastery) === 8 && 
        (this.getEnemiesInRange(8) < 3 || this.hasTalent("Shadowboxing Treads"))
      ),
      
      // Tiger Palm with Flurry Strikes
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        (me.getAura(auras.stormEarthAndFire)?.remaining || 0) > 2000 && 
        this.hasTalent("Flurry Strikes") && 
        !this.hasTalent("Xuen's Battlegear") && 
        Settings.HasTWW3_4pc
      ),
      
      // Whirling Dragon Punch (conditional)
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        !this.hasTalent("Revolving Whirl") || 
        (this.hasTalent("Revolving Whirl") && me.getAuraStacks(auras.danceOfChiji) < 2 && this.getEnemiesInRange(8) > 2) || 
        this.getEnemiesInRange(8) < 3
      ),
      
      // Strike of the Windlord (timed)
      spell.cast("Strike of the Windlord", () => this.getCurrentTarget(), req => 
        Settings.UseStrikeOfTheWindlord && 
        this.getCombatTime() > 5 && 
        (spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 15000 || this.hasTalent("Flurry Strikes")) && 
        (spell.getCooldown("Fists of Fury").timeleft < 2000 || spell.getCooldown("Celestial Conduit").timeleft < 10000)
      ),
      
      // Slicing Winds (fallback)
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel),
      
      // Crackling Jade Lightning
      spell.cast("Crackling Jade Lightning", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.theEmperorsCapacitor) > 19 && 
        this.comboStrike("Crackling Jade Lightning") && 
        this.hasTalent("Power of the Thunder King") && 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000
      ),
      
      // Spinning Crane Kick (general)
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Spinning Crane Kick") && 
        me.getAuraStacks(auras.danceOfChiji) === 2 && me.getEnemies(10).length > 1
      ),
      
      // Fists of Fury (general cleave)
      spell.cast("Fists of Fury", on => this.getCurrentTarget(), req => 
        (this.hasTalent("Flurry Strikes") || 
        this.hasTalent("Xuen's Battlegear") || 
        (!this.hasTalent("Xuen's Battlegear") && 
        (spell.getCooldown("Strike of the Windlord").timeleft > 1000 || 
        this.smallHotjsActive || 
        me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial)))) && me.getEnemies(10).length > 1
      ),
      
      // Tiger Palm (energy management)
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        this.getChiDeficit() >= 2 && 
        (!me.hasVisibleAura(auras.orderedElements) || this.getEnergyTimeToMax() <= me.gcd * 3)
      ),
      
      // Blackout Kick (general)
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        spell.getCooldown("Fists of Fury").timeleft > 0 && 
        (me.getAuraStacks(auras.teachingsOfTheMonastery) > 3 || me.hasVisibleAura(auras.orderedElements)) && 
        (this.hasTalent("Shadowboxing Treads") || me.hasVisibleAura(auras.bokProc) || me.hasVisibleAura(auras.orderedElements))
      ),
      
      // Jadefire Stomp
      spell.cast("Jadefire Stomp", () => this.getCurrentTarget(), req => 
        (this.hasTalent("Singularly Focused Jade") || this.hasTalent("Jadefire Harmony")) && 
        this.canUseJadefireStomp()
      ),
      
      // Chi Burst
      spell.cast("Chi Burst", () => !me.hasVisibleAura(auras.orderedElements)),
      
      // Tiger Palm with Ordered Elements
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        me.hasVisibleAura(auras.orderedElements) && 
        this.getChiDeficit() >= 1
      )
    );
  }

  buildDefaultST() {
    return new bt.Selector(
      // Rising Sun Kick with Pressure Point
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick") && 
        me.hasVisibleAura(auras.pressurePoint) && 
        this.smallHotjsActive
      ),
      
      // Slicing Winds with 2pc
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => 
        Settings.HasTWW3_2pc && 
        this.hasTalent("Celestial Conduit") && 
        this.smallHotjsActive
      ),
      
      // Tiger Palm before Celestial Conduit
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        spell.getCooldown("Celestial Conduit").ready && 
        me.hasVisibleAura(auras.pressurePoint) && 
        me.powerByType(PowerType.Chi) < 5 && 
        this.getCombatTime() < 10
      ),
      
      // Rising Sun Kick priority conditions
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick") && 
        (me.hasVisibleAura(auras.pressurePoint) && !this.smallHotjsActive && me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) || 
        me.hasVisibleAura(auras.invokersDelight) || 
        me.hasVisibleAura(auras.pressurePoint) && spell.getCooldown("Fists of Fury").timeleft > 0)
      ),
      
      // Tiger Palm with energy conditions
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Chi) < 5 && 
        this.comboStrike("Tiger Palm") && 
        !this.smallHotjsActive && 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        this.getEnergyTimeToMax() <= me.gcd * 3
      ),
      
      // Tiger Palm with 4pc
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        (me.getAura(auras.stormEarthAndFire)?.remaining || 0) > 2000 && 
        this.hasTalent("Flurry Strikes") && 
        Settings.HasTWW3_4pc
      ),
      
      // Whirling Dragon Punch
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        me.getAuraStacks(auras.danceOfChiji) !== 2 && 
        !Settings.HasTWW3_2pc
      ),
      
      // Celestial Conduit
      spell.cast("Celestial Conduit", () => 
        Settings.UseCelestialConduit && 
        me.hasVisibleAura(auras.stormEarthAndFire) && 
        (!me.hasVisibleAura(auras.heartOfTheJadeSerpentCDR) || this.getDebuffRemainingTime(auras.galeForce) < 5000) && 
        spell.getCooldown("Strike of the Windlord").timeleft > 0
      ),
      
      // Tiger Palm with small hotjs
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Chi) < 5 && 
        this.comboStrike("Tiger Palm") && 
        this.smallHotjsActive && 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        this.getEnergyTimeToMax() <= me.gcd * 3
      ),
      
      // Fists of Fury
      spell.cast("Fists of Fury", on => this.getCurrentTarget(), req => 
        this.comboStrike("Fists of Fury") && 
        (me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) || this.smallHotjsActive) && me.getEnemies(10).length > 1
      ),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.danceOfChiji) === 2 && 
        this.comboStrike("Spinning Crane Kick") && 
        (!Settings.HasTWW3_2pc || !me.hasVisibleAura("Bloodlust")) && 
        !this.hasTalent("Flurry Strikes") && me.getEnemies(10).length > 1
      ),
      
      // Tiger Palm with complex conditions
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        ((me.powerByType(PowerType.Energy) > 55 && this.hasTalent("Inner Peace")) || 
        (me.powerByType(PowerType.Energy) > 60 && !this.hasTalent("Inner Peace"))) && 
        this.comboStrike("Tiger Palm") && 
        this.getChiDeficit() >= 2 && 
        me.getAuraStacks(auras.teachingsOfTheMonastery) < this.getTeachingsMaxStacks() && 
        !me.hasVisibleAura(auras.orderedElements)
      ),
      
      // Touch of Death
      spell.cast("Touch of Death", on => this.getTouchOfDeathTarget(), req => 
        Settings.UseTouchOfDeath && 
        this.overlayToggles.touchOfDeath.value && 
        this.getTouchOfDeathTarget() !== null
      ),
      
      // Rising Sun Kick (general)
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Chi) > 4 || 
        (me.powerByType(PowerType.Chi) > 2 && me.powerByType(PowerType.Energy) > 50) || 
        spell.getCooldown("Fists of Fury").timeleft > 2000
      ),
      
      // Blackout Kick with Teachings stacks
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.teachingsOfTheMonastery) > 3 && 
        me.hasVisibleAura(auras.orderedElements) && 
        spell.getCooldown("Rising Sun Kick").timeleft > 1000 && 
        spell.getCooldown("Fists of Fury").timeleft > 2000
      ),
      
      // Whirling Dragon Punch (2pc)
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        Settings.HasTWW3_2pc
      ),
      
      // Whirling Dragon Punch (general ST)
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        me.getAuraStacks(auras.danceOfChiji) !== 2 || 
        me.hasVisibleAura(auras.orderedElements) || 
        this.hasTalent("Knowledge of the Broken Temple")
      ),
      
      // Crackling Jade Lightning
      spell.cast("Crackling Jade Lightning", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.theEmperorsCapacitor) > 19 && 
        !this.smallHotjsActive && 
        !me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial) && 
        this.comboStrike("Crackling Jade Lightning") && 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000
      ),
      
      // Slicing Winds (general ST)
      EvokerCommon.castEmpowered("Slicing Winds", Settings.SlicingWindsEmpowerLevel, () => this.getCurrentTarget(), () => 
        this.getTargetTimeToDeath() > 10 && 
        !Settings.HasTWW3_4pc || 
        this.hasTalent("Flurry Strikes")
      ),
      
      // Rising Sun Kick (chi conditions)
      spell.cast("Rising Sun Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Rising Sun Kick") && 
        (me.powerByType(PowerType.Chi) > 4 || 
        me.powerByType(PowerType.Chi) > 2 && me.powerByType(PowerType.Energy) > 50 || 
        spell.getCooldown("Fists of Fury").timeleft > 2000)
      ),
      
      // Fists of Fury (ST conditions)
      spell.cast("Fists of Fury", on => this.getCurrentTarget(), req => 
        (this.hasTalent("Xuen's Battlegear") || 
        (!this.hasTalent("Xuen's Battlegear") && 
        (spell.getCooldown("Strike of the Windlord").timeleft > 1000 || 
        this.smallHotjsActive || 
        me.hasVisibleAura(auras.heartOfTheJadeSerpentCDRCelestial)))) && 
        (this.hasTalent("Xuen's Battlegear") && spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 5000 || 
        spell.getCooldown("Invoke Xuen, the White Tiger").timeleft > 10000) && me.getEnemies(10).length > 1
      ),
      
      // Tiger Palm with energy management
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        this.getChiDeficit() >= 2 && 
        this.getEnergyTimeToMax() <= me.gcd * 3
      ),
      
      // Blackout Kick with Memory of the Monastery
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        me.getAuraStacks(auras.teachingsOfTheMonastery) > 7 && 
        this.hasTalent("Memory of the Monastery") && 
        !me.hasVisibleAura(auras.memoryOfTheMonastery) && 
        spell.getCooldown("Fists of Fury").timeleft > 0
      ),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        (me.getAuraStacks(auras.danceOfChiji) === 2 || 
        ((me.getAura(auras.danceOfChiji)?.remaining || 0) < 2000 && me.hasVisibleAura(auras.danceOfChiji))) && 
        this.comboStrike("Spinning Crane Kick") && 
        !me.hasVisibleAura(auras.orderedElements) && me.getEnemies(10).length > 1
      ),
      
      // Whirling Dragon Punch (fallback)
      spell.cast("Whirling Dragon Punch", on => this.getCurrentTarget(), req => 
        this.comboStrike("Whirling Dragon Punch")
      ),
      
      // Blackout Kick with procs
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.hasTalent("Courageous Impulse") && 
        this.comboStrike("Blackout Kick") && 
        me.getAuraStacks(auras.bokProc) === 2
      ),
      
      // Spinning Crane Kick with 2pc
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura(auras.danceOfChiji) && 
        Settings.HasTWW3_2pc && 
        this.comboStrike("Spinning Crane Kick") && me.getEnemies(10).length > 1
      ),
      
      // Blackout Kick with Ordered Elements
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        me.hasVisibleAura(auras.orderedElements) && 
        spell.getCooldown("Rising Sun Kick").timeleft > 1000 && 
        spell.getCooldown("Fists of Fury").timeleft > 2000
      ),
      
      // Tiger Palm with Flurry Strikes
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        this.getEnergyTimeToMax() <= me.gcd * 3 && 
        this.hasTalent("Flurry Strikes")
      ),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Spinning Crane Kick") && 
        me.hasVisibleAura(auras.danceOfChiji) && 
        (me.hasVisibleAura(auras.orderedElements) || 
        this.getEnergyTimeToMax() >= me.gcd * 3) && me.getEnemies(10).length > 1
      ),
      
      // Jadefire Stomp
      spell.cast("Jadefire Stomp", () => this.getCurrentTarget(), req => 
        (this.hasTalent("Singularly Focused Jade") || this.hasTalent("Jadefire Harmony")) && 
        this.canUseJadefireStomp()
      ),
      
      // Chi Burst
      spell.cast("Chi Burst", () => !me.hasVisibleAura(auras.orderedElements)),
      spell.cast("Chi Wave", () => !me.hasVisibleAura(auras.orderedElements)),
      
      // Blackout Kick (general ST)
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        (me.hasVisibleAura(auras.orderedElements) || 
        (me.hasVisibleAura(auras.bokProc) && this.getChiDeficit() >= 1 && this.hasTalent("Energy Burst"))) && 
        spell.getCooldown("Fists of Fury").timeleft > 0
      ),
      
      // Tiger Palm with Ordered Elements
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        me.hasVisibleAura(auras.orderedElements) && 
        this.getChiDeficit() >= 1
      ),
      
      // Chi Burst (fallback)
      spell.cast("Chi Burst"),
      spell.cast("Chi Wave"),
      
      // Spinning Crane Kick with Hit Combo
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Spinning Crane Kick") && 
        me.hasVisibleAura(auras.orderedElements) && 
        this.hasTalent("Hit Combo") && me.getEnemies(10).length > 1
      ),
      
      // Blackout Kick without Hit Combo
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        me.hasVisibleAura(auras.orderedElements) && 
        !this.hasTalent("Hit Combo") && 
        spell.getCooldown("Fists of Fury").timeleft > 0
      ),
      
      // Tiger Palm (previous Tiger Palm condition)
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        me.powerByType(PowerType.Chi) < 3 && 
        spell.getCooldown("Fists of Fury").ready
      )
    );
  }

  buildFallback() {
    return new bt.Selector(
      // Spinning Crane Kick
      spell.cast("Spinning Crane Kick", on => this.getCurrentTarget(), req => 
        me.powerByType(PowerType.Chi) > 5 && 
        this.comboStrike("Spinning Crane Kick") && me.getEnemies(10).length > 1
      ),
      
      // Blackout Kick
      spell.cast("Blackout Kick", on => this.getCurrentTarget(), req => 
        this.comboStrike("Blackout Kick") && 
        me.powerByType(PowerType.Chi) > 3
      ),
      
      // Tiger Palm
      spell.cast("Tiger Palm", on => this.getCurrentTarget(), req => 
        this.comboStrike("Tiger Palm") && 
        me.powerByType(PowerType.Chi) > 5
      )
    );
  }

  buildRacials() {
    return new bt.Selector(
      // Arcane Torrent with chi/energy conditions
      spell.cast("Arcane Torrent", () => 
        Settings.UseArcaneTorrent && 
        me.powerByType(PowerType.Chi) < me.maxPowerByType(PowerType.Chi) && 
        me.powerByType(PowerType.Energy) < 55
      ),
      
      // Other racials when Storm, Earth, and Fire is down
      spell.cast("Bag of Tricks", () => 
        Settings.UseBagOfTricks && 
        !me.hasVisibleAura(auras.stormEarthAndFire)
      ),
      
      spell.cast("Light's Judgment", () => 
        Settings.UseLightsJudgment && 
        !me.hasVisibleAura(auras.stormEarthAndFire)
      ),
      
      spell.cast("Haymaker", () => 
        Settings.UseHaymaker && 
        !me.hasVisibleAura(auras.stormEarthAndFire)
      ),
      
      spell.cast("Rocket Barrage", () => 
        Settings.UseRocketBarrage && 
        !me.hasVisibleAura(auras.stormEarthAndFire)
      ),
      
      spell.cast("Arcane Pulse", () => 
        Settings.UseArcanePulse && 
        !me.hasVisibleAura(auras.stormEarthAndFire)
      )
    );
  }

  // Helper methods
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getCombatTime() {
    return wow.frameTime / 1000;
  }

  getTargetTimeToDeath() {
    const target = this.getCurrentTarget();
    return target ? (target.timeToDeath() || 999) : 999;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }



  getDebuffRemainingTime(debuffId) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffId);
    return debuff ? debuff.remaining : 0;
  }

  getChiDeficit() {
    return me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi);
  }

  getEnergyTimeToMax() {
    const currentEnergy = me.powerByType(PowerType.Energy);
    const maxEnergy = me.maxPowerByType(PowerType.Energy);
    const energyRegen = 10; // Base energy regen for monks
    return Math.max(0, (maxEnergy - currentEnergy) / energyRegen * 1000);
  }

  getTeachingsMaxStacks() {
    return this.hasTalent("Knowledge of the Broken Temple") ? 8 : 4;
  }

  comboStrike(spellName) {
    // Check if the spell was not the previous spell cast (Hit Combo requirement)
    return !this.wasPreviousSpell(spellName);
  }

  wasPreviousSpell(spellName) {
    // Simple check: was this spell the last combo strike ability we tracked?
    const matches = this.lastComboStrikeAbility === spellName;
    
    //console.info(`[Windwalker] Last: ${this.lastComboStrikeAbility || 'none'}, Checking: ${spellName}, ${matches ? 'BLOCKED' : 'ALLOWED'}`);
    
    return matches;
  }
  
  // Update the last combo strike ability when we cast one
  updateLastComboStrike() {
    const allSpells = spell.getLastSuccessfulSpells(1); // Just get the most recent spell
    if (!allSpells || allSpells.length === 0) return;
    
    const lastSpell = allSpells[0];
    if (lastSpell && lastSpell.name) {
      // Check if it's a combo strike ability
      const comboStrikeAbilities = [
        "Tiger Palm",
        "Blackout Kick", 
        "Rising Sun Kick",
        "Spinning Crane Kick",
        "Fists of Fury",
        "Crackling Jade Lightning",
        "Whirling Dragon Punch"
      ];
      
      if (comboStrikeAbilities.includes(lastSpell.name)) {
        this.lastComboStrikeAbility = lastSpell.name;
        //console.info(`[Windwalker] Updated last combo strike: ${lastSpell.name}`);
      }
    }
  }
  
  // Helper method to get current target
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.distanceTo(unit) <= 40 && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  noDefensivesUp() {
    return !me.hasVisibleAura(auras.fortifyingBrew) && 
           !me.hasVisibleAura(auras.dampenHarm) && 
           !me.hasVisibleAura(auras.diffuseMagic) && 
           !me.hasVisibleAura(auras.touchOfKarma);
  }

  getTouchOfDeathTarget() {
    // Check if Touch of Death is ready or we have the Hidden Master's Forbidden Touch buff
    if (!spell.getCooldown("Touch of Death").ready && !me.hasVisibleAura("Hidden Master's Forbidden Touch")) {
      return null;
    }
    
    const enemies = me.getEnemies();
    let bestTarget = null;
    let bestHealth = 0;
    
    for (const enemy of enemies) {
      if (enemy && !enemy.deadOrGhost && me.distanceTo(enemy) <= 5 && me.isFacing(enemy)) {
        // Check if we can use Touch of Death on this target
        const canToD = this.canTouchOfDeath(enemy);
        if (!canToD) continue;
        
        // Select target with highest health (as per Lua framework)
        if (!bestTarget || enemy.health > bestHealth) {
          bestTarget = enemy;
          bestHealth = enemy.health;
        }
      }
    }
    
    return bestTarget;
  }

  canTouchOfDeath(target) {
    if (!target) return false;
    
    // Check if Touch of Death is ready
    if (spell.getCooldown("Touch of Death").timeleft > 0) {
      return false;
    }
    
    // Check health conditions based on talent
    if (this.hasTalent("Improved Touch of Death")) {
      return target.pctHealth <= 15;
    } else {
      return me.health > target.health;
    }
  }

  canUseJadefireStomp() {
    // Check movement threshold
    const movingThreshold = Settings.JadefireStompMovingThreshold * 1000;
    if (me.isMoving() && this.getMovingDuration() >= movingThreshold) {
      return false;
    }
    
    // Check range
    const target = this.getCurrentTarget();
    return target && me.distanceTo(target) <= Settings.JadefireStompRange;
  }

  getMovingDuration() {
    // This would need to be implemented based on available API
    // For now, return 0 to allow Jadefire Stomp
    return 0;
  }

  shouldUseRacialWithXuen() {
    return (me.getAura(auras.invokeXuen)?.remaining || 0) > 15000 || 
           !this.hasTalent("Invoke Xuen, the White Tiger") || 
           this.getTargetTimeToDeath() < 20;
  }

  updateRotationVariables() {
    // Update small_hotjs_active
    this.smallHotjsActive = me.hasVisibleAura(auras.heartOfTheJadeSerpentCDR) || me.hasAura(auras.heartOfTheJadeSerpentTWW3Tier);
    
    // Update fight style detection
    this.patchwerk = false; // Simplified - would need specific boss detection
    this.fightRemains = this.getTargetTimeToDeath();
    this.dungeonslice = me.inInstance && !me.inRaid && this.fightRemains < 20;
    this.dungeonroute = me.inInstance && !me.inRaid;
    
    // Update complex condition variables using Lua logic
    const target = this.getCurrentTarget();
    const targetTTD = this.getTargetTimeToDeath();
    const enemyCount = this.getEnemiesInRange(8);
    const chi = me.powerByType(PowerType.Chi);
    const energy = me.powerByType(PowerType.Energy);
    const combatTime = this.getCombatTime();
    
    // Get important cooldown and buff info
    const invokersDelightRemains = me.getAura(auras.invokersDelight)?.remaining || 0;
    const bloodlustUp = me.hasVisibleAura("Bloodlust") || me.hasVisibleAura("Heroism") || me.hasVisibleAura("Time Warp");
    const strikeWindlordRemains = spell.getCooldown("Strike of the Windlord").timeleft;
    const sefFullRecharge = spell.getCooldown("Storm, Earth, and Fire").charges < 2 ? spell.getCooldown("Storm, Earth, and Fire").timeleft : 0;
    const xuenRemains = spell.getCooldown("Invoke Xuen, the White Tiger").timeleft;
    const fistsRemains = spell.getCooldown("Fists of Fury").timeleft;
    const capacitorStacks = me.getAuraStacks(auras.theEmperorsCapacitor);
    
    // SEF condition from Lua (full logic)
    this.sefCondition = targetTTD > 6 && 
      (spell.getCooldown("Rising Sun Kick").timeleft > 0 || enemyCount > 2 || !this.hasTalent("Ordered Elements")) &&
      (this.wasPreviousSpell("Invoke Xuen, the White Tiger") ||
       ((this.hasTalent("Celestial Conduit") || !this.hasTalent("Last Emperor's Capacitor")) && 
        bloodlustUp && (strikeWindlordRemains < 5 || !this.hasTalent("Strike of the Windlord")) && 
        this.hasTalent("Sequenced Strikes")) ||
       invokersDelightRemains > 15 ||
       ((strikeWindlordRemains < 5 || !this.hasTalent("Strike of the Windlord")) && 
        sefFullRecharge < xuenRemains && fistsRemains < 5 && 
        (!this.hasTalent("Last Emperor's Capacitor") || this.hasTalent("Celestial Conduit"))) ||
       (this.hasTalent("Last Emperor's Capacitor") && capacitorStacks > 17 && 
        xuenRemains > sefFullRecharge) ||
       this.fightRemains < 30 ||
       (invokersDelightRemains > 15 && this.dungeonslice && 
        (spell.getCooldown("Rising Sun Kick").timeleft > 0 || enemyCount > 2 || !this.hasTalent("Ordered Elements"))));
    
    // Xuen condition from Lua (full logic)  
    this.xuenCondition = ((this.dungeonslice && enemyCount === 1 && 
                          (combatTime < 10 || (this.hasTalent("Xuen's Bond") && this.hasTalent("Celestial Conduit")))) || 
                         !this.dungeonslice || enemyCount > 1) &&
                        spell.getCooldown("Storm, Earth, and Fire").ready &&
                        ((targetTTD > 14 && !this.dungeonroute) || targetTTD > 22) &&
                        (enemyCount > 2 || target?.hasVisibleAura(auras.acclamation) || 
                         (!this.hasTalent("Ordered Elements") && combatTime < 5)) &&
                        ((chi > 2 && this.hasTalent("Ordered Elements")) || chi > 5 || 
                         (chi > 3 && energy < 50) || (energy < 50 && enemyCount === 1) ||
                         (this.wasPreviousSpell("Tiger Palm") && !this.hasTalent("Ordered Elements") && combatTime < 5));
    
    // Count Xuen invocations
    if (this.wasPreviousSpell("Invoke Xuen, the White Tiger")) {
      this.invokeXuenCount++;
    }
    
    if (!me.inCombat()) {
      this.invokeXuenCount = 0;
    }
  }

  // Burst system methods
  handleBurstToggle() {
    if (!Settings.UseBurstToggle) return;
    
    if (KeyBinding.isPressed("BurstToggleKeybind")) {
      if (!Settings.BurstModeWindow) {
        combat.burstToggle = !combat.burstToggle;
        this.burstModeActive = combat.burstToggle;
        console.log(`Burst toggle ${combat.burstToggle ? 'ACTIVATED' : 'DEACTIVATED'} (Toggle mode)`);
      } else {
        combat.burstToggle = true;
        this.burstModeActive = true;
        this.burstToggleTime = wow.frameTime;
        console.log(`Burst window ACTIVATED for ${Settings.BurstWindowDuration} seconds`);
      }
    }
    
    if (Settings.BurstModeWindow && combat.burstToggle && this.burstToggleTime > 0) {
      const elapsed = (wow.frameTime - this.burstToggleTime) / 1000;
      
      if (elapsed >= Settings.BurstWindowDuration) {
        combat.burstToggle = false;
        this.burstModeActive = false;
        this.burstToggleTime = 0;
        console.log(`Burst window EXPIRED after ${elapsed.toFixed(1)}s`);
      }
    }
  }

  shouldUseBurstAbility() {
    if (Settings.UseBurstToggle) {
      return combat.burstToggle;
    }
    return this.burstModeActive;
  }

  renderOverlay() {
    if (!me || !this.overlayToggles.showOverlay.value) return;

    const viewport = imgui.getMainViewport();
    if (!viewport) return;
    
    const workPos = viewport.workPos;
    const workSize = viewport.workSize;
    
    const overlaySize = { x: 300, y: 400 };
    const overlayPos = { 
      x: workPos.x + workSize.x - overlaySize.x - 20, 
      y: workPos.y + 20 
    };

    imgui.setNextWindowPos(overlayPos, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize(overlaySize, imgui.Cond.FirstUseEver);
    imgui.setNextWindowBgAlpha(0.30);
    
    const windowFlags = imgui.WindowFlags.NoResize | imgui.WindowFlags.AlwaysAutoResize;

    if (imgui.begin("Windwalker Monk Controls", this.overlayToggles.showOverlay, windowFlags)) {
      
      // Combat Status
      if (imgui.collapsingHeader("Combat Status", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        const chi = me.powerByType(PowerType.Chi);
        const maxChi = me.maxPowerByType(PowerType.Chi);
        const energy = me.powerByType(PowerType.Energy);
        const maxEnergy = me.maxPowerByType(PowerType.Energy);
        
        imgui.textColored({ r: 0.2, g: 0.8, b: 1.0, a: 1.0 }, `Chi: ${chi}/${maxChi}`);
        imgui.textColored({ r: 1.0, g: 0.8, b: 0.2, a: 1.0 }, `Energy: ${energy}/${maxEnergy}`);
        
        const enemyCount = this.getEnemiesInRange(8);
        let rotationText = "Single Target";
        if (enemyCount >= 5) rotationText = "AoE (5+)";
        else if (enemyCount > 1) rotationText = `Cleave (${enemyCount})`;
        
        imgui.textColored({ r: 0.8, g: 1.0, b: 0.2, a: 1.0 }, `Mode: ${rotationText}`);
        
        // Teachings stacks
        const teachingsStacks = me.getAuraStacks(auras.teachingsOfTheMonastery);
        const maxTeachings = this.getTeachingsMaxStacks();
        if (teachingsStacks > 0) {
          const teachingsColor = teachingsStacks >= maxTeachings ? 
            { r: 1.0, g: 0.2, b: 0.2, a: 1.0 } : { r: 0.8, g: 0.8, b: 0.8, a: 1.0 };
          imgui.textColored(teachingsColor, `Teachings: ${teachingsStacks}/${maxTeachings}`);
        }
        
        // Last combo strike ability
        if (this.lastComboStrikeAbility) {
          const comboColor = { r: 0.8, g: 0.2, b: 1.0, a: 1.0 }; // Purple for combo tracking
          imgui.textColored(comboColor, `Last Combo: ${this.lastComboStrikeAbility}`);
        } else {
          imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, "Last Combo: None");
        }
        
        imgui.unindent();
      }
      
      // Controls
      if (imgui.collapsingHeader("Controls", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();
        
        imgui.checkbox("Defensives", this.overlayToggles.defensives);
        imgui.checkbox("Cooldowns", this.overlayToggles.cooldowns);
        imgui.checkbox("Interrupts", this.overlayToggles.interrupts);
        imgui.checkbox("Touch of Death", this.overlayToggles.touchOfDeath);
        
        imgui.unindent();
      }
      
      // Manual spell casting section
      if (imgui.collapsingHeader("Manual Spell Casting")) {
        imgui.indent();
        
        imgui.text("Spell ID:");
        imgui.sameLine();
        imgui.setNextItemWidth(80);
        imgui.inputText("##spellId", this.spellIdInput);
        
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
