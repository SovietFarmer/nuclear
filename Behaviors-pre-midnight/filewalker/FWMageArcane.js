import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import Settings from "@/Core/Settings";
import CombatTimer from '@/Core/CombatTimer';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

// Define spell IDs for easier reference
const spells = {
  // Core arcane spells
  arcaneBlast: 30451,
  arcaneBarrage: 44425,
  arcaneMissiles: 5143,
  arcaneExplosion: 1449,
  arcaneOrb: 153626,
  touchOfTheMagi: 321507,
  arcaneSurge: 365350,
  evocation: 12051,
  presenceOfMind: 205025,
  
  // Secondary spells
  supernova: 157980,
  shiftingPower: 382440,
  
  // Utility
  spellsteal: 30449,
  mirrorImage: 55342,
  arcaneIntellect: 1459,
  invisibility: 66,
  iceBlock: 45438,
  counterspell: 2139,
  removeCurse: 475,
};

// Define aura IDs for easier reference
const auras = {
  // Core arcane auras
  arcaneCharge: 36032,        // Arcane Charge
  arcaneSurge: 365362,        // Arcane Surge
  touchOfTheMagi: 210824,     // Touch of the Magi
  clearcasting: 263725,       // Clearcasting
  evocation: 12051,           // Evocation
  presenceOfMind: 205025,     // Presence of Mind
  siphonStorm: 382467,        // Siphon Storm
  
  // Arcane talents and buffs
  arcaneTempo: 383997,        // Arcane Tempo
  arcaneHarmony: 384455,      // Arcane Harmony
  netherPrecision: 383783,    // Nether Precision
  arcaneFamiliar: 210126,     // Arcane Familiar
  intuition: 377200,          // Intuition
  aetherAttunement: 383951,   // Aether Attunement (4pc Set Bonus)
  magisSparkBlast: 378194,    // Magi's Spark (Arcane Blast debuff)
  
  // Talent buffs
  leydrinker: 383791,         // Leydrinker
  radiantSpark: 376103,       // Radiant Spark
  unerringProficiency: 378195, // Unerring Proficiency
  
  // Other
  arcaneIntellect: 1459,      // Arcane Intellect
  mirrorImage: 55342,         // Mirror Image
};

