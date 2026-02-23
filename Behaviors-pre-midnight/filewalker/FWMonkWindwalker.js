import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import CombatTimer from "@/Core/CombatTimer";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import Settings from "@/Core/Settings";

/**
 * Behavior implementation for Windwalker Monk
 * Based on SimC APL: March 17, 2025 - c02ee75
 */
export class WindwalkerMonkBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Windwalker; 
  name = "FW Windwalker Monk";
  version = 1;
  
  // Define talent build options
  static TALENT_BUILDS = {
    SHADO_PAN: 'shadowpan',
    FLURRY: 'flurry',
  };
  
  /**
   * Settings for the behavior
   * These will appear in the UI settings panel
   */
  static settings = [
    {
      header: "Windwalker Configuration",
      options: [
        {
          uid: "UseAOERotation",
          text: "Auto AOE Rotation",
          type: "checkbox",
          default: true
        },
        {
          uid: "AOEThreshold",
          text: "AOE Threshold",
          type: "slider",
          min:1,
          max:10,
          default: 3
        },
        {
          uid: "UseCooldowns",
          text: "Use Cooldowns",
          type: "checkbox",
          default: true
        },
        {
          uid: "XuenThreshold",
          text: "Xuen Time To Die Threshold",
          type: "slider",
          min:1,
          max:100,
          default: 14
        },
        {
          uid: "SEFThreshold",
          text: "SEF Time To Die Threshold",
          type: "slider",
          min:1,
          max:100,
          default: 6
        },
        {
          uid: "UseTouchOfKarma",
          text: "Use Touch of Karma",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseRacials",
          text: "Use Racial Abilities",
          type: "checkbox",
          default: true
        }
      ]
    }
  ];

  /**
   * Builds the behavior tree for Windwalker Monk
   * This is the main entry point for the behavior
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
        new bt.Action(() => {
                if (!this.getCurrentTarget()) return bt.Status.Success;
                
              
                
                return bt.Status.Failure;
              }),
       Common.waitForCastOrChannel(),
       Common.waitForNotMounted(),
       new bt.Action(() => {
               // Return success if we don't have a valid target
               if (this.getCurrentTarget() === null) {
                 return bt.Status.Success;
               }
               return bt.Status.Failure;
             }),
   
      this.initVariables(),
    //   Interrupt with Spear Hand Strike
      Spell.cast("Spear Hand Strike", () => this.shouldInterrupt()),
    //   Opener logic based on target count
      new bt.Decorator(
        () => this.isOpeningPhase() && this.getEnemyCount() > 2,
        this.aoeOpener(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.isOpeningPhase() && this.getEnemyCount() < 3,
        this.normalOpener(),
        new bt.Action(() => bt.Status.Success)
      ),
      // Use cooldowns
      new bt.Decorator(
        () => Settings.UseCooldowns && Spell.isSpellKnown(137639), // Storm, Earth and Fire
        this.useCooldowns(),
        new bt.Action(() => bt.Status.Success)
      ),
      // Main rotations based on enemy count
      new bt.Decorator(
        () => this.getEnemyCount() >= 5 && Settings.UseAOERotation,
        this.aoeRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() > 1 && this.getEnemyCount() < 5 && Settings.UseAOERotation,
        this.cleaveRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() < 2 || !Settings.UseAOERotation,
        this.singleTargetRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      // Fallback in case all rotations fail
    this.fallbackRotation()
      // Racial abilities if enabled
    //   new bt.Decorator(
    //     () => Settings.UseRacials,
    //     this.useRacials(),
    //     new bt.Action(() => bt.Status.Success)
    //   )
    );
  }

  /**
   * Initialize combat variables for rotation logic
   */
  initVariables() {
    return new bt.Action(() => {
      // Check for Shadopan hero talent
      const isFlurryBuild = me.hasAura(59868); // Flurry Strikes
      const target = this.getCurrentTarget();
      // Setup SEF condition variable
      const targetTimeToDie = this.getCurrentTarget()?.timeToDeath() || 999;
      const hasSEFCondition = targetTimeToDie > Settings.SEFThreshold && 
                             (this.hasCooldown("Rising Sun Kick") || this.getEnemyCount() > 2 || !Spell.isSpellKnown(378082)) && // Ordered Elements talent
                             (me.hasAura(162264) || // Xuen active
                             ((!Spell.isSpellKnown(392983) || // Last Emperor's Capacitor
                               target.getAuraStacks(325092) > 17) && // Emperor's Capacitor buff stacks
                              (this.hasCooldown("Strike of the Windlord") < 5 || 
                               !Spell.isSpellKnown(392983)))); // Strike of the Windlord

      // Setup Xuen condition variable
      const hasXuenCondition = (this.getEnemyCount() === 1 && (!Spell.isSpellKnown(395152) || // Celestial Conduit
                                Spell.isSpellKnown(395152) && Spell.isSpellKnown(123904))) && // Xuen's Bond
                               (this.getEnemyCount() > 1) && 
                                Spell.getCooldown(137639)?.ready && // Storm, Earth, and Fire
                               (targetTimeToDie > Settings.XuenThreshold);
      
      return bt.Status.Failure;
    });
  }

  /**
   * Check if we're in the opening phase of combat
   */
  isOpeningPhase() {
    return me.inCombat() && (Date.now() - CombatTimer.getCombatStartTime() < 4000);
  }

  /**
   * Get the current target, preferring the player's target if valid
   */
  getCurrentTarget() {
    const target = me.targetUnit;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Get the number of enemies in range
   */
  getEnemyCount() {
    const targetsInRange = combat.targets.filter(unit => unit.distanceTo(me) <= 8);
    return targetsInRange.length || 1; // Default to 1 if no targets found
  }

  /**
   * Check if a cooldown is available within specified seconds
   */
  hasCooldown(spellName, seconds = 0) {
    const cd = Spell.getCooldown(spellName);
    return cd && cd.ready ? false : cd.timeleft > (seconds * 1000);
  }

  /**
   * Check if we should use cooldowns based on settings and targets
   */
  shouldUseCooldowns() {
    return Settings.UseCooldowns && this.getCurrentTarget() && !this.getCurrentTarget().deadOrGhost;
  }

   /**
   * Calculate the time until energy reaches maximum
   * @returns {number} Time in seconds until energy is capped
   */
   getTimeToMaxEnergy() {
    // Energy regeneration rate is typically 10 energy per second for Monk
    // This can be affected by haste and other factors
    const energyRegenRate = 10 * (1 + (me.modSpellHaste || 0));
    const energyDeficit = me.maxPowerByType(PowerType.Energy) - me.powerByType(PowerType.Energy);
    
    if (energyDeficit <= 0) {
      return 0; // Already at max energy
    }
    
    if (energyRegenRate <= 0) {
      return 9999; // Cannot regenerate energy
    }
    
    return energyDeficit / energyRegenRate;
  }

  /**
   * Check if we should interrupt the current cast
   */
  shouldInterrupt() {
    const target = this.getCurrentTarget();
    return target && target.isCastingOrChanneling && target.isInterruptible;
  }

  /**
   * Check if we have combo strike available
   * Returns true if the last spell cast was different than the one we're checking
   */
  hasComboStrike(spellName) {
    if (!Spell.isSpellKnown(115636)) {  // Mastery: Combo Strikes
      return true;
    }
    
    const lastSpell = Spell.getLastSuccessfulSpell();
    return !lastSpell || lastSpell !== spellName;
  }

  /**
   * Check if the player has a specific talent
   */
  hasTalent(talentName) {
    return Spell.isSpellKnown(talentName);
  }

  /**
   * Auto-detect which hero talent build is active
   */
  detectHeroTalent() {
    if (me.hasAura(59868)) { // Flurry Strikes
      return WindwalkerMonkBehavior.TALENT_BUILDS.FLURRY;
    } else if (me.hasAura(324293)) { // Shado-Pan
      return WindwalkerMonkBehavior.TALENT_BUILDS.SHADO_PAN;
    }
    
    return null;
  }

  /**
   * Use cooldowns according to the APL
   */
  useCooldowns() {
    return new bt.Selector(
      // Tiger Palm before Xuen if needed
      Spell.cast("Tiger Palm", () => {
        const target = this.getCurrentTarget();
        return target && target.timeToDeath() > 14 && 
               !this.hasCooldown("Invoke Xuen, the White Tiger") && 
               (me.powerByType(PowerType.Chi) < 5 && !Spell.isSpellKnown(378082) || me.powerByType(PowerType.Chi) < 3) && 
               this.hasComboStrike("Tiger Palm");
      }),
      
      // Invoke Xuen
      Spell.cast("Invoke Xuen, the White Tiger", () => {
        const target = this.getCurrentTarget();
        const enemyCount = this.getEnemyCount();
        return (enemyCount === 1 && ((!Spell.isSpellKnown(395152) || // Celestial Conduit
                Spell.isSpellKnown(395152) && Spell.isSpellKnown(123904))) || // Xuen's Bond
                enemyCount > 1) && 
                Spell.getCooldown(137639)?.ready && // Storm, Earth, and Fire
               (target && target.timeToDeath() > Settings.XuenThreshold);
      }),
      
      // Storm, Earth and Fire
      Spell.cast("Storm, Earth, and Fire", () => {
        const target = this.getCurrentTarget();
        return target && target.timeToDeath() > Settings.SEFThreshold && 
              (this.hasCooldown("Rising Sun Kick") || this.getEnemyCount() > 2 || !Spell.isSpellKnown(378082)) && // Ordered Elements talent
              (me.hasAura(162264) || // Xuen active
              ((!Spell.isSpellKnown(392983) || // Last Emperor's Capacitor
                me.getAuraStacks(325092) > 17) && // Emperor's Capacitor buff stacks
               (this.hasCooldown("Strike of the Windlord") < 5 || 
                !Spell.isSpellKnown(392983)))); // Strike of the Windlord
      }),
      
      // Touch of Karma
      Spell.cast("Touch of Karma", () => Settings.UseTouchOfKarma && this.getCurrentTarget())
    );
  }

  /**
   * Use racial abilities
   */
  useRacials() {
    return new bt.Selector(
      // Ancestral Call
      Spell.cast("Ancestral Call", () => {
        const hasXuen = me.hasAura(162264); // Xuen buff
        const xuenRemains = me.getAura(162264)?.remaining || 0;
        return hasXuen && xuenRemains > 15000 || 
               !Spell.isSpellKnown(123904) && // No Xuen talent
               (!Spell.isSpellKnown(137639) && // No SEF talent
               (Spell.getCooldown(392983)?.ready || // Strike of the Windlord ready
                !Spell.isSpellKnown(392983) && // No Strike of the Windlord talent
                Spell.getCooldown(113656)?.ready) || // Fists of Fury ready
                me.hasAura(137639) && me.getAura(137639)?.remaining > 10000); // SEF remains > 10 sec
      }),
      
      // Blood Fury
      Spell.cast("Blood Fury", () => {
        const hasXuen = me.hasAura(162264); // Xuen buff
        const xuenRemains = me.getAura(162264)?.remaining || 0;
        return hasXuen && xuenRemains > 15000 || 
               !Spell.isSpellKnown(123904) && // No Xuen talent
               (!Spell.isSpellKnown(137639) && // No SEF talent
               (Spell.getCooldown(392983)?.ready || // Strike of the Windlord ready
                !Spell.isSpellKnown(392983) && // No Strike of the Windlord talent
                Spell.getCooldown(113656)?.ready) || // Fists of Fury ready
                me.hasAura(137639) && me.getAura(137639)?.remaining > 10000); // SEF remains > 10 sec
      }),
      
      // Berserking
      Spell.cast("Berserking", () => {
        const hasXuen = me.hasAura(162264); // Xuen buff
        const xuenRemains = me.getAura(162264)?.remaining || 0;
        return hasXuen && xuenRemains > 15000 || 
               !Spell.isSpellKnown(123904) && // No Xuen talent
               (!Spell.isSpellKnown(137639) && // No SEF talent
               (Spell.getCooldown(392983)?.ready || // Strike of the Windlord ready
                !Spell.isSpellKnown(392983) && // No Strike of the Windlord talent
                Spell.getCooldown(113656)?.ready) || // Fists of Fury ready
                me.hasAura(137639) && me.getAura(137639)?.remaining > 10000); // SEF remains > 10 sec
      }),
      
      // Fireblood
      Spell.cast("Fireblood", () => {
        const hasXuen = me.hasAura(162264); // Xuen buff
        const xuenRemains = me.getAura(162264)?.remaining || 0;
        return hasXuen && xuenRemains > 15000 || 
               !Spell.isSpellKnown(123904) && // No Xuen talent
               (!Spell.isSpellKnown(137639) && // No SEF talent
               (Spell.getCooldown(392983)?.ready || // Strike of the Windlord ready
                !Spell.isSpellKnown(392983) && // No Strike of the Windlord talent
                Spell.getCooldown(113656)?.ready) || // Fists of Fury ready
                me.hasAura(137639) && me.getAura(137639)?.remaining > 10000); // SEF remains > 10 sec
      })
    );
  }

  /**
   * AoE Opener for 3+ targets
   */
  aoeOpener() {
    return new bt.Selector(
      Spell.cast("Slicing Winds"),
      Spell.cast("Tiger Palm", () => me.powerByType(PowerType.Chi) < 6 && (this.hasComboStrike("Tiger Palm") || !Spell.isSpellKnown(196740))) // Check Hit Combo
    );
  }

  /**
   * Normal Opener for 1-2 targets
   */
  normalOpener() {
    return new bt.Selector(
      Spell.cast("Tiger Palm", () => me.powerByType(PowerType.Chi) < 6 && (this.hasComboStrike("Tiger Palm") || !Spell.isSpellKnown(196740))), // Check Hit Combo
      Spell.cast("Rising Sun Kick", () => Spell.isSpellKnown(378082)) // Ordered Elements talent
    );
  }

  /**
   * Fallback rotation when all else fails
   */
  fallbackRotation() {
    return new bt.Selector(
      Spell.cast("Spinning Crane Kick", () => me.powerByType(PowerType.Chi) > 5 && this.hasComboStrike("Spinning Crane Kick")),
      Spell.cast("Blackout Kick", () => this.hasComboStrike("Blackout Kick") && me.powerByType(PowerType.Chi) > 3),
      Spell.cast("Tiger Palm", () => this.hasComboStrike("Tiger Palm") && me.powerByType(PowerType.Chi) > 5)
    );
  }

  /**
   * AoE rotation for 5+ targets
   */
  aoeRotation() {
    return new bt.Selector(
      // Tiger Palm to build chi when needed
      Spell.cast("Tiger Palm", () => {
        return (me.powerByType(PowerType.Energy) > 55 && Spell.isSpellKnown(152173) || me.powerByType(PowerType.Energy) > 60 && !Spell.isSpellKnown(152173)) && // Inner Peace talent
               this.hasComboStrike("Tiger Palm") && 
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 2 && 
               (me.getAuraStacks(116645) < 3) && // Teachings of the Monastery stacks
               ((Spell.isSpellKnown(196736) && !me.hasAura(116768)) || // Energy Burst talent & no BoK proc
                !Spell.isSpellKnown(378082)); // Not Ordered Elements
      }),
      
      // Touch of Death
      Spell.cast("Touch of Death", () => {
        return !me.hasAura(395153) && !me.hasAura(395154); // Heart of the Jade Serpent CDR buffs
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji and high Chi Energy
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               ((me.getAuraStacks(325069) > 29 && this.hasCooldown("Fists of Fury") < 5) || // Chi Energy stacks & FoF coming soon
                (me.getAuraStacks(325202) === 2)); // Dance of Chi-Ji stacks
      }),
      
      // Whirling Dragon Punch with CDR buff
      Spell.cast("Whirling Dragon Punch", () => {
        return me.hasAura(395153) && me.getAuraStacks(325202) < 2; // Has CDR buff & less than 2 Dance of Chi-Ji stacks
      }),
      
      // Whirling Dragon Punch with < 2 Dance of Chi-Ji stacks
      Spell.cast("Whirling Dragon Punch", () => {
        return me.getAuraStacks(325202) < 2; // Less than 2 Dance of Chi-Ji stacks
      }),
      
      // Slicing Winds with CDR buffs
      Spell.cast("Slicing Winds", () => {
        return me.hasAura(395153) || me.hasAura(395154); // Heart of the Jade Serpent CDR buffs
      }),
      
      // Celestial Conduit
      Spell.cast("Celestial Conduit", () => {
        return me.hasAura(137639) && // Storm Earth and Fire up
               this.hasCooldown("Strike of the Windlord") && 
               (!me.hasAura(395153) || me.getAura(396222)?.remaining < 5000) && // No CDR or Gale Force expiring soon
               (Spell.isSpellKnown(123904) || !Spell.isSpellKnown(123904) && me.hasAura(388663)); // Has Xuen's Bond or Invoker's Delight
      }),
      
      // Rising Sun Kick for Whirling Dragon Punch setup
      Spell.cast("Rising Sun Kick", () => {
        return this.hasCooldown("Whirling Dragon Punch") < 2 && 
               this.hasCooldown("Fists of Fury") > 1 && 
               me.getAuraStacks(325202) < 2 || // Dance of Chi-Ji stacks < 2
               !me.hasAura(137639) && me.hasAura(80353); // Not in SEF but has Pressure Point buff
      }),
      
      // Whirling Dragon Punch for AoE
      Spell.cast("Whirling Dragon Punch", () => {
        return !Spell.isSpellKnown(388404) || // Not Revolving Whirl talent
               Spell.isSpellKnown(388404) && me.getAuraStacks(325202) < 2 && this.getEnemyCount() > 2; // Has Revolving Whirl with low Dance stacks and 3+ targets
      }),
      
      // Blackout Kick with BoK proc and low chi for Energy Burst
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && me.hasAura(116768) && me.powerByType(PowerType.Chi) < 2 && 
               Spell.isSpellKnown(196736) && me.powerByType(PowerType.Energy) < 55; // Energy Burst talent and low energy
      }),
      
      // Strike of the Windlord
      Spell.cast("Strike of the Windlord", () => {
        const combatTime = (Date.now() -CombatTimer.getCombatStartTime()) / 1000;
        return (combatTime > 5 || me.hasAura(388663) && me.hasAura(137639)) && // 5+ sec combat time or Invoker's Delight with SEF
               (this.hasCooldown("Invoke Xuen, the White Tiger") > 15 || Spell.isSpellKnown(59868)); // Xuen on CD or has Flurry Strikes
      }),
      
      // Slicing Winds
      Spell.cast("Slicing Winds"),
      
      // Blackout Kick with high Teachings stacks
      Spell.cast("Blackout Kick", () => {
        return me.getAuraStacks(116645) === 8 && Spell.isSpellKnown(392993); // Teachings stacks at max and has Shadowboxing Treads
      }),
      
      // Crackling Jade Lightning with Emperor's Capacitor
      Spell.cast("Crackling Jade Lightning", () => {
        return me.getAuraStacks(325092) > 19 && // Emperor's Capacitor stacks > 19 
               this.hasComboStrike("Crackling Jade Lightning") && 
               Spell.isSpellKnown(408863) && // Power of the Thunder King talent
               this.hasCooldown("Invoke Xuen, the White Tiger") > 10;
      }),
      
      // Fists of Fury
      Spell.cast("Fists of Fury", () => {
        return (Spell.isSpellKnown(59868) || // Flurry Strikes 
                Spell.isSpellKnown(392992) && // Xuen's Battlegear
                (this.hasCooldown("Invoke Xuen, the White Tiger") > 5 || this.hasCooldown("Invoke Xuen, the White Tiger") > 9) || 
                this.hasCooldown("Invoke Xuen, the White Tiger") > 10);
      }),
      
      // Tiger Palm to build chi with Flurry Strikes and Wisdom buff
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               me.hasAura(395152) && // Wisdom of the Wall Flurry buff
               me.powerByType(PowerType.Chi) < 6;
      }),
      
      // SCK at high chi
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && me.powerByType(PowerType.Chi) > 5;
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji and Chi Energy for FoF
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(325202) && // Dance of Chi-Ji buff 
               me.getAuraStacks(325069) > 29 && // Chi Energy stacks > 29
               this.hasCooldown("Fists of Fury") < 5; // FoF coming soon
      }),
      
      // Rising Sun Kick with Pressure Point buff
      Spell.cast("Rising Sun Kick", () => {
        return me.hasAura(80353) && this.hasCooldown("Fists of Fury") > 2; // Pressure Point buff & FoF not ready soon
      }),
      
      // Blackout Kick with Shadowboxing Treads and Courageous Impulse
      Spell.cast("Blackout Kick", () => {
        return Spell.isSpellKnown(392993) && // Shadowboxing Treads
               Spell.isSpellKnown(383724) && // Courageous Impulse
               this.hasComboStrike("Blackout Kick") && 
               me.getAuraStacks(116768) === 2; // 2 stacks of BoK proc
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && me.hasAura(325202); // Dance of Chi-Ji buff
      }),
      
      // Spinning Crane Kick with Ordered Elements and Crane Vortex
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(378082) && // Ordered Elements buff
               Spell.isSpellKnown(388848) && // Crane Vortex talent
               this.getEnemyCount() > 2;
      }),
      
      // Tiger Palm for chi with Flurry Strikes and Ordered Elements
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
            //    this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               me.hasAura(378082); // Ordered Elements buff
      }),
      
      // Tiger Palm for chi deficit
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 2 && 
               (!me.hasAura(378082) || this.getTimeToMaxEnergy() <= me.gcd * 3); // No Ordered Elements or about to cap energy
      }),
      
      // Jadefire Stomp with Singularly Focused Jade or Jadefire Harmony
      Spell.cast("Jadefire Stomp", () => {
        return Spell.isSpellKnown(387356) || Spell.isSpellKnown(388859); // Singularly Focused Jade or Jadefire Harmony talents
      }),
      
      // Spinning Crane Kick without Ordered Elements but with Crane Vortex
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               !me.hasAura(378082) && // No Ordered Elements buff 
               Spell.isSpellKnown(388848) && // Crane Vortex talent
               this.getEnemyCount() > 2 && 
               me.powerByType(PowerType.Chi) > 4;
      }),
      
      // Blackout Kick with combo strike benefits
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               this.hasCooldown("Fists of Fury") && 
               (me.getAuraStacks(116645) > 3 || me.hasAura(378082)) && // High Teachings stack or Ordered Elements
               (Spell.isSpellKnown(392993) || me.hasAura(116768)); // Shadowboxing Treads or BoK proc
      }),
      
      // Blackout Kick before Fists of Fury at low chi
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               !this.hasCooldown("Fists of Fury") && me.powerByType(PowerType.Chi) < 3;
      }),
      
      // Blackout Kick with Shadowboxing Treads and Courageous Impulse and BoK proc
      Spell.cast("Blackout Kick", () => {
        return Spell.isSpellKnown(392993) && // Shadowboxing Treads
               Spell.isSpellKnown(383724) && // Courageous Impulse
               this.hasComboStrike("Blackout Kick") && 
               me.hasAura(116768); // BoK proc
      }),
      
      // Spinning Crane Kick with high chi or energy
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               (me.powerByType(PowerType.Chi) > 3 || me.powerByType(PowerType.Energy) > 55);
      }),
      
      // Blackout Kick with Ordered Elements or BoK proc
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               (me.hasAura(378082) || // Ordered Elements buff
                (me.hasAura(116768) && (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 1 && Spell.isSpellKnown(196736))) && // BoK proc with chi deficit and Energy Burst
               this.hasCooldown("Fists of Fury");
      }),
      
      // Blackout Kick during FoF cooldown
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               this.hasCooldown("Fists of Fury") && 
               (me.powerByType(PowerType.Chi) > 2 || me.powerByType(PowerType.Energy) > 60 || me.hasAura(116768)); // High chi, high energy, or BoK proc
      }),
      
      // Generic Jadefire Stomp
      Spell.cast("Jadefire Stomp"),
      
      // Tiger Palm with Ordered Elements
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               me.hasAura(378082) && // Ordered Elements buff
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 1; // At least 1 Chi deficit
      }),
      
      // Chi Burst without Ordered Elements
      Spell.cast("Chi Burst", () => !me.hasAura(378082)), // No Ordered Elements buff
      
      // Generic Chi Burst
      Spell.cast("Chi Burst"),
      
      // SCK with Ordered Elements and Hit Combo
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(378082) && // Ordered Elements buff
               Spell.isSpellKnown(196740); // Hit Combo talent
      }),
      
      // Blackout Kick with Ordered Elements but without Hit Combo
      Spell.cast("Blackout Kick", () => {
        return me.hasAura(378082) && // Ordered Elements buff
               !Spell.isSpellKnown(196740) && // No Hit Combo talent
               this.hasCooldown("Fists of Fury");
      }),
      
      // Tiger Palm if not combo strike but need chi for FoF
      Spell.cast("Tiger Palm", () => {
        return !this.hasComboStrike("Tiger Palm") && 
               me.powerByType(PowerType.Chi) < 3 && 
               !this.hasCooldown("Fists of Fury"); // FoF is coming up
      })
    );
  }

  /**
   * Cleave rotation for 2-4 targets
   */
  cleaveRotation() {
    return new bt.Selector(
      // Spinning Crane Kick with 2 stacks of Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return me.getAuraStacks(325202) === 2 && this.hasComboStrike("Spinning Crane Kick"); // 2 stacks of Dance of Chi-Ji
      }),
      
      // Rising Sun Kick with Pressure Point or for WDP setup
      Spell.cast("Rising Sun Kick", () => {
        return (me.hasAura(80353) && this.getEnemyCount() < 4 && this.hasCooldown("Fists of Fury") > 4) || // Pressure Point and FoF on CD
               (this.hasCooldown("Whirling Dragon Punch") < 2 && this.hasCooldown("Fists of Fury") > 1 && me.getAuraStacks(325202) < 2); // Setting up WDP
      }),
      
      // Spinning Crane Kick with 2 stacks of Dance of Chi-Ji for 4+ targets
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.getAuraStacks(325202) === 2 && 
               this.getEnemyCount() > 3;
      }),
      
      // Tiger Palm for chi generation and combo with right conditions
      Spell.cast("Tiger Palm", () => {
        return (me.powerByType(PowerType.Energy) > 55 && Spell.isSpellKnown(152173) || me.powerByType(PowerType.Energy) > 60 && !Spell.isSpellKnown(152173)) && // Energy check with Inner Peace
               this.hasComboStrike("Tiger Palm") && 
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 2 && 
               me.getAuraStacks(116645) < 3 && // Low Teachings stacks
               ((Spell.isSpellKnown(196736) && !me.hasAura(116768) || !Spell.isSpellKnown(196736)) && // Energy Burst without BoK proc
                !me.hasAura(378082)) || // No Ordered Elements
               ((Spell.isSpellKnown(196736) && !me.hasAura(116768) || !Spell.isSpellKnown(196736)) && 
                !me.hasAura(378082) && // No Ordered Elements 
                !this.hasCooldown("Fists of Fury") && me.powerByType(PowerType.Chi) < 3); // FoF ready but low chi
      }),
      
      // Touch of Death
      Spell.cast("Touch of Death", () => {
        return !me.hasAura(395153) && !me.hasAura(395154); // No Heart of the Jade Serpent CDR buffs
      }),
      
      // Whirling Dragon Punch with CDR
      Spell.cast("Whirling Dragon Punch", () => {
        return me.hasAura(395153) && me.getAuraStacks(325202) < 2; // Heart of the Jade Serpent CDR and low Dance of Chi-Ji
      }),
      
      // Whirling Dragon Punch
      Spell.cast("Whirling Dragon Punch", () => {
        return me.getAuraStacks(325202) < 2; // Low Dance of Chi-Ji stacks
      }),
      
      // Slicing Winds with CDR
      Spell.cast("Slicing Winds", () => {
        return me.hasAura(395153) || me.hasAura(395154); // Any Heart of the Jade Serpent CDR buff
      }),
      
      // Celestial Conduit
      Spell.cast("Celestial Conduit", () => {
        return me.hasAura(137639) && // Storm Earth and Fire up
               this.hasCooldown("Strike of the Windlord") && 
               (!me.hasAura(395153) || me.getAura(396222)?.remaining < 5000) && // No CDR or Gale Force expiring soon
               (Spell.isSpellKnown(123904) || !Spell.isSpellKnown(123904) && me.hasAura(388663)); // Has Xuen's Bond or Invoker's Delight
      }),
      
      // Rising Sun Kick in early pull or with CDR and Pressure Point
      Spell.cast("Rising Sun Kick", () => {
        return (!me.hasAura(162264) && me.hasAura("Tiger Palm") && this.isOpeningPhase()) || // Opening phase
               (me.hasAura(395154) && me.hasAura(80353) && this.hasCooldown("Fists of Fury") && 
                (Spell.isSpellKnown(392991) || this.getEnemyCount() < 3)); // With Glory of the Dawn or few targets
      }),
      
      // Fists of Fury with CDR
      Spell.cast("Fists of Fury", () => {
        return me.hasAura(395154); // Heart of the Jade Serpent CDR Celestial
      }),
      
      // Whirling Dragon Punch with CDR Celestial
      Spell.cast("Whirling Dragon Punch", () => {
        return me.hasAura(395154); // Heart of the Jade Serpent CDR Celestial
      }),
      
      // Strike of the Windlord with Gale Force
      Spell.cast("Strike of the Windlord", () => {
        return Spell.isSpellKnown(396228) && // Gale Force talent
               me.hasAura(388663) && // Invoker's Delight buff
               (me.hasAura(2825) || !me.hasAura(395154)); // Bloodlust or no CDR Celestial
      }),
      
      // Fists of Fury with Power Infusion and Bloodlust
      Spell.cast("Fists of Fury", () => {
        return me.hasAura(10060) && me.hasAura(2825); // Power Infusion and Bloodlust
      }),
      
      // Rising Sun Kick with Power Infusion and Bloodlust for few targets
      Spell.cast("Rising Sun Kick", () => {
        return me.hasAura(10060) && me.hasAura(2825) && this.getEnemyCount() < 3;
      }),
      
      // Blackout Kick with max Teachings and targets < 3 or Shadowboxing Treads
      Spell.cast("Blackout Kick", () => {
        return me.getAuraStacks(116645) === 8 && 
               (this.getEnemyCount() < 3 || Spell.isSpellKnown(392993)); // Shadowboxing Treads
      }),
      
      // Whirling Dragon Punch with various conditions
      Spell.cast("Whirling Dragon Punch", () => {
        return !Spell.isSpellKnown(388404) || // Not Revolving Whirl
               (Spell.isSpellKnown(388404) && me.getAuraStacks(325202) < 2 && this.getEnemyCount() > 2) || // Revolving Whirl, low Dance stacks, 3+ targets
               this.getEnemyCount() < 3; // Few targets
      }),
      
      // Strike of the Windlord 
      Spell.cast("Strike of the Windlord", () => {
        const combatTime = (Date.now() -CombatTimer.getCombatStartTime()) / 1000;
        return combatTime > 5 && 
               (this.hasCooldown("Invoke Xuen, the White Tiger") > 15 || Spell.isSpellKnown(59868)) && // Xuen on CD or Flurry Strikes
               (this.hasCooldown("Fists of Fury") < 2 || this.hasCooldown("Celestial Conduit") < 10);
      }),
      
      // Slicing Winds
      Spell.cast("Slicing Winds"),
      
      // Crackling Jade Lightning with Emperor's Capacitor
      Spell.cast("Crackling Jade Lightning", () => {
        return me.getAuraStacks(325092) > 19 && // Emperor's Capacitor stacks > 19
               this.hasComboStrike("Crackling Jade Lightning") && 
               Spell.isSpellKnown(408863) && // Power of the Thunder King talent
               this.hasCooldown("Invoke Xuen, the White Tiger") > 10;
      }),
      
      // Spinning Crane Kick with 2 stacks of Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && me.getAuraStacks(325202) === 2;
      }),
      
      // Tiger Palm with Flurry Strikes and Wisdom buff for < 5 targets
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               this.getEnemyCount() < 5 && 
               me.hasAura(395152); // Wisdom of the Wall Flurry buff
      }),
      
      // Fists of Fury
      Spell.cast("Fists of Fury", () => {
        return (Spell.isSpellKnown(59868) || // Flurry Strikes
                Spell.isSpellKnown(392992) || // Xuen's Battlegear
                (!Spell.isSpellKnown(392992) && 
                 (this.hasCooldown("Strike of the Windlord") > 1 || 
                  me.hasAura(395153) || me.hasAura(395154)))) && // SotW on CD or CDR buff
               (Spell.isSpellKnown(59868) || // Flurry Strikes
                Spell.isSpellKnown(392992) && 
                (this.hasCooldown("Invoke Xuen, the White Tiger") > 5 || this.hasCooldown("Invoke Xuen, the White Tiger") > 9) || 
                this.hasCooldown("Invoke Xuen, the White Tiger") > 10);
      }),
      
      // Tiger Palm with Flurry Strikes and Wisdom buff
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               this.getEnemyCount() < 5 && 
               me.hasAura(395152); // Wisdom of the Wall Flurry buff
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji and Chi Energy
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(325202) && // Dance of Chi-Ji
               me.getAuraStacks(325069) > 29; // Chi Energy > 29
      }),
      
      // Rising Sun Kick with high chi or energy or FoF cooldown
      Spell.cast("Rising Sun Kick", () => {
        return (me.powerByType(PowerType.Chi) > 4 && (this.getEnemyCount() < 3 || Spell.isSpellKnown(392991))) || // High chi with Glory of the Dawn or few targets
               (me.powerByType(PowerType.Chi) > 2 && me.powerByType(PowerType.Energy) > 50 && (this.getEnemyCount() < 3 || Spell.isSpellKnown(392991))) || // Decent chi and energy
               (this.hasCooldown("Fists of Fury") > 2 && (this.getEnemyCount() < 3 || Spell.isSpellKnown(392991))); // FoF on cooldown
      }),
      
      // Blackout Kick with Shadowboxing Treads, Courageous Impulse, and 2 BoK procs
      Spell.cast("Blackout Kick", () => {
        return Spell.isSpellKnown(392993) && // Shadowboxing Treads
               Spell.isSpellKnown(383724) && // Courageous Impulse
               this.hasComboStrike("Blackout Kick") && 
               me.getAuraStacks(116768) === 2; // 2 stacks of BoK proc
      }),
      
      // Blackout Kick with 4 Teachings and right talents for < 3 targets
      Spell.cast("Blackout Kick", () => {
        return me.getAuraStacks(116645) === 4 && 
               !Spell.isSpellKnown(387026) && // Not Knowledge of the Broken Temple
               Spell.isSpellKnown(392993) && // Shadowboxing Treads
               this.getEnemyCount() < 3;
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && me.hasAura(325202); // Dance of Chi-Ji
      }),
      
      // Blackout Kick with Shadowboxing Treads, Courageous Impulse, and BoK proc
      Spell.cast("Blackout Kick", () => {
        return Spell.isSpellKnown(392993) && // Shadowboxing Treads
               Spell.isSpellKnown(383724) && // Courageous Impulse
               this.hasComboStrike("Blackout Kick") && 
               me.hasAura(116768); // BoK proc
      }),
      
      // Tiger Palm with Flurry Strikes for < 5 targets
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               this.getEnemyCount() < 5;
      }),
      
      // Tiger Palm for chi deficit
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 2 && 
               (!me.hasAura(378082) || this.getTimeToMaxEnergy() <= me.gcd * 3); // No Ordered Elements or about to cap energy
      }),
      
      // Blackout Kick with high Teachings and RSK on cooldown
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               this.hasCooldown("Fists of Fury") && 
               me.getAuraStacks(116645) > 3 && 
               this.hasCooldown("Rising Sun Kick");
      }),
      
      // Jadefire Stomp with Singularly Focused Jade or Jadefire Harmony
      Spell.cast("Jadefire Stomp", () => {
        return Spell.isSpellKnown(387356) || Spell.isSpellKnown(388859); // Singularly Focused Jade or Jadefire Harmony talents
      }),
      
      // Blackout Kick with combo strike during FoF cooldown
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               this.hasCooldown("Fists of Fury") && 
               (me.getAuraStacks(116645) > 3 || me.hasAura(378082)) && // High Teachings or Ordered Elements
               (Spell.isSpellKnown(392993) || me.hasAura(116768) || me.hasAura(378082)); // Shadowboxing, BoK proc, or Ordered Elements
      }),
      
      // Spinning Crane Kick with Crane Vortex for 3+ targets
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               !me.hasAura(378082) && // No Ordered Elements
               Spell.isSpellKnown(388848) && // Crane Vortex talent
               this.getEnemyCount() > 2 && 
               me.powerByType(PowerType.Chi) > 4;
      }),
      
      // Chi Burst without Ordered Elements
      Spell.cast("Chi Burst", () => !me.hasAura(378082)),
      
      // Blackout Kick with Ordered Elements or BoK proc during FoF cooldown
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               (me.hasAura(378082) || // Ordered Elements buff
                (me.hasAura(116768) && (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 1 && Spell.isSpellKnown(196736))) && // BoK proc with deficit and Energy Burst
               this.hasCooldown("Fists of Fury");
      }),
      
      // Blackout Kick during FoF cooldown with various conditions
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               this.hasCooldown("Fists of Fury") && 
               (me.powerByType(PowerType.Chi) > 2 || me.powerByType(PowerType.Energy) > 60 || me.hasAura(116768)); // High chi, high energy, or BoK proc
      }),
      
      // Generic Jadefire Stomp
      Spell.cast("Jadefire Stomp"),
      
      // Tiger Palm with Ordered Elements and chi deficit
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               me.hasAura(378082) && // Ordered Elements buff
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 1; // At least 1 Chi deficit
      }),
      
      // Generic Chi Burst
      Spell.cast("Chi Burst"),
      
      // Spinning Crane Kick with Ordered Elements and Hit Combo
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(378082) && // Ordered Elements buff
               Spell.isSpellKnown(196740); // Hit Combo talent
      }),
      
      // Blackout Kick with Ordered Elements but without Hit Combo
      Spell.cast("Blackout Kick", () => {
        return me.hasAura(378082) && // Ordered Elements buff
               !Spell.isSpellKnown(196740) && // No Hit Combo talent
               this.hasCooldown("Fists of Fury");
      }),
      
      // Tiger Palm if not combo strike but need chi for FoF
      Spell.cast("Tiger Palm", () => {
        return !this.hasComboStrike("Tiger Palm") && 
               me.powerByType(PowerType.Chi) < 3 && 
               !this.hasCooldown("Fists of Fury"); // FoF is coming up
      })
    );
  }

  /**
   * Single target rotation
   */
  singleTargetRotation() {
    return new bt.Selector(
      // Fists of Fury with CDR
      Spell.cast("Fists of Fury", () => {
        return me.hasAura(395154) || me.hasAura(395153); // Heart of the Jade Serpent CDR Celestial or regular CDR
      }),
      
      // Rising Sun Kick with various conditions
      Spell.cast("Rising Sun Kick", () => {
        return (me.hasAura(80353) && !me.hasAura(395153) && me.hasAura(395154)) || // Pressure Point plus CDR Celestial
               me.hasAura(388663) || // Invoker's Delight
               me.hasAura(2825) || // Bloodlust
               (me.hasAura(80353) && this.hasCooldown("Fists of Fury")) || // Pressure Point during FoF cooldown
               me.hasAura(10060); // Power Infusion
      }),
      
      // Whirling Dragon Punch with correct conditions and no Dance stacks
      Spell.cast("Whirling Dragon Punch", () => {
        return !me.hasAura(395154) && me.getAuraStacks(325202) !== 2;
      }),
      
      // Slicing Winds with CDR
      Spell.cast("Slicing Winds", () => {
        return me.hasAura(395153) || me.hasAura(395154); // Any Heart of the Jade Serpent CDR
      }),
      
      // Celestial Conduit
      Spell.cast("Celestial Conduit", () => {
        return me.hasAura(137639) && // Storm Earth and Fire up
               (!me.hasAura(395153) || me.getAura(396222)?.remaining < 5000) && // No CDR or Gale Force expiring soon
               this.hasCooldown("Strike of the Windlord") && 
               (Spell.isSpellKnown(123904) || !Spell.isSpellKnown(123904) && me.hasAura(388663)); // Has Xuen's Bond or Invoker's Delight
      }),
      
      // Spinning Crane Kick with 2 stacks of Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return me.getAuraStacks(325202) === 2 && this.hasComboStrike("Spinning Crane Kick");
      }),
      
      // Tiger Palm in various situations
      Spell.cast("Tiger Palm", () => {
        return (me.powerByType(PowerType.Energy) > 55 && Spell.isSpellKnown(152173) || me.powerByType(PowerType.Energy) > 60 && !Spell.isSpellKnown(152173)) && // Energy check with Inner Peace
               this.hasComboStrike("Tiger Palm") && 
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 2 && 
               me.getAuraStacks(116645) < 3 && // Low Teachings stacks
               ((Spell.isSpellKnown(196736) && !me.hasAura(116768) || !Spell.isSpellKnown(196736)) && // Energy Burst without BoK proc
                !me.hasAura(378082)); // No Ordered Elements
      }),
      
      // Tiger Palm before FoF if needed
      Spell.cast("Tiger Palm", () => {
        return ((Spell.isSpellKnown(196736) && !me.hasAura(116768) || !Spell.isSpellKnown(196736)) && 
                !me.hasAura(378082) && // No Ordered Elements 
                !this.hasCooldown("Fists of Fury") && me.powerByType(PowerType.Chi) < 3); // FoF ready but low chi
      }),
      
      // Tiger Palm with combo strike and chi deficit
      Spell.cast("Tiger Palm", () => {
        return (this.hasCooldown("Strike of the Windlord") || !me.hasAura(395154)) && 
               this.hasComboStrike("Tiger Palm") && 
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 2 && 
               !me.hasAura(378082); // No Ordered Elements
      }),
      
      // Touch of Death
      Spell.cast("Touch of Death"),
      
      // Rising Sun Kick in early phase
      Spell.cast("Rising Sun Kick", () => {
        return !me.hasAura(162264) && me.hasAura("Tiger Palm") && this.isOpeningPhase() || 
               (me.hasAura(137639) && Spell.isSpellKnown(378082)); // SEF up and Ordered Elements talent
      }),
      
      // Strike of the Windlord with Celestial Conduit
      Spell.cast("Strike of the Windlord", () => {
        return Spell.isSpellKnown(395152) && // Celestial Conduit
               !me.hasAura(388663) && // No Invoker's Delight
               !me.hasAura(395154) && // No Heart of the Jade Serpent CDR Celestial
               this.hasCooldown("Fists of Fury") < 5 && 
               this.hasCooldown("Invoke Xuen, the White Tiger") > 15;
      }),
      
      // Strike of the Windlord with Gale Force
      Spell.cast("Strike of the Windlord", () => {
        return Spell.isSpellKnown(396228) && // Gale Force
               me.hasAura(388663) && // Invoker's Delight
               (me.hasAura(2825) || !me.hasAura(395154)); // Bloodlust or no CDR Celestial
      }),
      
      // Strike of the Windlord with Flurry Strikes
      Spell.cast("Strike of the Windlord", () => {
        const combatTime = (Date.now() -CombatTimer.getCombatStartTime()) / 1000;
        return combatTime > 5 && Spell.isSpellKnown(59868); // 5+ sec in combat with Flurry Strikes
      }),
      
      // Fists of Fury with Power Infusion and Bloodlust
      Spell.cast("Fists of Fury", () => {
        const combatTime = (Date.now() -CombatTimer.getCombatStartTime()) / 1000;
        return me.hasAura(10060) && me.hasAura(2825) && combatTime > 5;
      }),
      
      // Blackout Kick with Teachings and Ordered Elements
      Spell.cast("Blackout Kick", () => {
        return me.getAuraStacks(116645) > 3 && 
               me.hasAura(378082) && // Ordered Elements
               this.hasCooldown("Rising Sun Kick") > 1 && 
               this.hasCooldown("Fists of Fury") > 2 && 
               this.hasComboStrike("Blackout Kick");
      }),
      
      // Tiger Palm with Flurry Strikes under PI and BL
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               me.hasAura(10060) && // Power Infusion
               me.hasAura(2825); // Bloodlust
      }),
      
      // Blackout Kick with high Teachings stacks
      Spell.cast("Blackout Kick", () => {
        return me.getAuraStacks(116645) > 4 && 
               this.hasCooldown("Rising Sun Kick") > 1 && 
               this.hasCooldown("Fists of Fury") > 2;
      }),
      
      // Whirling Dragon Punch in various conditions
      Spell.cast("Whirling Dragon Punch", () => {
        return !me.hasAura(395154) && me.getAuraStacks(325202) !== 2 || // No CDR Celestial and not 2 stacks of Dance
               me.hasAura(378082) || // Ordered Elements
               Spell.isSpellKnown(387026); // Knowledge of the Broken Temple
      }),
      
      // Crackling Jade Lightning with Emperor's Capacitor
      Spell.cast("Crackling Jade Lightning", () => {
        return me.getAuraStacks(325092) > 19 && 
               !me.hasAura(395153) && // No CDR
               !me.hasAura(395154) && // No CDR Celestial
               this.hasComboStrike("Crackling Jade Lightning") && 
               this.hasCooldown("Invoke Xuen, the White Tiger") > 10;
      }),
      
      // Slicing Winds in longer fights
      Spell.cast("Slicing Winds", () => {
        const target = this.getCurrentTarget();
        return target && target.timeToDeath() > 10;
      }),
      
      // Fists of Fury with appropriate conditions
      Spell.cast("Fists of Fury", () => {
        return (Spell.isSpellKnown(392992) || // Xuen's Battlegear
                !Spell.isSpellKnown(392992) && 
                (this.hasCooldown("Strike of the Windlord") > 1 || 
                 me.hasAura(395153) || me.hasAura(395154))) && // SotW on CD or CDR buff
               (Spell.isSpellKnown(392992) && this.hasCooldown("Invoke Xuen, the White Tiger") > 5 || 
                this.hasCooldown("Invoke Xuen, the White Tiger") > 10) && 
               (!me.hasAura(388663) || me.hasAura(388663) && 
                this.hasCooldown("Strike of the Windlord") > 4 && 
                this.hasCooldown("Celestial Conduit")) || 
               Spell.isSpellKnown(59868); // Flurry Strikes
      }),
      
      // Rising Sun Kick with high chi or energy
      Spell.cast("Rising Sun Kick", () => {
        return me.powerByType(PowerType.Chi) > 4 || me.powerByType(PowerType.Chi) > 2 && me.powerByType(PowerType.Energy) > 50 || this.hasCooldown("Fists of Fury") > 2;
      }),
      
      // Tiger Palm with Flurry Strikes and Wisdom buff
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868) && // Flurry Strikes
               me.hasAura(395152); // Wisdom of the Wall Flurry buff
      }),
      
      // Blackout Kick with Energy Burst, BoK proc and low chi
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               Spell.isSpellKnown(196736) && // Energy Burst
               me.hasAura(116768) && // BoK proc
               me.powerByType(PowerType.Chi) < 5 && 
               (me.hasAura(395153) || me.hasAura(395154)); // Has CDR
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji and special conditions
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(2825) && // Bloodlust
               me.hasAura(395153) && // Heart of the Jade Serpent CDR
               me.hasAura(325202); // Dance of Chi-Ji buff
      }),
      
      // Tiger Palm with Flurry Strikes
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868); // Flurry Strikes
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return (me.getAuraStacks(325202) === 2 || me.hasAura(325202) && me.getAura(325202).remaining < me.gcd * 3) && 
               this.hasComboStrike("Spinning Crane Kick") && 
               !me.hasAura(378082); // No Ordered Elements
      }),
      
      // Whirling Dragon Punch
      Spell.cast("Whirling Dragon Punch"),
      
      // Spinning Crane Kick with 2 stacks of Dance of Chi-Ji
      Spell.cast("Spinning Crane Kick", () => {
        return me.getAuraStacks(325202) === 2 && this.hasComboStrike("Spinning Crane Kick");
      }),
      
      // Blackout Kick with Courageous Impulse and 2 BoK proc stacks
      Spell.cast("Blackout Kick", () => {
        return Spell.isSpellKnown(383724) && // Courageous Impulse
               this.hasComboStrike("Blackout Kick") && 
               me.getAuraStacks(116768) === 2; // 2 stacks of BoK proc
      }),
      
      // Blackout Kick with Ordered Elements and cooldowns
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               me.hasAura(378082) && // Ordered Elements
               this.hasCooldown("Rising Sun Kick") > 1 && 
               this.hasCooldown("Fists of Fury") > 2;
      }),
      
      // Tiger Palm for energy capping with Flurry Strikes
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868); // Flurry Strikes
      }),
      
      // Spinning Crane Kick with Dance of Chi-Ji and various conditions
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(325202) && // Dance of Chi-Ji
               (me.hasAura(378082) || // Ordered Elements
                this.getTimeToMaxEnergy() >= me.gcd * 3 && 
                Spell.isSpellKnown(386444) && // Sequenced Strikes
                Spell.isSpellKnown(196736) || // Energy Burst
                !Spell.isSpellKnown(386444) || // Not Sequenced Strikes
                !Spell.isSpellKnown(196736) || // Not Energy Burst
                me.getAura(325202).remaining <= me.gcd * 3); // Dance about to expire
      }),
      
      // Tiger Palm with Flurry Strikes energy capping
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               this.getTimeToMaxEnergy() <= me.gcd * 3 && 
               Spell.isSpellKnown(59868); // Flurry Strikes
      }),
      
      // Jadefire Stomp with specific talents
      Spell.cast("Jadefire Stomp", () => {
        return Spell.isSpellKnown(387356) || Spell.isSpellKnown(388859); // Singularly Focused Jade or Jadefire Harmony
      }),
      
      // Chi Burst without Ordered Elements
      Spell.cast("Chi Burst", () => !me.hasAura(378082)),
      
      // Blackout Kick with Ordered Elements or BoK proc during FoF cooldown
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               (me.hasAura(378082) || // Ordered Elements
                (me.hasAura(116768) && (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 1 && Spell.isSpellKnown(196736))) && // BoK proc with deficit and Energy Burst
               this.hasCooldown("Fists of Fury");
      }),
      
      // Blackout Kick during FoF cooldown with various conditions
      Spell.cast("Blackout Kick", () => {
        return this.hasComboStrike("Blackout Kick") && 
               this.hasCooldown("Fists of Fury") && 
               (me.powerByType(PowerType.Chi) > 2 || me.powerByType(PowerType.Energy) > 60 || me.hasAura(116768)); // High chi, high energy, or BoK proc
      }),
      
      // Generic Jadefire Stomp
      Spell.cast("Jadefire Stomp"),
      
      // Tiger Palm with Ordered Elements and chi deficit
      Spell.cast("Tiger Palm", () => {
        return this.hasComboStrike("Tiger Palm") && 
               me.hasAura(378082) && // Ordered Elements
               (me.maxPowerByType(PowerType.Chi) - me.powerByType(PowerType.Chi)) >= 1; // Chi deficit
      }),
      
      // Generic Chi Burst
      Spell.cast("Chi Burst"),
      
      // Spinning Crane Kick with Ordered Elements and Hit Combo
      Spell.cast("Spinning Crane Kick", () => {
        return this.hasComboStrike("Spinning Crane Kick") && 
               me.hasAura(378082) && // Ordered Elements
               Spell.isSpellKnown(196740); // Hit Combo
      }),
      
      // Blackout Kick with Ordered Elements but without Hit Combo
      Spell.cast("Blackout Kick", () => {
        return me.hasAura(378082) && // Ordered Elements
               !Spell.isSpellKnown(196740) && // No Hit Combo
               this.hasCooldown("Fists of Fury");
      }),
      
      // Tiger Palm to build chi before FoF
      Spell.cast("Tiger Palm", () => {
        return me.powerByType(PowerType.Chi) < 3 && !this.hasCooldown("Fists of Fury");
      })
    );
  }
}