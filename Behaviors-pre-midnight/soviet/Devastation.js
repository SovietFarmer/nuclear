import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import EvokerCommon from "@/Behaviors/EvokerCommon";
import { defaultCombatTargeting as Combat, defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { PowerType } from "@/Enums/PowerType";
import Specialization from "@/Enums/Specialization";
import Spell from "@/Core/Spell";

const auras = {
  dragonRage: 375087,
  essenceBurst: 359618,
  burnout: 375802,
  massDisintegrate: 436336,
  leapingFlames: 370901,
  iridescenceBlue: 386399,
  shatteringStar: 370452,
  tipTheScales: 370553,
  deepBreath: 433874,
};

export class EvokerDevastationBehavior extends Behavior {
  name = "PVE Devastation Evoker";
  context = BehaviorContext.Any;
  specialization = Specialization.Evoker.Devastation;

  // Static variable to store the Deep Breath target
  static deepBreathTarget = null;

  static settings = [
    {
      header: "Defensives",
      options: [
        { type: "checkbox", uid: "EvokerDevastationUseRenewingBlaze", text: "Use Renewing Blaze", default: true },
        { type: "checkbox", uid: "EvokerDevastationUseObsidianScales", text: "Use Obsidian Scales", default: true },
      ]
    },
    {
      header: "Damage",
      options: [
        { type: "checkbox", uid: "EvokerDevastationUseDeepBreath", text: "Use Deep Breath", default: true },
        { type: "slider", uid: "EvokerDevastationDeepBreathMinTargets", text: "Deep Breath Minimum Targets", min: 1, max: 10, default: 3 },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      new bt.Action(() => EvokerCommon.handleEmpoweredSpell()),
      // Deep Breath cancellation check
      new bt.Decorator(
        () => this.shouldCancelDeepBreath(),
        new bt.Action(() => {
          me.cancelAura(auras.deepBreath);
          return bt.Status.Success;
        })
      ),
      common.waitForCastOrChannel(),
      spell.cast("Renewing Blaze", on => me,
        req => Settings.EvokerDevastationUseRenewingBlaze && (me.pctHealth < 50 || combat.targets.length > 2)
      ),
      spell.cast("Obsidian Scales", on => me,
        req => Settings.EvokerDevastationUseObsidianScales && (me.pctHealth < 40 || combat.targets.length > 3) && !me.hasAura("Renewing Blaze")
      ),
      spell.interrupt("Quell"),
      common.waitForTarget(),
      common.waitForFacing(),
      new bt.Decorator(
        ret => me.target && me.distanceTo(me.target) < 25 && me.hasAura(auras.dragonRage),
        this.burstRotation()
      ),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        this.outsideDragonRageRotation()
      )
    );
  }

  burstRotation() {
    return new bt.Selector(
      spell.cast("Fire Breath", on => me.target, req => me.hasAuraByMe(auras.tipTheScales)),
      spell.cast("Shattering Star", on => me.target, req => this.shouldCastShatteringStar()),
      spell.cast("Tip the Scales", on => me, req => me.hasAuraByMe(auras.dragonRage)),
      EvokerCommon.castEmpowered("Fire Breath", 1, on => me.target, req => true),
      EvokerCommon.castEmpowered("Eternity Surge", 1, on => me.target, req => true),
      spell.cast("Disintegrate", on => me.target, req => me.hasAura(auras.massDisintegrate)),
      spell.cast("Disintegrate", on => me.target, req => me.hasAura(auras.essenceBurst)),
      spell.cast("Living Flame", on => me.target, req => me.hasAura(auras.leapingFlames) || me.hasAura(auras.burnout)),
      spell.cast("Disintegrate", on => me.target, req => true),
      spell.cast("Azure Strike", on => me.target, req => true),
    );
  }

  outsideDragonRageRotation() {
    return new bt.Selector(
      new bt.Sequence(
        // Store the Deep Breath target and cast
        new bt.Action(() => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          if (bestTarget.unit) {
            // Store the target in our static variable
            EvokerDevastationBehavior.deepBreathTarget = bestTarget.unit;
            return bt.Status.Success;
          }
          return bt.Status.Failure;
        }),
        spell.cast("Deep Breath",
          on => {
            const bestTarget = EvokerCommon.findBestDeepBreathTarget();
            return bestTarget.unit ? bestTarget.unit.position : null;
          },
          req => {
            if (!Settings.EvokerDevastationUseDeepBreath) return false;
            const bestTarget = EvokerCommon.findBestDeepBreathTarget();
            return combat.targets.length > 2 && bestTarget.count >= Settings.EvokerDevastationDeepBreathMinTargets;
          }
        )
      ),
      spell.cast("Dragonrage", on => me.target, req => me.target && Combat.burstToggle),
      spell.cast("Shattering Star", on => me.target, req => this.shouldCastShatteringStar()),
      EvokerCommon.castEmpowered("Fire Breath", 2, on => me.target, ret => true),
      this.castEternitySurge(),
      spell.cast("Disintegrate", on => me.target, req => me.hasAura(auras.massDisintegrate)),
      spell.cast("Living Flame", on => me.target, req => me.hasAura(auras.burnout) && me.powerByType(PowerType.Essence) < 4),
      spell.cast("Disintegrate", on => me.target, req => me.hasAura(auras.essenceBurst)),
      spell.cast("Disintegrate", on => me.target, req => me.powerByType(PowerType.Essence) >= 3),
      spell.cast("Living Flame", on => me.target, req => me.hasAura(auras.burnout) && me.powerByType(PowerType.Essence) < 4),
      spell.cast("Azure Strike", on => me.target, req => combat.targets.length >= 3 && me.powerByType(PowerType.Essence) < 3),
      spell.cast("Disintegrate", on => me.target, req => true),
      spell.cast("Azure Strike", on => me.target, req => true),
    );
  }

  shouldCastShatteringStar() {
    const essenceBurst = me.getAura(auras.essenceBurst);
    if (!essenceBurst) return true;
    return essenceBurst.stacks < 2;
  }

  castEternitySurge() {
    return new bt.Decorator(
      ret => combat.targets.length > 0,
      new bt.Sequence(
        EvokerCommon.castEmpowered("Eternity Surge", this.getEternitySurgeEmpowerLevel(), on => me.target, ret => true)
      )
    );
  }

  getEternitySurgeEmpowerLevel() {
    const targetCount = combat.targets.length;
    if (targetCount >= 7) return 4;
    if (targetCount >= 5) return 3;
    if (targetCount >= 3) return 2;
    return 1;
  }

  shouldCancelDeepBreath() {
    const deepBreath = me.getAuraByMe(auras.deepBreath);
    if (!deepBreath) {
      return false;
    }
    // Check if we have a stored Deep Breath target and are within 1 yards
    if (EvokerDevastationBehavior.deepBreathTarget !== null) {
      try {
        // Validate the cached unit is still valid
        const distance = me.distanceTo(EvokerDevastationBehavior.deepBreathTarget);
        if (distance < 1) {
          // Clear the stored target once we cancel
          EvokerDevastationBehavior.deepBreathTarget = null;
          return true;
        }
      } catch (error) {
        // Unit has been invalidated, clear cache
        EvokerDevastationBehavior.deepBreathTarget = null;
      }
    }

    return false;
  }
}