export class ArcaneMageBehaviour extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Arcane;
  name = "FW Arcane Mage Spellslinger";
  version = 1.0;

  static settings = [
    {
      header: "Arcane Mage Settings",
      options: [
        {
          type: "checkbox",
          text: "Use AoE rotation automatically",
          uid: "AutoAOE",
          default: true,
          tooltip: "Automatically switches to AoE rotation based on target count"
        },
        {
          type: "slider",
          text: "AoE Target Count",
          uid: "AOETargetCount",
          default: 3,
          min: 2,
          max: 6,
          step: 1,
          tooltip: "Number of targets required to use AoE rotation"
        },
        {
          type: "checkbox",
          text: "Attack out of combat",
          uid: "AttackOOC",
          default: false,
          tooltip: "Attack targets even when out of combat"
        },
        {
          type: "checkbox",
          text: "Use Presence of Mind",
          uid: "UsePresenceOfMind",
          default: true,
          tooltip: "Use Presence of Mind during rotation"
        },
        {
          type: "checkbox",
          text: "Use Shifting Power",
          uid: "UseShiftingPower",
          default: true,
          tooltip: "Use Shifting Power to reduce cooldowns"
        },
        {
          type: "checkbox",
          text: "Cancel Presence of Mind",
          uid: "CancelPOM",
          default: true,
          tooltip: "Cancel Presence of Mind after one stack to start cooldown"
        },
        {
          type: "checkbox",
          text: "Use Evocation",
          uid: "UseEvocation",
          default: true,
          tooltip: "Use Evocation to restore mana during cooldowns"
        }
      ]
    }
  ];

  build() {

 return new bt.Selector(
      common.waitForNotMounted(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      common.waitForCastOrChannel(),
      spell.cast("Arcane Intellect", () => !me.hasAura(auras.arcaneIntellect)),
      spell.cast("Ice Block", () => me.pctHealth < 20),
      spell.cast("Remove Curse", () => {
        // Remove curse from self if we have a dispellable curse
        const curseAura = me.auras.find(aura => aura.dispelType === 2 && aura.isDebuff());
        return curseAura !== undefined;
      }),
      spell.interrupt("Counterspell", false),
      new bt.Decorator(
        () => me.hasAura(auras.touchOfTheMagi) || me.hasAura(auras.arcaneSurge),
        // this.useTrinkets(),
        new bt.Action(() => bt.Status.Failure)
      ),
      new bt.Decorator(
        () => me.hasAura(auras.touchOfTheMagi) || me.hasAura(auras.arcaneSurge),
        // this.useRacials(),
        new bt.Action(() => bt.Status.Failure)
      ),
      new bt.Decorator(
        () => this.shouldUseAoe(),
        this.aoeRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => true,
        this.singleTargetRotation(),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  // Utility Methods
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.distanceTo(unit) < 40 && me.isFacing(unit);
    const target = me.targetUnit;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getArcaneCharges() {
    const arcaneChargeAura = me.powerByType(PowerType.ArcaneCharges)    ;
    return arcaneChargeAura ? arcaneChargeAura.stacks : 0;
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    
    const debuff = target.getAuraByMe(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  hasTargetMagisSpark() {
    const target = this.getCurrentTarget();
    return target ? target.hasAuraByMe(auras.magisSparkBlast) : false;
  }

  hasTargetTouchOfTheMagi() {
    const target = this.getCurrentTarget();
    return target ? target.hasAuraByMe(auras.touchOfTheMagi) : false;
  }

  shouldUseAoe() {
    return me.getUnitsAroundCount(10) >= Settings.AOETargetCount;
  }

  hasTalent(talentName) {
    return spell.isSpellKnown(talentName);
  }

  shouldBarrageFromHarmony() {
    const harmonyAura = me.getAura(auras.arcaneHarmony);
    if (!harmonyAura) return false;
    
    // Based on SimC: barrage if Harmony is over 18 stacks, or 12 with High Voltage
    // and either no Nether Precision or your last stack of it
    const hasHighVoltage = this.hasTalent("High Voltage");
    const netherPrecisionAura = me.getAura(auras.netherPrecision);
    const netherPrecisionStacks = netherPrecisionAura ? netherPrecisionAura.stacks : 0;
    
    const stackThreshold = hasHighVoltage ? 12 : 18;
    
    return harmonyAura.stacks >= stackThreshold && 
           (netherPrecisionStacks === 0 || netherPrecisionStacks === 1);
  }

  shouldUseTouchOfTheMagi() {
    // Check cooldown status and conditions
    const touchCd = spell.getCooldown("Touch of the Magi");
    if (!touchCd.ready) return false;
    
    const arcaneCharges = this.getArcaneCharges();
    const arcaneSurgeUp = me.hasAura(auras.arcaneSurge);
    const lastSpell = spell.getLastSuccessfulSpell();
    
    // After arcane barrage or with Arcane Surge
    if (lastSpell === "Arcane Barrage") return true;
    if (lastSpell === "Arcane Aurge" && arcaneCharges < 4) return true;
    
    // Need more info on target health to align with burst windows
    return touchCd.ready && arcaneCharges < 4 && !me.hasAura(auras.touchOfTheMagi);
  }

  shouldUseArcaneSurge() {
    const touchCd = spell.getCooldown("Touch of the Magi");
    const arcaneSurgeCd = spell.getCooldown("Arcane Surge");
    
    if (!arcaneSurgeCd.ready) return false;
    
    // Use before Touch of the Magi comes off cooldown
    return touchCd.timeleft < 3000;
  }

  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Neural Synapse Enhancer", () => 
        this.hasTargetTouchOfTheMagi() && me.hasAura(auras.arcaneSurge)
      ),
      common.useEquippedItemByName("Spymaster's Web", () => 
        this.shouldUseCooldowns() && 
        (spell.getLastSuccessfulSpell() === "Arcane Surge" || 
        spell.getLastSuccessfulSpell() === "evocation")
      ),
      // Add more trinkets as needed
      common.useEquippedItemByName("Mugs Moxie Jug", () => 
        me.hasAura(auras.arcaneSurge) || me.hasAura(auras.touchOfTheMagi)
      ),
      common.useEquippedItemByName("Eye of Kezan", () => 
        me.hasAura(auras.arcaneSurge) || me.hasAura(auras.touchOfTheMagi)
      )
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Berserking", () => 
        spell.getLastSuccessfulSpell() === "Arcane surge"
      ),
      spell.cast("Blood Fury", () => 
        spell.getLastSuccessfulSpell() === "Arcane Surge"
      ),
      spell.cast("Fireblood", () => 
        spell.getLastSuccessfulSpell() === "Arcane Surge"
      ),
      spell.cast("Ancestral Call", () => 
        spell.getLastSuccessfulSpell() === "Arcane Surge"
      ),
      spell.cast("Light's Judgment", on => this.getCurrentTarget(), () => 
        !me.hasAura(auras.arcaneSurge) && !this.hasTargetTouchOfTheMagi() && this.getEnemiesInRange(10) >= 2
      )
    );
  }

  shouldUseCooldowns() {
    const target = this.getCurrentTarget();
    if (!target) return false;

    // Don't use cooldowns on low health targets unless they're bosses
    const targetHealth = target.pctHealth;
    const isBoss = target.classification === 3; // Check if target is a boss
    
    return targetHealth > 30 || isBoss;
  }

  // Cooldown rotation - implements the cd_opener action list
  cooldownRotation() {
    return new bt.Selector(
      // Touch of the Magi logic
      spell.cast("Touch of the Magi", on => this.getCurrentTarget(), () => {
        const lastSpell = spell.getLastSuccessfulSpell();
        const arcaneBarrageInFlight = lastSpell === "Arcane Barrage";
        const arcaneCharges = this.getArcaneCharges();
        const arcaneSurgeUp = me.hasAura(auras.arcaneSurge);
        const touchCooldownLong = spell.getCooldown("Touch of the Magi").timeleft > 30000;
        
        if (arcaneBarrageInFlight && (arcaneSurgeUp || touchCooldownLong)) {
          return true;
        }
        
        // Special case: if Arcane Surge was just cast
        if (lastSpell === "Arcane Surge" && (arcaneCharges < 4 || !me.hasAura(auras.netherPrecision))) {
          return true;
        }
        
        // Second special case: pool for cooldown windows
        if (touchCooldownLong && spell.getCooldown("Touch of the Magi").ready && arcaneCharges < 4 && !arcaneBarrageInFlight) {
          return true;
        }
        
        return false;
      }),
      
      // Presence of Mind logic
      spell.cast("Presence of Mind", () => {
        if (!Settings.UsePresenceOfMind) return false;
        
        return this.hasTargetTouchOfTheMagi() && 
               me.hasAura(auras.netherPrecision) && 
               this.getEnemiesInRange(10) < 3;
      }),
      
      // Cancel PoM after one use
      new bt.Action(() => {
        if (!Settings.CancelPOM) return bt.Status.Failure;
        
        const pomAura = me.getAura(auras.presenceOfMind);
        if (pomAura && pomAura.stacks === 1 && spell.getLastSuccessfulSpell() === "Arcane Blast") {
          me.cancelAura(auras.presenceOfMind);
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      // Evocation before Arcane Surge
      spell.cast("Evocation", () => {
        if (!Settings.UseEvocation) return false;
        
        const arcaneSurgeCd = spell.getCooldown("Arcane Surge");
        const touchCd = spell.getCooldown("Touch of the Magi");
        
        return arcaneSurgeCd.timeleft < 3000 && touchCd.timeleft < 5000;
      }),
      
      // Use Arcane Missiles for Nether Precision
      spell.cast("Arcane Missiles", on => this.getCurrentTarget(), () => {
        const lastSpell = spell.getLastSuccessfulSpell();
        const clearcasting = me.hasAura(auras.clearcasting);
        const hasNetherPrecision = me.hasAura(auras.netherPrecision);
        const hasAetherAttunement = me.hasAura(auras.aetherAttunement);
        const has4pcBonus = true; // Assume we have the 4pc bonus
        
        // Based on SimC: use Missiles after evocation/surge to build Nether Precision
        return (lastSpell === "evocation" || lastSpell === "Arcane Surge") && 
               !hasNetherPrecision && 
               clearcasting && 
               (!hasAetherAttunement || has4pcBonus);
      }),
      
      // Arcane Surge
      spell.cast("Arcane Surge", () => {
        const touchCd = spell.getCooldown("Touch of the Magi");
        const arcaneCharges = this.getArcaneCharges();
        
        // Based on SimC: use when Touch of the Magi is about to come off cooldown
        return touchCd.timeleft < (spell.getSpell("Arcane Surge").castTime + 
                                 (arcaneCharges === 4 ? 0 : 3000));
      })
    );
  }

  // Single target rotation - Implements the spellslinger action list
  singleTargetRotation() {
    return new bt.Selector(
      // First run cooldown rotation if appropriate
      new bt.Decorator(
        () => this.shouldUseCooldowns(),
        this.cooldownRotation(),
        new bt.Action(() => bt.Status.Success)
      ),

      // Shifting Power outside cooldowns
      spell.cast("Shifting Power", () => {
        if (!Settings.UseShiftingPower) return false;
        
        const arcaneSurgeUp = me.hasAura(auras.arcaneSurge);
        const siphonStormUp = me.hasAura(auras.siphonStorm);
        const touchUp = this.hasTargetTouchOfTheMagi();
        const orbCharges = spell.getCharges("Arcane Orb");
        const touchCooldown = spell.getCooldown("Touch of the Magi");
        const hasIntuition = me.hasAura(auras.intuition);
        const intuitionRemains = hasIntuition ? me.getAura(auras.intuition).remaining : 0;
        
        // Based on SimC logic
        return (((orbCharges === 0 || touchCooldown.timeleft < 23000) && 
               !arcaneSurgeUp && !siphonStormUp && !touchUp && 
               (spell.getCooldown("Evocation").timeleft > 12000) && 
               touchCooldown.timeleft > (12000 + 6000)) || 
               (spell.getLastSuccessfulSpell() === "Arcane Barrage" && 
               (arcaneSurgeUp || touchUp || spell.getCooldown("Evocation").timeleft < 20000))) && 
               (!hasIntuition || intuitionRemains > 4000);
      }),
      
      // Barrage if Tempo or Intuition is about to expire
      spell.cast("Arcane Barrage", on => this.getCurrentTarget(), () => {
        const tempoUp = me.hasAura(auras.arcaneTempo);
        const tempoRemains = tempoUp ? me.getAura(auras.arcaneTempo).remaining : 0;
        const intuitionUp = me.hasAura(auras.intuition);
        const intuitionRemains = intuitionUp ? me.getAura(auras.intuition).remaining : 0;
        
        return (tempoUp && tempoRemains < 1500) || (intuitionUp && intuitionRemains < 1500);
      }),
      
      // // Barrage if Harmony stacks are high
      // spell.cast("Arcane Barrage", on => this.getCurrentTarget(), () => {
      //   return this.shouldBarrageFromHarmony();
      // }),
      
      // // Barrage before Touch of the Magi
      // spell.cast("Arcane Barrage", on => this.getCurrentTarget(), () => {
      //   const touchCd = spell.getCooldown("Touch of the Magi");
      //   return touchCd.ready || touchCd.timeleft < 1500;
      // }),
      
      // Use Clearcasting for Nether Precision
      spell.cast("Arcane Missiles", on => this.getCurrentTarget(), () => {
        const clearcastingUp = me.hasAura(auras.clearcasting);
        const netherPrecisionUp = me.hasAura(auras.netherPrecision);
        const touchCd = spell.getCooldown("Touch of the Magi");
        const surgeCd = spell.getCooldown("Arcane Surge");
        const hasMagisSpark = this.hasTalent("Magi's Spark");
        const clearcastingStacks = clearcastingUp ? me.getAura(auras.clearcasting).stacks : 0;
        
        return clearcastingUp && !netherPrecisionUp && 
               ((touchCd.timeleft > 7000 && surgeCd.timeleft > 7000) || 
               clearcastingStacks > 1 || !hasMagisSpark);
      }),
      
      // Arcane Blast with Magi's Spark or Leydrinker
      spell.cast("Arcane Blast", on => this.getCurrentTarget(), () => {
        const hasSpark = this.hasTargetMagisSpark();
        const hasLeydrinker = me.hasAura(auras.leydrinker);
        const arcaneCharges = this.getArcaneCharges();
        
        return (hasSpark || hasLeydrinker) && arcaneCharges === 4;
      }),
      
      // Arcane Orb when low on charges
      spell.cast("Arcane Orb", on => this.getCurrentTarget(), () => {
        const arcaneCharges = this.getArcaneCharges();
        const hasHighVoltage = this.hasTalent("High Voltage");
        
        return (arcaneCharges < 3) || (arcaneCharges < (hasHighVoltage ? 2 : 1));
      }),
      
      // Arcane Barrage with Intuition
      spell.cast("Arcane Barrage", on => this.getCurrentTarget(), () => {
        return me.hasAura(auras.intuition);
      }),
      
      // Default to Arcane Blast
      spell.cast("Arcane Blast", on => this.getCurrentTarget()),
      
      // Final fallback to Arcane Barrage
      spell.cast("Arcane Barrage", on => this.getCurrentTarget())
    );
  }
  
  // AoE rotation - Implements the spellslinger_aoe action list
  aoeRotation() {
    return new bt.Selector(
      // First run cooldown rotation if appropriate
      new bt.Decorator(
        () => this.shouldUseCooldowns(),
        this.cooldownRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Supernova if we have max Unerring Proficiency stacks
      spell.cast("Supernova", () => {
        const proficiencyAura = me.getAura(auras.unerringProficiency);
        return proficiencyAura && proficiencyAura.stacks === 30;
      }),
      
      // Shifting Power in AoE
      spell.cast("Shifting Power", () => {
        if (!Settings.UseShiftingPower) return false;
        
        const arcaneSurgeUp = me.hasAura(auras.arcaneSurge);
        const siphonStormUp = me.hasAura(auras.siphonStorm);
        const touchUp = this.hasTargetTouchOfTheMagi();
        const orbCharges = spell.getCharges("Arcane Orb");
        const touchCooldown = spell.getCooldown("Touch of the Magi");
        const evoCooldown = spell.getCooldown("Evocation");
        const hasShiftingShards = this.hasTalent("Shifting Shards");
        
        // Based on SimC logic for AoE
        return ((arcaneSurgeUp === false && siphonStormUp === false && touchUp === false && 
                evoCooldown.timeleft > 15000 && touchCooldown.timeleft > 10000 && 
                orbCharges === 0) || 
                (spell.getLastSuccessfulSpell() === "Arcane Barrage" && 
                (arcaneSurgeUp || touchUp || evoCooldown.timeleft < 20000) && 
                hasShiftingShards));
      }),
      
      // Arcane Orb to build charges in AoE
      spell.cast("Arcane Orb", on => this.getCurrentTarget(), () => {
        const arcaneCharges = this.getArcaneCharges();
        return arcaneCharges < 3;
      }),
      
      // Arcane Blast if we have Magi's Spark or Leydrinker
      spell.cast("Arcane Blast", on => this.getCurrentTarget(), () => {
        const hasSpark = this.hasTargetMagisSpark();
        const hasLeydrinker = me.hasAura(auras.leydrinker);
        
        return (hasSpark || hasLeydrinker) && spell.getLastSuccessfulSpell() !== "Arcane Blast";
      }),
      
      // Barrage if we have Aether Attunement and High Voltage
      spell.cast("Arcane Barrage", on => this.getCurrentTarget(), () => {
        const hasAether = me.hasAura(auras.aetherAttunement);
        const hasHighVoltage = this.hasTalent("High Voltage");
        const hasClearcasting = me.hasAura(auras.clearcasting);
        const arcaneCharges = this.getArcaneCharges();
        
        return hasAether && hasHighVoltage && hasClearcasting && arcaneCharges > 1;
      }),
      
      // Missiles with Clearcasting in AoE
      spell.cast("Arcane Missiles", on => this.getCurrentTarget(), () => {
        const hasClearcasting = me.hasAura(auras.clearcasting);
        const hasHighVoltage = this.hasTalent("High Voltage");
        const arcaneCharges = this.getArcaneCharges();
        const hasNetherPrecision = me.hasAura(auras.netherPrecision);
        
        return hasClearcasting && ((hasHighVoltage && arcaneCharges < 4) || !hasNetherPrecision);
      }),
      
      // Presence of Mind at low charges
      spell.cast("Presence of Mind", () => {
        if (!Settings.UsePresenceOfMind) return false;
        
        const arcaneCharges = this.getArcaneCharges();
        return arcaneCharges === 3 || arcaneCharges === 2;
      }),
      
      // Barrage at max charges
      spell.cast("Arcane Barrage", on => this.getCurrentTarget(), () => {
        const arcaneCharges = this.getArcaneCharges();
        return arcaneCharges === 4;
      }),
      
      // Arcane Explosion for AoE
      spell.cast("Arcane Explosion", () => {
        const arcaneCharges = this.getArcaneCharges();
        const hasReverberate = this.hasTalent("Reverberate");
        
        return hasReverberate || arcaneCharges < 2;
      }),
      
      // Default to Arcane Blast if nothing else to do
      spell.cast("Arcane Blast", on => this.getCurrentTarget()),
      
      // Fallback to Arcane Barrage if we can't cast anything else
      spell.cast("Arcane Barrage", on => this.getCurrentTarget())
    );
  }

}
