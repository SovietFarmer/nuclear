import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import Pet from "@/Core/Pet";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class HunterBeastMasteryBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Hunter.BeastMastery;
  name = "FW Hunter BeastMastery";
  version = 1;
  static settings = [
    {
      header: "Beast Mastery Configuration",
      options: [
        {
          uid: "UseRacials",
          name: "Use Racial Abilities",
          type: "checkbox",
          default: true
        },
        {
          uid: "AOEThreshold",
          name: "AOE Threshold",
          type: "slider",
          min: 2,
          max: 5,
          default: 2
        }
      ]
    }
  ];
  

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      this.summonPet(),
      spell.cast("Aspect of the Wild", req => !me.isMoving() && this.shouldUseOffensiveCDs()),
      // new bt.Decorator(
      //   () => this.shouldUseTrinkets(),
      //   // this.useTrinkets(),
      //   new bt.Action(() => bt.Status.Success)
      // ),
      // new bt.Decorator(
      //   () => this.shouldUseRacials(),
      //   this.useRacials(),
      //   new bt.Action(() => bt.Status.Success)
      // ),
      new bt.Decorator(
        () => this.getEnemyCount() < 2,
        this.singleTargetRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() >= 2,
        this.multiTargetRotation(),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  summonPet() {
    return new bt.Selector(
      Pet.follow(() => me.hasAura("Feign Death")),
      new bt.Action(() => {
        if (!Pet.isAlive() && !me.isCasting && !me.isChanneling) {
          const callPetSpell = spell.getSpell("Call Pet 1");
          if (callPetSpell && callPetSpell.isKnown && callPetSpell.cooldown.ready) {
            if (callPetSpell.cast()) {
              console.info("Summoning pet");
              return bt.Status.Success;
            }
          }
        }
        return bt.Status.Failure;
      }),
      // Revive pet if needed
      new bt.Action(() => {
        if (Pet.current && Pet.current.deadOrGhost && !me.isCasting && !me.isChanneling) {
          const revivePetSpell = spell.getSpell("Revive Pet");
          if (revivePetSpell && revivePetSpell.isKnown && revivePetSpell.cooldown.ready) {
            if (revivePetSpell.cast()) {
              console.info("Reviving pet");
              return bt.Status.Success;
            }
          }
        }
        return bt.Status.Failure;
      }),
      // Set pet to attack current target
      Pet.attack(() => this.getCurrentTarget())
    );
  }

  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Improvised Seaforium Pacemaker", () => this.shouldUseOffensiveCDs()),
      common.useEquippedItemByName("Eye of Kezan", () => this.shouldUseOffensiveCDs()),
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Berserking", req => me.hasAura("Call of the Wild") || me.hasAura("Bestial Wrath")),
      spell.cast("Blood Fury", req => me.hasAura("Call of the Wild") || me.hasAura("Bestial Wrath")),
      spell.cast("Ancestral Call", req => me.hasAura("Call of the Wild") || me.hasAura("Bestial Wrath")),
      spell.cast("Fireblood", req => me.hasAura("Call of the Wild") || me.hasAura("Bestial Wrath")),
      spell.cast("Lights Judgment", req => !me.hasAura("Bestial Wrath")),
      spell.cast("Bag of Tricks", req => !me.hasAura("Bestial Wrath"))
    );
  }

  singleTargetRotation() {
    return new bt.Selector(
      // From actions.st
      spell.cast("Dire Beast", req => this.hasTalent("Huntmaster's Call")),
      spell.cast("Bestial Wrath", req => this.shouldUseOffensiveCDs()),
      this.castBarbedShot(),
      spell.cast("Kill Command", req => spell.getChargesFractional("Kill Command") >= spell.getChargesFractional("Barbed Shot")),
      spell.cast("Call of the Wild", req => this.shouldUseOffensiveCDs()),
      spell.cast("Bloodshed", req => this.shouldUseOffensiveCDs()),
      spell.cast("Black Arrow", req => this.hasTalent("Black Arrow")),
      spell.cast("Explosive Shot", req => this.hasTalent("Thundering Hooves")),
      spell.cast("Cobra Shot"),
      spell.cast("Dire Beast"),
      spell.cast("Arcane Pulse", req => !me.hasAura("Bestial Wrath")),
      spell.cast("Arcane Torrent", req => (me.powerByType(PowerType.Focus) + me.regenRate + 15) < me.maxPowerByType(PowerType.Focus))
    );
  }

  multiTargetRotation() {
    return new bt.Selector(
      // From actions.cleave
      spell.cast("Bestial Wrath"),
      this.castBarbedShot(),
      this.castMultiShot(),
      spell.cast("Black Arrow", req => me.hasAura("Beast Cleave")),
      spell.cast("Call of the Wild", req => this.shouldUseOffensiveCDs()),
      spell.cast("Bloodshed", req => this.shouldUseOffensiveCDs()),
      spell.cast("Dire Beast", req => this.hasTalent("Shadow Hounds") || this.hasTalent("Dire Cleave")),
      spell.cast("Explosive Shot", req => this.hasTalent("Thundering Hooves")),
      spell.cast("Kill Command"),
      spell.cast("Cobra Shot", req => me.powerByType(PowerType.Focus) > 40 || me.getAuraStacks("Hogstrider") > 3),
      spell.cast("Dire Beast"),
      spell.cast("Explosive Shot"),
      spell.cast("Bag of Tricks", req => !me.hasAura("Bestial Wrath")),
      spell.cast("Arcane Torrent", req => (me.powerByType(PowerType.Focus) + me.regenRate + 30) < me.maxPowerByType(PowerType.Focus))
    );
  }

  castBarbedShot() {
    return spell.cast("Barbed Shot", on => this.getCurrentTarget(), req => {
      const barbedShot = spell.getSpell("Barbed Shot");
      if (!barbedShot) return false;
      
      // Get recharge time and charges
      const fullRechargeTime = spell.getFullRechargeTime("Barbed Shot");
      const chargesFractional = spell.getChargesFractional("Barbed Shot");
      const killCommandCharges = spell.getChargesFractional("Kill Command");
      
      // Conditions from simc: full_recharge_time<gcd|charges_fractional>=cooldown.kill_command.charges_fractional|
      // talent.call_of_the_wild&cooldown.call_of_the_wild.ready
      return fullRechargeTime < 1.5 || 
             chargesFractional >= killCommandCharges || 
             (this.hasTalent("Call of the Wild") && spell.getCooldown("Call of the Wild").ready);
    });
  }

  castMultiShot() {
    return spell.cast("Multi-Shot", req => {
      const beastCleave = Pet.current ? Pet.current.getAuraByMe("Beast Cleave") : null;
      const beastCleaveRemains = beastCleave ? beastCleave.remaining : 0;
      
      return beastCleaveRemains < (0.25 + 1.5) && (!this.hasTalent("Bloody Frenzy") || !spell.getCooldown("Call of the Wild").ready);
    });
  }

  // Helper methods
  getCurrentTarget() {
    const target = me.target;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  getEnemyCount() {
    const aoeThreshold = 2; // Can be adjusted or made configurable
    const targetsInRange = combat.targets.filter(unit => unit.distanceTo(me) <= 40);
    return targetsInRange.length;
  }

  shouldUseOffensiveCDs() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    
    // Don't use CDs if the target is about to die
    const ttd = target.timeToDeath();
    if (ttd !== undefined && ttd < 15) return false;
    
    return true;
  }

  shouldUseTrinkets() {
    return this.shouldUseOffensiveCDs();
  }

  shouldUseRacials() {
    return this.shouldUseOffensiveCDs();
  }

  hasTalent(talentName) {
    return spell.isSpellKnown(talentName);
  }
}