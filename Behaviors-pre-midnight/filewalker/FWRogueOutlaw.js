import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

/**
 * Behavior implementation for Outlaw Rogue
 * Based on SIMC profile TWW2_Rogue_Outlaw
 */
export class OutlawRogueBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Rogue.Combat;
  name = "FW Outlaw Rogue";
  version = 1;
  
  // Define talent build options - automatically determined based on hero talents
  static TALENT_BUILDS = {
    DEATHSTALKER: 'deathstalker',  // From Hero Talents: Deathstalker's Mark
    FATEBOUND: 'fatebound',        // From Hero Talents: Hand of Fate
    TRICKSTER: 'trickster',        // From Hero Talents: Unseen Blade
  };
  
  /**
   * Settings for the behavior
   * These will appear in the UI settings panel
   */
  static settings = [
    {
      header: "Outlaw Rogue Configuration",
      options: [
        {
          uid: "DoubleCoups",
          text: "Double Coup de Grace (Bug)",
          type: "checkbox",
          default: false,
          description: "Enable to chain cast Coup de Grace (if bug is active)"
        },
        {
          uid: "AOEThreshold",
          text: "AOE Threshold",
          type: "slider",
          min: 2,
          max: 5,
          default: 3,
          description: "Number of enemies for Blade Flurry"
        },
        {
          uid: "LethalPoison",
          text: "Lethal Poison",
          type: "dropdown",
          default: "instant",
          options: [
            { text: "Instant", value: "instant" },
            { text: "Wound", value: "wound" },
            { text: "Deadly", value: "deadly" }
          ]
        },
        {
          uid: "NonLethalPoison",
          text: "Non-Lethal Poison",
          type: "dropdown",
          default: "none",
          options: [
            { text: "None", value: "none" },
            { text: "Crippling", value: "crippling" },
            { text: "Numbing", value: "numbing" }
          ]
        }
      ]
    }
  ];

  /**
   * Builds the behavior tree for Outlaw Rogue
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      this.applyPoisons(),
      this.opener(),
      new bt.Action(() => {
        // This action ensures we have a valid target
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      // Main selector for choosing rotation
      new bt.Selector(
        // High priority stealth actions
        new bt.Decorator(
          () => me.hasAura("Stealth") || me.hasAura("Vanish") || me.hasAura("Subterfuge"),
          this.stealthActions(),
          new bt.Action(() => bt.Status.Success)
        ),
        // If finish condition is met, use finishers
        new bt.Decorator(
          () => this.finishCondition(),
          this.finishers(),
          new bt.Action(() => bt.Status.Success)
        ),
        // Cooldowns
        this.useCooldowns(),
        // Builders
        this.builders()
      )
    );
  }

  /**
   * Apply poisons to weapons
   */
  applyPoisons() {
    const lethalPoison = Settings.LethalPoison || "instant";
    const nonLethalPoison = Settings.NonLethalPoison || "none";
    
    return new bt.Selector(
      Spell.cast("Apply Poison", () => {
        const lethalActive = me.hasAura(this.getLethalPoisonAuraName());
        const nonLethalActive = nonLethalPoison === "none" || me.hasAura(this.getNonLethalPoisonAuraName());
        
        return !lethalActive || !nonLethalActive;
      })
    );
  }

  /**
   * Get the aura name for the currently selected lethal poison
   */
  getLethalPoisonAuraName() {
    const poisonType = Settings.LethalPoison || "instant";
    switch(poisonType) {
      case "instant": return "Instant Poison";
      case "wound": return "Wound Poison";
      case "deadly": return "Deadly Poison";
      default: return "Instant Poison";
    }
  }

  /**
   * Get the aura name for the currently selected non-lethal poison
   */
  getNonLethalPoisonAuraName() {
    const poisonType = Settings.NonLethalPoison || "none";
    switch(poisonType) {
      case "crippling": return "Crippling Poison";
      case "numbing": return "Numbing Poison";
      default: return "";
    }
  }

  /**
   * Pre-combat opener sequence
   */
  opener() {
    return new bt.Selector(
      Spell.cast("Stealth", () => !me.inCombat && !me.hasAura("Stealth")),
      Spell.cast("Adrenaline Rush", () => !me.inCombat && me.hasAura("Stealth") && Spell.isSpellKnown("Improved Adrenaline Rush")),
      Spell.cast("Roll the Bones", () => !me.inCombat && me.hasAura("Stealth") && !this.hasAnyRtBBuff())
    );
  }

  /**
   * Detect which hero talent build is active based on key hero talents
   * @returns {string} The detected talent build
   */
  detectHeroBuild() {
    // Check for top-tier hero talents as listed in HeroTalents.txt
    if (me.hasAura("Deathstalker's Mark")) {
      return OutlawRogueBehavior.TALENT_BUILDS.DEATHSTALKER;
    } else if (me.hasAura("Hand of Fate")) {
      return OutlawRogueBehavior.TALENT_BUILDS.FATEBOUND;
    } else if (me.hasAura("Unseen Blade")) {
      return OutlawRogueBehavior.TALENT_BUILDS.TRICKSTER;
    }
    
    // Default to Deathstalker if no hero talent detected
    return OutlawRogueBehavior.TALENT_BUILDS.DEATHSTALKER;
  }
  
  /**
   * Check if the Deathstalker build is active
   */
  isDeathstalkerBuild() {
    return this.detectHeroBuild() === OutlawRogueBehavior.TALENT_BUILDS.DEATHSTALKER;
  }
  
  /**
   * Check if the Fatebound build is active
   */
  isFateboundBuild() {
    return this.detectHeroBuild() === OutlawRogueBehavior.TALENT_BUILDS.FATEBOUND;
  }
  
  /**
   * Check if the Trickster build is active
   */
  isTricksterBuild() {
    return this.detectHeroBuild() === OutlawRogueBehavior.TALENT_BUILDS.TRICKSTER;
  }
  
  /**
   * Determine if we should use Ambush based on SIMC condition
   * (talent.hidden_opportunity|combo_points.deficit>=2+talent.improved_ambush+buff.broadside.up)&energy>=50
   */
  ambushCondition() {
    const comboPointsDeficit = 7 - me.powerByType(PowerType.ComboPoints);
    const minDeficit = 2 + 
                      (Spell.isSpellKnown("Improved Ambush") ? 1 : 0) + 
                      (me.hasAura("Broadside") ? 1 : 0);
                      
    const hasEnoughEnergy = me.powerByType(PowerType.Energy) >= 50;
    
    return (Spell.isSpellKnown("Hidden Opportunity") || comboPointsDeficit >= minDeficit) && hasEnoughEnergy;
  }

  /**
   * Actions to perform while in stealth
   */
  stealthActions() {
    return new bt.Selector(
      // High priority Cold Blood if finishing
      Spell.cast("Cold Blood", () => this.finishCondition()),
      
      // Pool resources for BtE with Crackshot
      new bt.Action(() => {
        if (this.finishCondition() && 
            Spell.isSpellKnown("Crackshot") && 
            (!me.hasAura("Shadowmeld") || me.hasAura("Stealth") || me.hasAura("Vanish")) && 
            me.powerByType(PowerType.Energy) < 35) {
          // We need more energy for BtE, so success here to stop and pool
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      // High priority Between the Eyes for Crackshot
      Spell.cast("Between the Eyes", () => {
        return this.finishCondition() && 
               Spell.isSpellKnown("Crackshot") && 
               (!me.hasAura("Shadowmeld") || me.hasAura("Stealth") || me.hasAura("Vanish"));
      }),
      
      // Finisher Dispatch
      Spell.cast("Dispatch", () => this.finishCondition()),
      
      // Fan the Hammer + Crackshot builds Pistol Shot with opportunity
      Spell.cast("Pistol Shot", () => {
        return Spell.isSpellKnown("Crackshot") && 
               Spell.isSpellKnown("Fan the Hammer") && 
               Spell.getAuraStacks("Opportunity") >= 6 && 
               ((me.hasAura("Broadside") && me.powerByType(PowerType.ComboPoints) <= 1) || 
                me.hasAura("Greenskins Wickers"));
      }),
      
      // Hidden Opportunity Ambush
      Spell.cast("Ambush", () => Spell.isSpellKnown("Hidden Opportunity"))
    );
  }

  /**
   * Finisher abilities
   */
  finishers() {
    return new bt.Selector(
      Spell.cast("Coup de Grace"),
      Spell.cast("Between the Eyes", () => {
        return (me.hasAura("Ruthless Precision") || 
                !me.hasAura("Between the Eyes") || 
                me.getAura("Between the Eyes")?.remaining < 4000 || 
                !Spell.isSpellKnown("Mean Streak")) && 
               (!me.hasAura("Greenskins Wickers") || !Spell.isSpellKnown("Greenskins Wickers"));
      }),
      Spell.cast("Cold Blood"),
      Spell.cast("Dispatch")
    );
  }

  /**
   * Builder abilities
   */
  builders() {
    return new bt.Selector(
      // Hidden Opportunity Ambush with Audacity
      Spell.cast("Ambush", () => Spell.isSpellKnown("Hidden Opportunity") && me.hasAura("Audacity")),
      
      // Fan the Hammer + Audacity + Hidden Opportunity combo
      Spell.cast("Pistol Shot", () => {
        return Spell.isSpellKnown("Fan the Hammer") && 
               Spell.isSpellKnown("Audacity") && 
               Spell.isSpellKnown("Hidden Opportunity") && 
               me.hasAura("Opportunity") && 
               !me.hasAura("Audacity");
      }),
      
      // Consume Opportunity with Fan the Hammer at max stacks or expiring soon
      Spell.cast("Pistol Shot", () => {
        return Spell.isSpellKnown("Fan the Hammer") && 
               me.hasAura("Opportunity") && 
               (Spell.getAuraStacks("Opportunity") >= (Spell.isSpellKnown("Quick Draw") ? 9 : 6) || 
                me.getAura("Opportunity").remaining < 2000);
      }),
      
      // Fan the Hammer Opportunity without overcapping combo points
      Spell.cast("Pistol Shot", () => {
        const comboPointsGenerated = 1 + 
                                    (Spell.isSpellKnown("Quick Draw") ? 1 : 0) * 
                                    (me.hasAura("Broadside") ? 1 : 0) * 
                                    (Spell.isSpellKnown("Fan the Hammer") ? (Spell.isSpellKnown("Improved Fan the Hammer") ? 2 : 1) : 0);
        
        const comboPointDeficit = 6 - me.powerByType(PowerType.ComboPoints);
        
        return Spell.isSpellKnown("Fan the Hammer") && 
               (me.hasAura("Opportunity") || !me.targetUnit.hasAura("Pistol Shot")) && 
               (comboPointDeficit >= comboPointsGenerated || me.powerByType(PowerType.ComboPoints) <= (Spell.isSpellKnown("Ruthlessness") ? 1 : 0));
      }),
      
    //   // Non-Fan the Hammer Opportunity usage
    //   Spell.cast("Pistol Shot", () => {
    //     return !Spell.isSpellKnown("Fan the Hammer") && (!me.targetUnit.hasAura(185763) ||
    //            me.hasAura("Opportunity")) && 
    //            (me.powerByType(PowerType.Energy) < (me.maxPowerByType(PowerType.Energy) - me.powerByType(PowerType.Energy) * 1.5) || 
    //             (7 - me.powerByType(PowerType.ComboPoints)) <= 1 + (me.hasAura("Broadside") ? 1 : 0) || 
    //             Spell.isSpellKnown("Quick Draw") || 
    //             (Spell.isSpellKnown("Audacity") && !me.hasAura("Audacity")));
    //   }),
      
      // Pool for Ambush with Hidden Opportunity
      new bt.Action(() => {
        if (Spell.isSpellKnown("Hidden Opportunity") && !this.ambushCondition()) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      // Hidden Opportunity Ambush
      Spell.cast("Ambush", () => Spell.isSpellKnown("Hidden Opportunity")),
      
      // Default builder
      Spell.cast("Sinister Strike")
    );
  }

  /**
   * Logic for using cooldowns
   */
  useCooldowns() {
    return new bt.Selector(
      // Adrenaline Rush - maintain or use with Improved ADR at low CPs
      Spell.cast("Adrenaline Rush", () => {
        return !me.hasAura("Adrenaline Rush") && 
              (!this.finishCondition() || !Spell.isSpellKnown("Improved Adrenaline Rush")) || 
              (Spell.isSpellKnown("Improved Adrenaline Rush") && me.powerByType(PowerType.ComboPoints) <= 2);
      }),
      
      // Enable chain cast Coup de Grace if the bug option is enabled
      Spell.cast("Coup de Grace", () => {
        return Settings.DoubleCoups && Spell.getTimeSinceLastCast("Coup de Grace") < 1000 && 
               Spell.getCooldown("Coup de Grace").ready;
      }),
      
      // Maintain Blade Flurry on 2+ targets
      Spell.cast("Blade Flurry", () => {
        const targets = this.getEnemyCount();
        return targets >= 2 && (!me.hasAura("Blade Flurry") || me.getAura("Blade Flurry").remaining < 1000);
      }),
      
      // Deft Maneuvers logic for Blade Flurry
      Spell.cast("Blade Flurry", () => {
        const targets = this.getEnemyCount();
        const comboPointDeficit = 6 - me.powerByType(PowerType.ComboPoints);
        
        return Spell.isSpellKnown("Deft Maneuvers") && 
               !this.finishCondition() && 
               (targets >= 3 && comboPointDeficit >= targets + (me.hasAura("Broadside") ? 1 : 0) || 
                targets >= 5);
      }),
      
      // Keep it Rolling logic - with a natural 5 buff roll
      Spell.cast("Keep it Rolling", () => {
        const normalBuffCount = this.getRtBNormalBuffCount();
        const totalBuffs = this.getRtBBuffCount();
        const maxRemaining = this.getMaxRtBBuffRemaining();
        
        return normalBuffCount >= 5 && totalBuffs == 6 && maxRemaining <= 30000;
      }),
      
      // Keep it Rolling - at 4+ buffs without a natural 5
      Spell.cast("Keep it Rolling", () => {
        const normalBuffCount = this.getRtBNormalBuffCount();
        const totalBuffs = this.getRtBBuffCount();
        
        return totalBuffs >= 4 && normalBuffCount <= 2;
      }),
      
      // Keep it Rolling - at 3 specific buffs
      Spell.cast("Keep it Rolling", () => {
        const normalBuffCount = this.getRtBNormalBuffCount();
        const totalBuffs = this.getRtBBuffCount();
        
        return totalBuffs >= 3 && normalBuffCount <= 2 && 
               me.hasAura("Broadside") && me.hasAura("Ruthless Precision") && me.hasAura("True Bearing");
      }),
      
      // Roll the Bones - no buffs
      Spell.cast("Roll the Bones", () => this.getRtBBuffCount() === 0),
      
      // Roll the Bones - TWW2 set logic
      Spell.cast("Roll the Bones", () => {
        const willLoseCount = this.getRtBBuffsWillLose();
        const maxRemaining = this.getMaxRtBBuffRemaining();
        const buffsAbovePandemic = this.getBuffsAbovePandemic();
        
        return me.hasAura("TWW2_4pc") && 
               willLoseCount <= 1 && 
               (buffsAbovePandemic < 5 || maxRemaining < 42000);
      }),
      
      // Roll the Bones - TWW2 set with few buffs or Supercharger
      Spell.cast("Roll the Bones", () => {
        const buffCount = this.getRtBBuffCount();
        const maxRemaining = this.getMaxRtBBuffRemaining();
        const willLoseCount = this.getRtBBuffsWillLose();
        
        return me.hasAura("TWW2_4pc") && 
               (buffCount <= 2 || 
               (Spell.isSpellKnown("Supercharger") && 
                (maxRemaining < 11000 || !Spell.isSpellKnown("Keep it Rolling")) && 
                willLoseCount < 5));
      }),
      
      // Roll the Bones - non-TWW2 logic
      Spell.cast("Roll the Bones", () => {
        const buffCount = this.getRtBBuffCount();
        const willLoseCount = this.getRtBBuffsWillLose();
        
        // Without TWW2 set or Sleight of Hand
        return !me.hasAura("TWW2_4pc") && 
               (willLoseCount <= (me.hasAura("Loaded Dice") ? 1 : 0) || 
                (Spell.isSpellKnown("Supercharger") && me.hasAura("Loaded Dice") && buffCount <= 2) || 
                (Spell.isSpellKnown("Hidden Opportunity") && me.hasAura("Loaded Dice") && 
                 buffCount <= 2 && !me.hasAura("Broadside") && !me.hasAura("Ruthless Precision") && 
                 !me.hasAura("True Bearing")));
      }),
      
      // Ghostly Strike
      Spell.cast("Ghostly Strike", () => me.powerByType(PowerType.ComboPoints) < 6),
      
      // Killing Spree outside of stealth
      Spell.cast("Killing Spree", () => this.finishCondition() && !me.hasAura("Stealth") && !me.hasAura("Vanish")),
      
      // Vanish usage based on appropriate talent builds
      this.vanishUsage(),
      
      // Blade Rush with low energy outside of stealth
      Spell.cast("Blade Rush", () => {
        return me.powerByType(PowerType.Energy) < (me.maxPowerByType(PowerType.Energy) - 4 * me.powerByType(PowerType.Energy) / me.maxPowerByType(PowerType.Energy)) && 
               !me.hasAura("Stealth") && !me.hasAura("Vanish");
      })
    );
  }

  /**
   * Vanish usage logic
   */
  vanishUsage() {
    return new bt.Selector(
      // Main meta build vanish logic (Underhanded Upper Hand + Crackshot + Subterfuge)
      Spell.cast("Vanish", () => {
        if (!Spell.isSpellKnown("Underhanded Upper Hand") || 
            !Spell.isSpellKnown("Crackshot") || 
            !Spell.isSpellKnown("Subterfuge")) {
          return false;
        }
        
        // With Adrenaline Rush
        if (me.hasAura("Adrenaline Rush") && 
            (me.getAura("Escalating Blade")?.stacks < 4 || !me.hasAura("Escalating Blade")) && 
            this.finishCondition()) {
          // Without Killing Spree
          if (!Spell.isSpellKnown("Killing Spree")) {
            // BtE on cooldown and Ruthless Precision active
            if (!Spell.getCooldown("Between the Eyes").ready && 
                me.hasAura("Ruthless Precision") && 
                me.getAura("Ruthless Precision").remaining > 4000) {
              const keepItRollingOnCD = Spell.getTimeSinceLastCast("Keep it Rolling") > 150000;
              const hasNormalRtB = this.getRtBNormalBuffCount() > 0;
              
              // KIR logic
              if ((keepItRollingOnCD && hasNormalRtB) || !Spell.isSpellKnown("Keep it Rolling")) {
                return true;
              }
            }
          } 
          // With Killing Spree
          else if (Spell.getCooldown("Killing Spree").timeleft > 15000) {
            return true;
          }
          
          // Prevent AR downtime
          if (me.getAura("Adrenaline Rush").remaining < 3000 && Spell.getCooldown("Adrenaline Rush").timeleft > 10000) {
            return true;
          }
          
          // With Supercharger
          if (!Spell.isSpellKnown("Killing Spree") && me.hasAura("Supercharge 1")) {
            return true;
          }
        }
        
        // About to cap on charges
        if (Spell.getCooldown("Vanish").duration - Spell.getCooldown("Vanish").timeleft < 15000) {
          return true;
        }
        
        return false;
      }),
      
      // Off-meta Vanish logic for builds missing key talents
      Spell.cast("Vanish", () => {
        // Has Underhanded Upper Hand and Subterfuge but no Crackshot
        if (Spell.isSpellKnown("Underhanded Upper Hand") && 
            Spell.isSpellKnown("Subterfuge") && 
            !Spell.isSpellKnown("Crackshot")) {
          if (me.hasAura("Adrenaline Rush")) {
            const hasAmbushCondition = (Spell.isSpellKnown("Hidden Opportunity") && this.ambushCondition()) || 
                                      !Spell.isSpellKnown("Hidden Opportunity");
            
            if (hasAmbushCondition) {
              if ((!Spell.getCooldown("Between the Eyes").ready && me.hasAura("Ruthless Precision")) || 
                  !me.hasAura("Ruthless Precision") || 
                  me.getAura("Adrenaline Rush").remaining < 3000) {
                return true;
              }
            }
          }
        }
        
        // Has Crackshot but no Underhanded Upper Hand
        if (Spell.isSpellKnown("Crackshot") && !Spell.isSpellKnown("Underhanded Upper Hand")) {
          return this.finishCondition();
        }
        
        // Hidden Opportunity build without other key talents
        if (Spell.isSpellKnown("Hidden Opportunity") && 
            !Spell.isSpellKnown("Underhanded Upper Hand") && 
            !Spell.isSpellKnown("Crackshot")) {
          if (!me.hasAura("Audacity") && 
              Spell.getAuraStacks("Opportunity") < (Spell.isSpellKnown("Quick Draw") ? 9 : 6) && 
              this.ambushCondition()) {
            return true;
          }
        }
        
        // Other builds
        if (!Spell.isSpellKnown("Hidden Opportunity") && 
            !Spell.isSpellKnown("Underhanded Upper Hand") && 
            !Spell.isSpellKnown("Crackshot")) {
          // Fateful Ending build
          if (Spell.isSpellKnown("Fateful Ending")) {
            if ((!me.hasAura("Fatebound Lucky Coin") && 
                (me.getAuraStacks("Fatebound Coin Tails") >= 5 || me.getAuraStacks("Fatebound Coin Heads") >= 5)) || 
                (me.hasAura("Fatebound Lucky Coin") && !Spell.getCooldown("Between the Eyes").ready)) {
              return true;
            }
          }
          
          // Take Em By Surprise build
          if (Spell.isSpellKnown("Take Em By Surprise") && !me.hasAura("Take Em By Surprise")) {
            return true;
          }
        }
        
        // Fight is ending soon
        if (combat.getAverageTimeToDeath() < 8) {
          return true;
        }
        
        return false;
      })
    );
  }

  /**
   * Check if the finish condition is met based on SIMC logic
   * combo_points>=cp_max_spend-1-(stealthed.all&talent.crackshot|(talent.hand_of_fate|talent.flawless_form)&talent.hidden_opportunity&(buff.audacity.up|buff.opportunity.up))
   * @returns {boolean} True if we should use finishers
   */
  finishCondition() {
    const maxComboPoints = me.maxPowerByType(PowerType.ComboPoints); // Assuming the max is always 6, adjust if needed
    
    // Base deduction: 1 point
    let deduction = 1;
    
    // Additional deduction for certain conditions
    if ((me.hasAura("Stealth") || me.hasAura("Vanish") || me.hasAura("Subterfuge")) && 
        Spell.isSpellKnown("Crackshot")) {
      // Stealth + Crackshot = additional 1 point deduction
      deduction += 1;
    } else if ((Spell.isSpellKnown("Hand of Fate") || Spell.isSpellKnown("Flawless Form")) && 
               Spell.isSpellKnown("Hidden Opportunity") && 
               (me.hasAura("Audacity") || me.hasAura("Opportunity"))) {
      // Hidden Opportunity builds with buffs = additional 1 point deduction
      deduction += 1;
    }
    
    // Check if current combo points are sufficient to finish
    return me.powerByType(PowerType.ComboPoints) >= maxComboPoints - deduction;
  }

  /**
   * Get the current target, preferring the player's target if valid
   * @returns {CGUnit} The current target or null if none
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
   * @returns {number} The number of valid enemies
   */
  getEnemyCount() {
    const aoeThreshold = Settings.AOEThreshold || 3;
    return combat.targets.filter(unit => unit.distanceTo(me) <= 10).length;
  }

  /**
   * Get the count of Roll the Bones buffs
   * @returns {number} The number of active RtB buffs
   */
  getRtBBuffCount() {
    let count = 0;
    if (me.hasAura("Broadside")) count++;
    if (me.hasAura("Buried Treasure")) count++;
    if (me.hasAura("Grand Melee")) count++;
    if (me.hasAura("Ruthless Precision")) count++;
    if (me.hasAura("Skull and Crossbones")) count++;
    if (me.hasAura("True Bearing")) count++;
    return count;
  }

  /**
   * Get the count of normal Roll the Bones buffs (not from Count the Odds)
   * @returns {number} The number of normal RtB buffs
   */
  getRtBNormalBuffCount() {
    // This is a simplification, as we don't have a way to distinguish 
    // between normal buffs and those from Count the Odds
    // In a real implementation, you'd need to track this
    return this.getRtBBuffCount();
  }

  /**
   * Get the number of buffs that will be lost when recasting Roll the Bones
   * This is a simplification, as the actual implementation would be complex
   * @returns {number} The number of buffs that will be lost
   */
  getRtBBuffsWillLose() {
    // For simplicity, assume all current buffs will be lost
    return this.getRtBBuffCount();
  }

  /**
   * Get the maximum remaining time on any Roll the Bones buff
   * @returns {number} The maximum remaining time in milliseconds
   */
  getMaxRtBBuffRemaining() {
    let maxRemaining = 0;
    
    const checkAura = (auraName) => {
      const aura = me.getAura(auraName);
      if (aura && aura.remaining > maxRemaining) {
        maxRemaining = aura.remaining;
      }
    };
    
    checkAura("Broadside");
    checkAura("Buried Treasure");
    checkAura("Grand Melee");
    checkAura("Ruthless Precision");
    checkAura("Skull and Crossbones");
    checkAura("True Bearing");
    
    return maxRemaining;
  }

  /**
   * Get the count of buffs that are above the pandemic range (>39s)
   * @returns {number} The number of buffs above pandemic range
   */
  getBuffsAbovePandemic() {
    let count = 0;
    
    const checkAura = (auraName) => {
      const aura = me.getAura(auraName);
      if (aura && aura.remaining > 39000) {
        count++;
      }
    };
    
    checkAura("Broadside");
    checkAura("Buried Treasure");
    checkAura("Grand Melee");
    checkAura("Ruthless Precision");
    checkAura("Skull and Crossbones");
    checkAura("True Bearing");
    
    return count;
  }

  /**
   * Check if any Roll the Bones buff is active
   * @returns {boolean} True if any RtB buff is active
   */
  hasAnyRtBBuff() {
    return me.hasAura("Broadside") || 
           me.hasAura("Buried Treasure") || 
           me.hasAura("Grand Melee") || 
           me.hasAura("Ruthless Precision") || 
           me.hasAura("Skull and Crossbones") || 
           me.hasAura("True Bearing");
  }

  debugPistolShotState() {
    // Only log occasionally to prevent spam
    const now = Date.now();
    if (!this.lastDebugTime || now - this.lastDebugTime > 5000) {
      console.info(`--- Outlaw Debug State ---`);
      console.info(`Combo Points: ${me.powerByType(PowerType.ComboPoints)}/6`);
      console.info(`Energy: ${me.powerByType(PowerType.Energy)}/${me.maxPowerByType(PowerType.Energy)}`);
      console.info(`Opportunity: ${me.hasAura("Opportunity") ? `${me.getAura("Opportunity").stacks} stacks, ${Math.floor(me.getAura("Opportunity").remaining / 1000)}s remaining` : "Not active"}`);
      console.info(`Audacity: ${me.hasAura("Audacity") ? `${Math.floor(me.getAura("Audacity").remaining / 1000)}s remaining` : "Not active"}`);
      console.info(`Fan the Hammer: ${Spell.isSpellKnown("Fan the Hammer") ? "Known" : "Not known"}`);
      console.info(`Quick Draw: ${Spell.isSpellKnown("Quick Draw") ? "Known" : "Not known"}`);
      console.info(`Finish Condition: ${this.finishCondition() ? "True" : "False"}`);
      this.lastDebugTime = now;
    }
    return bt.Status.Failure; // Always fail so rotation continues
  }
}